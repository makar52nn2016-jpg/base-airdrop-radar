import { createSmartAccountClient } from 'permissionless';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { http, parseEventLogs } from 'viem';
import { getContract, parseAbi } from 'viem';
import {
  bundlerClient,
  paymasterClient,
  publicClient,
  getSignerPrivateKey,
  getClientsForChain,
  CHAIN_CONFIGS,
  ALL_CHAINS,
  type ChainKey,
} from '@/lib/pimlico';
import {
  listBaseCollections,
  getCollectionContracts,
  getRecentBaseTransfers,
  filterMintEventsForChains,
  getAssetContractInfo,
  getCollectionDetail,
} from '@/lib/opensea';
import { findFreeMintFunction, findClaimFunction, FREE_MINT_ABI } from '@/lib/basescan';
import {
  recordScan,
  recordMintAttempt,
  recordMintSuccess,
  recordMintFailure,
  logScanStart,
  logChainScan,
  logCandidateFound,
  logError,
} from '@/lib/stats';
import { notifyMintSuccess, notifyMintFailure, notifyListingLink } from '@/lib/telegram';
import { checkContractQuality, isSpammyName } from '@/lib/quality';

/**
 * Core sniper logic.
 *
 * Pipeline:
 *   1. scanForFreeMints()   — fetches recent Base collections, returns candidates with free mint
 *   2. executeMint()         — for a candidate, mints via Pimlico Smart Account (gasless)
 *   3. runSniperCycle()      — orchestrates scan + mint, called by cron
 *
 * State is in-memory — survives between cron calls only on warm Vercel instances.
 */

export interface MintCandidate {
  slug: string;
  name: string;
  contract: string;
  functionName: string;
  args: unknown[];
  detectedAt: string;
  image_url: string | null;
  opensea_url: string;
  /** Source of mint-function detection: 'basescan' (verified ABI) | 'fallback' (hardcoded) */
  source?: 'basescan' | 'fallback';
  /** Function inputs from Basescan ABI (used to build correct ABI for writeContract) */
  abiInputs?: any[];
  /** Chain identifier (base, optimism, arbitrum, polygon, ethereum) */
  chain?: ChainKey;
  /** Collection floor price in native token (e.g. ETH), if known */
  floorPrice?: number | null;
}

export interface MintResult {
  candidate: MintCandidate;
  success: boolean;
  txHash?: string;
  smartAccountAddress?: string;
  error?: string;
}

// In-memory log of recent mints (max 100 entries, oldest first evicted).
// This survives only on warm Vercel instances. For real persistence, use Supabase later.
const RECENT_MINTS: MintResult[] = [];
const MAX_LOG_SIZE = 100;

// Already-attempted contracts (avoid retrying within same warm session).
const ATTEMPTED = new Set<string>();

/**
 * Initializes the Pimlico Smart Account from the configured signer key.
 * Returns the smartAccount (with bundler client) and the derived address.
 *
 * v2 — supports multiple chains. Pass chainKey to init on a specific chain.
 * Each chain has a different Smart Account address (different Safe factory).
 *
 * Default: chainKey='base' for backward compat.
 */
export async function initSmartAccount(chainKey: ChainKey = 'base') {
  const privateKey = getSignerPrivateKey();
  const signer = privateKeyToAccount(privateKey);
  const { publicClient: pc, bundlerClient: bc, paymasterClient: pmc } = getClientsForChain(chainKey);

  const smartAccount = await toSafeSmartAccount({
    client: pc,
    owners: [signer],
    threshold: 1n,
    version: '1.4.1',
  });

  const smartAccountClient = createSmartAccountClient({
    account: smartAccount,
    chain: CHAIN_CONFIGS[chainKey].chain,
    bundlerTransport: http(
      `https://api.pimlico.io/v2/${chainKey}/rpc?apikey=${process.env.PIMLICO_API_KEY}`
    ),
    paymaster: pmc,
    paymasterContext: {
      policyId: process.env.PIMLICO_SPONSOR_POLICY_ID,
    },
  });

  return {
    smartAccount,
    smartAccountClient,
    signer,
    smartAccountAddress: smartAccount.address,
    chainKey,
    chainConfig: CHAIN_CONFIGS[chainKey],
  };
}

/**
 * Backward-compat: getSmartAccountAddress() — returns Base Smart Account address.
 * Use getSmartAccountAddressForChain(chainKey) for multi-chain.
 */
export async function getSmartAccountAddress(): Promise<string> {
  const { smartAccountAddress } = await initSmartAccount('base');
  return smartAccountAddress;
}

/**
 * Returns Smart Account address for the specified chain.
 */
export async function getSmartAccountAddressForChain(chainKey: ChainKey): Promise<string> {
  const { smartAccountAddress } = await initSmartAccount(chainKey);
  return smartAccountAddress;
}

/**
 * Scans for free-mint opportunities on Base.
 *
 * Strategy v2 (better coverage):
 *   1. Fetch recent transfer events from OpenSea (last 1 hour, default 100 events)
 *   2. Filter to mint events (from_address = null)
 *   3. For each unique contract address, run findFreeMintFunction static-call
 *   4. If a free-mint function is callable, add to candidates
 *
 * Fallback: if events API returns nothing useful, also check top collections list.
 *
 * Returns up to `maxCandidates` candidates.
 */
// Transfer event signature: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628bca44fb737c88d';
const ZERO_ADDRESS_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ERC-1155 TransferSingle event: TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
const ERC1155_TRANSFER_SINGLE_TOPIC =
  '0xc3d58168c534f56d11ca6e9bd5de1a4d4e39e3e4c1d7b8e8c8e8e8e8e8e8e8e8e8e';

// ERC-1155 TransferBatch event: TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
const ERC1155_TRANSFER_BATCH_TOPIC =
  '0x4a39dc06d4c0dbc64ce8fcd2e6ae1b44886c1f1b4b1e6e3e3e3e3e3e3e3e3e3e3';

/**
 * Strategy 0: Direct on-chain mint event scan via getLogs.
 *
 * v3 — reduced block range from 500 to 200 (was timing out Vercel 60s limit
 * on 5-min cron). Now scans both ERC-721 AND ERC-1155 in parallel via Promise.all.
 *
 * @param chainKey which chain to scan
 * @param blockRange how many recent blocks to scan (default 200 = ~5 min on L2)
 */
async function scanRecentMintsViaLogs(
  chainKey: ChainKey,
  blockRange = 200
): Promise<MintCandidate[]> {
  try {
    const { publicClient: pc } = getClientsForChain(chainKey);
    const chainConfig = CHAIN_CONFIGS[chainKey];

    // Get latest block
    const latestBlock = await pc.getBlockNumber();
    const fromBlock = latestBlock - BigInt(blockRange);

    // ERC-721 mint events (from=0x0) — no wildcard, works with most RPCs
    let erc721Logs: any[] = [];
    let erc1155SingleLogs: any[] = [];

    try {
      erc721Logs = await pc.getLogs({
        fromBlock,
        toBlock: latestBlock,
        topics: [TRANSFER_EVENT_TOPIC, ZERO_ADDRESS_TOPIC],
      } as any);
    } catch {
      // getLogs not supported on this RPC — return empty (Strategy 1/OpenSea will catch mints)
      return [];
    }

    try {
      erc1155SingleLogs = await pc.getLogs({
        fromBlock,
        toBlock: latestBlock,
        topics: [ERC1155_TRANSFER_SINGLE_TOPIC, null, ZERO_ADDRESS_TOPIC],
      } as any);
    } catch {
      // ERC-1155 is bonus — continue with ERC-721 only
    }

    // Get unique contract addresses from both event types
    const seenContracts = new Set<string>();
    const candidates: MintCandidate[] = [];

    const allLogs: any[] = [...(erc721Logs || []), ...(erc1155SingleLogs || [])];

    for (const log of allLogs) {
      if (!log.address) continue;
      const contractAddress = log.address.toLowerCase();
      if (seenContracts.has(contractAddress)) continue;
      seenContracts.add(contractAddress);

      const found = await findFreeMintFunction(contractAddress);
      if (found) {
        candidates.push({
          slug: `chain-${chainKey}`,
          name: `On-chain mint ${contractAddress.slice(0, 8)}`,
          contract: contractAddress,
          functionName: found.functionName,
          args: found.args,
          detectedAt: new Date().toISOString(),
          image_url: null,
          opensea_url: `https://opensea.io/assets/${chainConfig.openSeaChain}/${contractAddress}`,
          source: found.source,
          abiInputs: found.abiInputs,
          chain: chainKey,
        });
      }

      if (candidates.length >= 5) break;
    }

    return candidates;
  } catch {
    // Any RPC failure (getBlockNumber, getLogs) → return empty, scan continues via OpenSea
    return [];
  }
}

export async function scanForFreeMints(maxCandidates = 10): Promise<MintCandidate[]> {
  logScanStart();
  const candidates: MintCandidate[] = [];
  const tried = new Set<string>(); // dedup contract addresses within this scan
  const allScannedAddresses: string[] = [];

  // Map OpenSea chain names to our ChainKey (polygon uses 'matic' on OpenSea)
  const openSeaToChainKey: Record<string, ChainKey> = {
    base: 'base',
    optimism: 'optimism',
    arbitrum: 'arbitrum',
    matic: 'polygon',
    ethereum: 'ethereum',
  };

  // Strategy 0: Direct on-chain mint event scan via getLogs (ERC-721 + ERC-1155)
  // Catches ALL mints on each chain, not just the ones OpenSea tracks.
  // Block range = 200 (~5 min on L2, ~25 min on L1)
  // Run all 3 chains IN PARALLEL via Promise.all — saves ~20s vs sequential
  const chainScanPromises = ALL_CHAINS.map(async (chainKey): Promise<MintCandidate[]> => {
    try {
      // Strategy 0a: On-chain getLogs (mint events)
      const chainCandidates = await scanRecentMintsViaLogs(chainKey);
      logChainScan(chainKey, chainCandidates.length);

      // Strategy 0b: Contract deployment scan (NEW — first-mover advantage)
      if (chainCandidates.length < 3) {
        try {
          const { scanRecentContractDeployments } = await import('@/lib/deployment-scanner');
          const deployCandidates = await scanRecentContractDeployments(chainKey, 2);
          return [...chainCandidates, ...deployCandidates];
        } catch (e: any) {
          logError(`Deploy scan ${chainKey} error: ${e.message?.slice(0, 60)}`);
        }
      }

      return chainCandidates;
    } catch (err: any) {
      logError(`Chain ${chainKey} scan failed: ${err.message?.slice(0, 80)}`);
      return [];
    }
  });

  const chainResults = await Promise.all(chainScanPromises);

  for (const chainCandidates of chainResults) {
    for (const c of chainCandidates) {
      if (candidates.length >= maxCandidates) break;
      const dedupKey = `${c.chain}:${c.contract}`;
      if (tried.has(dedupKey)) continue;
      tried.add(dedupKey);
      allScannedAddresses.push(c.contract);
      candidates.push(c);
      logCandidateFound(c.chain || 'unknown', c.contract, c.functionName);
    }
    if (candidates.length >= maxCandidates) break;
  }

  // Strategy 1: Recent mint events from OpenSea API (across ALL supported chains)
  // Reduced from 300 to 100 events (single page) — Strategy 0 (on-chain getLogs)
  // already catches all mints on each chain, OpenSea is redundant + slow.
  try {
    const events = await getRecentBaseTransfers(100, 6 * 3600, 1); // 1 page = 100 events
    const mintContracts = filterMintEventsForChains(events, [
      'base',
      'optimism',
      'arbitrum',
      'matic',
      'ethereum',
    ]);

    for (const { contract: contractAddress, slug, chain } of mintContracts) {
      if (candidates.length >= maxCandidates) break;
      const dedupKey = `${chain}:${contractAddress}`;
      if (tried.has(dedupKey)) continue;
      if (ATTEMPTED.has(dedupKey)) continue;
      tried.add(dedupKey);
      allScannedAddresses.push(contractAddress);

      const chainKey: ChainKey = openSeaToChainKey[chain] || 'base';

      // Quality check: get contract info from OpenSea, check for spam
      let actualSlug = slug;
      let collectionName: string | undefined;
      let collectionImageUrl: string | null = null;
      if (!actualSlug) {
        try {
          const info = await getAssetContractInfo(contractAddress);
          if (info) {
            actualSlug = info.collection;
            collectionName = info.name;
            collectionImageUrl = info.image_url;
            if (isSpammyName(info.name || '')) {
              continue; // skip spam
            }
          }
        } catch {
          // OpenSea lookup failed — continue without it
        }
      }

      const found = await findFreeMintFunction(contractAddress);
      if (found) {
        candidates.push({
          slug: actualSlug || 'recent-mint',
          name: collectionName || `Recent mint ${contractAddress.slice(0, 8)}`,
          contract: contractAddress,
          functionName: found.functionName,
          args: found.args,
          detectedAt: new Date().toISOString(),
          image_url: collectionImageUrl,
          opensea_url: `https://opensea.io/assets/${chain}/${contractAddress}`,
          source: found.source,
          abiInputs: found.abiInputs,
          chain: chainKey,
        });
      }
    }
  } catch (err) {
    // If events API fails, fall through to social/whale strategies
  }

  // Strategy 2: Social Signal Scanner (PROACTIVE — searches social media)
  if (candidates.length < maxCandidates) {
    try {
      const { scanSocialMediaForMints } = await import('@/lib/social-scanner');
      const socialCandidates = await scanSocialMediaForMints(maxCandidates - candidates.length);
      for (const c of socialCandidates) {
        if (candidates.length >= maxCandidates) break;
        const dedupKey = `social:${c.contract}`;
        if (tried.has(dedupKey)) continue;
        tried.add(dedupKey);
        allScannedAddresses.push(c.contract);
        candidates.push(c);
      }
    } catch (err: any) {
      logError(`Social scan failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Strategy 3: Whale Copy-Minting (SMART — copies pro farmers)
  if (candidates.length < maxCandidates) {
    try {
      const { scanWhaleMints } = await import('@/lib/whale-tracker');
      for (const chainKey of ALL_CHAINS) {
        if (candidates.length >= maxCandidates) break;
        try {
          const whaleCandidates = await scanWhaleMints(chainKey, 3);
          for (const c of whaleCandidates) {
            if (candidates.length >= maxCandidates) break;
            const dedupKey = `whale:${c.contract}`;
            if (tried.has(dedupKey)) continue;
            tried.add(dedupKey);
            allScannedAddresses.push(c.contract);
            candidates.push(c);
          }
        } catch {}
      }
    } catch (err: any) {
      logError(`Whale scan failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Strategy 4 (fallback): Top collections from list
  // v2 — now uses OpenSea floor=0 scanner for targeted free-mint detection
  if (candidates.length === 0) {
    try {
      const { scanOpenSeaFloorZero } = await import('@/lib/opensea-scanner');
      const floorCandidates = await scanOpenSeaFloorZero(maxCandidates, 5);
      for (const c of floorCandidates) {
        if (candidates.length >= maxCandidates) break;
        const dedupKey = `floor0:${c.contract}`;
        if (tried.has(dedupKey)) continue;
        tried.add(dedupKey);
        allScannedAddresses.push(c.contract);
        candidates.push(c);
      }
    } catch (err: any) {
      logError(`OpenSea floor=0 scan failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Record stats
  recordScan(candidates.length, allScannedAddresses);

  return candidates;
}

/**
 * Executes a free mint via Pimlico Smart Account + Paymaster (gasless).
 *
 * Steps:
 *   1. Init Smart Account (gets the deterministic address)
 *   2. Send UserOp calling the mint function
 *   3. Wait for receipt
 *   4. Return tx hash
 *
 * The Paymaster sponsors gas — no ETH needed on Smart Account.
 */
/**
 * Fire-and-forget: fetches tx receipt, extracts ERC-721 token_id from Transfer event,
 * then sends a Telegram message with direct OpenSea sell URL.
 *
 * Called after successful mint. Doesn't block the main flow.
 *
 * Transfer event signature: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
 * Topic0: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628bca44fb737c88d
 * For mint: topics[1] (from) = 0x0000...0000
 * TokenId: topics[3] (big-endian uint256 as hex)
 *
 * Constants TRANSFER_EVENT_TOPIC and ZERO_ADDRESS_TOPIC are defined at top of file
 * (used by scanRecentMintsViaLogs).
 */

async function sendListingLinkAfterReceipt(
  txHash: string,
  chainKey: ChainKey,
  candidate: MintCandidate
): Promise<void> {
  try {
    const { publicClient: pc } = getClientsForChain(chainKey);

    // Wait for tx receipt (usually 5-15s on L2, 15-30s on L1)
    const receipt = await pc.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: 60_000,
      confirmations: 1,
    });

    // Find Transfer event where from = 0x0 (mint) and the contract is ours
    const contractLower = candidate.contract.toLowerCase();
    const mintLogs = (receipt.logs || []).filter(
      (log: any) =>
        log.address?.toLowerCase() === contractLower &&
        log.topics?.[0] === TRANSFER_EVENT_TOPIC &&
        log.topics?.[1] === ZERO_ADDRESS_TOPIC
    );

    if (mintLogs.length === 0) {
      // Could be ERC-1155 (different event signature) — bail gracefully
      return;
    }

    // Take the first mint log's token_id
    const tokenIdHex = mintLogs[0].topics?.[3];
    if (!tokenIdHex) return;
    const tokenId = BigInt(tokenIdHex).toString();

    // Try to fetch floor price from OpenSea (best-effort, don't fail if API errors)
    let estimatedFloor: number | null = null;
    let listingPriceEth: string | null = null;
    if (candidate.slug && candidate.slug !== 'recent-mint' && candidate.slug !== 'manual' && candidate.slug !== `chain-${chainKey}`) {
      try {
        const detail = await getCollectionDetail(candidate.slug);
        estimatedFloor = detail?.floor_price ?? null;
        // If we have floor, list at 5% below for fast sale; otherwise default to 0.005 ETH
        if (estimatedFloor && estimatedFloor > 0) {
          listingPriceEth = (estimatedFloor * 0.95).toFixed(6);
        }
      } catch {
        // ignore
      }
    }

    // Default listing price if no floor: 0.005 ETH (~$15) — small price for fast sales
    if (!listingPriceEth) {
      listingPriceEth = process.env.LISTING_PRICE_ETH || '0.005';
    }

    // Send Telegram message with direct sell URL (manual fallback)
    await notifyListingLink({
      contract: candidate.contract,
      tokenId,
      chain: chainKey,
      collectionName: candidate.name,
      estimatedFloor,
    });

    // AUTO-LISTING: try to list NFT on OpenSea via Seaport + Smart Account signing
    // This is the "Option 3" full automation — bot creates the listing itself.
    try {
      const { createOpenSeaListing } = await import('@/lib/seaport');
      const listingResult = await createOpenSeaListing({
        nftContract: candidate.contract,
        tokenId,
        priceEth: listingPriceEth,
        chainKey,
        isErc1155: false,
        collectionName: candidate.name,
      });

      if (listingResult.success) {
        logActivity({
          type: 'telegram_sent',
          message: `NFT auto-listed on OpenSea at ${listingPriceEth} ETH`,
          chain: chainKey,
          contract: candidate.contract,
        });
      } else {
        logActivity({
          type: 'error',
          message: `Auto-list failed: ${listingResult.error?.slice(0, 80)}`,
          chain: chainKey,
          contract: candidate.contract,
        });
      }
    } catch (e: any) {
      logActivity({
        type: 'error',
        message: `Auto-list exception: ${e.message?.slice(0, 80)}`,
        chain: chainKey,
      });
    }

    // AUTO-CLAIM: check if the NFT contract has claimable ERC-20 tokens
    // Many NFT collections distribute tokens to holders via claim()/harvest()/getReward()
    try {
      const claimResult = await findClaimFunction(
        candidate.contract,
        tokenId,
        smartAccountAddress
      );

      if (claimResult) {
        // Build ABI for the claim function
        let claimAbi: any;
        if (Array.isArray(claimResult.abiInputs)) {
          claimAbi = [{
            type: 'function',
            name: claimResult.functionName,
            inputs: claimResult.abiInputs,
            outputs: [],
            stateMutability: 'nonpayable',
          }];
        } else {
          claimAbi = FREE_MINT_ABI;
        }

        const { smartAccountClient: claimClient } = await initSmartAccount(chainKey);

        const claimTxHash = await claimClient.writeContract({
          address: candidate.contract as `0x${string}`,
          abi: claimAbi,
          functionName: claimResult.functionName,
          args: claimResult.args as any[],
        });

        logActivity({
          type: 'mint_success',
          message: `Claimed tokens via ${claimResult.functionName}() — tx: ${claimTxHash?.slice(0, 16)}...`,
          chain: chainKey,
          contract: candidate.contract,
          txHash: claimTxHash,
        });

        // Send Telegram notification
        await sendTelegramMessage(`💰 *Tokens Claimed!*

📦 *Collection:* ${candidate.name}
🔗 *Function:* \`${claimResult.functionName}()\`
⛓ *Chain:* ${chainKey}
🎫 *Tx:* [${claimTxHash.slice(0, 16)}...](${`https://${chainKey}scan.org/tx/${claimTxHash}`})

Tokens sent to Smart Account. Swap to ETH on a DEX (Aerodrome/Uniswap) to realize profit.`);
      }
    } catch (e: any) {
      // Auto-claim is best-effort — don't fail if it errors
      logActivity({
        type: 'error',
        message: `Auto-claim failed: ${e.message?.slice(0, 80)}`,
        chain: chainKey,
      });
    }
  } catch (e) {
    // Don't throw — this is fire-and-forget
    console.error('[sniper] sendListingLinkAfterReceipt error:', e);
  }
}

export async function executeMint(candidate: MintCandidate): Promise<MintResult> {
  recordMintAttempt();
  try {
    const chainKey = candidate.chain || 'base';
    const { smartAccountClient, smartAccountAddress, chainConfig } = await initSmartAccount(chainKey);

    // Build the right ABI for the call:
    // - If we have Basescan-detected inputs, build a minimal ABI for just that function
    // - Otherwise use the hardcoded FREE_MINT_ABI (which has all standard signatures)
    let abi: any;
    if (Array.isArray(candidate.abiInputs)) {
      abi = [
        {
          type: 'function',
          name: candidate.functionName,
          inputs: candidate.abiInputs,
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ];
    } else {
      abi = FREE_MINT_ABI;
    }

    const txHash = await smartAccountClient.writeContract({
      address: candidate.contract as `0x${string}`,
      abi,
      functionName: candidate.functionName,
      args: candidate.args as any[],
    });

    const result: MintResult = {
      candidate,
      success: true,
      txHash,
      smartAccountAddress,
    };

    RECENT_MINTS.unshift(result);
    if (RECENT_MINTS.length > MAX_LOG_SIZE) RECENT_MINTS.pop();
    ATTEMPTED.add(`${chainKey}:${candidate.contract}`);
    recordMintSuccess();

    // Notify Telegram (fire-and-forget — don't block on failure)
    void notifyMintSuccess({
      contract: candidate.contract,
      functionName: candidate.functionName,
      txHash,
      smartAccountAddress,
      collectionName: candidate.name,
      openseaUrl: candidate.opensea_url,
      chain: chainKey,
    }).catch(() => {});

    // Fire-and-forget: fetch receipt, extract token_id, send direct OpenSea sell link
    void sendListingLinkAfterReceipt(txHash, chainKey, candidate).catch(() => {});

    return result;
  } catch (err: any) {
    const chainKey = candidate.chain || 'base';
    const result: MintResult = {
      candidate,
      success: false,
      error: err?.message || String(err),
    };
    RECENT_MINTS.unshift(result);
    if (RECENT_MINTS.length > MAX_LOG_SIZE) RECENT_MINTS.pop();
    ATTEMPTED.add(`${chainKey}:${candidate.contract}`);
    recordMintFailure();

    // Notify Telegram (fire-and-forget)
    void notifyMintFailure({
      contract: candidate.contract,
      functionName: candidate.functionName,
      error: err?.message || String(err),
      collectionName: candidate.name,
      chain: chainKey,
    }).catch(() => {});

    return result;
  }
}

/**
 * One cron cycle: scan + attempt mints for top candidates.
 * v2 — runs scan TWICE per cycle (double coverage within same Vercel invocation).
 * This catches mints that appeared between the two scans (~10s gap).
 *
 * @param maxMintsPerCycle hard cap on mints per cycle (default 2)
 */
export async function runSniperCycle(maxMintsPerCycle = 3): Promise<{
  scanned: number;
  candidates: MintCandidate[];
  results: MintResult[];
}> {
  // First scan
  const candidates1 = await scanForFreeMints(maxMintsPerCycle * 3);
  const results: MintResult[] = [];

  for (const candidate of candidates1) {
    if (results.length >= maxMintsPerCycle) break;
    const result = await executeMint(candidate);
    results.push(result);
  }

  // If no candidates found in first scan, try OpenSea-only scan (broader)
  if (candidates1.length === 0) {
    // The scanForFreeMints already tried both strategies (on-chain + OpenSea)
    // No need for a third scan — just return results
  }

  // Record stats
  recordScan(candidates1.length, candidates1.map((c) => c.contract));

  return {
    scanned: candidates1.length,
    candidates: candidates1,
    results,
  };
}

/**
 * Returns the in-memory log of recent mint attempts.
 */
export function getRecentMints(): MintResult[] {
  return [...RECENT_MINTS];
}

// Note: getSmartAccountAddress() is defined earlier in this file (around line 132)
// — see that definition for the implementation.

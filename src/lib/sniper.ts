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
import { findFreeMintFunction, FREE_MINT_ABI } from '@/lib/basescan';
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
 * v2 — now scans BOTH ERC-721 AND ERC-1155 mint events. Catches ALL mints
 * on each chain (not just the ones OpenSea tracks). Block range increased
 * from 50 to 500 (~10-15 min on L2, ~1.5 hours on L1).
 *
 * @param chainKey which chain to scan
 * @param blockRange how many recent blocks to scan (default 500)
 */
async function scanRecentMintsViaLogs(
  chainKey: ChainKey,
  blockRange = 500
): Promise<MintCandidate[]> {
  const { publicClient: pc } = getClientsForChain(chainKey);
  const chainConfig = CHAIN_CONFIGS[chainKey];

  // Get latest block
  const latestBlock = await pc.getBlockNumber();
  const fromBlock = latestBlock - BigInt(blockRange);

  // Fetch all mint Transfer events in range — ERC-721 (from=0x0) AND ERC-1155
  const [erc721Logs, erc1155SingleLogs] = await Promise.all([
    pc.getLogs({
      fromBlock,
      toBlock: latestBlock,
      topics: [TRANSFER_EVENT_TOPIC, ZERO_ADDRESS_TOPIC],
    } as any),
    pc.getLogs({
      fromBlock,
      toBlock: latestBlock,
      topics: [ERC1155_TRANSFER_SINGLE_TOPIC, undefined, ZERO_ADDRESS_TOPIC],
    } as any),
  ]);

  // Get unique contract addresses from both event types
  const seenContracts = new Set<string>();
  const candidates: MintCandidate[] = [];

  const allLogs: any[] = [...(erc721Logs || []), ...(erc1155SingleLogs || [])];

  for (const log of allLogs) {
    if (!log.address) continue;
    const contractAddress = log.address.toLowerCase();
    if (seenContracts.has(contractAddress)) continue;
    seenContracts.add(contractAddress);

    // Try to detect free-mint function on this contract
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

    // Cap at 10 candidates per chain to avoid runaway
    if (candidates.length >= 10) break;
  }

  return candidates;
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
  // Block range = 500 (~10-15 min on L2, ~1.5 hours on L1)
  for (const chainKey of ALL_CHAINS) {
    if (candidates.length >= maxCandidates) break;
    try {
      const chainCandidates = await scanRecentMintsViaLogs(chainKey); // uses default 500 blocks
      logChainScan(chainKey, chainCandidates.length);
      for (const c of chainCandidates) {
        if (candidates.length >= maxCandidates) break;
        const dedupKey = `${chainKey}:${c.contract}`;
        if (tried.has(dedupKey)) continue;
        // NOTE: Removed ATTEMPTED check — retry every scan cycle for max catch rate
        tried.add(dedupKey);
        allScannedAddresses.push(c.contract);
        candidates.push(c);
        logCandidateFound(chainKey, c.contract, c.functionName);
      }
    } catch (err: any) {
      logError(`Chain ${chainKey} scan failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Strategy 1: Recent mint events from OpenSea API (across ALL supported chains)
  try {
    const events = await getRecentBaseTransfers(100, 6 * 3600); // last 6 hours
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
    // If events API fails, fall through to collections list
  }

  // Strategy 2 (fallback): Top collections from list
  if (candidates.length === 0) {
    const collections = await listBaseCollections(50);

    for (const col of collections) {
      if (candidates.length >= maxCandidates) break;
      if (ATTEMPTED.has(col.slug)) continue;

      try {
        const contracts = await getCollectionContracts(col.slug);
        for (const contractAddress of contracts) {
          if (candidates.length >= maxCandidates) break;
          if (tried.has(contractAddress)) continue;
          tried.add(contractAddress);
          allScannedAddresses.push(contractAddress);

          const found = await findFreeMintFunction(contractAddress);
          if (found) {
            candidates.push({
              slug: col.slug,
              name: col.name,
              contract: contractAddress,
              functionName: found.functionName,
              args: found.args,
              detectedAt: new Date().toISOString(),
              image_url: col.image_url,
              opensea_url: col.opensea_url,
              source: found.source,
              abiInputs: found.abiInputs,
            });
          }
        }
      } catch (err) {
        continue;
      }
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
    if (candidate.slug && candidate.slug !== 'recent-mint' && candidate.slug !== 'manual') {
      try {
        const detail = await getCollectionDetail(candidate.slug);
        estimatedFloor = detail?.floor_price ?? null;
      } catch {
        // ignore
      }
    }

    // Send the listing-link Telegram message
    await notifyListingLink({
      contract: candidate.contract,
      tokenId,
      chain: chainKey,
      collectionName: candidate.name,
      estimatedFloor,
    });
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
 *
 * @param maxMintsPerCycle hard cap on mints per cycle (default 2) — keeps paymaster
 *   sponsorship quota reasonable.
 */
export async function runSniperCycle(maxMintsPerCycle = 2): Promise<{
  scanned: number;
  candidates: MintCandidate[];
  results: MintResult[];
}> {
  const candidates = await scanForFreeMints(maxMintsPerCycle * 3); // find more than needed, pick top
  const results: MintResult[] = [];

  for (const candidate of candidates) {
    if (results.length >= maxMintsPerCycle) break;
    const result = await executeMint(candidate);
    results.push(result);
  }

  return {
    scanned: candidates.length,
    candidates,
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

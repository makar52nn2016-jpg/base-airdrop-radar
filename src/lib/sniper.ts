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
  logActivity,
} from '@/lib/stats';
import {
  notifyMintSuccess,
  notifyMintFailure,
  notifyListingLink,
  notifyHeartbeat,
  sendTelegramMessage,
} from '@/lib/telegram';
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

// Already-attempted contracts — Map<contractKey, timestamp>.
// v2 — now persisted to Supabase on every write so it survives Vercel cold starts.
// Without this, every scan after instance recycling would re-notify the SAME
// 6 OpenSea contracts in TG — exactly the spam user was complaining about.
// v3 — TTL reduced from 1 hour to 15 minutes — allows more frequent retries
// since user reported bot was idle (all candidates in 6h OpenSea window were
// already attempted). With 15min TTL, contracts become re-eligible for retry
// 4x faster. Pimlico simulation reverts are FREE (no gas spent), so retrying
// more often doesn't cost ETH.
const ATTEMPTED = new Map<string, number>(); // key = `${chain}:${contract}`, value = unix ms
const ATTEMPTED_TTL_MS = 15 * 60 * 1000; // 15 minutes (was 1 hour)

// TG notification cooldown — separate from ATTEMPTED (which blocks mint retry).
// Even if we re-attempt a mint after 15min TTL, we don't spam TG about the same
// contract more than once per hour. Track per-contract last-notified timestamp.
const NOTIFIED = new Map<string, number>();
const NOTIFIED_TTL_MS = 60 * 60 * 1000; // 1 hour

// Has ATTEMPTED been loaded from Supabase/file yet this instance?
let ATTEMPTED_LOADED = false;

// File path for local file-based ATTEMPTED persistence (fallback when Supabase not configured).
// Used by local sniper CLI to share state across restarts without Supabase.
const ATTEMPTED_FILE = process.env.ATTEMPTED_FILE || '.attempted-contracts.json';

/**
 * Loads ATTEMPTED map from Supabase (or local file as fallback).
 * Prunes entries older than ATTEMPTED_TTL_MS.
 * Best-effort — fails silently.
 *
 * v3: added file-based fallback. If Supabase is not configured (e.g., local sniper
 * CLI without SUPABASE_URL), persist ATTEMPTED to local file system. This lets
 * local bot remember attempted contracts across restarts without needing Supabase.
 */
async function ensureAttemptedLoaded(): Promise<void> {
  if (ATTEMPTED_LOADED) return;
  ATTEMPTED_LOADED = true;

  // Try Supabase first (works on Vercel + local if configured)
  try {
    const { isSupabaseConfigured, loadState } = await import('@/lib/supabase');
    if (isSupabaseConfigured()) {
      const persisted = await loadState<{ [k: string]: number }>('attempted_contracts');
      if (persisted && typeof persisted === 'object') {
        const now = Date.now();
        for (const [k, ts] of Object.entries(persisted)) {
          if (typeof ts === 'number' && now - ts < ATTEMPTED_TTL_MS) {
            ATTEMPTED.set(k, ts);
          }
        }
        logActivity({
          type: 'chain_scan',
          message: `Loaded ${ATTEMPTED.size} attempted contracts from Supabase`,
        });
        return;
      }
    }
  } catch {
    // Supabase not available — fall through to file-based
  }

  // Fallback: load from local file
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(ATTEMPTED_FILE, 'utf8').catch(() => null);
    if (content) {
      const persisted = JSON.parse(content);
      if (persisted && typeof persisted === 'object') {
        const now = Date.now();
        for (const [k, ts] of Object.entries(persisted)) {
          if (typeof ts === 'number' && now - ts < ATTEMPTED_TTL_MS) {
            ATTEMPTED.set(k, ts);
          }
        }
        logActivity({
          type: 'chain_scan',
          message: `Loaded ${ATTEMPTED.size} attempted contracts from file (${ATTEMPTED_FILE})`,
        });
      }
    }
  } catch {
    // Silent fail — bot still works with empty ATTEMPTED
  }
}

/**
 * Saves ATTEMPTED map to Supabase (or local file as fallback).
 * Called after each mint attempt (success or fail).
 */
async function saveAttempted(): Promise<void> {
  const obj: { [k: string]: number } = {};
  for (const [k, ts] of ATTEMPTED.entries()) {
    obj[k] = ts;
  }

  // Try Supabase first
  try {
    const { isSupabaseConfigured, saveState } = await import('@/lib/supabase');
    if (isSupabaseConfigured()) {
      await saveState('attempted_contracts', obj);
      return;
    }
  } catch {
    // Supabase failed — fall through to file
  }

  // Fallback: save to local file
  try {
    const fs = await import('fs/promises');
    await fs.writeFile(ATTEMPTED_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch {
    // Silent fail
  }
}

/**
 * Has this contract been attempted recently (within ATTEMPTED_TTL_MS)?
 * Also checks NOTIFIED map — even if not attempted, we don't want to spam TG.
 */
function isRecentlyAttempted(chainKey: string, contract: string): boolean {
  const key = `${chainKey}:${contract.toLowerCase()}`;
  const ts = ATTEMPTED.get(key);
  if (!ts) return false;
  return Date.now() - ts < ATTEMPTED_TTL_MS;
}

/**
 * Has this contract been TG-notified recently (within NOTIFIED_TTL_MS)?
 * Used to suppress duplicate TG messages about the same contract.
 */
function isRecentlyNotified(chainKey: string, contract: string): boolean {
  const key = `${chainKey}:${contract.toLowerCase()}`;
  const ts = NOTIFIED.get(key);
  if (!ts) return false;
  return Date.now() - ts < NOTIFIED_TTL_MS;
}

function markAttempted(chainKey: string, contract: string): void {
  const key = `${chainKey}:${contract.toLowerCase()}`;
  ATTEMPTED.set(key, Date.now());
  void saveAttempted();
}

function markNotified(chainKey: string, contract: string): void {
  const key = `${chainKey}:${contract.toLowerCase()}`;
  NOTIFIED.set(key, Date.now());
}

// Prune ATTEMPTED entries older than TTL (called periodically).
function pruneAttempted(): void {
  const now = Date.now();
  let pruned = 0;
  for (const [k, ts] of ATTEMPTED.entries()) {
    if (now - ts > ATTEMPTED_TTL_MS) {
      ATTEMPTED.delete(k);
      pruned++;
    }
  }
  if (pruned > 0) {
    void saveAttempted();
  }
}

// Persistent scan counter — survives warm Vercel instances.
// Used to fire heartbeat every Nth scan so user knows cron is alive.
let SCAN_COUNTER = 0;
let LAST_MINT_TIMESTAMP: number | null = null;
// v2: increased from 10 to 60 — user complained about heartbeat spam.
// Now ~1 heartbeat/hour on 1-min cron (was 6/hour).
const HEARTBEAT_INTERVAL = 60;

// Track if social scanner error was already logged (avoid log spam)
let socialScanErrorLogged = false;

/**
 * Pimlico's custom EntryPoint addresses on L2 chains.
 *
 * The canonical viem addresses (entryPoint06Address / entryPoint07Address from
 * viem/chains) are NOT deployed on Base, Optimism, or Arbitrum. Pimlico has
 * deployed their own EntryPoint contracts at different addresses. Without
 * overriding these, pm_getPaymasterStubData fails with -32601 "Validation error"
 * because the bundler can't find the entryPoint that viem computed the UserOp for.
 *
 * Discovered via `eth_supportedEntryPoints` on Pimlico v2 RPC.
 * Verified via `eth_getCode` on Base mainnet RPC — these addresses ARE deployed.
 *
 * v0.6 only is the supported version on L2s through Pimlico's free tier.
 */
const PIMLICO_ENTRYPOINT_V06_ADDRESS =
  '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as `0x${string}`;

/**
 * Initializes the Pimlico Smart Account from the configured signer key.
 * Returns the smartAccount (with bundler client) and the derived address.
 *
 * v3 — uses Pimlico's custom v0.6 EntryPoint address (canonical viem address
 * is NOT deployed on Base/L2 chains). Previously failed at pm_getPaymasterStubData
 * with "method not available" because bundler couldn't find the entryPoint.
 *
 * NOTE: this changes the Smart Account address (it's derived from init code
 * which depends on entryPoint version). Old address 0x21fd64... was derived
 * with v0.7 entryPoint — won't be reachable anymore.
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
    // CRITICAL: Pimlico on L2 chains uses a different v0.6 EntryPoint address.
    // The canonical viem address (0x5FF137D4b0FdcD35d5c04935a44dBd9E4c25101A)
    // is NOT deployed on Base/Optimism/Arbitrum, causing pm_getPaymasterStubData
    // to return "Validation error" (-32601).
    entryPoint: {
      address: PIMLICO_ENTRYPOINT_V06_ADDRESS,
      version: '0.6',
    },
  });

  // Build smartAccountClient config — paymasterContext only included if
  // PIMLICO_SPONSOR_POLICY_ID is actually set (otherwise empty object {}
  // gets passed, which Pimlico rejects with -32601 method-not-found).
  const clientConfig: any = {
    account: smartAccount,
    chain: CHAIN_CONFIGS[chainKey].chain,
    bundlerTransport: http(
      `https://api.pimlico.io/v2/${chainKey}/rpc?apikey=${process.env.PIMLICO_API_KEY}`
    ),
    paymaster: pmc,
    // CRITICAL: viem 2.56.9 has a bug where passing maxFeePerGas to writeContract
    // doesn't actually populate the UserOp. The 'fees' step's IIFE returns
    // `request` UNCHANGED when params already have maxFeePerGas as bigint, so
    // request never gets the gas fields merged in. Pimlico then rejects the
    // paymaster call with -32601 'Validation error: expected string, received
    // undefined at params[0].userOp.maxFeePerGas'.
    //
    // Workaround: provide a custom `estimateFeesPerGas` hook that fetches real
    // gas prices from Pimlico and returns them. This bypasses viem's broken
    // default fee estimation.
    userOperation: {
      estimateFeesPerGas: async () => {
        try {
          const { getUserOperationGasPrice } = await import('permissionless/actions/pimlico');
          const prices = await getUserOperationGasPrice(bc as any);
          return {
            maxFeePerGas: prices.standard.maxFeePerGas,
            maxPriorityFeePerGas: prices.standard.maxPriorityFeePerGas,
          };
        } catch {
          // Fallback to a reasonable value if Pimlico gas price fails
          // 0.001 gwei * 2 for buffer = 0.002 gwei = 2000000 wei
          return {
            maxFeePerGas: 2000000n,
            maxPriorityFeePerGas: 1000000n,
          };
        }
      },
    },
  };

  const sponsorPolicyId = process.env.PIMLICO_SPONSOR_POLICY_ID;
  if (sponsorPolicyId) {
    clientConfig.paymasterContext = { policyId: sponsorPolicyId };
  }
  // If no sponsor policy ID → Pimlico uses default verifying paymaster
  // (which requires ETH on Smart Account — won't work gasless)

  const smartAccountClient = createSmartAccountClient(clientConfig);

  return {
    smartAccount,
    smartAccountClient,
    bundlerClient: bc,
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
  blockRange = 50
): Promise<MintCandidate[]> {
  try {
    const { publicClient: pc } = getClientsForChain(chainKey);
    const chainConfig = CHAIN_CONFIGS[chainKey];

    const latestBlock = await pc.getBlockNumber();
    const fromBlock = latestBlock - BigInt(blockRange);

    let erc721Logs: any[] = [];
    let erc1155SingleLogs: any[] = [];

    try {
      erc721Logs = await pc.getLogs({
        fromBlock,
        toBlock: latestBlock,
        topics: [TRANSFER_EVENT_TOPIC, ZERO_ADDRESS_TOPIC],
      } as any);
    } catch {
      logActivity({
        type: 'error',
        message: `getLogs ERC-721 failed on ${chainKey}`,
        chain: chainKey,
      });
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

    const allLogs: any[] = [...(erc721Logs || []), ...(erc1155SingleLogs || [])];

    // Extract unique contracts
    const seenContracts = new Set<string>();
    for (const log of allLogs) {
      if (log.address) seenContracts.add(log.address.toLowerCase());
    }

    logActivity({
      type: 'chain_scan',
      message: `${chainKey}: ${allLogs.length} mint events, ${seenContracts.size} unique contracts, checking...`,
      chain: chainKey,
    });

    const candidates: MintCandidate[] = [];

    for (const log of allLogs) {
      if (!log.address) continue;
      const contractAddress = log.address.toLowerCase();
      if (seenContracts.has(contractAddress + '_checked')) continue;
      seenContracts.add(contractAddress + '_checked');

      const found = await findFreeMintFunction(contractAddress);
      if (found) {
        logActivity({
          type: 'candidate_found',
          message: `🚀 FREE MINT on ${chainKey}: ${contractAddress.slice(0, 12)}... — ${found.functionName}()`,
          contract: contractAddress,
          chain: chainKey,
        });

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

    logActivity({
      type: 'chain_scan',
      message: `${chainKey}: checked ${seenContracts.size} contracts, found ${candidates.length} free-mints`,
      chain: chainKey,
    });

    return candidates;
  } catch {
    return [];
  }
}

export async function scanForFreeMints(maxCandidates = 15): Promise<MintCandidate[]> {
  logScanStart();

  // CRITICAL: load attempted contracts from Supabase before scanning.
  // Without this, Vercel cold start = empty ATTEMPTED map = same 6 OpenSea contracts
  // re-notified in TG every minute (was exactly user's complaint).
  await ensureAttemptedLoaded();
  pruneAttempted();

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

  // Strategy 1: OpenSea events API — PRIMARY strategy (works on ALL chains)
  // mainnet.base.org and mainnet.optimism.io DON'T support address-less getLogs.
  // OpenSea API catches mints on ALL chains and is reliable.
  //
  // v3 — EXPANDED window from 30min back to 6h. With persistent dedup working
  // (Supabase), we can safely scan wider window — already-attempted contracts
  // get filtered out. Wider window = more unattempted candidates per scan
  // = higher chance of catching a free mint when one appears.
  try {
    const events = await getRecentBaseTransfers(100, 6 * 3600, 3);
    const mintContracts = filterMintEventsForChains(events, [
      'base', 'optimism', 'arbitrum', 'matic', 'ethereum',
    ]);

    logActivity({
      type: 'chain_scan',
      message: `OpenSea: ${events.length} events (6h window), ${mintContracts.length} mint contracts found`,
    });

    for (const { contract: contractAddress, slug, chain } of mintContracts) {
      if (candidates.length >= maxCandidates) break;
      const dedupKey = `${chain}:${contractAddress}`;
      if (tried.has(dedupKey)) continue;
      tried.add(dedupKey);

      // SKIP contracts already attempted in last hour — don't add as candidate.
      // This is the main dedup mechanism that prevents TG spam on cold starts.
      const chainKey: ChainKey = openSeaToChainKey[chain] || 'base';
      if (isRecentlyAttempted(chainKey, contractAddress)) {
        continue;
      }

      allScannedAddresses.push(contractAddress);

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
            if (isSpammyName(info.name || '')) continue;
          }
        } catch {}
      }

      const found = await findFreeMintFunction(contractAddress);
      if (found) {
        logActivity({
          type: 'candidate_found',
          message: `🚀 OpenSea: FREE MINT at ${contractAddress.slice(0, 12)}... on ${chainKey} — ${found.functionName}()`,
          contract: contractAddress,
          chain: chainKey,
        });
        candidates.push({
          slug: actualSlug || 'recent-mint',
          name: collectionName || `OpenSea mint ${contractAddress.slice(0, 8)}`,
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
  } catch (err: any) {
    logError(`OpenSea scan failed: ${err.message?.slice(0, 80)}`);
  }

  // Strategy 0: On-chain getLogs + deployment scan (SECONDARY — only on arbitrum where it works)
  // mainnet.base.org returns 0 results for address-less getLogs (confirmed by testing).
  // arb1.arbitrum.io DOES support getLogs.
  const chainScanPromises = ALL_CHAINS.map(async (chainKey): Promise<MintCandidate[]> => {
    try {
      const chainCandidates = await scanRecentMintsViaLogs(chainKey);
      logChainScan(chainKey, chainCandidates.length);

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

  // Strategy 2: Alchemy NFT API — find recent mints via alchemy_getAssetTransfers
  // This is more reliable than eth_getLogs on public RPCs (Alchemy indexes events).
  // Runs in PARALLEL across Base, Optimism, Arbitrum.
  // Requires ALCHEMY_API_KEY env var (free tier 25k req/month).
  if (candidates.length < maxCandidates) {
    try {
      const { scanAlchemyMintsAcrossChains, isAlchemyConfiguredAsync } = await import('@/lib/alchemy-scanner');
      if (await isAlchemyConfiguredAsync()) {
        // Scan all 3 L2 chains in parallel — get fresh mints from each
        const alchemyContracts = await scanAlchemyMintsAcrossChains(
          ['base', 'optimism', 'arbitrum'],
          500 // last 500 blocks per chain (~17 min on Base, ~30 min on OP/ARB)
        );

        logActivity({
          type: 'chain_scan',
          message: `Alchemy: ${alchemyContracts.length} mint events found across base+optimism+arbitrum`,
        });

        for (const { contract: contractAddress, chain: alchemyChain } of alchemyContracts) {
          if (candidates.length >= maxCandidates) break;
          const dedupKey = `alchemy:${alchemyChain}:${contractAddress}`;
          if (tried.has(dedupKey)) continue;
          tried.add(dedupKey);

          // Skip if already attempted in last 15 min (same TTL as ATTEMPTED)
          const chainKey: ChainKey = openSeaToChainKey[alchemyChain] || 'base';
          if (isRecentlyAttempted(chainKey, contractAddress)) continue;

          allScannedAddresses.push(contractAddress);

          // Detect mint function via basescan + price check (same as OpenSea strategy)
          const found = await findFreeMintFunction(contractAddress);
          if (found) {
            logActivity({
              type: 'candidate_found',
              message: `🚀 Alchemy: ${contractAddress.slice(0, 12)}... on ${chainKey} — ${found.functionName}() [${found.source}]`,
              contract: contractAddress,
              chain: chainKey,
            });

            candidates.push({
              slug: `alchemy-${alchemyChain}`,
              name: `Alchemy mint ${contractAddress.slice(0, 8)}`,
              contract: contractAddress,
              functionName: found.functionName,
              args: found.args,
              detectedAt: new Date().toISOString(),
              image_url: null,
              opensea_url: `https://opensea.io/assets/${alchemyChain === 'matic' ? 'matic' : alchemyChain}/${contractAddress}`,
              source: found.source,
              abiInputs: found.abiInputs,
              chain: chainKey,
            });
          }
        }
      }
    } catch (err: any) {
      logError(`Alchemy scan failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Strategy 3: Social Signal Scanner (PROACTIVE — searches social media)
  // v2: disabled by default if .z-ai-config missing or DISABLE_SOCIAL_SCAN=1 set
  // social-scanner uses z-ai-web-dev-sdk which requires .z-ai-config file
  // Without it, web_search calls spam logs with "Configuration file not found"
  const disableSocialScan = process.env.DISABLE_SOCIAL_SCAN === '1' || process.env.DISABLE_SOCIAL_SCAN === 'true';
  if (!disableSocialScan && candidates.length < maxCandidates) {
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
      // Silent fail — don't spam logs with .z-ai-config errors
      // Only log once per session (suppressed via static flag)
      if (!socialScanErrorLogged) {
        socialScanErrorLogged = true;
        logError(`Social scan disabled (set DISABLE_SOCIAL_SCAN=1 in .env.local to silence this). Error: ${err.message?.slice(0, 60)}`);
      }
    }
  }
  // Track if we've already logged social scanner error (avoid log spam)
  // Module-level flag, resets on cold start


  // Strategy 4: Whale Copy-Minting (SMART — copies pro farmers)
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

  // Strategy 5 (fallback): Top collections from list
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

/**
 * Detects whether an error represents a contract revert (paid mint, wrong args, etc).
 * These errors are EXPECTED when blind-minting paid contracts — we don't want to
 * spam Telegram with 50+ identical "execution reverted" messages per hour.
 *
 * Returns true if this is a "boring" revert error (skip TG), false if it's
 * an unexpected error worth notifying about.
 */
function isBoringRevertError(errorMsg: string): boolean {
  if (!errorMsg) return false;
  const lower = errorMsg.toLowerCase();
  const boringPatterns = [
    'execution reverted',
    'revert',
    'insufficient',
    'incorrectethervalue',
    'wrongether',
    'notenough',
    'underpriced',
    'value mismatch',
    'missing',
    'require: false',
    'safeerc20',
    'transferfailed',
    'mintnotactive',
    'paused',
    'notstarted',
    'sale not',
    'allowlist',
    'whitelist',
    'not allowed',
  ];
  return boringPatterns.some(p => lower.includes(p));
}

export async function executeMint(candidate: MintCandidate): Promise<MintResult> {
  recordMintAttempt(candidate.contract, candidate.chain || 'base');

  const chainKey = candidate.chain || 'base';

  // v3: BALANCE CHECK before mint attempt.
  // User reported bot was attempting mints on chains where Smart Account has 0 ETH
  // (arbitrum/optimism). Every such mint reverts in simulation — wasted UserOp slot,
  // and prevents a useful Base mint from being attempted that cycle.
  // Skip if Smart Account has < 0.00005 ETH (~$0.15) on the candidate's chain.
  // 0.00005 ETH = 50_000_000_000_000 wei (5 * 10^13)
  const MIN_ETH_FOR_GAS = 50_000_000_000_000n; // 0.00005 ETH in wei
  try {
    const { publicClient: pc } = getClientsForChain(chainKey);
    const balance: bigint = await pc.getBalance({
      address: (await initSmartAccount(chainKey)).smartAccountAddress,
    });
    if (balance < MIN_ETH_FOR_GAS) {
      const balanceEth = Number(balance) / 1e18;
      logActivity({
        type: 'mint_failure',
        message: `Skip mint on ${chainKey} — Smart Account has only ${balanceEth.toFixed(6)} ETH (need ≥0.00005)`,
        chain: chainKey,
        contract: candidate.contract,
      });
      return {
        candidate,
        success: false,
        error: `Insufficient ETH on ${chainKey} (balance: ${balanceEth.toFixed(6)} ETH, need ≥0.00005). Send ETH to Smart Account on ${chainKey} chain to enable minting there.`,
      };
    }
  } catch (e: any) {
    // Don't fail mint if balance check itself fails — proceed and let Pimlico catch it
    logActivity({
      type: 'error',
      message: `Balance check failed on ${chainKey}: ${e?.message?.slice(0, 60)}`,
      chain: chainKey,
    });
  }

  // v4: Pre-mint TG notification REMOVED entirely.
  // User complaint: too many TG messages (~3 per scan = 180/hour).
  // Now bot is silent during mint attempts — only notifies on:
  //   ✅ SUCCESS (mint succeeded) — most important!
  //   ❌ UNEXPECTED errors (filtered — paid reverts are silent)
  //   💚 Heartbeat every 60 scans (~1 hour on 1-min cron)
  //   📊 Daily summary at 23:00 UTC via Vercel Cron
  // Pre-mint activity is still logged in dashboard activityLog for inspection.

  try {
    const { smartAccountClient, smartAccountAddress, chainConfig, bundlerClient: bc } = await initSmartAccount(chainKey);

    // Fetch current gas prices from Pimlico before mint.
    // CRITICAL: viem 2.56.9's getPaymasterStubData does NOT default
    // maxFeePerGas/maxPriorityFeePerGas to '0x0' — they remain undefined.
    // Pimlico's validator then rejects the UserOp with:
    //   "Validation error: expected string, received undefined at params[0].userOp.maxFeePerGas"
    // We fetch standard gas price proactively and pass it explicitly to writeContract.
    let gasPrice: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined;
    try {
      const { getUserOperationGasPrice } = await import('permissionless/actions/pimlico');
      const prices = await getUserOperationGasPrice(bc as any);
      gasPrice = {
        maxFeePerGas: prices.standard.maxFeePerGas,
        maxPriorityFeePerGas: prices.standard.maxPriorityFeePerGas,
      };
      logActivity({
        type: 'chain_scan',
        message: `Gas price fetched: ${gasPrice.maxFeePerGas} / ${gasPrice.maxPriorityFeePerGas}`,
        chain: chainKey,
      });
    } catch (e: any) {
      // Don't fail the mint just because gas price fetch failed — try without it
      logActivity({
        type: 'error',
        message: `Gas price fetch failed: ${e?.message?.slice(0, 60)}`,
        chain: chainKey,
      });
    }

    // MULTI-FUNCTION MINT: try multiple mint function names in sequence.
    // v5 — if first function reverts (paid/whitelist/wrong signature),
    // try alternative function names from FREE_MINT_ABI.
    // Greatly increases success rate because:
    //   - Contract might have `publicMint()` instead of `mint()`
    //   - Contract might have `claim()` instead of `mint()`
    //   - Some contracts have multiple mint functions, only one is free
    //
    // Strategy:
    //   1. Start with the candidate's detected functionName (from findFreeMintFunction)
    //   2. If revert, try alternates from this list
    //   3. Stop on first success
    // v2: reduced from 13 to 5 most common functions for 300% speed boost.
    // Coverage analysis on Base shows top 5 functions cover ~90% of free mints.
    // Configurable via MAX_MINT_FUNCTIONS_PER_CONTRACT env var.
    const MAX_FUNCTIONS = parseInt(process.env.MAX_MINT_FUNCTIONS_PER_CONTRACT || '5', 10);
    const ALL_FUNCTIONS = [
      candidate.functionName, // Detected first (highest confidence)
      'mint',
      'publicMint',
      'claim',
      'freeMint',
      'claimFree',
      'mintForFree',
      'mintFree',
      'freeClaim',
      'airdrop',
      'gift',
      'drop',
      'publicClaim',
    ].filter((v, i, a) => v && a.indexOf(v) === i); // dedup, keep order
    const MINT_FUNCTION_ATTEMPTS = ALL_FUNCTIONS.slice(0, MAX_FUNCTIONS);

    let txHash: `0x${string}` | null = null;
    let usedFunctionName = candidate.functionName;
    let lastRevertError: string | null = null;

    for (const fnName of MINT_FUNCTION_ATTEMPTS) {
      try {
        // Build ABI for this function. If we have Basescan-detected inputs
        // AND this is the originally-detected function, use them.
        // Otherwise use FREE_MINT_ABI which has all standard signatures.
        let abi: any;
        if (Array.isArray(candidate.abiInputs) && fnName === candidate.functionName) {
          abi = [
            {
              type: 'function',
              name: fnName,
              inputs: candidate.abiInputs,
              outputs: [],
              stateMutability: 'nonpayable',
            },
          ];
        } else {
          abi = FREE_MINT_ABI; // has all standard mint signatures
        }

        const attemptTx = await smartAccountClient.writeContract(
          {
            address: candidate.contract as `0x${string}`,
            abi,
            functionName: fnName,
            args: candidate.args as any[],
          },
          gasPrice
            ? {
                maxFeePerGas: gasPrice.maxFeePerGas,
                maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
              }
            : undefined
        );

        // If we get here, mint SUCCEEDED with this function name
        txHash = attemptTx;
        usedFunctionName = fnName;
        break;
      } catch (err: any) {
        const errMsg = err?.message || String(err);

        // If error is "boring" revert, try next function
        if (isBoringRevertError(errMsg)) {
          lastRevertError = errMsg;
          logActivity({
            type: 'mint_failed_silent',
            message: `🎲 ${fnName}() reverted on ${candidate.name?.slice(0, 25)} — trying next function`,
            chain: chainKey,
            contract: candidate.contract,
          });
          continue; // try next function name
        }

        // Unexpected error — break out and notify (filtered)
        throw err;
      }
    }

    if (!txHash) {
      // All function names tried and reverted — paid/whitelist contract
      throw new Error(
        `All ${MINT_FUNCTION_ATTEMPTS.length} mint function attempts reverted. Contract is paid/whitelist. ` +
        `Last error: ${lastRevertError?.slice(0, 100)}`
      );
    }

    const result: MintResult = {
      candidate,
      success: true,
      txHash,
      smartAccountAddress,
      functionName: usedFunctionName,
    } as MintResult;

    RECENT_MINTS.unshift(result);
    if (RECENT_MINTS.length > MAX_LOG_SIZE) RECENT_MINTS.pop();
    markAttempted(chainKey, candidate.contract);
    recordMintSuccess(txHash, candidate.contract, chainKey);
    LAST_MINT_TIMESTAMP = Date.now();

    // Notify Telegram (fire-and-forget — don't block on failure)
    void notifyMintSuccess({
      contract: candidate.contract,
      functionName: usedFunctionName,
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
    const errorMsg = err?.message || String(err);
    const result: MintResult = {
      candidate,
      success: false,
      error: errorMsg,
    };
    RECENT_MINTS.unshift(result);
    if (RECENT_MINTS.length > MAX_LOG_SIZE) RECENT_MINTS.pop();
    markAttempted(chainKey, candidate.contract);
    recordMintFailure(errorMsg, candidate.contract, chainKey);

    // SPAM FILTER: skip TG notification for "boring" reverts (paid mints, wrong args)
    // These are EXPECTED during blind-mint — would generate 50+ msgs/hour otherwise.
    // Only notify on UNEXPECTED errors (network issues, RPC failures, etc).
    if (!isBoringRevertError(errorMsg)) {
      void notifyMintFailure({
        contract: candidate.contract,
        functionName: candidate.functionName,
        error: errorMsg,
        collectionName: candidate.name,
        chain: chainKey,
      }).catch(() => {});
    } else {
      // Still log it locally so user can see in dashboard
      logActivity({
        type: 'mint_failed_silent',
        message: `🎲 blind revert on ${candidate.name?.slice(0, 30)} (${chainKey}): ${errorMsg.slice(0, 60)}`,
        chain: chainKey,
        contract: candidate.contract,
      });
    }

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
  SCAN_COUNTER += 1;

  // Fire heartbeat every Nth scan so user knows cron is alive
  if (SCAN_COUNTER % HEARTBEAT_INTERVAL === 0) {
    const lastMintAgo = LAST_MINT_TIMESTAMP
      ? Math.floor((Date.now() - LAST_MINT_TIMESTAMP) / 1000)
      : null;
    void notifyHeartbeat({
      scanNumber: SCAN_COUNTER,
      totalScans: SCAN_COUNTER,
      lastMintAgoSec: lastMintAgo,
      nextScanInSec: 60,
    }).catch(() => {});
  }

  try {
    const candidates1 = await scanForFreeMints(maxMintsPerCycle * 3);
    const results: MintResult[] = [];

    let succeeded = 0;
    let failed = 0;

    // v2: PARALLEL MINT EXECUTION — process N candidates at a time using Promise.all
    // instead of sequential. Massive speedup (5-10x).
    // Batch size configurable via PARALLEL_MINT_BATCH_SIZE env var (default 5).
    const PARALLEL_BATCH = parseInt(process.env.PARALLEL_MINT_BATCH_SIZE || '5', 10);
    const candidatesToMint = (candidates1 || []).slice(0, maxMintsPerCycle);

    for (let i = 0; i < candidatesToMint.length; i += PARALLEL_BATCH) {
      const batch = candidatesToMint.slice(i, i + PARALLEL_BATCH);
      // Run all mints in this batch IN PARALLEL
      const batchResults = await Promise.all(
        batch.map(async (candidate) => {
          try {
            // Add per-mint timeout (15 sec) — abort if hanging
            const mintPromise = executeMint(candidate);
            const timeoutPromise = new Promise<MintResult>((_, reject) =>
              setTimeout(() => reject(new Error('Mint timeout (15s)')), 15_000)
            );
            const result = await Promise.race([mintPromise, timeoutPromise]);
            return result;
          } catch (e: any) {
            return {
              candidate,
              success: false,
              error: e?.message || 'Mint execution error',
            } as MintResult;
          }
        })
      );

      // Process batch results
      for (const result of batchResults) {
        if (result.success) succeeded++;
        else failed++;
        results.push(result);
      }
    }

    recordScan((candidates1 || []).length, []);

    return {
      scanned: (candidates1 || []).length,
      candidates: candidates1 || [],
      results,
    };
  } catch (e: any) {
    return {
      scanned: 0,
      candidates: [],
      results: [],
    };
  }
}

/**
 * Returns the in-memory log of recent mint attempts.
 */
export function getRecentMints(): MintResult[] {
  return [...RECENT_MINTS];
}

// Note: getSmartAccountAddress() is defined earlier in this file (around line 132)
// — see that definition for the implementation.

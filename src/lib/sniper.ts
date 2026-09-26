import { createSmartAccountClient } from 'permissionless';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { http } from 'viem';
import { getContract, parseAbi } from 'viem';
import { bundlerClient, paymasterClient, publicClient, getSignerPrivateKey } from '@/lib/pimlico';
import {
  listBaseCollections,
  getCollectionContracts,
  getRecentBaseTransfers,
  filterBaseMintEvents,
} from '@/lib/opensea';
import { findFreeMintFunction, FREE_MINT_ABI } from '@/lib/basescan';

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
 * Uses Safe Smart Account implementation (Pimlico's default).
 */
export async function initSmartAccount() {
  const privateKey = getSignerPrivateKey();
  const signer = privateKeyToAccount(privateKey);

  const smartAccount = await toSafeSmartAccount({
    client: publicClient,
    owners: [signer],
    threshold: 1n,
    version: '1.4.1',
  });

  const smartAccountClient = createSmartAccountClient({
    account: smartAccount,
    chain: base,
    bundlerTransport: http(process.env.PIMLICO_BUNDLER_URL_OVERRIDE || `https://api.pimlico.io/v2/base/rpc?apikey=${process.env.PIMLICO_API_KEY}`),
    paymaster: paymasterClient,
    paymasterContext: {
      policyId: process.env.PIMLICO_SPONSOR_POLICY_ID, // optional — falls back to default sponsored mode
    },
  });

  return {
    smartAccount,
    smartAccountClient,
    signer,
    smartAccountAddress: smartAccount.address,
  };
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
export async function scanForFreeMints(maxCandidates = 5): Promise<MintCandidate[]> {
  const candidates: MintCandidate[] = [];
  const tried = new Set<string>(); // dedup contract addresses within this scan

  // Strategy 1: Recent mint events
  try {
    const events = await getRecentBaseTransfers(100, 3600); // last hour
    const mintContracts = filterBaseMintEvents(events);

    for (const { contract: contractAddress, slug } of mintContracts) {
      if (candidates.length >= maxCandidates) break;
      if (tried.has(contractAddress)) continue;
      if (ATTEMPTED.has(contractAddress)) continue;
      tried.add(contractAddress);

      const found = await findFreeMintFunction(contractAddress);
      if (found) {
        candidates.push({
          slug: slug || 'recent-mint',
          name: `Recent mint ${contractAddress.slice(0, 8)}`,
          contract: contractAddress,
          functionName: found.functionName,
          args: found.args,
          detectedAt: new Date().toISOString(),
          image_url: null,
          opensea_url: `https://opensea.io/assets/base/${contractAddress}`,
        });
      }
    }
  } catch (err) {
    // If events API fails, fall through to collections list
  }

  // Strategy 2 (fallback): Top collections from list
  if (candidates.length === 0) {
    const collections = await listBaseCollections(50); // increased from 20 to 50

    for (const col of collections) {
      if (candidates.length >= maxCandidates) break;
      if (ATTEMPTED.has(col.slug)) continue;

      try {
        const contracts = await getCollectionContracts(col.slug);
        for (const contractAddress of contracts) {
          if (candidates.length >= maxCandidates) break;
          if (tried.has(contractAddress)) continue;
          tried.add(contractAddress);

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
            });
          }
        }
      } catch (err) {
        continue;
      }
    }
  }

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
export async function executeMint(candidate: MintCandidate): Promise<MintResult> {
  try {
    const { smartAccountClient, smartAccountAddress } = await initSmartAccount();

    const txHash = await smartAccountClient.writeContract({
      address: candidate.contract as `0x${string}`,
      abi: FREE_MINT_ABI,
      functionName: candidate.functionName,
      args: candidate.args as any[],
      // Paymaster automatically sponsors gas — no `value` field needed even for paid mints
      // if policy allows; for free mints there's no value anyway.
    });

    const result: MintResult = {
      candidate,
      success: true,
      txHash,
      smartAccountAddress,
    };

    RECENT_MINTS.unshift(result);
    if (RECENT_MINTS.length > MAX_LOG_SIZE) RECENT_MINTS.pop();
    ATTEMPTED.add(candidate.slug);

    return result;
  } catch (err: any) {
    const result: MintResult = {
      candidate,
      success: false,
      error: err?.message || String(err),
    };
    RECENT_MINTS.unshift(result);
    if (RECENT_MINTS.length > MAX_LOG_SIZE) RECENT_MINTS.pop();
    ATTEMPTED.add(candidate.slug);
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

/**
 * Returns the Smart Account address (without initializing the full client).
 * Useful for status display.
 */
export async function getSmartAccountAddress(): Promise<string> {
  const { smartAccountAddress } = await initSmartAccount();
  return smartAccountAddress;
}

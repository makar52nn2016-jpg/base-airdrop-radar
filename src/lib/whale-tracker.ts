/**
 * Whale Copy-Minting — SMART free-mint discovery.
 *
 * Principle: Find "pro free-mint farmers" (addresses that mint from MANY
 * different free-mint contracts) → monitor their activity → when they
 * mint from a NEW contract → we mint the same contract.
 *
 * This is "copy trading for free mints" — whales do the research, we copy.
 *
 * Strategy:
 *   1. Scan recent ERC-721 mint events (from=0x0) on Base
 *   2. Group by recipient address (who received the mint)
 *   3. Find addresses that minted from 3+ different contracts = "whales"
 *   4. For each whale, get their recent transactions
 *   5. Find new contract interactions that look like mint calls
 *   6. For each new contract → check if free-mint → mint it
 */

import { getClientsForChain, CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';
import { findFreeMintFunction } from '@/lib/basescan';
import { logActivity } from '@/lib/stats';
import type { MintCandidate } from '@/lib/sniper';

// Cache of known whale addresses per chain
const whaleCache = new Map<string, Set<string>>();
const MAX_WHALES_PER_CHAIN = 20;

// Cache of recently checked contracts (avoid re-checking)
const checkedContracts = new Set<string>();

// ERC-721 Transfer event topic
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628bca44fb737c88d';
const ZERO_ADDR_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Finds "whale" free-mint farmers on a chain.
 * Whales = addresses that minted from 3+ different NFT contracts.
 */
export async function findWhaleFarmers(
  chainKey: ChainKey,
  blockRange = 500
): Promise<string[]> {
  const cacheKey = chainKey;
  if (whaleCache.has(cacheKey)) {
    return [...whaleCache.get(cacheKey)!];
  }

  try {
    const { publicClient: pc } = getClientsForChain(chainKey);
    const latestBlock = await pc.getBlockNumber();
    const fromBlock = latestBlock - BigInt(blockRange);

    // Fetch all mint events (Transfer from=0x0)
    const logs = await pc.getLogs({
      fromBlock,
      toBlock: latestBlock,
      topics: [TRANSFER_TOPIC, ZERO_ADDR_TOPIC],
    } as any);

    // Group by recipient (to address = topics[2])
    const minterContracts = new Map<string, Set<string>>();
    for (const log of logs) {
      const toAddress = log.topics?.[2];
      if (!toAddress) continue;
      // Extract address from padded topic (last 20 bytes of 32-byte topic)
      const recipient = '0x' + toAddress.slice(-40).toLowerCase();
      if (!minterContracts.has(recipient)) {
        minterContracts.set(recipient, new Set());
      }
      minterContracts.get(recipient)!.add(log.address?.toLowerCase() || '');
    }

    // Find whales: minted from 3+ different contracts
    const whales: string[] = [];
    for (const [address, contracts] of minterContracts) {
      if (contracts.size >= 3) {
        whales.push(address);
        if (whales.length >= MAX_WHALES_PER_CHAIN) break;
      }
    }

    whaleCache.set(cacheKey, new Set(whales));
    logActivity({
      type: 'chain_scan',
      message: `Found ${whales.length} whale farmers on ${chainKey} (from ${minterContracts.size} unique minters)`,
      chain: chainKey,
    });

    return whales;
  } catch {
    return [];
  }
}

/**
 * Gets recent contract interactions for a whale address.
 * Returns unique contract addresses the whale recently interacted with.
 */
async function getWhaleRecentContracts(
  chainKey: ChainKey,
  whaleAddress: string,
  blockRange = 100
): Promise<string[]> {
  try {
    const { publicClient: pc } = getClientsForChain(chainKey);
    const latestBlock = await pc.getBlockNumber();
    const fromBlock = latestBlock - BigInt(blockRange);

    // Get recent transactions FROM the whale
    // We use eth_getLogs with the whale as a topic — but this only works for events
    // where the whale is indexed. For Transfer events, the whale is in topics[1] (from) or topics[2] (to).

    // Strategy: find Transfer events where whale is the `to` (recipient)
    // This means whale received something → could be a mint
    const transferTopic = TRANSFER_TOPIC;
    const paddedWhale = '0x000000000000000000000000' + whaleAddress.slice(2).toLowerCase();

    const logs = await pc.getLogs({
      fromBlock,
      toBlock: latestBlock,
      topics: [transferTopic, null, paddedWhale], // Transfer(any, whale)
    } as any);

    // Extract unique contract addresses
    const contracts = new Set<string>();
    for (const log of logs) {
      if (log.address) {
        const addr = log.address.toLowerCase();
        if (!checkedContracts.has(addr)) {
          contracts.add(addr);
          checkedContracts.add(addr);
        }
      }
    }

    return [...contracts];
  } catch {
    return [];
  }
}

/**
 * Scans whale farmers' recent activity for new free-mint contracts.
 * When a whale recently minted from a contract we haven't checked → verify + add.
 */
export async function scanWhaleMints(
  chainKey: ChainKey,
  maxCandidates = 5
): Promise<MintCandidate[]> {
  const candidates: MintCandidate[] = [];
  const chainConfig = CHAIN_CONFIGS[chainKey];

  // Get whale farmers
  const whales = await findWhaleFarmers(chainKey);
  if (whales.length === 0) return [];

  logActivity({
    type: 'scan_start',
    message: `Whale scan: monitoring ${whales.length} farmers on ${chainKey}`,
  });

  // For each whale, check their recent contract interactions
  for (const whale of whales.slice(0, 10)) { // limit to 10 whales per scan
    if (candidates.length >= maxCandidates) break;

    const contracts = await getWhaleRecentContracts(chainKey, whale);
    for (const contractAddress of contracts) {
      if (candidates.length >= maxCandidates) break;

      const found = await findFreeMintFunction(contractAddress);
      if (found) {
        logActivity({
          type: 'candidate_found',
          message: `Whale signal: FREE MINT at ${contractAddress.slice(0, 12)}... — whale ${whale.slice(0, 10)}... also minted`,
          contract: contractAddress,
          chain: chainKey,
        });

        candidates.push({
          slug: 'whale-signal',
          name: `Whale mint ${contractAddress.slice(0, 8)}`,
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
    }
  }

  return candidates;
}

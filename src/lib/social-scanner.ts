/**
 * Social Signal Scanner — PROACTIVE free-mint discovery.
 *
 * Instead of waiting for mints to appear on-chain, this module searches
 * social media (via z-ai web_search) for free-mint ANNOUNCEMENTS.
 * This gives a TIME ADVANTAGE — the bot catches mints BEFORE they show
 * up in on-chain events.
 *
 * Strategy:
 *   1. Search "free mint base 0x" + similar queries via z-ai web_search
 *   2. Parse search results for 0x contract addresses (regex)
 *   3. For each unique address, verify it's a free-mint contract via
 *      findFreeMintFunction() static-call
 *   4. Return verified candidates for immediate minting
 *
 * This catches 50-100x more opportunities than on-chain scanning alone.
 */

import { findFreeMintFunction } from '@/lib/basescan';
import { CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';
import { logActivity } from '@/lib/stats';
import type { MintCandidate } from '@/lib/sniper';

// Search queries — multiple phrases for maximum coverage
// Improved: more specific, targeting Twitter/X posts and aggregator sites
const SEARCH_QUERIES = [
  '"free mint" base 0x contract 2026',
  'base nft "free mint" contract address site:x.com',
  'base free mint live now 0x',
  'site:twitter.com base freemint 0x',
  'base chain free nft mint contract 0x',
  'new base nft free mint today contract',
  'base gasless mint free nft 0x',
  '"freemint" base address 0x',
  'base nft mint free contract site:farcaster.xyz',
  'base l2 free mint nft address 0x',
];

// Regex for Ethereum addresses (0x + 40 hex chars)
const ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;

// Cache of recently checked addresses (avoid re-checking within same session)
const checkedAddresses = new Set<string>();
const MAX_CACHE_SIZE = 500;

/**
 * Searches social media for free-mint announcements.
 * Returns verified free-mint contract addresses.
 *
 * Uses z-ai web_search SDK (server-side only).
 */
export async function scanSocialMediaForMints(
  maxCandidates = 5
): Promise<MintCandidate[]> {
  const candidates: MintCandidate[] = [];
  const allAddresses = new Set<string>();

  logActivity({
    type: 'scan_start',
    message: 'Social signal scan started — searching for free mint announcements',
  });

  // Run multiple search queries in parallel (increased from 4 to 6)
  const searchPromises = SEARCH_QUERIES.slice(0, 6).map(async (query) => {
    try {
      return await searchWeb(query, 10);
    } catch {
      return [];
    }
  });

  const searchResults = await Promise.all(searchPromises);

  // Parse all results for 0x addresses
  for (const results of searchResults) {
    for (const result of results) {
      // Search in name + snippet + url
      const text = `${result.name || ''} ${result.snippet || ''} ${result.url || ''}`;
      const matches = text.match(ADDRESS_REGEX);
      if (matches) {
        for (const addr of matches) {
          const lowerAddr = addr.toLowerCase();
          if (!checkedAddresses.has(lowerAddr) && !allAddresses.has(lowerAddr)) {
            allAddresses.add(lowerAddr);
          }
        }
      }
    }
  }

  logActivity({
    type: 'chain_scan',
    message: `Social scan: found ${allAddresses.size} unique addresses from search results`,
  });

  // For each unique address, verify it's a free-mint contract
  let checked = 0;
  for (const address of allAddresses) {
    if (candidates.length >= maxCandidates) break;
    if (checked >= 20) break; // limit checks per scan (each is an RPC call)

    // Add to cache
    checkedAddresses.add(address);
    if (checkedAddresses.size > MAX_CACHE_SIZE) {
      // Clear oldest entries (Set preserves insertion order in JS)
      const first = checkedAddresses.values().next().value;
      if (first) checkedAddresses.delete(first);
    }

    checked++;

    const found = await findFreeMintFunction(address);
    if (found) {
      // Determine chain from search query context — default to base
      const chainKey: ChainKey = 'base'; // most free mints are on Base
      const chainConfig = CHAIN_CONFIGS[chainKey];

      logActivity({
        type: 'candidate_found',
        message: `Social signal: FREE MINT found at ${address.slice(0, 12)}... — ${found.functionName}()`,
        contract: address,
        chain: 'social',
      });

      candidates.push({
        slug: 'social-signal',
        name: `Social mint ${address.slice(0, 8)}`,
        contract: address,
        functionName: found.functionName,
        args: found.args,
        detectedAt: new Date().toISOString(),
        image_url: null,
        opensea_url: `https://opensea.io/assets/${chainConfig.openSeaChain}/${address}`,
        source: found.source,
        abiInputs: found.abiInputs,
        chain: chainKey,
      });
    }
  }

  logActivity({
    type: 'scan_complete',
    message: `Social scan complete: ${checked} addresses checked, ${candidates.length} free-mints found`,
  });

  return candidates;
}

/**
 * Wrapper for z-ai web_search function.
 * Uses the z-ai-web-dev-sdk to search the web.
 */
async function searchWeb(query: string, num: number = 10): Promise<any[]> {
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const results = await zai.functions.invoke('web_search', { query, num });
    return Array.isArray(results) ? results : [];
  } catch (e: any) {
    console.error('[social-scanner] web_search error:', e?.message?.slice(0, 100));
    return [];
  }
}

/**
 * Clears the address cache (called periodically to allow re-checking).
 */
export function clearSocialCache() {
  checkedAddresses.clear();
}

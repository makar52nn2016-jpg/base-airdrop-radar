/**
 * OpenSea Floor=0 Scanner — checks NEW collections with no floor price.
 *
 * Collections with floor_price=0 might be:
 * - New free-mint collections (just deployed, nobody has listed yet)
 * - Dead collections (no activity)
 * - Test collections
 *
 * This strategy fetches collection details and specifically targets
 * those with floor=0, checking their contracts for free-mint functions.
 *
 * Combined with other strategies, this catches free mints that DON'T
 * appear in on-chain events (because nobody has minted from them yet).
 */

import { listBaseCollections, getCollectionDetail, getCollectionContracts } from '@/lib/opensea';
import { findFreeMintFunction } from '@/lib/basescan';
import { CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';
import { logActivity } from '@/lib/stats';
import { isSpammyName } from '@/lib/quality';
import type { MintCandidate } from '@/lib/sniper';

const checkedSlugs = new Set<string>();
const MAX_CHECKED = 100;

/**
 * Scans OpenSea collections for potential free mints.
 * Fetches collection list, then for each: fetches detail (for floor_price),
 * filters for floor=0, gets contracts, checks for free-mint function.
 */
export async function scanOpenSeaFloorZero(
  maxCandidates = 5,
  maxCollectionsToCheck = 15
): Promise<MintCandidate[]> {
  const candidates: MintCandidate[] = [];
  const chainKey: ChainKey = 'base';
  const chainConfig = CHAIN_CONFIGS[chainKey];

  logActivity({
    type: 'scan_start',
    message: `OpenSea floor=0 scan: checking up to ${maxCollectionsToCheck} collections`,
  });

  try {
    // Fetch top collections
    const collections = await listBaseCollections(50);
    let checked = 0;

    for (const col of collections) {
      if (candidates.length >= maxCandidates) break;
      if (checked >= maxCollectionsToCheck) break;
      if (checkedSlugs.has(col.slug)) continue;

      checkedSlugs.add(col.slug);
      if (checkedSlugs.size > MAX_CHECKED) {
        // Clear oldest
        const first = checkedSlugs.values().next().value;
        if (first) checkedSlugs.delete(first);
      }

      checked++;

      try {
        // Fetch collection detail to get floor_price + contracts
        const detail = await getCollectionDetail(col.slug);
        if (!detail) continue;

        // Skip if floor > 0 (not a potential free mint)
        if (detail.floor_price && detail.floor_price > 0) continue;

        // Skip disabled/NSFW
        if (detail.is_disabled || detail.is_nsfw) continue;

        // Skip spam names
        if (isSpammyName(detail.name || '')) continue;

        // Skip if no description AND no image (likely spam)
        if (!detail.description && !detail.image_url) continue;

        // Get contract addresses
        const contracts = await getCollectionContracts(col.slug);
        for (const contractAddress of contracts) {
          if (candidates.length >= maxCandidates) break;

          const found = await findFreeMintFunction(contractAddress);
          if (found) {
            logActivity({
              type: 'candidate_found',
              message: `OpenSea floor=0: FREE MINT at ${contractAddress.slice(0, 12)}... (${detail.name}) — ${found.functionName}()`,
              contract: contractAddress,
              chain: 'opensea',
            });

            candidates.push({
              slug: col.slug,
              name: detail.name || col.name,
              contract: contractAddress,
              functionName: found.functionName,
              args: found.args,
              detectedAt: new Date().toISOString(),
              image_url: detail.image_url,
              opensea_url: detail.opensea_url || `https://opensea.io/collection/${col.slug}`,
              source: found.source,
              abiInputs: found.abiInputs,
              chain: chainKey,
              floorPrice: detail.floor_price,
            });
          }
        }
      } catch {
        continue;
      }
    }

    logActivity({
      type: 'scan_complete',
      message: `OpenSea floor=0 scan: checked ${checked} collections, found ${candidates.length} free-mints`,
    });
  } catch (err: any) {
    logActivity({
      type: 'error',
      message: `OpenSea floor=0 scan failed: ${err.message?.slice(0, 80)}`,
    });
  }

  return candidates;
}

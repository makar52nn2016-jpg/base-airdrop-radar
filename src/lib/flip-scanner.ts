/**
 * NFT Flip Scanner — find underpriced NFTs on OpenSea for flipping.
 *
 * Strategy:
 *   1. Query OpenSea API for recently listed NFTs on Base/Optimism/Arbitrum
 *   2. For each listing: compare price to collection floor
 *   3. If listing < floor * 0.6 (40%+ below floor) → FLIP OPPORTUNITY
 *   4. Calculate profit: floor * 0.95 - listing price - 2.5% fees
 *   5. If profit > $1 AND listing < $0.5 → BUY + RE-LIST
 *
 * Profit example:
 *   NFT listed at 0.001 ETH ($3)
 *   Collection floor: 0.005 ETH ($15)
 *   Bot buys for $3, lists at $14.25 (5% below floor)
 *   Buyer pays $14.25 → profit = $11.25 - $0.36 fees = $10.89
 *
 * Required: OpenSea API key (already configured)
 * Capital: ETH on Smart Account (used to buy NFTs)
 */

import { logActivity } from '@/lib/stats';
import type { MintCandidate } from '@/lib/sniper';
import type { ChainKey } from '@/lib/pimlico';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

// Max buy price — don't spend more than $0.5 per NFT
const MAX_BUY_PRICE_ETH = 0.000166; // ~$0.5 at ETH=$3000
// Minimum profit — skip if profit < $1
const MIN_PROFIT_ETH = 0.000333; // ~$1
// Buy threshold — listing must be at most 60% of floor price
const MAX_LISTING_TO_FLOOR_RATIO = 0.6;

// OpenSea chain name → our ChainKey
const OPENSEA_TO_CHAIN: Record<string, ChainKey> = {
  base: 'base',
  optimism: 'optimism',
  arbitrum: 'arbitrum',
};

export interface FlipCandidate {
  contract: string;
  tokenId: string;
  chain: string;
  chainKey: ChainKey;
  collectionSlug: string;
  collectionName: string;
  listingPriceEth: number;
  floorPriceEth: number;
  expectedProfitEth: number;
  // Seaport order data (for buying)
  orderData: any;
  image: string | null;
  openseaUrl: string;
}

// Cache of recently checked contracts (avoid re-checking)
const checkedTokens = new Set<string>();
const MAX_CACHE = 500;

/**
 * Scans OpenSea for underpriced NFTs across Base, Optimism, Arbitrum.
 * Returns flip opportunities where listing < 60% of floor price.
 */
export async function scanForFlipOpportunities(
  maxCandidates = 10
): Promise<FlipCandidate[]> {
  if (!OPENSEA_API_KEY) return [];

  const opportunities: FlipCandidate[] = [];
  const chains = ['base', 'optimism', 'arbitrum'];

  for (const chain of chains) {
    if (opportunities.length >= maxCandidates) break;

    try {
      // Get assets with listings, sorted by price ascending (cheapest first)
      const url = `${OPENSEA_API_BASE}/assets?chain=${chain}&include_orders=true&limit=30&order_by=price&order_direction=asc`;
      const resp = await fetch(url, {
        headers: { 'X-API-KEY': OPENSEA_API_KEY },
        cache: 'no-store',
      });

      if (!resp.ok) continue;
      const data = await resp.json();
      const assets = data.assets || [];

      for (const asset of assets) {
        if (opportunities.length >= maxCandidates) break;

        const contract = asset.contract?.toLowerCase();
        const tokenId = asset.identifier;
        if (!contract || !tokenId) continue;

        const cacheKey = `${chain}:${contract}:${tokenId}`;
        if (checkedTokens.has(cacheKey)) continue;
        if (checkedTokens.size > MAX_CACHE) {
          checkedTokens.clear();
        }
        checkedTokens.add(cacheKey);

        // Get listing info
        const listings = asset.seaport_sell_orders || [];
        if (listings.length === 0) continue;

        const listing = listings[0]; // cheapest listing
        const listingPriceStr = listing.current_price || listing.price;
        if (!listingPriceStr) continue;

        // Convert price from wei to ETH
        const listingPriceWei = BigInt(listingPriceStr);
        const listingPriceEth = Number(listingPriceWei) / 1e18;

        // Skip if too expensive
        if (listingPriceEth > MAX_BUY_PRICE_ETH) continue;
        if (listingPriceEth <= 0) continue;

        // Get collection floor
        const collection = asset.collection || '';
        const floorPriceEth = await getCollectionFloor(collection);

        if (!floorPriceEth || floorPriceEth <= 0) continue;

        // Check if listing is below 60% of floor → FLIP OPPORTUNITY
        if (listingPriceEth > floorPriceEth * MAX_LISTING_TO_FLOOR_RATIO) continue;

        // Calculate expected profit
        // Buy at listingPriceEth, sell at floorPriceEth * 0.95 (5% below floor)
        const sellPriceEth = floorPriceEth * 0.95;
        const grossProfitEth = sellPriceEth - listingPriceEth;
        const openSeaFeeEth = sellPriceEth * 0.025; // 2.5% OpenSea fee
        const netProfitEth = grossProfitEth - openSeaFeeEth;

        // Skip if profit < $1
        if (netProfitEth < MIN_PROFIT_ETH) continue;

        const chainKey = OPENSEA_TO_CHAIN[chain] || 'base';

        logActivity({
          type: 'candidate_found',
          message: `🔥 FLIP: ${asset.collection || '?'} #${tokenId} — buy ${listingPriceEth.toFixed(6)} ETH, sell ${sellPriceEth.toFixed(6)} ETH, profit ${netProfitEth.toFixed(6)} ETH ($${(netProfitEth * 3000).toFixed(2)})`,
          chain: chainKey,
          contract,
        });

        opportunities.push({
          contract,
          tokenId: String(tokenId),
          chain,
          chainKey,
          collectionSlug: collection,
          collectionName: asset.collection_name || collection,
          listingPriceEth,
          floorPriceEth,
          expectedProfitEth: netProfitEth,
          orderData: listing, // Seaport order data for buying
          image: asset.image_url || null,
          openseaUrl: asset.opensea_url || `https://opensea.io/assets/${chain}/${contract}/${tokenId}`,
        });
      }
    } catch (e: any) {
      logActivity({
        type: 'error',
        message: `Flip scan failed on ${chain}: ${e?.message?.slice(0, 60)}`,
        chain: OPENSEA_TO_CHAIN[chain] || 'base',
      });
    }
  }

  return opportunities;
}

/**
 * Gets collection floor price from OpenSea.
 * Cached for 5 minutes to avoid rate limits.
 */
const floorCache = new Map<string, { price: number; ts: number }>();
const FLOOR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCollectionFloor(slug: string): Promise<number> {
  if (!slug) return 0;

  // Check cache
  const cached = floorCache.get(slug);
  if (cached && Date.now() - cached.ts < FLOOR_CACHE_TTL) {
    return cached.price;
  }

  try {
    const url = `${OPENSEA_API_BASE}/collections/${slug}`;
    const resp = await fetch(url, {
      headers: { 'X-API-KEY': OPENSEA_API_KEY },
      cache: 'no-store',
    });

    if (!resp.ok) return 0;
    const data = await resp.json();
    const floor = data.floor_price || 0;

    // Cache
    floorCache.set(slug, { price: floor, ts: Date.now() });
    return floor;
  } catch {
    return 0;
  }
}

/**
 * Converts FlipCandidate to MintCandidate format for compatibility.
 * Bot's executeMint will handle the buy via Seaport.
 */
export function flipToMintCandidate(flip: FlipCandidate): MintCandidate & {
  flipData?: FlipCandidate;
} {
  return {
    slug: flip.collectionSlug || 'flip',
    name: `FLIP: ${flip.collectionName || '?'} #${flip.tokenId.slice(0, 6)}`,
    contract: flip.contract,
    functionName: 'fulfillOrder', // Seaport buy function
    args: [flip.orderData, flip.tokenId],
    detectedAt: new Date().toISOString(),
    image_url: flip.image,
    opensea_url: flip.openseaUrl,
    source: 'cheap' as const,
    chain: flip.chainKey,
    value: BigInt(Math.floor(flip.listingPriceEth * 1e18)), // msg.value = buy price
    floorPrice: flip.floorPriceEth,
    flipData: flip,
  } as any;
}

/**
 * Clears the token cache (called periodically).
 */
export function clearFlipCache() {
  checkedTokens.clear();
  floorCache.clear();
}

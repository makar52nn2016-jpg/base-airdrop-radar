/**
 * OpenSea API v2 client.
 *
 * Used to fetch recently-created NFT collections on Base chain.
 * Free tier: 4 req/sec, 10k requests/day.
 *
 * Required env var: OPENSEA_API_KEY (32-char hex string from opensea.io/settings/api-keys)
 */

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const OPENSEA_BASE_URL = 'https://api.opensea.io/api/v2';

export interface OpenSeaCollection {
  /** Collection slug — used for URLs and detail lookups */
  slug: string;
  /** Contract address (lowercase, no 0x prefix variant) */
  contract: string;
  /** Chain id — for Base it's "base" */
  chain: string;
  /** Collection name */
  name: string;
  /** Description (may be empty) */
  description: string | null;
  /** Image URL (collection logo) */
  image_url: string | null;
  /** Floor price in ETH (null if no listings yet) */
  floor_price: number | null;
  /** Total supply minted so far */
  total_supply: number | null;
  /** Creation date (ISO) */
  created_date: string | null;
}

export interface OpenSeaCollectionsResponse {
  collections: OpenSeaCollection[];
}

/**
 * Fetches recently-created collections on Base.
 * Returns up to `limit` collections (default 20).
 *
 * OpenSea API v2: GET /api/v2/collections?chain={chain}
 * Supports pagination via `next` cursor.
 */
export async function getRecentBaseCollections(limit = 20): Promise<OpenSeaCollection[]> {
  if (!OPENSEA_API_KEY) {
    throw new Error('OPENSEA_API_KEY env var is not set');
  }

  const url = `${OPENSEA_BASE_URL}/collections?chain=base&include_hidden=false`;

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': OPENSEA_API_KEY,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`OpenSea API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OpenSeaCollectionsResponse;
  return (data.collections || []).slice(0, limit);
}

/**
 * Fetches a single collection by slug.
 */
export async function getCollectionBySlug(slug: string): Promise<OpenSeaCollection | null> {
  if (!OPENSEA_API_KEY) {
    throw new Error('OPENSEA_API_KEY env var is not set');
  }

  const url = `${OPENSEA_BASE_URL}/collections/${slug}`;

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': OPENSEA_API_KEY,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`OpenSea API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as OpenSeaCollection;
}

/**
 * Checks if OpenSea is configured.
 */
export function isOpenSeaConfigured(): boolean {
  return !!OPENSEA_API_KEY;
}

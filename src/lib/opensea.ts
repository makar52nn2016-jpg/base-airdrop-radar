/**
 * OpenSea API v2 client.
 *
 * Free tier: 4 req/sec, 10k requests/day.
 * Required env: OPENSEA_API_KEY (from opensea.io/settings/api-keys)
 *
 * Endpoints used:
 *   GET /api/v2/collections?chain=base           — list collections on Base
 *   GET /api/v2/collections/{slug}                — single collection detail
 *   GET /api/v2/collections/{slug}/listings       — current listings (for floor price)
 */

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const OPENSEA_BASE_URL = 'https://api.opensea.io/api/v2';

export interface OpenSeaCollectionSummary {
  /** Collection slug — used as ID */
  slug: string;
  /** Display name */
  name: string;
  description: string | null;
  image_url: string | null;
  banner_image_url: string | null;
  owner: string | null;
  safelist_status: string;
  category: string | null;
  is_disabled: boolean;
  is_nsfw: boolean;
  opensea_url: string;
}

export interface OpenSeaCollectionDetail extends OpenSeaCollectionSummary {
  /** Contracts associated with this collection (may be more than one) */
  contracts: Array<{
    address: string;
    chain: string;
    token_standard: string;
    /** Total supply minted */
    total_supply: number;
    /** Total minted (with burned counted) */
    total_minted: number;
  }>;
  /** Floor price in chain's native currency (ETH) */
  floor_price: number | null;
  /** Creation date ISO */
  created_date: string | null;
}

interface CollectionsListResponse {
  collections: OpenSeaCollectionSummary[];
}

// Response shape from /api/v2/collections/{slug} is identical to OpenSeaCollectionDetail
// (no extra fields at top level), so we just alias the type for clarity.
type CollectionDetailResponse = OpenSeaCollectionDetail;

/**
 * Fetches collections on Base chain.
 * Returns up to `limit` collections (default 50).
 */
export async function listBaseCollections(limit = 50): Promise<OpenSeaCollectionSummary[]> {
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

  const data = (await response.json()) as CollectionsListResponse;
  return (data.collections || []).slice(0, limit);
}

/**
 * Fetches a single collection's full details (including contracts).
 */
export async function getCollectionDetail(slug: string): Promise<OpenSeaCollectionDetail | null> {
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

  return (await response.json()) as CollectionDetailResponse;
}

/**
 * Convenience: returns contract addresses for a collection on Base.
 * Empty if collection has no Base contracts.
 */
export async function getCollectionContracts(slug: string): Promise<string[]> {
  const detail = await getCollectionDetail(slug);
  if (!detail) return [];
  return detail.contracts.filter((c) => c.chain === 'base').map((c) => c.address);
}

/**
 * Checks if OpenSea is configured.
 */
export function isOpenSeaConfigured(): boolean {
  return !!OPENSEA_API_KEY;
}

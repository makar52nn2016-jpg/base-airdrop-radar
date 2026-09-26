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
 * OpenSea events API — returns recent activity (transfers, sales, listings).
 *
 * Event structure (verified):
 *   {
 *     event_type: "transfer",
 *     transfer_type: "mint" | "regular" (mint = from 0x0 or null),
 *     chain: "base" | "ethereum" | "polygon" | "optimism" | ...,
 *     nft: { contract, identifier, token_standard, name, ... },
 *     from_address, to_address, quantity, event_timestamp
 *   }
 *
 * NOTE: API's `chain` query param doesn't filter properly — events come
 * from all chains. We filter client-side in filterBaseMintEvents().
 */
export interface OpenSeaEvent {
  event_type: string;
  event_timestamp: number;
  transaction?: string;
  chain?: string;
  transfer_type?: string;
  from_address: string | null;
  to_address: string | null;
  quantity?: number | null;
  nft?: {
    identifier: string;
    collection: string;
    contract: string;
    token_standard: string;
    name: string | null;
    image_url: string | null;
    opensea_url: string | null;
  };
  collection_slug?: string;
}

interface EventsListResponse {
  asset_events: OpenSeaEvent[];
  next: string | null;
}

/**
 * Fetches recent transfer events. NOTE: API does not respect `chain` filter,
 * so events come from ALL chains. Use filterBaseMintEvents() to filter
 * client-side for Base-only mint events.
 *
 * @param limit max events to fetch (default 50, max 100)
 * @param sinceSeconds only return events from last N seconds (default 3600)
 */
export async function getRecentBaseTransfers(
  limit = 50,
  sinceSeconds = 3600
): Promise<OpenSeaEvent[]> {
  if (!OPENSEA_API_KEY) {
    throw new Error('OPENSEA_API_KEY env var is not set');
  }

  const afterTs = Math.floor(Date.now() / 1000) - sinceSeconds;
  const url = `${OPENSEA_BASE_URL}/events?chain=base&event_type=transfer&limit=${Math.min(
    limit,
    100
  )}&after=${afterTs}`;

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': OPENSEA_API_KEY,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`OpenSea events API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as EventsListResponse;
  return data.asset_events || [];
}

/**
 * Filters events to ONLY Base chain mint events.
 *
 * A "mint" is identified by `transfer_type === "mint"` OR
 * `from_address === null` OR `from_address === "0x0...0000"`.
 *
 * Returns distinct contract addresses on Base.
 */
export function filterBaseMintEvents(events: OpenSeaEvent[]): { contract: string; slug?: string }[] {
  const mintContracts = new Map<string, { contract: string; slug?: string }>();
  const zeroAddress = '0x0000000000000000000000000000000000000000'.toLowerCase();

  for (const e of events) {
    const isBase = e.chain === 'base';
    const isMint =
      e.transfer_type === 'mint' ||
      e.from_address === null ||
      (e.from_address && e.from_address.toLowerCase() === zeroAddress);

    if (!isBase || !isMint) continue;

    const contract = e.nft?.contract?.toLowerCase();
    if (!contract) continue;

    if (!mintContracts.has(contract)) {
      mintContracts.set(contract, {
        contract,
        slug: e.collection_slug || undefined,
      });
    }
  }

  return [...mintContracts.values()];
}

/**
 * Fetches contract info by address (returns the collection slug + metadata).
 *
 * Useful when we only have a contract address (from events) and need the
 * collection slug to call other endpoints.
 *
 * Endpoint: GET /api/v2/asset_contract/{address}
 */
export interface AssetContractInfo {
  address: string;
  chain: string;
  collection: string; // slug
  token_standard: string;
  name: string;
  description: string | null;
  image_url: string | null;
  safelist_status: string;
}

export async function getAssetContractInfo(address: string): Promise<AssetContractInfo | null> {
  if (!OPENSEA_API_KEY) return null;

  const url = `${OPENSEA_BASE_URL}/asset_contract/${address.toLowerCase()}`;

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': OPENSEA_API_KEY,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    return null;
  }

  return (await response.json()) as AssetContractInfo;
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

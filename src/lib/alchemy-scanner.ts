/**
 * Alchemy NFT API scanner.
 *
 * Uses Alchemy's enhanced RPC method `alchemy_getAssetTransfers` to find
 * recent NFT mint events (transfers from zero address) on Base, Optimism,
 * and Arbitrum. Also provides `getContractMetadata` to check `isMintable`
 * flag — lets us filter out contracts that don't have public mint function.
 *
 * Required env var:
 *   - ALCHEMY_API_KEY: from https://dashboard.alchemy.com (free tier 25k NFT API req/month)
 *
 * v2 — if env var not set, falls back to Supabase runtime config stored via
 * /api/sniper/config endpoint. Lets user add the key via simple curl call
 * instead of going through Vercel env vars dashboard.
 *
 * Free tier limits:
 *   - 300M compute units / month (plenty for sniper use case)
 *   - 25k NFT API REST requests / month
 *   - alchemy_getAssetTransfers counts as RPC request (very cheap compute-wise)
 *
 * Documentation:
 *   - https://docs.alchemy.com/reference/alchemy-getassettransfers
 *   - https://docs.alchemy.com/reference/getnftsforcompany-collection
 */

// Cache for runtime-loaded key (avoid loading from Supabase on every call)
let cachedRuntimeKey: string | null = null;
let runtimeKeyLoadTime = 0;
const RUNTIME_KEY_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Returns the Alchemy API key — tries env var first, then Supabase runtime config.
 * Supabase fallback lets us add the key without Vercel env vars dashboard setup.
 */
async function getAlchemyApiKey(): Promise<string> {
  // 1. Try env var (set in Vercel env vars)
  const envKey = process.env.ALCHEMY_API_KEY;
  if (envKey) return envKey;

  // 2. Try cached runtime key (TTL 1 min to avoid hammering Supabase)
  const now = Date.now();
  if (cachedRuntimeKey && now - runtimeKeyLoadTime < RUNTIME_KEY_CACHE_TTL) {
    return cachedRuntimeKey;
  }

  // 3. Load from Supabase runtime config (stored via /api/sniper/config)
  try {
    const { loadState } = await import('@/lib/supabase');
    const config = (await loadState<Record<string, any>>('runtime_config')) || {};
    const runtimeKey = config.alchemy_api_key as string | undefined;
    if (runtimeKey) {
      cachedRuntimeKey = runtimeKey;
      runtimeKeyLoadTime = now;
      return runtimeKey;
    }
  } catch {
    // Silent fail
  }

  return '';
}

/**
 * Synchronously checks if Alchemy is configured via env var.
 * For runtime (Supabase) key, use isAlchemyConfiguredAsync() instead.
 */
export function isAlchemyConfigured(): boolean {
  return !!process.env.ALCHEMY_API_KEY || !!cachedRuntimeKey;
}

/**
 * Async check — loads key from Supabase if env var not set.
 * Use this in scanner functions to ensure we have a valid key before scanning.
 */
export async function isAlchemyConfiguredAsync(): Promise<boolean> {
  if (process.env.ALCHEMY_API_KEY) return true;
  const key = await getAlchemyApiKey();
  return !!key;
}

/**
 * Returns recent NFT mint events on a chain via Alchemy's enhanced RPC method
 * `alchemy_getAssetTransfers`.
 *
 * Mint events = transfers where `from === 0x0000000000000000000000000000000000000000`.
 *
 * Alchemy supports this method on Base, Optimism, Arbitrum, Ethereum, Polygon.
 * Much more reliable than direct `eth_getLogs` on free public RPCs (which often
 * fails or returns 0 results).
 *
 * @param chainKey Chain to scan (base, optimism, arbitrum, ethereum, polygon)
 * @param sinceBlocks Approximate block range to scan (default 500)
 * @returns Array of unique contract addresses that minted NFTs recently
 */
export async function getRecentMintsViaAlchemy(
  chainKey: string,
  sinceBlocks = 500
): Promise<Array<{ contract: string; chain: string; tokenId?: string }>> {
  const apiKey = await getAlchemyApiKey();
  if (!apiKey) return [];

  const rpcUrl = `https://${ALCHEMY_HOST_BY_CHAIN[chainKey]}/v2/${apiKey}`;
  if (!ALCHEMY_HOST_BY_CHAIN[chainKey]) return [];

  try {
    // Step 1: Get current block number
    const blockResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    if (!blockResp.ok) return [];
    const blockData = await blockResp.json();
    const latestBlock = parseInt(blockData.result, 16);
    const fromBlock = `0x${(latestBlock - sinceBlocks).toString(16)}`;

    // Step 2: Call alchemy_getAssetTransfers with filter for mints (from = zero address)
    const transfersResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [
          {
            fromBlock,
            toBlock: 'latest',
            fromAddress: '0x0000000000000000000000000000000000000000',
            category: ['erc721', 'erc1155'],
            maxCount: '0x64', // 100 results
          },
        ],
        id: 2,
      }),
    });

    if (!transfersResp.ok) return [];
    const transfersData = await transfersResp.json();
    const transfers = transfersData.result?.transfers || [];

    // Extract unique contract addresses (NFT contracts being minted)
    const seen = new Set<string>();
    const uniqueContracts: Array<{ contract: string; chain: string; tokenId?: string }> = [];

    for (const t of transfers) {
      const contract = t.rawContract?.address?.toLowerCase();
      if (!contract || seen.has(contract)) continue;
      seen.add(contract);

      // Extract tokenId if available
      const tokenId = t.rawContract?.tokenId;
      uniqueContracts.push({
        contract,
        chain: chainKey,
        tokenId,
      });
    }

    return uniqueContracts;
  } catch (e) {
    console.error(`[alchemy] getRecentMintsViaAlchemy error on ${chainKey}:`, e);
    return [];
  }
}

// Alchemy host per chain (built dynamically with API key)
const ALCHEMY_HOST_BY_CHAIN: Record<string, string> = {
  base: 'base-mainnet.g.alchemy.com',
  optimism: 'opt-mainnet.g.alchemy.com',
  arbitrum: 'arb-mainnet.g.alchemy.com',
  ethereum: 'eth-mainnet.g.alchemy.com',
  polygon: 'polygon-mainnet.g.alchemy.com',
};

/**
 * Fetches contract metadata from Alchemy NFT API.
 * Returns `isMintable` flag if Alchemy knows about this contract.
 *
 * Endpoint: GET https://nft.alchemy.com/v3/getContractMetadata
 * Documentation: https://docs.alchemy.com/reference/get-contract-metadata
 *
 * @param contractAddress NFT contract address
 * @param chain chain identifier (base, optimism, arbitrum, ethereum, polygon)
 */
export async function getContractMetadata(
  contractAddress: string,
  chain: string
): Promise<{
  name?: string;
  symbol?: string;
  totalSupply?: string;
  isMintable?: boolean;
  contractDeployer?: string;
  deployedBlock?: number;
  tokenType?: string;
} | null> {
  const apiKey = await getAlchemyApiKey();
  if (!apiKey) return null;

  try {
    const url = `https://nft.alchemy.com/v3/getContractMetadata?chain=${chain}&contractAddress=${contractAddress}`;
    const resp = await fetch(url, {
      headers: { 'X-Alchemy-API-Key': apiKey },
      cache: 'no-store',
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.contractMetadata || null;
  } catch {
    return null;
  }
}

/**
 * Check if a contract is flagged as spam by Alchemy.
 * Spam contracts are often low-quality or scam NFTs — skip them.
 *
 * @param contractAddress NFT contract address
 * @param chain chain identifier
 */
export async function isSpamContract(
  contractAddress: string,
  chain: string
): Promise<boolean> {
  const apiKey = await getAlchemyApiKey();
  if (!apiKey) return false;

  try {
    const url = `https://nft.alchemy.com/v3/isSpamContract?chain=${chain}&contractAddress=${contractAddress}`;
    const resp = await fetch(url, {
      headers: { 'X-Alchemy-API-Key': apiKey },
      cache: 'no-store',
    });

    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.data === true || data === true;
  } catch {
    return false;
  }
}

/**
 * Scans all supported chains for recent NFT mints via Alchemy.
 * Returns combined list of unique contracts across all chains.
 *
 * @param chains Array of chains to scan
 * @param blocksPerChain How many recent blocks to scan per chain
 */
export async function scanAlchemyMintsAcrossChains(
  chains: string[] = ['base', 'optimism', 'arbitrum'],
  blocksPerChain = 500
): Promise<Array<{ contract: string; chain: string; tokenId?: string }>> {
  const apiKey = await getAlchemyApiKey();
  if (!apiKey) return [];

  // Scan all chains in parallel
  const results = await Promise.all(
    chains.map(async (chain) => {
      try {
        return await getRecentMintsViaAlchemy(chain, blocksPerChain);
      } catch {
        return [];
      }
    })
  );

  // Flatten + dedup by contract address (keep chain from first occurrence)
  const seen = new Set<string>();
  const combined: Array<{ contract: string; chain: string; tokenId?: string }> = [];

  for (const chainResults of results) {
    for (const item of chainResults) {
      if (seen.has(item.contract)) continue;
      seen.add(item.contract);
      combined.push(item);
    }
  }

  return combined;
}

/**
 * Filters Alchemy-found contracts:
 *   - Skip spam contracts (Alchemy's spam filter)
 *   - Optional: skip contracts where isMintable === false (no public mint function)
 *
 * @param contracts Array of contract addresses with chain info
 * @returns Filtered list of contracts that should be attempted
 */
export async function filterAlchemyContractsByMintability(
  contracts: Array<{ contract: string; chain: string }>
): Promise<Array<{ contract: string; chain: string; isMintable?: boolean }>> {
  if (!(await isAlchemyConfiguredAsync()) || contracts.length === 0) return contracts;

  const results: Array<{ contract: string; chain: string; isMintable?: boolean }> = [];

  // Check spam status + mintability in parallel (limit to 5 concurrent to avoid rate limits)
  const batchSize = 5;
  for (let i = 0; i < contracts.length; i += batchSize) {
    const batch = contracts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (c) => {
        try {
          // Check spam status — skip spam contracts
          const isSpam = await isSpamContract(c.contract, c.chain);
          if (isSpam) return null;

          // Check contract metadata — get isMintable flag (optional, don't filter on false)
          const metadata = await getContractMetadata(c.contract, c.chain);
          return {
            contract: c.contract,
            chain: c.chain,
            isMintable: metadata?.isMintable,
          };
        } catch {
          // If metadata check fails, still include contract (let blind mint decide)
          return { contract: c.contract, chain: c.chain };
        }
      })
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  return results;
}

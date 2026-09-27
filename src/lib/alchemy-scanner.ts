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
 * Free tier limits:
 *   - 300M compute units / month (plenty for sniper use case)
 *   - 25k NFT API REST requests / month
 *   - alchemy_getAssetTransfers counts as RPC request (very cheap compute-wise)
 *
 * Documentation:
 *   - https://docs.alchemy.com/reference/alchemy-getassettransfers
 *   - https://docs.alchemy.com/reference/getnftsforcompany-collection
 */

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';

// Alchemy enhanced RPC URLs per chain
const ALCHEMY_RPC_URLS: Record<string, string> = {
  base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
};

// OpenSea chain name → our ChainKey
const OPENSEA_TO_CHAIN_KEY: Record<string, string> = {
  base: 'base',
  optimism: 'optimism',
  arbitrum: 'arbitrum',
  matic: 'polygon',
  ethereum: 'ethereum',
};

export function isAlchemyConfigured(): boolean {
  return !!ALCHEMY_API_KEY;
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
  if (!isAlchemyConfigured()) return [];

  const rpcUrl = ALCHEMY_RPC_URLS[chainKey];
  if (!rpcUrl) return [];

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
  if (!isAlchemyConfigured()) return null;

  try {
    const url = `https://nft.alchemy.com/v3/getContractMetadata?chain=${chain}&contractAddress=${contractAddress}`;
    const resp = await fetch(url, {
      headers: { 'X-Alchemy-API-Key': ALCHEMY_API_KEY },
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
  if (!isAlchemyConfigured()) return false;

  try {
    const url = `https://nft.alchemy.com/v3/isSpamContract?chain=${chain}&contractAddress=${contractAddress}`;
    const resp = await fetch(url, {
      headers: { 'X-Alchemy-API-Key': ALCHEMY_API_KEY },
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
  if (!isAlchemyConfigured()) return [];

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
  if (!isAlchemyConfigured() || contracts.length === 0) return contracts;

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

import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { http, createPublicClient } from 'viem';
import { base, optimism, arbitrum, polygon, mainnet } from 'viem/chains';
import type { Chain } from 'viem';

/**
 * Multi-chain Pimlico client setup.
 *
 * Supports:
 *   - base (chainId 8453)
 *   - optimism (chainId 10)
 *   - arbitrum (chainId 42161)
 *   - polygon (chainId 137)
 *   - ethereum (chainId 1)
 *
 * Each chain has its own:
 *   - Public RPC URL (for state queries)
 *   - Pimlico bundler URL (for UserOp submission)
 *   - Pimlico paymaster URL (for gas sponsorship)
 *
 * Smart Account address is deterministic per (signer, chain) — different chain
 * means different Smart Account address (Pimlico Safe factory varies by chain).
 *
 * Required env vars:
 *   - PIMLICO_API_KEY: from pimlico.io dashboard
 *   - SIGNER_PRIVATE_KEY: EOA private key that signs UserOperations
 */

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY || '';
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY || '';

export type ChainKey = 'base' | 'optimism' | 'arbitrum' | 'polygon' | 'ethereum';

interface ChainConfig {
  key: ChainKey;
  chain: Chain;
  /** Public RPC for state queries (free, no key needed) */
  rpcUrl: string;
  /** Chain scanner base URL (e.g. basescan.org, optimistic.etherscan.io) */
  scannerUrl: string;
  /** OpenSea chain identifier (used in opensea.io/assets/<chain>/<addr>) */
  openSeaChain: string;
}

export const CHAIN_CONFIGS: Record<ChainKey, ChainConfig> = {
  base: {
    key: 'base',
    chain: base,
    // Official Base RPC — works for eth_blockNumber (getLogs may fail, that's OK)
    rpcUrl: 'https://mainnet.base.org',
    scannerUrl: 'https://basescan.org',
    openSeaChain: 'base',
  },
  optimism: {
    key: 'optimism',
    chain: optimism,
    rpcUrl: 'https://mainnet.optimism.io',
    scannerUrl: 'https://optimistic.etherscan.io',
    openSeaChain: 'optimism',
  },
  arbitrum: {
    key: 'arbitrum',
    chain: arbitrum,
    // Arb1 official RPC — supports BOTH getBlockNumber AND getLogs ✅
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    scannerUrl: 'https://arbiscan.io',
    openSeaChain: 'arbitrum',
  },
  polygon: {
    key: 'polygon',
    chain: polygon,
    // Official Polygon RPC — works for getBlockNumber
    rpcUrl: 'https://polygon-rpc.com',
    scannerUrl: 'https://polygonscan.com',
    openSeaChain: 'matic',
  },
  ethereum: {
    key: 'ethereum',
    chain: mainnet,
    // Cloudflare ETH gateway — free, no API key
    rpcUrl: 'https://cloudflare-eth.com',
    scannerUrl: 'https://etherscan.io',
    openSeaChain: 'ethereum',
  },
};

// Only scan chains with working RPCs from Vercel.
// polygon and ethereum RPCs fail from Vercel (401/connection issues).
// They're still in CHAIN_CONFIGS (for /chains command) but not scanned.
// OpenSea events API (Strategy 1) still catches mints on ALL chains.
export const ALL_CHAINS: ChainKey[] = ['base', 'optimism', 'arbitrum'];

// Cache clients per chain (creating clients is expensive)
const clientCache = new Map<ChainKey, { publicClient: any; bundlerClient: any; paymasterClient: any }>();

function pimlicoUrl(chainKey: ChainKey): string {
  return `https://api.pimlico.io/v2/${chainKey}/rpc?apikey=${PIMLICO_API_KEY}`;
}

/**
 * Returns cached clients for the given chain. Creates them on first call.
 */
export function getClientsForChain(chainKey: ChainKey) {
  if (clientCache.has(chainKey)) {
    return clientCache.get(chainKey)!;
  }

  const config = CHAIN_CONFIGS[chainKey];

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const bundlerClient = createBundlerClient({
    chain: config.chain,
    transport: http(pimlicoUrl(chainKey)),
    client: publicClient,
  });

  const paymasterClient = createPaymasterClient({
    chain: config.chain,
    transport: http(pimlicoUrl(chainKey)),
  });

  const clients = { publicClient, bundlerClient, paymasterClient };
  clientCache.set(chainKey, clients);
  return clients;
}

// Backward-compat exports (use Base clients as default)
export const baseChain = base;
export const publicClient = getClientsForChain('base').publicClient;
export const bundlerClient = getClientsForChain('base').bundlerClient;
export const paymasterClient = getClientsForChain('base').paymasterClient;

/**
 * Returns the signer private key if configured.
 */
export function getSignerPrivateKey(): `0x${string}` {
  if (!SIGNER_PRIVATE_KEY) {
    throw new Error('SIGNER_PRIVATE_KEY env var is not set.');
  }
  if (!SIGNER_PRIVATE_KEY.startsWith('0x')) {
    return `0x${SIGNER_PRIVATE_KEY}` as `0x${string}`;
  }
  return SIGNER_PRIVATE_KEY as `0x${string}`;
}

/**
 * Checks if Pimlico is configured.
 */
export function isPimlicoConfigured(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!PIMLICO_API_KEY) missing.push('PIMLICO_API_KEY');
  if (!SIGNER_PRIVATE_KEY) missing.push('SIGNER_PRIVATE_KEY');
  return { configured: missing.length === 0, missing };
}

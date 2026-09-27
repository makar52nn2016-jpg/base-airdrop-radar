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
    // v3: switched to PublicNode RPC — official mainnet.base.org was timing out
    // from Vercel on eth_getBalance calls (2/10 attempts failed with "RPC
    // Request failed"). Pimlico RPC doesn't support eth_call. PublicNode is
    // a free, reliable, multi-chain RPC provider that supports all standard
    // methods including eth_call, eth_getBalance, eth_getLogs.
    rpcUrl: 'https://base-rpc.publicnode.com',
    scannerUrl: 'https://basescan.org',
    openSeaChain: 'base',
  },
  optimism: {
    key: 'optimism',
    chain: optimism,
    rpcUrl: 'https://optimism-rpc.publicnode.com',
    scannerUrl: 'https://optimistic.etherscan.io',
    openSeaChain: 'optimism',
  },
  arbitrum: {
    key: 'arbitrum',
    chain: arbitrum,
    rpcUrl: 'https://arbitrum-one-rpc.publicnode.com',
    scannerUrl: 'https://arbiscan.io',
    openSeaChain: 'arbitrum',
  },
  polygon: {
    key: 'polygon',
    chain: polygon,
    // PublicNode RPC — reliable, supports eth_call + eth_getBalance + eth_getLogs
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    scannerUrl: 'https://polygonscan.com',
    openSeaChain: 'matic',
  },
  ethereum: {
    key: 'ethereum',
    chain: mainnet,
    // PublicNode RPC — reliable for state queries
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    scannerUrl: 'https://etherscan.io',
    openSeaChain: 'ethereum',
  },
};

// All 5 chains now active (was 3). Polygon + Ethereum added for wider coverage.
// Polygon uses ETH for gas (since Polygon migrated to ETH).
// Ethereum mainnet gas is expensive — bot will skip Ethereum mints unless
// Smart Account has > 0.00005 ETH on Ethereum.
export const ALL_CHAINS: ChainKey[] = ['base', 'optimism', 'arbitrum', 'polygon', 'ethereum'];

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
 * v2 — now also flags PIMLICO_SPONSOR_POLICY_ID as "warning" (not blocking,
 * but gasless mints will fail without it).
 */
export function isPimlicoConfigured(): { configured: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!PIMLICO_API_KEY) missing.push('PIMLICO_API_KEY');
  if (!SIGNER_PRIVATE_KEY) missing.push('SIGNER_PRIVATE_KEY');
  if (!process.env.PIMLICO_SPONSOR_POLICY_ID) {
    warnings.push('PIMLICO_SPONSOR_POLICY_ID (gasless mints WILL FAIL without it — get from https://dashboard.pimlico.io/sponsorship-policies)');
  }
  return { configured: missing.length === 0, missing, warnings };
}

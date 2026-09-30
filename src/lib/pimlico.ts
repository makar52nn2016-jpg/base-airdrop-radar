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
    // v4: switched back to official mainnet.base.org as PRIMARY — it's Coinbase's
    // own RPC, much more reliable than publicnode. PublicNode is FALLBACK only.
    // (mainnet.base.org now responds in 250-300ms consistently from Vercel;
    //  publicnode was 80-100ms when alive but occasionally timeout/fail under load).
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
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    scannerUrl: 'https://arbiscan.io',
    openSeaChain: 'arbitrum',
  },
  polygon: {
    key: 'polygon',
    chain: polygon,
    rpcUrl: 'https://polygon-rpc.com',
    scannerUrl: 'https://polygonscan.com',
    openSeaChain: 'matic',
  },
  ethereum: {
    key: 'ethereum',
    chain: mainnet,
    rpcUrl: 'https://eth.llamarpc.com',
    scannerUrl: 'https://etherscan.io',
    openSeaChain: 'ethereum',
  },
};

// Fallback RPC URLs per chain — tried if primary throws/times out
export const CHAIN_RPC_FALLBACKS: Record<ChainKey, string[]> = {
  base: ['https://base-rpc.publicnode.com', 'https://base.publicnode.com'],
  optimism: ['https://optimism-rpc.publicnode.com'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com'],
  polygon: ['https://polygon-bor-rpc.publicnode.com'],
  ethereum: ['https://ethereum-rpc.publicnode.com'],
};

// v5: reverted back to 3 chains. User doesn't have ETH on polygon/ethereum,
// so scanning them is wasteful (all candidates skip due to balance check).
// OpenSea + Alchemy strategies still scan ALL chains via events API.
export const ALL_CHAINS: ChainKey[] = ['base', 'optimism', 'arbitrum'];

// Cache clients per chain (creating clients is expensive)
const clientCache = new Map<ChainKey, { publicClient: any; bundlerClient: any; paymasterClient: any }>();

function pimlicoUrl(chainKey: ChainKey): string {
  return `https://api.pimlico.io/v2/${chainKey}/rpc?apikey=${PIMLICO_API_KEY}`;
}

/**
 * v8 — Reverted to viem's standard http() transport with NO custom fetch.
 *
 * v6/v7 attempts to add a custom fetch wrapper (for timeout/fallback) caused
 * "HTTP request failed. URL: [object Object]" errors. viem internally passes
 * a Request OBJECT (not a string URL) as fetch's first arg, and our wrapper
 * was mis-formatting the URL when displaying errors.
 *
 * v8: just use viem's default http(url) — no custom fetch. The RPC switch
 * from publicnode.com to mainnet.base.org (Coinbase official) in
 * CHAIN_CONFIGS already addresses reliability.
 */
function makeHttpTransport(url: string) {
  return http(url);
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
    transport: makeHttpTransport(config.rpcUrl),
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

/**
 * v6 — Checks whether Pimlico gas sponsorship is configured.
 * When true, the sniper can safely skip the ETH balance pre-flight check:
 * Pimlico's paymaster will pay gas for sponsored UserOps regardless of
 * the Smart Account's ETH balance.
 */
export function isSponsorshipConfigured(): boolean {
  return Boolean(process.env.PIMLICO_SPONSOR_POLICY_ID);
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

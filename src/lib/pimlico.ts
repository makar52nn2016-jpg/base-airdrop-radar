import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { http, createPublicClient } from 'viem';
import { base } from 'viem/chains';

/**
 * Pimlico client setup for gasless Smart Account operations on Base.
 *
 * Required env vars:
 *  - PIMLICO_API_KEY: from pimlico.io dashboard
 *  - SIGNER_PRIVATE_KEY: EOA private key that signs UserOperations
 *
 * Note: Pimlico's RPC endpoint supports standard ERC-4337 JSON-RPC methods
 * (eth_sendUserOperation, pm_sponsorUserOperation, etc.) — no Pimlico-specific
 * client extensions are needed for basic gasless operation.
 */

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY || '';
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY || '';

// Pimlico endpoints (Base mainnet)
export const PIMLICO_BUNDLER_URL = `https://api.pimlico.io/v2/base/rpc?apikey=${PIMLICO_API_KEY}`;
export const PIMLICO_PAYMASTER_URL = `https://api.pimlico.io/v2/base/rpc?apikey=${PIMLICO_API_KEY}`;

// Public Base RPC for state queries (free, no key needed)
export const BASE_RPC_URL = 'https://mainnet.base.org';

// Base chain config
export const baseChain = base;

// Public client for state queries (read-only)
export const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

// Bundler client — for submitting UserOperations via Pimlico
export const bundlerClient = createBundlerClient({
  chain: base,
  transport: http(PIMLICO_BUNDLER_URL),
  client: publicClient,
});

// Paymaster client — for gas sponsorship via Pimlico
// Pimlico supports both `pm_getPaymasterData` (for generic paymaster) and
// `pm_sponsorUserOperation` (for sponsored mode). We use the standard
// paymasterActions — no Pimlico-specific extensions needed.
export const paymasterClient = createPaymasterClient({
  chain: base,
  transport: http(PIMLICO_PAYMASTER_URL),
});

/**
 * Returns the signer private key if configured.
 * Throws with a clear error if missing.
 */
export function getSignerPrivateKey(): `0x${string}` {
  if (!SIGNER_PRIVATE_KEY) {
    throw new Error(
      'SIGNER_PRIVATE_KEY env var is not set. Generate a private key and add it in Vercel env vars.'
    );
  }
  if (!SIGNER_PRIVATE_KEY.startsWith('0x')) {
    return `0x${SIGNER_PRIVATE_KEY}` as `0x${string}`;
  }
  return SIGNER_PRIVATE_KEY as `0x${string}`;
}

/**
 * Checks if the Pimlico setup is properly configured.
 */
export function isPimlicoConfigured(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!PIMLICO_API_KEY) missing.push('PIMLICO_API_KEY');
  if (!SIGNER_PRIVATE_KEY) missing.push('SIGNER_PRIVATE_KEY');
  return {
    configured: missing.length === 0,
    missing,
  };
}

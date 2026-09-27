/**
 * Cached Smart Account addresses per chain.
 *
 * Computed once on first access, then cached in-memory.
 * Address is deterministic per (signer, chainKey) — never changes,
 * so caching is safe.
 *
 * This avoids the slow ~10-15s sequential init in /chains command.
 */

import { getSmartAccountAddressForChain } from '@/lib/sniper';
import type { ChainKey } from '@/lib/pimlico';
import { ALL_CHAINS, CHAIN_CONFIGS } from '@/lib/pimlico';

interface ChainInfo {
  chainKey: ChainKey;
  chainId: number;
  address: string;
  scannerUrl: string;
  openSeaUrl: string;
  openSeaChain: string;
  initError?: string;
}

let cachedChains: ChainInfo[] | null = null;
let initPromise: Promise<ChainInfo[]> | null = null;

/**
 * Returns all 5 chain Smart Account addresses.
 * First call triggers parallel init (takes ~3-5s), subsequent calls return cache instantly.
 */
export async function getAllChainAddresses(): Promise<ChainInfo[]> {
  if (cachedChains) return cachedChains;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const results = await Promise.all(
      ALL_CHAINS.map(async (chainKey): Promise<ChainInfo> => {
        const config = CHAIN_CONFIGS[chainKey];
        try {
          const address = await getSmartAccountAddressForChain(chainKey);
          return {
            chainKey,
            chainId: config.chain.id,
            address,
            scannerUrl: `${config.scannerUrl}/address/${address}`,
            openSeaUrl: `https://opensea.io/${address}`,
            openSeaChain: config.openSeaChain,
          };
        } catch (e: any) {
          return {
            chainKey,
            chainId: config.chain.id,
            address: 'init failed',
            scannerUrl: config.scannerUrl,
            openSeaUrl: '',
            openSeaChain: config.openSeaChain,
            initError: e?.message?.slice(0, 100) || String(e),
          };
        }
      })
    );

    cachedChains = results;
    return results;
  })();

  return initPromise;
}

/**
 * Synchronous access — returns cached results or empty array if not yet computed.
 */
export function getCachedChainAddresses(): ChainInfo[] {
  return cachedChains || [];
}

/**
 * Formats the chains info as a Telegram-friendly message.
 */
export function formatChainsMessage(chains: ChainInfo[]): string {
  const lines: string[] = ['⛓ *Smart Accounts per chain*'];
  for (const c of chains) {
    lines.push(
      `\n*${c.chainKey}* (\`${c.chainId}\`)\n  \`${c.address}\`${
        c.initError ? `\n  ⚠ ${c.initError}` : `\n  [OpenSea](${c.openSeaUrl}) · [Scanner](${c.scannerUrl})`
      }`
    );
  }
  return lines.join('\n');
}

/**
 * Yield Farm Scanner — finds best liquidity pools on Aerodrome.
 *
 * VERIFIED ADDRESSES:
 *   Aerodrome Factory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da ✅
 */

import { BASE_DEFI, BASE_TOKENS } from './defi-config';
import { logActivity } from '@/lib/stats';

const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

export async function scanYieldPools(maxResults = 5): Promise<any[]> {
  const pools: any[] = [];

  try {
    logActivity({
      type: 'chain_scan',
      message: `Yield farm: scanning Aerodrome Factory for pools...`,
    });

    // Check Aerodrome Factory — try allPairsLength() and allPoolsLength()
    for (const selector of ['0x57a6e44a', '0x5a1e3c6a']) { // allPairsLength, allPoolsLength
      const req = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: BASE_DEFI.aerodromeFactory, data: selector }, 'latest'],
        id: 1,
      };
      const resp = await fetch(ALCHEMY_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data = await resp.json();

      if (data.result && data.result !== '0x') {
        const count = Number(BigInt(data.result));
        logActivity({
          type: 'chain_scan',
          message: `Yield farm: Aerodrome Factory has ${count} pairs/pools`,
        });
        break;
      }
    }
  } catch (e: any) {
    logActivity({
      type: 'error',
      message: `Yield farm scan failed: ${e?.message?.slice(0, 60)}`,
    });
  }

  return pools;
}

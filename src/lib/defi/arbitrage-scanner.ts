/**
 * Arbitrage Scanner — compares prices between Aerodrome and Uniswap V3.
 *
 * VERIFIED ADDRESSES:
 *   Aerodrome Router: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43 ✅
 *   Aerodrome Factory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da ✅
 *   Uniswap V3 Router: 0x2626664c2603336E57B271c5C0b26F421741e481 ✅
 *   Uniswap V3 Factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD ✅
 */

import { BASE_DEFI, BASE_TOKENS } from './defi-config';
import { logActivity } from '@/lib/stats';

const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

export async function scanArbitrageOpportunities(maxResults = 5): Promise<any[]> {
  const opportunities: any[] = [];

  try {
    logActivity({
      type: 'chain_scan',
      message: `Arbitrage: checking Aerodrome vs Uniswap V3 prices...`,
    });

    // Check WETH/USDC price on Aerodrome
    const aeroPrice = await getAerodromePrice(BASE_TOKENS.WETH, BASE_TOKENS.USDC);

    // Check WETH/USDC price on Uniswap V3
    const uniPrice = await getUniswapV3Price(BASE_TOKENS.WETH, BASE_TOKENS.USDC);

    if (aeroPrice && uniPrice && aeroPrice > 0 && uniPrice > 0) {
      const diff = Math.abs(aeroPrice - uniPrice);
      const diffPct = (diff / Math.min(aeroPrice, uniPrice)) * 100;

      logActivity({
        type: 'chain_scan',
        message: `Arbitrage: WETH/USDC — Aero: $${aeroPrice.toFixed(2)} | Uni: $${uniPrice.toFixed(2)} | diff: ${diffPct.toFixed(2)}%`,
      });

      if (diffPct > 0.5) { // 0.5% price difference = profitable arbitrage
        opportunities.push({
          tokenIn: BASE_TOKENS.WETH,
          tokenOut: BASE_TOKENS.USDC,
          buyDex: aeroPrice < uniPrice ? 'Aerodrome' : 'Uniswap',
          sellDex: aeroPrice < uniPrice ? 'Uniswap' : 'Aerodrome',
          buyPrice: Math.min(aeroPrice, uniPrice),
          sellPrice: Math.max(aeroPrice, uniPrice),
          profitUsd: diff,
          diffPct,
        });

        logActivity({
          type: 'candidate_found',
          message: `🔥 ARBITRAGE: WETH/USDC diff ${diffPct.toFixed(2)}% — buy ${aeroPrice < uniPrice ? 'Aero' : 'Uni'} sell ${aeroPrice < uniPrice ? 'Uni' : 'Aero'} → profit ~$${diff.toFixed(2)}`,
        });
      }
    } else {
      logActivity({
        type: 'chain_scan',
        message: `Arbitrage: Aero price: ${aeroPrice || '?'} | Uni price: ${uniPrice || '?'}`,
      });
    }
  } catch (e: any) {
    logActivity({
      type: 'error',
      message: `Arbitrage scan failed: ${e?.message?.slice(0, 60)}`,
    });
  }

  return opportunities;
}

async function getAerodromePrice(tokenA: string, tokenB: string): Promise<number | null> {
  try {
    // Use Aerodrome Router getAmountsOut to get price
    // getAmountsOut(uint256, address[]) = 0xd06ca61f
    // Input: 1 WETH = 10^18, path = [WETH, USDC]
    const amountIn = (10n ** 18n).toString(16).padStart(64, '0');
    const path = tokenA.toLowerCase().slice(2).padStart(64, '0') + tokenB.toLowerCase().slice(2).padStart(64, '0');
    const data = '0xd06ca61f' + amountIn + '0000000000000000000000000000000000000000000000000000000000000040' + '0000000000000000000000000000000000000000000000000000000000000002' + path;

    const req = {
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: BASE_DEFI.aerodromeRouter, data }, 'latest'],
      id: 1,
    };
    const resp = await fetch(ALCHEMY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const data2 = await resp.json();
    if (data2.error || !data2.result || data2.result === '0x') return null;

    // Parse getAmountsOut response — last uint256 is the output amount
    const hex = data2.result.slice(2);
    const lastAmount = BigInt('0x' + hex.slice(-64));
    // USDC has 6 decimals
    return Number(lastAmount) / 1e6;
  } catch {
    return null;
  }
}

async function getUniswapV3Price(tokenA: string, tokenB: string): Promise<number | null> {
  try {
    // Use Uniswap V3 Factory getPool to find the pool
    // getPool(address,address,uint24) = 0x1698ee82
    // Try fee tiers: 500 (0x1f4), 3000 (0xbb8), 10000 (0x2710)
    for (const fee of ['00000000000000000000000000000000000000000000000000000000000001f4', '0000000000000000000000000000000000000000000000000000000000000bb8', '0000000000000000000000000000000000000000000000000000000000002710']) {
      const data = '0x1698ee82' + tokenA.toLowerCase().slice(2).padStart(64, '0') + tokenB.toLowerCase().slice(2).padStart(64, '0') + fee;
      const req = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: BASE_DEFI.uniswapV3Factory, data }, 'latest'],
        id: 1,
      };
      const resp = await fetch(ALCHEMY_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data2 = await resp.json();
      if (data2.error || !data2.result) continue;

      const pool = '0x' + data2.result.slice(-40);
      if (pool === '0x0000000000000000000000000000000000000000') continue;

      // Get pool reserves via slot0() = 0x3850c7bd
      const slot0Req = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: pool, data: '0x3850c7bd' }, 'latest'],
        id: 2,
      };
      const slot0Resp = await fetch(ALCHEMY_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slot0Req),
      });
      const slot0Data = await slot0Resp.json();
      if (slot0Data.error || !slot0Data.result || slot0Data.result === '0x') continue;

      // slot0 returns: sqrtPriceX96, tick, protocolFee, ...
      const hex = slot0Data.result.slice(2);
      const sqrtPriceX96 = BigInt('0x' + hex.slice(0, 64));
      // price = (sqrtPriceX96 / 2^96)^2
      // For WETH/USDC: price = (sqrtPriceX96^2) / (2^192) * 10^(18-6)
      const price = Number((sqrtPriceX96 * sqrtPriceX96) / (2n ** 192n)) * 1e12;
      if (price > 0) return price;
    }
    return null;
  } catch {
    return null;
  }
}

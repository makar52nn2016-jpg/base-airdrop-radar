/**
 * Arbitrage Scanner — compares prices between Aerodrome and Uniswap V3.
 *
 * ARCHITECTURE (per user feedback 2026-09-28):
 *   - NO automatic execution (cannot beat MEV bots in public mempool with $50 budget)
 *   - SCAN + ALERT only — user executes manually via Aerodrome/Uniswap UI
 *   - Direct pool reserves reading (no broken Router.getAmountsOut)
 *
 * COVERAGE: 28 pairs across 8 verified Base tokens:
 *   WETH, USDC, USDT, DAI, cbBTC, cbETH, AERO, AAVE
 *
 * VERIFIED ADDRESSES:
 *   Aerodrome Factory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da ✅
 *   Uniswap V3 Factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD ✅
 */

import { BASE_DEFI, BASE_TOKENS } from './defi-config';
import { logActivity } from '@/lib/stats';

const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

// Token registry — all 8 verified tokens
const T = BASE_TOKENS;

// 28 pairs across 8 tokens — covers all major cross-rates
const PAIRS: ArbPair[] = [
  // === WETH pairs (7)
  { name: 'WETH/USDC', tokenIn: T.WETH, tokenOut: T.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/USDT', tokenIn: T.WETH, tokenOut: T.USDT, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/DAI',  tokenIn: T.WETH, tokenOut: T.DAI,  inDec: 18, outDec: 18, minSpreadPct: 0.6 },
  { name: 'WETH/cbBTC', tokenIn: T.WETH, tokenOut: T.cbBTC, inDec: 18, outDec: 8, minSpreadPct: 0.5 },
  { name: 'WETH/cbETH', tokenIn: T.WETH, tokenOut: T.cbETH, inDec: 18, outDec: 18, minSpreadPct: 0.5 },
  { name: 'WETH/AERO', tokenIn: T.WETH, tokenOut: T.AERO, inDec: 18, outDec: 18, minSpreadPct: 1.0 },
  { name: 'WETH/AAVE', tokenIn: T.WETH, tokenOut: T.AAVE, inDec: 18, outDec: 18, minSpreadPct: 1.0 },

  // === cbBTC pairs (6)
  { name: 'cbBTC/USDC', tokenIn: T.cbBTC, tokenOut: T.USDC, inDec: 8, outDec: 6, minSpreadPct: 0.4 },
  { name: 'cbBTC/USDT', tokenIn: T.cbBTC, tokenOut: T.USDT, inDec: 8, outDec: 6, minSpreadPct: 0.4 },
  { name: 'cbBTC/DAI',  tokenIn: T.cbBTC, tokenOut: T.DAI,  inDec: 8, outDec: 18, minSpreadPct: 0.4 },
  { name: 'cbBTC/cbETH', tokenIn: T.cbBTC, tokenOut: T.cbETH, inDec: 8, outDec: 18, minSpreadPct: 0.5 },
  { name: 'cbBTC/AERO', tokenIn: T.cbBTC, tokenOut: T.AERO, inDec: 8, outDec: 18, minSpreadPct: 1.0 },
  { name: 'cbBTC/AAVE', tokenIn: T.cbBTC, tokenOut: T.AAVE, inDec: 8, outDec: 18, minSpreadPct: 1.0 },

  // === cbETH pairs (5)
  { name: 'cbETH/USDC', tokenIn: T.cbETH, tokenOut: T.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'cbETH/USDT', tokenIn: T.cbETH, tokenOut: T.USDT, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'cbETH/DAI',  tokenIn: T.cbETH, tokenOut: T.DAI,  inDec: 18, outDec: 18, minSpreadPct: 0.6 },
  { name: 'cbETH/AERO', tokenIn: T.cbETH, tokenOut: T.AERO, inDec: 18, outDec: 18, minSpreadPct: 1.0 },
  { name: 'cbETH/AAVE', tokenIn: T.cbETH, tokenOut: T.AAVE, inDec: 18, outDec: 18, minSpreadPct: 1.0 },

  // === AERO pairs (4)
  { name: 'AERO/USDC', tokenIn: T.AERO, tokenOut: T.USDC, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'AERO/USDT', tokenIn: T.AERO, tokenOut: T.USDT, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'AERO/DAI',  tokenIn: T.AERO, tokenOut: T.DAI,  inDec: 18, outDec: 18, minSpreadPct: 1.5 },
  { name: 'AERO/AAVE', tokenIn: T.AERO, tokenOut: T.AAVE, inDec: 18, outDec: 18, minSpreadPct: 1.5 },

  // === AAVE pairs (3)
  { name: 'AAVE/USDC', tokenIn: T.AAVE, tokenOut: T.USDC, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'AAVE/USDT', tokenIn: T.AAVE, tokenOut: T.USDT, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'AAVE/DAI',  tokenIn: T.AAVE, tokenOut: T.DAI,  inDec: 18, outDec: 18, minSpreadPct: 1.5 },

  // === Stablecoin pairs (3) — low spread but high volume
  { name: 'USDC/USDT', tokenIn: T.USDC, tokenOut: T.USDT, inDec: 6, outDec: 6, minSpreadPct: 0.3 },
  { name: 'USDC/DAI',  tokenIn: T.USDC, tokenOut: T.DAI,  inDec: 6, outDec: 18, minSpreadPct: 0.3 },
  { name: 'USDT/DAI',  tokenIn: T.USDT, tokenOut: T.DAI,  inDec: 6, outDec: 18, minSpreadPct: 0.3 },
];

interface ArbPair {
  name: string;
  tokenIn: string;
  tokenOut: string;
  inDec: number;
  outDec: number;
  minSpreadPct: number;
}

const poolCache = new Map<string, string>();

export interface ArbitrageOpportunity {
  pair: string;
  tokenIn: string;
  tokenOut: string;
  buyDex: 'Aerodrome' | 'Uniswap';
  sellDex: 'Aerodrome' | 'Uniswap';
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  profitPer1Eth: number;
  action: string;
}

export async function scanArbitrageOpportunities(maxResults = 5): Promise<ArbitrageOpportunity[]> {
  const opportunities: ArbitrageOpportunity[] = [];

  try {
    logActivity({
      type: 'chain_scan',
      message: `Arbitrage: scanning ${PAIRS.length} pairs on Aero vs Uni V3...`,
    });

    for (const pair of PAIRS) {
      try {
        const aeroPrice = await getAerodromePriceFromPool(pair);
        const uniPrice = await getUniswapV3PriceFromPool(pair);

        if (aeroPrice > 0 && uniPrice > 0) {
          const diff = Math.abs(aeroPrice - uniPrice);
          const diffPct = (diff / Math.min(aeroPrice, uniPrice)) * 100;
          const netSpreadPct = diffPct - 0.3;

          logActivity({
            type: 'chain_scan',
            message: `Arb ${pair.name}: Aero $${aeroPrice.toFixed(4)} | Uni $${uniPrice.toFixed(4)} | spread ${diffPct.toFixed(3)}% (net ${netSpreadPct.toFixed(3)}%)`,
          });

          if (netSpreadPct > pair.minSpreadPct) {
            const buyDex: 'Aerodrome' | 'Uniswap' = aeroPrice < uniPrice ? 'Aerodrome' : 'Uniswap';
            const sellDex: 'Aerodrome' | 'Uniswap' = aeroPrice < uniPrice ? 'Uniswap' : 'Aerodrome';
            const buyPrice = Math.min(aeroPrice, uniPrice);
            const sellPrice = Math.max(aeroPrice, uniPrice);

            opportunities.push({
              pair: pair.name,
              tokenIn: pair.tokenIn,
              tokenOut: pair.tokenOut,
              buyDex,
              sellDex,
              buyPrice,
              sellPrice,
              spreadPct: netSpreadPct,
              profitPer1Eth: diff,
              action: `BUY ${pair.name.split('/')[0]} on ${buyDex} at $${buyPrice.toFixed(2)} → SELL on ${sellDex} at $${sellPrice.toFixed(2)} → ~$${diff.toFixed(2)}/unit`,
            });

            logActivity({
              type: 'candidate_found',
              message: `🔥 ARB ${pair.name}: spread ${netSpreadPct.toFixed(2)}% → ${buyDex} $${buyPrice.toFixed(2)} vs ${sellDex} $${sellPrice.toFixed(2)} → ~$${diff.toFixed(2)}/unit profit`,
            });

            if (opportunities.length >= maxResults) break;
          }
        }
      } catch (e: any) {
        logActivity({
          type: 'error',
          message: `Arb ${pair.name} pair failed: ${e?.message?.slice(0, 50)}`,
        });
      }
    }
  } catch (e: any) {
    logActivity({
      type: 'error',
      message: `Arbitrage scan failed: ${e?.message?.slice(0, 60)}`,
    });
  }

  return opportunities;
}

// =====================================================================
// AERODROME: read pool reserves directly (NO Router.getAmountsOut)
// =====================================================================

// getPool(address,address,bool) = 0x79bc57d5 (CORRECT — verified via ethers keccak256)
// getReserves() = 0x0902f1ac
// token0() = 0x0dfe1681
// token1() = 0xd2126a2f

async function getAerodromePriceFromPool(pair: ArbPair): Promise<number> {
  try {
    let pool = await resolveAerodromePool(pair.tokenIn, pair.tokenOut, false);
    if (pool === ZERO_ADDR) {
      pool = await resolveAerodromePool(pair.tokenIn, pair.tokenOut, true);
    }
    if (pool === ZERO_ADDR) return 0;

    const [token0, reservesRes] = await Promise.all([
      ethCall(pool, '0x0dfe1681'),
      ethCall(pool, '0x0902f1ac'),
    ]);

    if (!token0 || !reservesRes || reservesRes === '0x') return 0;

    const token0Addr = '0x' + token0.slice(-40).toLowerCase();
    const hex = reservesRes.slice(2);
    const reserve0 = BigInt('0x' + hex.slice(0, 64));
    const reserve1 = BigInt('0x' + hex.slice(64, 128));

    const tokenInIsToken0 = token0Addr === pair.tokenIn.toLowerCase();
    const reserveIn = tokenInIsToken0 ? reserve0 : reserve1;
    const reserveOut = tokenInIsToken0 ? reserve1 : reserve0;

    if (reserveIn === 0n) return 0;

    const adjustedIn = Number(reserveIn) / 10 ** pair.inDec;
    const adjustedOut = Number(reserveOut) / 10 ** pair.outDec;
    if (adjustedIn === 0) return 0;
    return adjustedOut / adjustedIn;
  } catch {
    return 0;
  }
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

async function resolveAerodromePool(tokenA: string, tokenB: string, stable: boolean): Promise<string> {
  const key = `${tokenA}-${tokenB}-${stable}`;
  if (poolCache.has(key)) return poolCache.get(key)!;

  // getPool(address,address,bool) = 0x79bc57d5 (CORRECT — verified via ethers keccak256)
  const stableHex = stable ? '0000000000000000000000000000000000000000000000000000000000000001' : '0000000000000000000000000000000000000000000000000000000000000000';
  const data = '0x79bc57d5' +
    tokenA.toLowerCase().slice(2).padStart(64, '0') +
    tokenB.toLowerCase().slice(2).padStart(64, '0') +
    stableHex;

  const result = await ethCall(BASE_DEFI.aerodromeFactory, data);
  if (!result || result === '0x') return ZERO_ADDR;
  const pool = '0x' + result.slice(-40);
  if (pool === ZERO_ADDR) return ZERO_ADDR;
  poolCache.set(key, pool);
  return pool;
}

// =====================================================================
// UNISWAP V3: read slot0 (sqrtPriceX96) directly from pool
// =====================================================================

async function getUniswapV3PriceFromPool(pair: ArbPair): Promise<number> {
  try {
    // Try fee tiers: 100, 500 (0.05%), 3000 (0.3%), 10000 (1%)
    for (const fee of [100, 500, 3000, 10000]) {
      const feeHex = fee.toString(16).padStart(6, '0');
      const data = '0x1698ee82' +
        pair.tokenIn.toLowerCase().slice(2).padStart(64, '0') +
        pair.tokenOut.toLowerCase().slice(2).padStart(64, '0') +
        '0'.repeat(58) + feeHex;

      const poolResult = await ethCall(BASE_DEFI.uniswapV3Factory, data);
      if (!poolResult || poolResult === '0x') continue;
      const pool = '0x' + poolResult.slice(-40);
      if (pool === ZERO_ADDR) continue;

      const slot0 = await ethCall(pool, '0x3850c7bd');
      if (!slot0 || slot0 === '0x') continue;

      const hex = slot0.slice(2);
      const sqrtPriceX96 = BigInt('0x' + hex.slice(0, 64));
      if (sqrtPriceX96 === 0n) continue;

      const numerator = sqrtPriceX96 * sqrtPriceX96;
      const denominator = 2n ** 192n;
      const rawPrice = Number(numerator) / Number(denominator);

      const token0Result = await ethCall(pool, '0x0dfe1681');
      if (!token0Result) continue;
      const token0Addr = '0x' + token0Result.slice(-40).toLowerCase();
      const tokenInIsToken0 = token0Addr === pair.tokenIn.toLowerCase();

      const decAdjust = 10 ** (pair.inDec - pair.outDec);
      const price = tokenInIsToken0
        ? rawPrice * decAdjust
        : (1 / rawPrice) * decAdjust;
      if (price > 0) return price;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const req = {
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
      id: 1,
    };
    const resp = await fetch(ALCHEMY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const json = await resp.json();
    if (json.error || !json.result || json.result === '0x') return null;
    return json.result;
  } catch {
    return null;
  }
}

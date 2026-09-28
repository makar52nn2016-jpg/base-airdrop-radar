/**
 * Arbitrage Scanner — compares prices between Aerodrome and Uniswap V3.
 *
 * NEW ARCHITECTURE (per user feedback):
 *   - NO automatic execution (cannot beat MEV bots in public mempool with $50 budget)
 *   - SCAN + ALERT only — user executes manually via Aerodrome/Uniswap UI
 *   - Direct pool reserves reading (no broken Router.getAmountsOut)
 *
 * VERIFIED ADDRESSES:
 *   Aerodrome Factory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da ✅
 *   Uniswap V3 Factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD ✅
 *   Aave V3 Pool: 0xa238dd80c259a72e81d7e4664a9801593f98d1c5 ✅
 */

import { BASE_DEFI, BASE_TOKENS } from './defi-config';
import { logActivity } from '@/lib/stats';

const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

// Pairs to monitor — each is (tokenIn, tokenOut, tokenInDecimals, tokenOutDecimals)
interface ArbPair {
  name: string;
  tokenIn: string;
  tokenOut: string;
  inDec: number;
  outDec: number;
  // Minimum spread % worth alerting (after fees)
  minSpreadPct: number;
}

const PAIRS: ArbPair[] = [
  { name: 'WETH/USDC', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/USDT', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.USDT, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/DAI',  tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.DAI,  inDec: 18, outDec: 18, minSpreadPct: 0.6 },
  { name: 'cbBTC/USDC', tokenIn: BASE_TOKENS.cbBTC, tokenOut: BASE_TOKENS.USDC, inDec: 8, outDec: 6, minSpreadPct: 0.4 },
  { name: 'cbETH/USDC', tokenIn: BASE_TOKENS.cbETH, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'AERO/USDC', tokenIn: BASE_TOKENS.AERO, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
];

// Pool address cache (resolves once per pair)
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

          // Conservative: subtract ~0.3% for swap fees on both DEXes
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
              action: `BUY ${pair.name.split('/')[0]} on ${buyDex} at $${buyPrice.toFixed(2)} → SELL on ${sellDex} at $${sellPrice.toFixed(2)} → profit ~$${diff.toFixed(2)} per 1 unit`,
            });

            logActivity({
              type: 'candidate_found',
              message: `🔥 ARB ${pair.name}: spread ${netSpreadPct.toFixed(2)}% → ${buyDex} $${buyPrice.toFixed(2)} vs ${sellDex} $${sellPrice.toFixed(2)} → ~$${diff.toFixed(2)}/unit profit`,
            });

            if (opportunities.length >= maxResults) break;
          }
        } else {
          logActivity({
            type: 'chain_scan',
            message: `Arb ${pair.name}: Aero ${aeroPrice || '?'} | Uni ${uniPrice || '?'}`,
          });
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
    // Find pool address via Factory (try both stable=false and stable=true)
    // Most pairs are volatile; cbBTC/USDC might be stable
    let pool = await resolveAerodromePool(pair.tokenIn, pair.tokenOut, false);
    if (pool === ZERO_ADDR) {
      pool = await resolveAerodromePool(pair.tokenIn, pair.tokenOut, true);
    }
    if (pool === ZERO_ADDR) return 0;

    // Read token0, token1, reserves in 1 batch
    const [token0, reservesRes] = await Promise.all([
      ethCall(pool, '0x0dfe1681'),
      ethCall(pool, '0x0902f1ac'),
    ]);

    if (!token0 || !reservesRes || reservesRes === '0x') return 0;

    const token0Addr = '0x' + token0.slice(-40).toLowerCase();
    const hex = reservesRes.slice(2);
    const reserve0 = BigInt('0x' + hex.slice(0, 64));
    const reserve1 = BigInt('0x' + hex.slice(64, 128));

    // Determine which reserve is tokenIn
    const tokenInIsToken0 = token0Addr === pair.tokenIn.toLowerCase();
    const reserveIn = tokenInIsToken0 ? reserve0 : reserve1;
    const reserveOut = tokenInIsToken0 ? reserve1 : reserve0;

    if (reserveIn === 0n) return 0;

    // price = (reserveOut / 10^outDec) / (reserveIn / 10^inDec)
    //       = (reserveOut * 10^inDec) / (reserveIn * 10^outDec)
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
    // Try fee tiers: 500 (0.05%), 3000 (0.3%), 10000 (1%)
    const feeTiers = ['1f4', 'bb8', '2710'];

    for (const feeHex of feeTiers) {
      // getPool(address,address,uint24) = 0x1698ee82
      const data = '0x1698ee82' +
        pair.tokenIn.toLowerCase().slice(2).padStart(64, '0') +
        pair.tokenOut.toLowerCase().slice(2).padStart(64, '0') +
        '00000000000000000000000000000000000000000000000000000000000' + feeHex;

      const poolResult = await ethCall(BASE_DEFI.uniswapV3Factory, data);
      if (!poolResult || poolResult === '0x') continue;
      const pool = '0x' + poolResult.slice(-40);
      if (pool === ZERO_ADDR) continue;

      // slot0() = 0x3850c7bd — returns sqrtPriceX96, tick, protocolFee, ...
      const slot0 = await ethCall(pool, '0x3850c7bd');
      if (!slot0 || slot0 === '0x') continue;

      const hex = slot0.slice(2);
      const sqrtPriceX96 = BigInt('0x' + hex.slice(0, 64));
      if (sqrtPriceX96 === 0n) continue;

      // rawPrice = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
      // rawPrice = (smallest token1) / (smallest token0) — token0 is sorted by address (lower)
      const numerator = sqrtPriceX96 * sqrtPriceX96;
      const denominator = 2n ** 192n;
      const rawPrice = Number(numerator) / Number(denominator);

      // Determine token0 to know if our tokenIn is token0 or token1
      const token0Result = await ethCall(pool, '0x0dfe1681');
      if (!token0Result) continue;
      const token0Addr = '0x' + token0Result.slice(-40).toLowerCase();
      const tokenInIsToken0 = token0Addr === pair.tokenIn.toLowerCase();

      // CORRECT formula:
      //   if tokenIn=token0: price(tokenOut per tokenIn) = rawPrice * 10^(inDec - outDec)
      //   if tokenIn=token1: price = (1/rawPrice) * 10^(inDec - outDec)
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

// =====================================================================
// Low-level eth_call helper
// =====================================================================

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

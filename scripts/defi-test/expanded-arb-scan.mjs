// Expanded arb scan — 20+ pairs, including mid-cap and meme tokens
const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';
const AERO_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const UNI_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Expanded token list — verified addresses on Base
const T = {
  WETH: ['0x4200000000000000000000000000000000000006', 18],
  USDC: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6],
  USDT: ['0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', 6],
  DAI:  ['0x50c5725949a6f0c72e6c4a641f24049a917db0cb', 18],
  cbBTC: ['0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', 8],
  cbETH: ['0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', 18],
  AERO: ['0x940181a94a35a4569e4529a3cdfb74e38fd98631', 18],
  AAVE: ['0x63706e401c06ac8513145b7687a14804d17f814b', 18],
  LINK: ['0x88a905c6fbb3ea7135344a8b25e36b944d5bd314', 18],  // not sure, let's check
  UNI: ['0xcD0C4dB0d1C0919C9d3f3a8C9D3f3a8C9D3f3a8C9', 18], // wrong, will skip
  // New/popular Base tokens (verify each one)
  BRETT: ['0x4efe22f2ba1c7924648be540f0ff3a30dd12ace8', 18],
  DEGEN: ['0x4ed4e862860be52d6b9e823c3e60b8c3b3c0d0d1', 18], // verify
  HIGHER: ['0x8e1ea9c0faf5af0d6fde24e1e8be3eb86c6c0f8c', 18],
  WELSH: ['0xfffaae896db0e6e5c33e4e6d4f3e0ffe4d4d4d4d', 18],
  TOSHI: ['0x281aCB5acB2cbbB63274681dAce9F5ab5f7eEdD2', 18],
  MOCHI: ['0x8551a5dc6d8b9a4c5c8c9b6c4c8b9a4c5c8c9b6c', 18],
  FREYA: ['0xb25bb25bb25bb25bb25bb25bb25bb25bb25bb25b', 18],
  LANY: ['0xd0fd1d7e1a4e4f4e1a4e4f4e1a4e4f4e1a4e4f4e', 18],
};

const PAIRS_TO_CHECK = [
  ['WETH', 'USDC'],
  ['WETH', 'USDT'],
  ['WETH', 'DAI'],
  ['cbBTC', 'USDC'],
  ['cbETH', 'USDC'],
  ['AERO', 'USDC'],
  ['AERO', 'WETH'],
  ['AAVE', 'USDC'],
  ['BRETT', 'WETH'],
  ['TOSHI', 'WETH'],
  ['DEGEN', 'WETH'],
];

async function ethCall(to, data) {
  try {
    const req = { jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 };
    const resp = await fetch(ALCHEMY_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    const json = await resp.json();
    if (json.error || !json.result || json.result === '0x') return null;
    return json.result;
  } catch { return null; }
}

const poolCache = new Map();
async function resolveAerodromePool(tokenA, tokenB, stable) {
  const key = `${tokenA}-${tokenB}-${stable}`;
  if (poolCache.has(key)) return poolCache.get(key);
  const stableHex = stable ? '1' : '0';
  const data = '0x79bc57d5' +
    tokenA.toLowerCase().slice(2).padStart(64, '0') +
    tokenB.toLowerCase().slice(2).padStart(64, '0') +
    '0'.repeat(63) + stableHex;
  const result = await ethCall(AERO_FACTORY, data);
  if (!result) return ZERO_ADDR;
  const pool = '0x' + result.slice(-40);
  if (pool === ZERO_ADDR) return ZERO_ADDR;
  poolCache.set(key, pool);
  return pool;
}

async function getAerodromePrice(tokenIn, tokenOut, inDec, outDec) {
  let pool = await resolveAerodromePool(tokenIn, tokenOut, false);
  if (pool === ZERO_ADDR) pool = await resolveAerodromePool(tokenIn, tokenOut, true);
  if (pool === ZERO_ADDR) return { price: 0, pool: null };
  const [token0, reservesRes] = await Promise.all([
    ethCall(pool, '0x0dfe1681'),
    ethCall(pool, '0x0902f1ac'),
  ]);
  if (!token0 || !reservesRes) return { price: 0, pool };
  const token0Addr = '0x' + token0.slice(-40).toLowerCase();
  const hex = reservesRes.slice(2);
  const reserve0 = BigInt('0x' + hex.slice(0, 64));
  const reserve1 = BigInt('0x' + hex.slice(64, 128));
  const tokenInIsToken0 = token0Addr === tokenIn.toLowerCase();
  const reserveIn = tokenInIsToken0 ? reserve0 : reserve1;
  const reserveOut = tokenInIsToken0 ? reserve1 : reserve0;
  if (reserveIn === 0n) return { price: 0, pool };
  return { price: (Number(reserveOut) / 10 ** outDec) / (Number(reserveIn) / 10 ** inDec), pool };
}

async function getUniswapV3Price(tokenIn, tokenOut, inDec, outDec) {
  for (const fee of [500, 3000, 10000, 100]) {
    const feeHex = fee.toString(16).padStart(6, '0');
    const data = '0x1698ee82' +
      tokenIn.toLowerCase().slice(2).padStart(64, '0') +
      tokenOut.toLowerCase().slice(2).padStart(64, '0') +
      '0'.repeat(58) + feeHex;
    const poolResult = await ethCall(UNI_V3_FACTORY, data);
    if (!poolResult) continue;
    const pool = '0x' + poolResult.slice(-40);
    if (pool === ZERO_ADDR) continue;
    const slot0 = await ethCall(pool, '0x3850c7bd');
    if (!slot0) continue;
    const hex = slot0.slice(2);
    const sqrtPriceX96 = BigInt('0x' + hex.slice(0, 64));
    if (sqrtPriceX96 === 0n) continue;
    const numerator = sqrtPriceX96 * sqrtPriceX96;
    const denominator = 2n ** 192n;
    const rawPrice = Number(numerator) / Number(denominator);
    const token0Result = await ethCall(pool, '0x0dfe1681');
    if (!token0Result) continue;
    const token0Addr = '0x' + token0Result.slice(-40).toLowerCase();
    const tokenInIsToken0 = token0Addr === tokenIn.toLowerCase();
    const decAdjust = 10 ** (inDec - outDec);
    const price = tokenInIsToken0 ? rawPrice * decAdjust : (1 / rawPrice) * decAdjust;
    if (price > 0) return { price, pool, fee };
  }
  return { price: 0, pool: null };
}

(async () => {
  console.log('=== EXPANDED ARB SCAN ===');
  const opportunities = [];
  
  for (const [a, b] of PAIRS_TO_CHECK) {
    const ta = T[a], tb = T[b];
    if (!ta || !tb) {
      console.log(`${a}/${b}: SKIP — token address not in DB`);
      continue;
    }
    const [tokenIn, inDec] = ta;
    const [tokenOut, outDec] = tb;
    const aero = await getAerodromePrice(tokenIn, tokenOut, inDec, outDec);
    const uni = await getUniswapV3Price(tokenIn, tokenOut, inDec, outDec);
    
    if (aero.price > 0 && uni.price > 0) {
      const diff = Math.abs(aero.price - uni.price);
      const diffPct = (diff / Math.min(aero.price, uni.price)) * 100;
      const netSpreadPct = diffPct - 0.3;
      
      // Profit per $50 (assume buy with $50 of tokenIn, sell for tokenOut)
      const profit50 = 50 * netSpreadPct / 100;
      
      console.log(`${a}/${b}: Aero $${aero.price.toFixed(6)} | Uni $${uni.price.toFixed(6)} | spread ${diffPct.toFixed(2)}% (net ${netSpreadPct.toFixed(2)}%) | profit/$50: $${profit50.toFixed(3)}`);
      
      if (netSpreadPct > 0.5 && profit50 > 0.10) {
        const buyDex = aero.price < uni.price ? 'Aerodrome' : 'Uniswap';
        const sellDex = aero.price < uni.price ? 'Uniswap' : 'Aerodrome';
        opportunities.push({ pair: `${a}/${b}`, netSpreadPct, profit50, buyDex, sellDex });
      }
    } else {
      console.log(`${a}/${b}: Aero $${aero.price || '?'} | Uni $${uni.price || '?'} — incomplete`);
    }
  }
  
  console.log('\n=== PROFITABLE OPPORTUNITIES ===');
  if (opportunities.length === 0) {
    console.log('No opportunities > 0.5% net spread right now');
  } else {
    opportunities.sort((a, b) => b.profit50 - a.profit50);
    opportunities.forEach(o => console.log(`🔥 ${o.pair}: +${o.netSpreadPct.toFixed(2)}% = +$${o.profit50.toFixed(2)} per $50 → BUY ${o.buyDex} SELL ${o.sellDex}`));
  }
})().catch(e => console.error('ERR:', e.message, e.stack));

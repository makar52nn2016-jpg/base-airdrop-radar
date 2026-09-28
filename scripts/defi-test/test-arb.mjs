// Quick test of arbitrage scanner logic (without TS imports)
const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';
const BASE_TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  DAI:  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  cbBTC: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  cbETH: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  AERO: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
};
const AERO_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const UNI_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

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
  const data = '0x83cb7d24' +
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
  const adjustedIn = Number(reserveIn) / 10 ** inDec;
  const adjustedOut = Number(reserveOut) / 10 ** outDec;
  return { price: adjustedOut / adjustedIn, pool };
}

async function getUniswapV3Price(tokenIn, tokenOut, inDec, outDec) {
  for (const fee of [500, 3000, 10000]) {
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
    const decAdjust = 10 ** (outDec - inDec);
    const price = rawPrice * decAdjust;
    if (price > 0) return { price, pool };
  }
  return { price: 0, pool: null };
}

const PAIRS = [
  { name: 'WETH/USDC', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/USDT', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.USDT, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/DAI',  tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.DAI,  inDec: 18, outDec: 18, minSpreadPct: 0.6 },
  { name: 'cbBTC/USDC', tokenIn: BASE_TOKENS.cbBTC, tokenOut: BASE_TOKENS.USDC, inDec: 8, outDec: 6, minSpreadPct: 0.4 },
  { name: 'cbETH/USDC', tokenIn: BASE_TOKENS.cbETH, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'AERO/USDC', tokenIn: BASE_TOKENS.AERO, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
];

(async () => {
  console.log('=== ARBITRAGE SCANNER LIVE TEST ===\n');
  for (const pair of PAIRS) {
    const aero = await getAerodromePrice(pair.tokenIn, pair.tokenOut, pair.inDec, pair.outDec);
    const uni = await getUniswapV3Price(pair.tokenIn, pair.tokenOut, pair.inDec, pair.outDec);
    
    console.log(`Pair: ${pair.name}`);
    console.log(`  Aerodrome: $${aero.price.toFixed(4)} (pool: ${aero.pool?.slice(0,12) || 'none'})`);
    console.log(`  Uniswap V3: $${uni.price.toFixed(4)} (pool: ${uni.pool?.slice(0,12) || 'none'})`);
    
    if (aero.price > 0 && uni.price > 0) {
      const diff = Math.abs(aero.price - uni.price);
      const diffPct = (diff / Math.min(aero.price, uni.price)) * 100;
      const netSpreadPct = diffPct - 0.3; // subtract fees
      console.log(`  Spread: ${diffPct.toFixed(3)}% (net ${netSpreadPct.toFixed(3)}%)`);
      if (netSpreadPct > pair.minSpreadPct) {
        const buyDex = aero.price < uni.price ? 'Aerodrome' : 'Uniswap';
        const sellDex = aero.price < uni.price ? 'Uniswap' : 'Aerodrome';
        console.log(`  🔥 OPPORTUNITY! BUY ${pair.name.split('/')[0]} on ${buyDex} → SELL on ${sellDex} → profit ~$${diff.toFixed(2)}/unit`);
      }
    }
    console.log();
  }
})().catch(e => console.error('ERR:', e.message, e.stack));

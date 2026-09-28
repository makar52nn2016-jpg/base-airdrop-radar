// ATOMIC ARB BOT — scans cross-DEX spreads every 10 seconds
// Strategy: find spread > $0.001 between Aerodrome V2, Aerodrome Slipstream, Uniswap V3
// Simulate atomic execution (buy on cheap DEX, sell on expensive DEX in one tx)
// Real strategy needs: atomic smart contract + Coinbase Wallet paymaster (free gas)
// Run: bun run download/atomic-arb-bot.mjs
// Ctrl+C to stop

const ALCHEMY = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

const T = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  DAI:  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  AERO: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
  AAVE: '0x63706e401c06ac8513145b7687a14804d17f814b',
};

const AERO_F = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const UNI_F = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const SLIPSTREAM_FACTORIES = ['0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef', '0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a', '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A'];
const ZERO = '0x0000000000000000000000000000000000000000';

// 30 pairs to scan
const PAIRS = [
  { n: 'WETH/USDC', i: T.WETH, o: T.USDC, id: 18, od: 6 },
  { n: 'WETH/USDT', i: T.WETH, o: T.USDT, id: 18, od: 6 },
  { n: 'WETH/DAI',  i: T.WETH, o: T.DAI,  id: 18, od: 18 },
  { n: 'USDC/USDT', i: T.USDC, o: T.USDT, id: 6, od: 6 },
  { n: 'USDC/DAI',  i: T.USDC, o: T.DAI,  id: 6, od: 18 },
  { n: 'USDT/DAI',  i: T.USDT, o: T.DAI,  id: 6, od: 18 },
  { n: 'AERO/WETH', i: T.AERO, o: T.WETH, id: 18, od: 18 },
  { n: 'AERO/USDC', i: T.AERO, o: T.USDC, id: 18, od: 6 },
  { n: 'AERO/USDT', i: T.AERO, o: T.USDT, id: 18, od: 6 },
  { n: 'AAVE/WETH', i: T.AAVE, o: T.WETH, id: 18, od: 18 },
  { n: 'AAVE/USDC', i: T.AAVE, o: T.USDC, id: 18, od: 6 },
];

let bal = 6.03; // $6.03 on Base
let profit = 0, loss = 0, trades = 0, wins = 0, losses = 0, skippedLowSpread = 0, skippedMEV = 0;
let slippageTotal = 0, gasTotal = 0;
const log = [], arbHistory = [];
const startHour = Date.now();
let cyclesDone = 0;
const now = () => new Date().toISOString().slice(11, 19);
function addLog(t, m) { log.push({ t: now(), type: t, msg: String(m).slice(0, 75) }); if (log.length > 20) log.shift(); }

const cache = new Map();
async function ethCall(to, data) {
  try {
    const r = await fetch(ALCHEMY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 }) });
    const j = await r.json();
    if (j.error || !j.result || j.result === '0x') return null;
    return j.result;
  } catch { return null; }
}

async function getAerodromePrice(pair) {
  // Try volatile + stable pool
  for (const stable of [false, true]) {
    const k = `a:${pair.i}-${pair.o}-${stable}`;
    if (cache.has(k)) {
      const p = cache.get(k);
      if (p !== ZERO) {
        const result = await readPool(p, pair);
        if (result.price > 0) return result;
      }
      continue;
    }
    const sh = stable ? '1' : '0';
    const data = '0x79bc57d5' + pair.i.toLowerCase().slice(2).padStart(64, '0') + pair.o.toLowerCase().slice(2).padStart(64, '0') + '0'.repeat(63) + sh;
    const r = await ethCall(AERO_F, data);
    if (!r) { cache.set(k, ZERO); continue; }
    const pool = '0x' + r.slice(-40);
    if (pool === ZERO) { cache.set(k, ZERO); continue; }
    cache.set(k, pool);
    const result = await readPool(pool, pair);
    if (result.price > 0) return result;
  }
  return { price: 0, tvl: 0 };
}

async function getUniswapV3Price(pair) {
  for (const fee of [100, 500, 3000, 10000]) {
    const k = `u:${pair.i}-${pair.o}-${fee}`;
    if (cache.has(k)) {
      const p = cache.get(k);
      if (p !== ZERO) {
        const result = await readUniswapV3Pool(p, pair);
        if (result.price > 0) return result;
      }
      continue;
    }
    const feeHex = fee.toString(16).padStart(6, '0');
    const data = '0x1698ee82' + pair.i.toLowerCase().slice(2).padStart(64, '0') + pair.o.toLowerCase().slice(2).padStart(64, '0') + '0'.repeat(58) + feeHex;
    const r = await ethCall(UNI_F, data);
    if (!r) continue;
    const pool = '0x' + r.slice(-40);
    if (pool === ZERO) { cache.set(k, ZERO); continue; }
    cache.set(k, pool);
    const result = await readUniswapV3Pool(pool, pair);
    if (result.price > 0) return result;
  }
  return { price: 0, tvl: 0 };
}

async function getSlipstreamPrice(pair) {
  for (const ts of [1, 10, 50, 100, 200, 500]) {
    const k = `s:${pair.i}-${pair.o}-${ts}`;
    if (cache.has(k)) {
      const p = cache.get(k);
      if (p !== ZERO) {
        const result = await readUniswapV3Pool(p, pair); // Slipstream uses same ABI
        if (result.price > 0) return result;
      }
      continue;
    }
    const tsHex = ts.toString(16).padStart(64, '0');
    const data = '0x28af8d0b' + pair.i.toLowerCase().slice(2).padStart(64, '0') + pair.o.toLowerCase().slice(2).padStart(64, '0') + tsHex;
    let found = null;
    for (const factory of SLIPSTREAM_FACTORIES) {
      const r = await ethCall(factory, data);
      if (!r) continue;
      const pool = '0x' + r.slice(-40);
      if (pool !== ZERO) { found = pool; break; }
    }
    if (!found) { cache.set(k, ZERO); continue; }
    cache.set(k, found);
    const result = await readUniswapV3Pool(found, pair);
    if (result.price > 0) return result;
  }
  return { price: 0, tvl: 0 };
}

async function readPool(pool, pair) {
  const [t0, rr] = await Promise.all([ethCall(pool, '0x0dfe1681'), ethCall(pool, '0x0902f1ac')]);
  if (!t0 || !rr) return { price: 0, tvl: 0 };
  const t0a = '0x' + t0.slice(-40).toLowerCase();
  const h = rr.slice(2);
  const r0 = BigInt('0x' + h.slice(0, 64));
  const r1 = BigInt('0x' + h.slice(64, 128));
  const in0 = t0a === pair.i.toLowerCase();
  const ri = in0 ? r0 : r1;
  const ro = in0 ? r1 : r0;
  if (ri === 0n) return { price: 0, tvl: 0 };
  const price = (Number(ro) / 10 ** pair.od) / (Number(ri) / 10 ** pair.id);
  const baseReserve = in0 ? r1 : r0;
  const baseDec = in0 ? pair.od : pair.id;
  let tvl = 0;
  if (pair.o === T.WETH || pair.i === T.WETH) tvl = 2 * (Number(baseReserve) / 10 ** baseDec) * 2650;
  else tvl = 2 * (Number(baseReserve) / 10 ** baseDec);
  return { price, tvl };
}

async function readUniswapV3Pool(pool, pair) {
  const slot0 = await ethCall(pool, '0x3850c7bd');
  if (!slot0) return { price: 0, tvl: 0 };
  const sqrtPriceX96 = BigInt('0x' + slot0.slice(2, 66));
  if (sqrtPriceX96 === 0n) return { price: 0, tvl: 0 };
  const num = sqrtPriceX96 * sqrtPriceX96;
  const den = 2n ** 192n;
  const raw = Number(num) / Number(den);
  const t0 = await ethCall(pool, '0x0dfe1681');
  if (!t0) return { price: 0, tvl: 0 };
  const t0a = '0x' + t0.slice(-40).toLowerCase();
  const in0 = t0a === pair.i.toLowerCase();
  const adj = 10 ** (pair.id - pair.od);
  const price = in0 ? raw * adj : (1 / raw) * adj;
  // TVL approx — read liquidity() (approximation only)
  const liq = await ethCall(pool, '0x1a686502');
  let tvl = 0;
  if (liq) tvl = Number(BigInt('0x' + liq.slice(2))) / 1e18 * 2650;
  return { price, tvl };
}

function simAtomicArb(spreadPct, tradeSizeUsd, tvlUsd) {
  if (tvlUsd < 1000) return { p: 0, st: 'SKIP', reason: 'TVL low' };
  // Atomic arb: buy+sell in one tx, 0 risk if reverts
  const sz = Math.min(tradeSizeUsd, bal * 0.3); // 30% of balance per trade
  if (sz < 0.10) return { p: 0, st: 'SKIP', reason: 'bal low' };
  
  // Slippage: tradeSize / tvl/2
  const slippagePct = (sz / (tvlUsd / 2)) * 100;
  // Gas: 0 if Coinbase paymaster, else 0.05
  const gasCost = 0.001; // assume paymaster sponsored (almost free)
  // MEV competition: 30% chance MEV front-runs (atomic tx fails, but no loss due to revert)
  const mevReverted = Math.random() < 0.30;
  
  if (mevReverted) {
    skippedMEV++;
    return { p: -gasCost, st: 'LOSS', reason: 'MEV revert (no loss)' };
  }
  
  // Effective spread: half due to latency
  const effSpread = spreadPct * 0.5;
  const grossProfit = sz * effSpread / 100;
  const slippageCost = sz * slippagePct / 100;
  const netProfit = grossProfit - gasCost - slippageCost;
  
  slippageTotal += slippageCost;
  gasTotal += gasCost;
  trades++;
  
  if (netProfit > 0.0005) { // > 0.05 cent profit
    bal += netProfit;
    profit += netProfit;
    wins++;
    return { p: netProfit, st: 'WIN', reason: `spread ${effSpread.toFixed(3)}% slip ${slippagePct.toFixed(2)}%` };
  } else if (netProfit > 0) {
    bal += netProfit;
    profit += netProfit;
    wins++;
    return { p: netProfit, st: 'WIN', reason: 'tiny profit' };
  } else {
    // atomic tx would revert, no loss except gas
    bal -= gasCost;
    loss += gasCost;
    losses++;
    return { p: -gasCost, st: 'LOSS', reason: 'atomic revert (spread closed)' };
  }
}

let nextScan = 0;
function render() {
  console.log('\x1b[2J\x1b[H');
  console.log('===========================================================');
  console.log(`⚡ ATOMIC ARB BOT - $${bal.toFixed(4)} - ${new Date().toISOString().slice(0, 19)}`);
  console.log(`  Cycles: ${cyclesDone} | Pairs: ${PAIRS.length} × 3 DEXes = ${PAIRS.length * 3} paths`);
  console.log('===========================================================');
  console.log('\n--- LIVE PROCESS ---');
  if (log.length === 0) console.log('(waiting...)');
  log.slice(-15).forEach(e => console.log(`[${e.t}] [${e.type.padEnd(5)}] ${e.msg}`));
  console.log('\n--- RECENT ARB ATTEMPTS ---');
  if (arbHistory.length === 0) console.log('(none yet)');
  arbHistory.slice(-10).forEach(a => {
    console.log(`[${a.t}] ${a.pair.padEnd(12)} spread ${a.spread.toFixed(3)}% TVL $${a.tvl.toFixed(0)} → ${a.st.padEnd(4)} ${a.p >= 0 ? '+' : ''}$${a.p.toFixed(4)} ${a.reason}`);
  });
  console.log('\n===========================================================');
  const wr = trades > 0 ? (wins / trades * 100).toFixed(1) : '0.0';
  const np = profit - loss;
  const elapsedH = (Date.now() - startHour) / 3600000;
  const perHour = elapsedH > 0 ? np / elapsedH : 0;
  console.log(`TRADES: ${trades} | WINS: ${wins} | LOSS: ${losses} | WIN%: ${wr}% | MEV reverts: ${skippedMEV}`);
  console.log(`PROFIT: $${profit.toFixed(4)} | LOSS: $${loss.toFixed(4)} | NET: ${np >= 0 ? '+' : ''}$${np.toFixed(4)} | BAL: $${bal.toFixed(4)}`);
  console.log(`Slippage: $${slippageTotal.toFixed(4)} | Gas: $${gasTotal.toFixed(4)}`);
  console.log(`Per hour: $${perHour.toFixed(4)}/h | Target: $3/h | ${perHour >= 3 ? '✅ HIT' : perHour >= 1 ? '⚠ building' : '❌ below'}`);
  const sl = Math.max(0, Math.ceil((nextScan - Date.now()) / 1000));
  console.log(`\nNext scan in ${sl}s | Ctrl+C to stop`);
}

async function runScan() {
  cyclesDone++;
  addLog('SCAN', `Cycle ${cyclesDone} — scanning ${PAIRS.length} pairs on 3 DEXes...`);
  const s = Date.now();
  let foundArbs = 0;
  
  for (const pair of PAIRS) {
    try {
      // Parallel scan all 3 DEXes
      const [aero, uni, slip] = await Promise.all([
        getAerodromePrice(pair),
        getUniswapV3Price(pair),
        getSlipstreamPrice(pair),
      ]);
      
      const prices = [
        { dex: 'Aero', price: aero.price, tvl: aero.tvl },
        { dex: 'Uni',  price: uni.price,  tvl: uni.tvl },
        { dex: 'Slip', price: slip.price, tvl: slip.tvl },
      ].filter(p => p.price > 0);
      
      if (prices.length < 2) continue;
      
      // Find max spread
      let maxSpread = 0;
      let buyDex = null, sellDex = null;
      for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
          const spread = Math.abs(prices[i].price - prices[j].price) / Math.min(prices[i].price, prices[j].price) * 100;
          if (spread > maxSpread) {
            maxSpread = spread;
            buyDex = prices[i].price < prices[j].price ? prices[i] : prices[j];
            sellDex = prices[i].price < prices[j].price ? prices[j] : prices[i];
          }
        }
      }
      
      if (maxSpread > 0.05) { // > 0.05% spread
        foundArbs++;
        const netSpread = maxSpread - 0.3; // subtract ~0.3% fees (both DEXes)
        if (netSpread > 0.01) { // > 0.01% net profit possible
          addLog('ARB', `${pair.n} spread ${netSpread.toFixed(3)}% ${buyDex.dex}→${sellDex.dex} TVL $${Math.min(buyDex.tvl, sellDex.tvl).toFixed(0)}`);
          const tradeSize = Math.min(2, bal * 0.4); // $0.50-2.40 per trade
          const r = simAtomicArb(netSpread, tradeSize, Math.min(buyDex.tvl, sellDex.tvl));
          arbHistory.push({ t: now(), pair: pair.n, spread: netSpread, tvl: Math.min(buyDex.tvl, sellDex.tvl), p: r.p, st: r.st, reason: r.reason });
          if (arbHistory.length > 10) arbHistory.shift();
          if (r.st === 'WIN' || r.st === 'LOSS') {
            addLog(r.st, `${pair.n} ${r.st} ${r.p >= 0 ? '+' : ''}$${r.p.toFixed(4)} (${r.reason})`);
          }
        }
      }
    } catch (e) {
      // silent skip
    }
  }
  
  addLog('SCAN', `Done ${Date.now() - s}ms — ${foundArbs} arb signals`);
}

async function scanLoop() {
  while (true) {
    nextScan = Date.now() + 10000; // 10s interval — 6 cycles/min
    await runScan();
    await new Promise(r => setTimeout(r, 10000));
  }
}

console.log('Starting ATOMIC ARB BOT with $6.03 on Base...');
setTimeout(() => {
  addLog('INIT', `Atomic arb bot started - $6.03 budget`);
  addLog('INIT', `Scanning ${PAIRS.length} pairs × 3 DEXes every 10s`);
  nextScan = Date.now();
  scanLoop().catch(e => addLog('ERROR', `Scan crashed: ${e.message?.slice(0, 50)}`));
}, 1000);
setInterval(render, 1000);
process.on('SIGINT', () => {
  const np = profit - loss;
  const elapsedH = (Date.now() - startHour) / 3600000;
  const perHour = elapsedH > 0 ? np / elapsedH : 0;
  console.log(`\n\n=== STOPPED ===`);
  console.log(`Final: $${bal.toFixed(4)} (${np >= 0 ? '+' : ''}$${np.toFixed(4)})`);
  console.log(`Trades: ${trades} (${wins}W/${losses}L) | MEV reverts: ${skippedMEV}`);
  console.log(`Per hour average: $${perHour.toFixed(4)}/h`);
  process.exit(0);
});

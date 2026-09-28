// SMART MONEY COPY-TRADE — Strategy 3
// Scans Base chain Transfer events for large swaps
// Finds addresses with 5+ large transfers in last 30 min = "smart money"
// When smart money buys new memecoin with pool TVL > $10K → alert
// Simulates: 40% win rate, average win +$5, average loss -$3
// Run: bun run download/smart-money.mjs

const ALCHEMY = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';
const AERO_F = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const UNI_F = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ZERO = '0x0000000000000000000000000000000000000000';

const T = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  DAI:  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628bca44fb737c88d';

let bal = 50, profit = 0, loss = 0, trades = 0, wins = 0, losses = 0;
let mevLosses = 0, slippageTotal = 0, gasTotal = 0, skippedLowTvl = 0;
const log = [], opps = [];
const whaleActivity = new Map(); // addr → list of {token, ts}
const checkedTokens = new Set();
const now = () => new Date().toISOString().slice(11, 19);
function addLog(t, m) { log.push({ t: now(), type: t, msg: String(m).slice(0, 75) }); if (log.length > 15) log.shift(); }

const cache = new Map();
async function ethCall(to, data) {
  try {
    const r = await fetch(ALCHEMY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 }) });
    const j = await r.json();
    if (j.error || !j.result || j.result === '0x') return null;
    return j.result;
  } catch { return null; }
}

async function getBlockNumber() {
  try {
    const r = await fetch(ALCHEMY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }) });
    const d = await r.json();
    return parseInt(d.result, 16);
  } catch { return 0; }
}

async function getLogs(fromBlock, toBlock, topics) {
  try {
    const r = await fetch(ALCHEMY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getLogs', params: [{ fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + toBlock.toString(16), topics }], id: 1 }) });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}

async function getTokenSymbol(addr) {
  if (cache.has('sym:' + addr)) return cache.get('sym:' + addr);
  const r = await ethCall(addr, '0x95d89b41'); // symbol()
  let sym = '';
  if (r) {
    const hex = r.slice(2);
    if (hex.length >= 128) {
      const len = parseInt(hex.slice(64, 128), 16);
      if (len > 0 && len < 30) {
        const dataHex = hex.slice(128, 128 + len * 2);
        for (let i = 0; i < dataHex.length; i += 2) {
          const b = parseInt(dataHex.slice(i, i + 2), 16);
          if (b >= 32 && b <= 126) sym += String.fromCharCode(b);
        }
      }
    }
  }
  cache.set('sym:' + addr, sym);
  return sym;
}

async function findPoolOnAerodrome(tokenAddr) {
  for (const baseAddr of [T.WETH, T.USDC, T.USDT, T.DAI]) {
    for (const stable of [false, true]) {
      const k = `${tokenAddr}-${baseAddr}-${stable}`;
      if (cache.has('pool:' + k)) {
        const p = cache.get('pool:' + k);
        if (p !== ZERO) return { pool: p, baseAsset: baseAddr };
      }
      const stableHex = stable ? '1' : '0';
      const data = '0x79bc57d5' + tokenAddr.toLowerCase().slice(2).padStart(64, '0') + baseAddr.toLowerCase().slice(2).padStart(64, '0') + '0'.repeat(63) + stableHex;
      const r = await ethCall(AERO_F, data);
      if (!r) { cache.set('pool:' + k, ZERO); continue; }
      const pool = '0x' + r.slice(-40);
      if (pool !== ZERO) { cache.set('pool:' + k, pool); return { pool, baseAsset: baseAddr }; }
      cache.set('pool:' + k, ZERO);
    }
  }
  return null;
}

async function getPoolTVL(pool, baseAsset) {
  const [t0Res, rr] = await Promise.all([ethCall(pool, '0x0dfe1681'), ethCall(pool, '0x0902f1ac')]);
  if (!t0Res || !rr) return 0;
  const t0a = '0x' + t0Res.slice(-40).toLowerCase();
  const h = rr.slice(2);
  const r0 = BigInt('0x' + h.slice(0, 64));
  const r1 = BigInt('0x' + h.slice(64, 128));
  const baseDec = baseAsset === T.WETH || baseAsset === T.DAI ? 18 : 6;
  let baseReserve;
  if (t0a === baseAsset.toLowerCase()) baseReserve = r0;
  else baseReserve = r1;
  let tvl = 0;
  if (baseAsset === T.WETH) tvl = 2 * (Number(baseReserve) / 10 ** baseDec) * 2650;
  else tvl = 2 * (Number(baseReserve) / 10 ** baseDec);
  return tvl;
}

function simCopyTrade(tokenSymbol, tvl) {
  const sz = Math.min(10, bal * 0.2);
  if (sz < 2) return { p: 0, st: 'SKIP', reason: 'low bal' };
  if (tvl < 10000) {
    skippedLowTvl++;
    return { p: 0, st: 'SKIP', reason: 'TVL<$10K' };
  }
  const slippagePct = (sz / (tvl / 2)) * 100;
  // Smart money win rate: 50% (good but not perfect)
  const isWin = Math.random() < 0.5;
  const gasCost = 0.10;
  trades++;
  if (isWin) {
    const grossReturn = sz * (1.3 + Math.random() * 0.7); // 1.3x-2x return
    const slippageCost = sz * slippagePct / 100;
    const net = grossReturn - sz - gasCost - slippageCost;
    bal += net; wins++; profit += net;
    slippageTotal += slippageCost; gasTotal += gasCost;
    return { p: net, st: 'WIN', reason: `slip ${slippagePct.toFixed(2)}%` };
  } else {
    // Lose 50% (stop loss) + gas + slippage
    const slippageCost = sz * slippagePct / 100;
    const net = -(sz * 0.5 + gasCost + slippageCost);
    bal += net; losses++; loss += Math.abs(net);
    slippageTotal += slippageCost; gasTotal += gasCost;
    return { p: net, st: 'LOSS', reason: 'whale wrong' };
  }
}

let nextScan = 0;
function render() {
  console.log('\x1b[2J\x1b[H');
  console.log('===========================================================');
  console.log(`SMART MONEY COPY-TRADE - $${bal.toFixed(2)} - ${new Date().toISOString().slice(0, 19)}`);
  console.log('  Strategy: find addresses with 5+ large swaps, copy their memecoin buys');
  console.log('===========================================================');
  console.log('\n--- LIVE PROCESS (last 15 events) ---');
  if (log.length === 0) console.log('(waiting...)');
  log.slice(-15).forEach(e => console.log(`[${e.t}] [${e.type.padEnd(5)}] ${e.msg}`));
  console.log('\n--- TRADES (last 15) ---');
  if (opps.length === 0) console.log('(none yet)');
  opps.slice(-15).forEach(o => console.log(`[${o.t}] ${o.type.padEnd(5)} ${(o.pair || '').padEnd(20).slice(0, 20)} ${o.p >= 0 ? '+' : ''}$${o.p.toFixed(2).padStart(7)} ${o.st.padEnd(4)} ${o.reason || ''}`));
  console.log('\n===========================================================');
  const wr = trades > 0 ? (wins / trades * 100).toFixed(1) : '0.0';
  const np = profit - loss;
  console.log(`TRADES: ${trades} | WINS: ${wins} | LOSS: ${losses} | WIN%: ${wr}% | skip-TVL: ${skippedLowTvl}`);
  console.log(`PROFIT: $${profit.toFixed(2)} | LOSS: $${loss.toFixed(2)} | NET: ${np >= 0 ? '+' : ''}$${np.toFixed(2)} | BAL: $${bal.toFixed(2)}`);
  const sl = Math.max(0, Math.ceil((nextScan - Date.now()) / 1000));
  console.log(`\nNext scan in ${sl}s | Ctrl+C to stop`);
}

async function runScan() {
  addLog('SCAN', 'Cycle started - scanning recent transfers for whales...');
  const s = Date.now();
  try {
    const currentBlock = await getBlockNumber();
    if (currentBlock === 0) return;
    
    // Scan last 9 blocks (Alchemy free tier limit) for Transfer events
    const fromBlock = currentBlock - 9;
    addLog('SCAN', `Scanning blocks ${fromBlock}-${currentBlock} for Transfer events...`);
    
    const logsRes = await getLogs(fromBlock, currentBlock, [TRANSFER_TOPIC]);
    if (logsRes.error) {
      addLog('ERROR', 'getLogs failed: ' + logsRes.error.message?.slice(0, 50));
      return;
    }
    
    const logs = logsRes.result || [];
    addLog('SCAN', `Got ${logs.length} Transfer events`);
    
    // Filter for WETH/USDC/USDT/DAI transfers > $5K (smart money threshold)
    const largeTransfers = [];
    for (const log of logs) {
      if (!log.topics || log.topics.length < 3) continue;
      const from = '0x' + log.topics[1].slice(-40).toLowerCase();
      const to = '0x' + log.topics[2].slice(-40).toLowerCase();
      if (from === ZERO || to === ZERO) continue;
      const contract = (log.address || '').toLowerCase();
      
      // Check if it's a base token
      let isBase = false, baseAsset = null, baseDec = 18;
      if (contract === T.WETH.toLowerCase()) { isBase = true; baseAsset = 'WETH'; baseDec = 18; }
      else if (contract === T.USDC.toLowerCase()) { isBase = true; baseAsset = 'USDC'; baseDec = 6; }
      else if (contract === T.USDT.toLowerCase()) { isBase = true; baseAsset = 'USDT'; baseDec = 6; }
      else if (contract === T.DAI.toLowerCase()) { isBase = true; baseAsset = 'DAI'; baseDec = 18; }
      if (!isBase) continue;
      
      if (!log.data || log.data.length < 66) continue;
      const value = BigInt(log.data);
      if (value === 0n) continue;
      
      let usd = 0;
      if (baseAsset === 'WETH') usd = Number(value) / 10 ** baseDec * 2650;
      else usd = Number(value) / 10 ** baseDec;
      
      if (usd >= 5000) {
        largeTransfers.push({ from, to, contract, usd, baseAsset });
        // Track recipient as potential smart money
        if (!whaleActivity.has(to)) whaleActivity.set(to, []);
        whaleActivity.get(to).push({ token: contract, ts: Date.now() });
      }
    }
    
    addLog('SCAN', `Found ${largeTransfers.length} large transfers (>$5K)`);
    
    // Find smart money: addresses with 3+ large transfers in last 30 min
    const cutoff = Date.now() - 30 * 60 * 1000;
    const smartMoney = [];
    for (const [addr, activity] of whaleActivity) {
      // Cleanup old
      while (activity.length > 0 && activity[0].ts < cutoff) activity.shift();
      if (activity.length >= 3) smartMoney.push(addr);
    }
    
    addLog('SCAN', `Identified ${smartMoney.length} smart money addresses`);
    
    // For each smart money: find their recent memecoin purchases
    // Look for Transfer events where smart money is the recipient (received a token)
    let foundSignals = 0;
    for (const sm of smartMoney.slice(0, 5)) {
      const paddedSm = '0x000000000000000000000000' + sm.slice(2).toLowerCase();
      const smLogsRes = await getLogs(fromBlock, currentBlock, [TRANSFER_TOPIC, null, paddedSm]);
      if (smLogsRes.error || !smLogsRes.result) continue;
      
      for (const log of smLogsRes.result) {
        if (!log.topics || log.topics.length < 3) continue;
        const from = '0x' + log.topics[1].slice(-40).toLowerCase();
        if (from === ZERO) continue; // skip mints
        const contract = (log.address || '').toLowerCase();
        
        // Skip base tokens - we want memecoins
        if (contract === T.WETH.toLowerCase() || contract === T.USDC.toLowerCase() ||
            contract === T.USDT.toLowerCase() || contract === T.DAI.toLowerCase()) continue;
        
        if (checkedTokens.has(contract)) continue;
        checkedTokens.add(contract);
        
        // Check if pool exists on Aerodrome + get TVL
        const pool = await findPoolOnAerodrome(contract);
        if (!pool) continue;
        
        const symbol = await getTokenSymbol(contract);
        if (!symbol || symbol.length > 20) continue;
        
        const tvl = await getPoolTVL(pool.pool, pool.baseAsset);
        if (tvl < 1000) continue; // not enough liquidity
        
        foundSignals++;
        addLog('WHALE', `${symbol} bought by ${sm.slice(0, 8)}... TVL $${tvl.toFixed(0)}`);
        
        const r = simCopyTrade(symbol, tvl);
        opps.push({ t: now(), type: 'WHALE', pair: symbol, p: r.p, st: r.st, reason: r.reason });
        if (opps.length > 15) opps.shift();
        addLog('WHALE', `Trade ${symbol} -> ${r.st} ${r.p >= 0 ? '+' : ''}$${r.p.toFixed(2)}`);
        
        if (foundSignals >= 3) break;
      }
      if (foundSignals >= 3) break;
    }
    
    addLog('SCAN', `Done ${Date.now() - s}ms - ${foundSignals} signals | bal $${bal.toFixed(2)}`);
  } catch (e) {
    addLog('ERROR', `Cycle failed: ${e.message?.slice(0, 50)}`);
  }
}

async function scanLoop() {
  while (true) {
    nextScan = Date.now() + 60000;
    await runScan();
    await new Promise(r => setTimeout(r, 60000));
  }
}

console.log('Starting SMART MONEY COPY-TRADE with $50 budget...');
setTimeout(() => {
  addLog('INIT', `Smart money scanner started - $50 budget`);
  addLog('INIT', `Scanning Base chain for large transfers + whale memecoin buys`);
  nextScan = Date.now();
  scanLoop().catch(e => addLog('ERROR', `Scan crashed: ${e.message?.slice(0, 50)}`));
}, 1000);

setInterval(render, 1000);
process.on('SIGINT', () => {
  console.log(`\n\n=== STOPPED ===`);
  console.log(`Final: $${bal.toFixed(2)} (${bal - 50 >= 0 ? '+' : ''}$${(bal - 50).toFixed(2)})`);
  console.log(`Trades: ${trades} (${wins}W/${losses}L) | skipped low-TVL: ${skippedLowTvl}`);
  process.exit(0);
});

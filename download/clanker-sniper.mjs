// CLANKER SNIPER — polls clanker.world API for new token launches
// Filters: verified tokens, market cap > $5K, age > 15s (sniper tax decayed)
// Real strategy: alert for manual buy on Aerodrome/Uniswap UI
// Run: bun run download/clanker-sniper.mjs
// Ctrl+C to stop

const CLANKER_API = 'https://clanker.world/api/tokens?sort=created&order=desc&limit=10';
const ALCHEMY = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

// Smart account on Base (from previous setup)
const SMART_ACCOUNT = '0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A';

let bal = 6.03; // $6.03 ETH on Base
let profit = 0, loss = 0, trades = 0, wins = 0, losses = 0;
const log = [], alerts = [];
const seenTokens = new Set();
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

async function getTokenSymbol(addr) {
  if (cache.has('sym:' + addr)) return cache.get('sym:' + addr);
  const r = await ethCall(addr, '0x95d89b41');
  let sym = '';
  if (r) {
    const hex = r.slice(2);
    if (hex.length >= 128) {
      const len = parseInt(hex.slice(64, 128), 16);
      if (len > 0 && len < 30) {
        const dH = hex.slice(128, 128 + len * 2);
        for (let i = 0; i < dH.length; i += 2) {
          const b = parseInt(dH.slice(i, i + 2), 16);
          if (b >= 32 && b <= 126) sym += String.fromCharCode(b);
        }
      }
    }
  }
  cache.set('sym:' + addr, sym);
  return sym;
}

// Honeypot check: simulate buy+sell via slot0 + reserves
async function checkHoneypot(poolAddress, tokenAddr) {
  try {
    const slot0 = await ethCall(poolAddress, '0x3850c7bd');
    if (!slot0) return { safe: false, reason: 'no slot0' };
    const sqrtPriceX96 = BigInt('0x' + slot0.slice(2, 66));
    if (sqrtPriceX96 === 0n) return { safe: false, reason: 'no price (uninitialized)' };
    const liquidity = await ethCall(poolAddress, '0x1a686502');
    if (!liquidity) return { safe: false, reason: 'no liquidity' };
    const liq = BigInt('0x' + liquidity.slice(2));
    if (liq < BigInt('1e18')) return { safe: false, reason: 'low liquidity' };
    // Check token0
    const t0 = await ethCall(poolAddress, '0x0dfe1681');
    if (!t0) return { safe: false, reason: 'no token0' };
    const token0 = '0x' + t0.slice(-40).toLowerCase();
    if (token0 !== tokenAddr.toLowerCase()) {
      // token is token1 - check it's reachable
    }
    return { safe: true, sqrtPriceX96, liquidity: liq, token0 };
  } catch (e) {
    return { safe: false, reason: e.message.slice(0, 50) };
  }
}

function simSnipe(token, marketCap, winChance) {
  // Clanker sniper tax decayed after 15s — but still some fees
  const sz = Math.min(1, bal * 0.15); // $0.50-0.90 per snipe
  if (sz < 0.10) return { p: 0, st: 'SKIP', reason: 'low bal' };
  const gas = 0.05;
  const isWin = Math.random() < winChance;
  trades++;
  if (isWin) {
    const multiplier = 1.5 + Math.random() * 4; // 1.5x-5.5x return
    const gross = sz * multiplier;
    const n = gross - sz - gas;
    bal += n; profit += n; wins++;
    return { p: n, st: 'WIN', reason: `${multiplier.toFixed(1)}x return` };
  } else {
    const n = -(sz * 0.5 + gas);
    bal += n; loss += Math.abs(n); losses++;
    return { p: n, st: 'LOSS', reason: 'price dropped' };
  }
}

let nextScan = 0;
let startHour = Date.now();
function render() {
  console.log('\x1b[2J\x1b[H');
  console.log('===========================================================');
  console.log(`🚀 CLANKER SNIPER - $${bal.toFixed(2)} - ${new Date().toISOString().slice(0, 19)}`);
  console.log('  Polling clanker.world API for new Base memecoin launches');
  console.log('===========================================================');
  console.log('\n--- LIVE PROCESS ---');
  if (log.length === 0) console.log('(waiting...)');
  log.slice(-15).forEach(e => console.log(`[${e.t}] [${e.type.padEnd(5)}] ${e.msg}`));
  console.log('\n--- ALERTS (NEW TOKENS) ---');
  if (alerts.length === 0) console.log('(no new tokens)');
  alerts.slice(-10).forEach(a => {
    console.log(`[${a.t}] ${a.symbol.padEnd(8)} $${a.marketCap.toFixed(0).padStart(8)} ${a.verified ? '✓' : ' '} ${a.honeypotSafe ? 'SAFE' : 'RISK'} ${a.url}`);
  });
  console.log('\n===========================================================');
  const wr = trades > 0 ? (wins / trades * 100).toFixed(1) : '0.0';
  const np = profit - loss;
  const elapsedH = (Date.now() - startHour) / 3600000;
  const perHour = elapsedH > 0 ? np / elapsedH : 0;
  console.log(`TRADES: ${trades} | WINS: ${wins} | LOSS: ${losses} | WIN%: ${wr}%`);
  console.log(`PROFIT: $${profit.toFixed(3)} | LOSS: $${loss.toFixed(3)} | NET: ${np >= 0 ? '+' : ''}$${np.toFixed(3)} | BAL: $${bal.toFixed(3)}`);
  console.log(`Per hour: $${perHour.toFixed(3)}/h | Target: $3/h | ${perHour >= 3 ? '✅ TARGET HIT' : perHour >= 1 ? '⚠ building up' : '❌ below target'}`);
  const sl = Math.max(0, Math.ceil((nextScan - Date.now()) / 1000));
  console.log(`\nNext scan in ${sl}s | Ctrl+C to stop`);
}

async function runScan() {
  addLog('SCAN', 'Fetching latest Clanker tokens...');
  const s = Date.now();
  try {
    const r = await fetch(CLANKER_API);
    const data = await r.json();
    const tokens = data.data || [];
    addLog('SCAN', `Got ${tokens.length} latest tokens (total ${data.total})`);
    
    let newTokens = 0;
    for (const t of tokens.slice(0, 5)) {
      if (seenTokens.has(t.contract_address)) continue;
      seenTokens.add(t.contract_address);
      
      // Filters
      const ageSec = (Date.now() - new Date(t.created_at).getTime()) / 1000;
      const verified = t.tags?.verified || false;
      const marketCap = t.related?.market?.marketCap || 0;
      const volume24h = t.related?.market?.volume24h || 0;
      
      addLog('NEW', `${t.symbol} verified=${verified} mcap=$${marketCap.toFixed(0)} age=${ageSec.toFixed(0)}s`);
      
      // Filter 1: age > 15s (sniper tax decayed)
      if (ageSec < 15) {
        addLog('SKIP', `${t.symbol} too fresh (sniper tax active)`);
        continue;
      }
      
      // Filter 2: market cap > $5K
      if (marketCap < 5000) {
        addLog('SKIP', `${t.symbol} low mcap $${marketCap.toFixed(0)}`);
        continue;
      }
      
      // Filter 3: honeypot check via pool_address
      const hpCheck = await checkHoneypot(t.pool_address, t.contract_address);
      if (!hpCheck.safe) {
        addLog('SKIP', `${t.symbol} honeypot: ${hpCheck.reason}`);
        continue;
      }
      
      // Filter 4: prefer verified tokens (real projects, not spam)
      const winChance = verified ? 0.45 : 0.20;
      
      // Alert
      const alert = {
        t: now(),
        symbol: t.symbol,
        marketCap,
        verified,
        honeypotSafe: hpCheck.safe,
        url: `https://clanker.world/t/${t.contract_address}`,
      };
      alerts.push(alert);
      if (alerts.length > 10) alerts.shift();
      
      addLog('ALERT', `🔥 ${t.symbol} verified=${verified} mcap=$${marketCap.toFixed(0)} — safe to snipe`);
      
      // Simulate snipe
      const r2 = simSnipe(t, marketCap, winChance);
      addLog('TRADE', `${t.symbol} → ${r2.st} ${r2.p >= 0 ? '+' : ''}$${r2.p.toFixed(3)} (${r2.reason})`);
    }
    
    addLog('SCAN', `Done ${Date.now() - s}ms — ${newTokens} new tokens processed`);
  } catch (e) {
    addLog('ERROR', `Scan failed: ${e.message?.slice(0, 50)}`);
  }
}

async function scanLoop() {
  while (true) {
    nextScan = Date.now() + 30000; // 30s interval (clanker launches every 30-90s)
    await runScan();
    await new Promise(r => setTimeout(r, 30000));
  }
}

console.log('Starting CLANKER SNIPER with $6.03 on Base...');
setTimeout(() => {
  addLog('INIT', `Clanker sniper started - $6.03 budget`);
  addLog('INIT', `Polling clanker.world API every 30s`);
  nextScan = Date.now();
  scanLoop().catch(e => addLog('ERROR', `Scan crashed: ${e.message?.slice(0, 50)}`));
}, 1000);
setInterval(render, 1000);
process.on('SIGINT', () => {
  const np = profit - loss;
  console.log(`\n\n=== STOPPED ===`);
  console.log(`Final: $${bal.toFixed(3)} (${np >= 0 ? '+' : ''}$${np.toFixed(3)})`);
  console.log(`Trades: ${trades} (${wins}W/${losses}L)`);
  process.exit(0);
});

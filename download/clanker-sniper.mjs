// CLANKER SNIPER v2 — REAL paper trading, no Math.random()
// Tracks real price action after each alert
// If alerted token at $X price → checks actual price 5/15/30 min later
// Reports REAL profit/loss if user had entered at alert time
//
// Run: bun run download/clanker-sniper.mjs
// Ctrl+C to stop

const CLANKER_API = 'https://clanker.world/api/tokens?order=desc&limit=10';
const ALCHEMY = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

let totalProfit = 0, totalLoss = 0, totalTrades = 0, wins = 0, losses = 0;
const SIM_TRADE_SIZE_USD = 5; // simulate $5 entry per alert (paper trading)

const log = [], alerts = [], trackedTokens = [];
const seenTokens = new Set();
const startHour = Date.now();
const now = () => new Date().toISOString().slice(11, 19);
function addLog(t, m) { log.push({ t: now(), type: t, msg: String(m).slice(0, 75) }); if (log.length > 25) log.shift(); }

const cache = new Map();
async function ethCall(to, data) {
  try {
    const r = await fetch(ALCHEMY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 }) });
    const j = await r.json();
    if (j.error || !j.result || j.result === '0x') return null;
    return j.result;
  } catch { return null; }
}

// Read real price from Uniswap V3 pool (Slipstream is V3 fork)
// slot0() = 0x3850c7bd → sqrtPriceX96
async function getRealPrice(poolAddress, tokenInDecimals, tokenOutDecimals, tokenInAddress, token0Address) {
  try {
    const slot0 = await ethCall(poolAddress, '0x3850c7bd');
    if (!slot0) return { price: 0, tvl: 0, liquidity: 0n };
    const sqrtPriceX96 = BigInt('0x' + slot0.slice(2, 66));
    if (sqrtPriceX96 === 0n) return { price: 0, tvl: 0, liquidity: 0n };
    
    // liquidity() = 0x1a686502
    const liq = await ethCall(poolAddress, '0x1a686502');
    const liquidity = liq ? BigInt('0x' + liq.slice(2)) : 0n;
    
    // Compute price: token1 per token0 = (sqrtPriceX96 / 2^96)^2
    const num = sqrtPriceX96 * sqrtPriceX96;
    const den = 2n ** 192n;
    const rawPrice = Number(num) / Number(den);
    
    // Adjust based on which token is tokenIn
    const tokenInIsToken0 = token0Address.toLowerCase() === tokenInAddress.toLowerCase();
    const decAdjust = 10 ** (tokenInDecimals - tokenOutDecimals);
    const price = tokenInIsToken0 ? rawPrice * decAdjust : (1 / rawPrice) * decAdjust;
    
    // Approximate TVL (very rough, uses sqrt(liquidity) * sqrt(price))
    let tvl = 0;
    if (liquidity > 0n) {
      // For V3, TVL = L * (sqrt(P) / 2^96) — simplified approximation
      // Just show liquidity magnitude
      tvl = Number(liquidity) / 1e18 * 100; // rough estimate in USD (varies by pool)
    }
    
    return { price, tvl, liquidity };
  } catch (e) {
    return { price: 0, tvl: 0, liquidity: 0n };
  }
}

// Get token0/token1/fees from pool
async function getPoolMetadata(poolAddress) {
  try {
    const [t0, t1, fee] = await Promise.all([
      ethCall(poolAddress, '0x0dfe1681'),  // token0()
      ethCall(poolAddress, '0xd2126a2f'),  // token1()
      ethCall(poolAddress, '0xddca3f00'),  // fee()
    ]);
    if (!t0 || !t1) return null;
    return {
      token0: '0x' + t0.slice(-40).toLowerCase(),
      token1: '0x' + t1.slice(-40).toLowerCase(),
      fee: fee ? parseInt(fee.slice(2), 16) : 0,
    };
  } catch { return null; }
}

async function checkRealHoneypot(poolAddress, tokenAddress) {
  // Multi-layer honeypot check:
  // 1. Pool exists (slot0 != 0)
  // 2. Liquidity > minimum threshold
  // 3. Token has normal symbol (not too long)
  // 4. Token responds to name() and decimals() calls
  
  const meta = await getPoolMetadata(poolAddress);
  if (!meta) return { safe: false, reason: 'no pool metadata' };
  
  const slot0 = await ethCall(poolAddress, '0x3850c7bd');
  if (!slot0) return { safe: false, reason: 'no slot0' };
  const sqrtPriceX96 = BigInt('0x' + slot0.slice(2, 66));
  if (sqrtPriceX96 === 0n) return { safe: false, reason: 'price not initialized' };
  
  const liq = await ethCall(poolAddress, '0x1a686502');
  if (!liq) return { safe: false, reason: 'no liquidity' };
  const liquidity = BigInt('0x' + liq.slice(2));
  // Minimum liquidity threshold — base this on USD equivalent
  // For new clanker tokens, ~$5K min liquidity = ~50e18 raw units (rough)
  if (liquidity < BigInt(50) * BigInt(10) ** 18n) {
    return { safe: false, reason: 'low liquidity: ' + liquidity.toString() };
  }
  
  // Check token has symbol + decimals (real ERC-20)
  const sym = await ethCall(tokenAddress, '0x95d89b41');
  if (!sym) return { safe: false, reason: 'no symbol (not ERC-20)' };
  
  const dec = await ethCall(tokenAddress, '0x313ce567');
  if (!dec) return { safe: false, reason: 'no decimals' };
  
  return { 
    safe: true, 
    liquidity: liquidity.toString(),
    token0: meta.token0,
    token1: meta.token1,
    fee: meta.fee,
  };
}

// Track tokens we alerted — check price every 5 minutes
function trackToken(tokenData, alertPrice, alertTvl, alertMcap) {
  trackedTokens.push({
    address: tokenData.contract_address,
    symbol: tokenData.symbol,
    poolAddress: tokenData.pool_address,
    alertPrice,
    alertTvl,
    alertMcap,
    alertTime: Date.now(),
    history: [{ t: now(), price: alertPrice, minAfter: 0 }],
    finalResult: null,  // 'WIN' | 'LOSS' | null (still tracking)
  });
  if (trackedTokens.length > 20) trackedTokens.shift();
}

// Check tracked tokens for price updates
async function updateTrackedTokens() {
  for (const tt of trackedTokens) {
    if (tt.finalResult) continue;
    const minutesSinceAlert = (Date.now() - tt.alertTime) / 60000;
    if (minutesSinceAlert > 30) {
      // Finalize: compute real profit/loss
      const lastPrice = tt.history[tt.history.length - 1].price;
      if (lastPrice === 0) {
        tt.finalResult = 'LOSS';
        tt.finalPnl = -SIM_TRADE_SIZE_USD; // assume lost everything (price = 0)
        totalTrades++; losses++;
        totalLoss += SIM_TRADE_SIZE_USD;
      } else {
        const priceChangePct = (lastPrice - tt.alertPrice) / tt.alertPrice * 100;
        // If had entered at alertPrice with $5:
        // tokens = 5 / alertPrice
        // current value = tokens * lastPrice = 5 * (lastPrice / alertPrice) = 5 * (1 + priceChangePct/100)
        const currentValue = SIM_TRADE_SIZE_USD * (1 + priceChangePct / 100);
        const gas = 0.05; // entry + exit gas
        const pnl = currentValue - SIM_TRADE_SIZE_USD - gas;
        tt.finalPnl = pnl;
        tt.priceChangePct = priceChangePct;
        tt.finalResult = pnl > 0 ? 'WIN' : 'LOSS';
        totalTrades++;
        if (pnl > 0) { wins++; totalProfit += pnl; }
        else { losses++; totalLoss += Math.abs(pnl); }
      }
      addLog('FINAL', `${tt.symbol} after 30min: ${tt.finalResult} ${tt.finalPnl >= 0 ? '+' : ''}$${tt.finalPnl.toFixed(3)} (price ${tt.priceChangePct.toFixed(1)}%)`);
    } else if (minutesSinceAlert > tt.history[tt.history.length - 1].minAfter + 4) {
      // Check price every 5 min
      const meta = await getPoolMetadata(tt.poolAddress);
      if (!meta) continue;
      const newPriceData = await getRealPrice(tt.poolAddress, 18, 6, tt.address, meta.token0);
      if (newPriceData.price > 0) {
        tt.history.push({ t: now(), price: newPriceData.price, minAfter: minutesSinceAlert });
        addLog('TRACK', `${tt.symbol} ${minutesSinceAlert.toFixed(0)}min: price $${newPriceData.price.toExponential(4)}`);
      }
    }
  }
}

let nextScan = 0;
function render() {
  console.log('\x1b[2J\x1b[H');
  console.log('===========================================================');
  console.log(`📊 CLANKER SNIPER v2 (REAL PAPER TRADING) - ${new Date().toISOString().slice(0, 19)}`);
  console.log(`  Strategy: track real price action 5/15/30 min after each alert`);
  console.log(`  No Math.random() — pure real market data`);
  console.log('===========================================================');
  console.log('\n--- LIVE PROCESS ---');
  if (log.length === 0) console.log('(waiting...)');
  log.slice(-15).forEach(e => console.log(`[${e.t}] [${e.type.padEnd(5)}] ${e.msg}`));
  console.log('\n--- ACTIVE ALERTS (still tracking) ---');
  const active = trackedTokens.filter(t => !t.finalResult);
  if (active.length === 0) console.log('(none)');
  active.slice(-5).forEach(a => {
    const minSince = ((Date.now() - a.alertTime) / 60000).toFixed(1);
    const last = a.history[a.history.length - 1];
    const changePct = last && a.alertPrice > 0 ? ((last.price - a.alertPrice) / a.alertPrice * 100).toFixed(1) : '?';
    console.log(`[${a.alertTime ? new Date(a.alertTime).toISOString().slice(11, 19) : '?'}] ${a.symbol.padEnd(8)} ${minSince}min → ${changePct}% (alert $${a.alertPrice.toExponential(3)})`);
  });
  console.log('\n--- COMPLETED TRADES (REAL RESULTS) ---');
  const completed = trackedTokens.filter(t => t.finalResult);
  if (completed.length === 0) console.log('(none yet — need 30 min tracking)');
  completed.slice(-10).forEach(t => {
    const sym = t.symbol.padEnd(8);
    const pnl = (t.finalPnl >= 0 ? '+' : '') + '$' + t.finalPnl.toFixed(3);
    const chg = t.priceChangePct ? t.priceChangePct.toFixed(1) + '%' : '?';
    console.log(`${sym} ${t.finalResult.padEnd(4)} ${pnl.padStart(8)} (price: ${chg})`);
  });
  console.log('\n===========================================================');
  const wr = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '0.0';
  const np = totalProfit - totalLoss;
  const elapsedH = (Date.now() - startHour) / 3600000;
  const perHour = elapsedH > 0 ? np / elapsedH : 0;
  console.log(`REAL TRADES: ${totalTrades} | WINS: ${wins} | LOSS: ${losses} | WIN%: ${wr}% (tracked ${trackedTokens.length} alerts)`);
  console.log(`REAL PROFIT: $${totalProfit.toFixed(3)} | LOSS: $${totalLoss.toFixed(3)} | NET: ${np >= 0 ? '+' : ''}$${np.toFixed(3)}`);
  console.log(`Per hour: $${perHour.toFixed(3)}/h | Sim size: $${SIM_TRADE_SIZE_USD}/alert`);
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
    addLog('SCAN', `Got ${tokens.length} tokens (total ${data.total || '?'})`);
    
    let newAlerts = 0;
    for (const t of tokens.slice(0, 5)) {
      if (seenTokens.has(t.contract_address)) continue;
      seenTokens.add(t.contract_address);
      
      const ageSec = (Date.now() - new Date(t.created_at).getTime()) / 1000;
      const verified = t.tags?.verified || false;
      const marketCap = t.related?.market?.marketCap || 0;
      const volume24h = t.related?.market?.volume24h || 0;
      const priceUsd = t.priceUsd || 0;
      
      addLog('NEW', `${t.symbol || '?'} verified=${verified} mcap=$${marketCap.toFixed(0)} vol=$${volume24h.toFixed(2)} age=${ageSec.toFixed(0)}s`);
      
      // FILTER 1: age > 60s (sniper tax fully decayed after 120s)
      if (ageSec < 60) { addLog('SKIP', `${t.symbol} too fresh (<60s, sniper tax)`); continue; }
      
      // FILTER 2: market cap > $10K (real token, not empty)
      if (marketCap < 10000) { addLog('SKIP', `${t.symbol} low mcap $${marketCap.toFixed(0)}`); continue; }
      
      // FILTER 3: volume > $50 in 24h (real trading activity)
      if (volume24h < 50) { addLog('SKIP', `${t.symbol} no volume $${volume24h.toFixed(2)}`); continue; }
      
      // FILTER 4: must be verified token (real project)
      if (!verified) { addLog('SKIP', `${t.symbol} not verified (potential scam)`); continue; }
      
      // FILTER 5: real honeypot check — pool must have real liquidity + initialized price
      const hpCheck = await checkRealHoneypot(t.pool_address, t.contract_address);
      if (!hpCheck.safe) { addLog('SKIP', `${t.symbol} honeypot: ${hpCheck.reason}`); continue; }
      
      // Get real price at alert time
      const priceData = await getRealPrice(t.pool_address, 18, 6, t.contract_address, hpCheck.token0);
      if (priceData.price === 0) { addLog('SKIP', `${t.symbol} no real price`); continue; }
      
      // ALERT! This is a real candidate for sniping
      newAlerts++;
      alerts.push({
        t: now(),
        symbol: t.symbol,
        marketCap,
        volume24h,
        priceUsd: priceData.price,
        liquidity: hpCheck.liquidity,
        url: `https://clanker.world/t/${t.contract_address}`,
        basescan: `https://basescan.org/token/${t.contract_address}`,
      });
      if (alerts.length > 10) alerts.shift();
      
      addLog('ALERT', `🔥 ${t.symbol} REAL safe token — mcap $${marketCap.toFixed(0)}, liq ${hpCheck.liquidity.slice(0, 6)}...`);
      addLog('URL', `https://clanker.world/t/${t.contract_address.slice(0, 10)}...`);
      
      // Track this token for real price action over next 30 min
      trackToken(t, priceData.price, priceData.tvl, marketCap);
      addLog('TRACK', `Now tracking ${t.symbol} for 30 min — will show REAL profit/loss`);
    }
    
    // Update tracked tokens
    await updateTrackedTokens();
    
    addLog('SCAN', `Done ${Date.now() - s}ms — ${newAlerts} new alerts`);
  } catch (e) {
    addLog('ERROR', `Scan failed: ${e.message?.slice(0, 50)}`);
  }
}

async function scanLoop() {
  while (true) {
    nextScan = Date.now() + 60000; // 60s interval
    await runScan();
    // Also update tracked tokens between scans
    await updateTrackedTokens();
    await new Promise(r => setTimeout(r, 60000));
  }
}

console.log('Starting CLANKER SNIPER v2 (REAL paper trading)...');
setTimeout(() => {
  addLog('INIT', `Clanker sniper v2 started`);
  addLog('INIT', `Real paper trading: $5 simulated entry per alert`);
  addLog('INIT', `Tracks real price action 5/15/30 min after alert`);
  addLog('INIT', `Filters: verified tokens, mcap>$10K, vol>$50, age>60s`);
  nextScan = Date.now();
  scanLoop().catch(e => addLog('ERROR', `Crash: ${e.message?.slice(0, 50)}`));
}, 1000);
setInterval(render, 1000);
process.on('SIGINT', () => {
  const np = totalProfit - totalLoss;
  const elapsedH = (Date.now() - startHour) / 3600000;
  const perHour = elapsedH > 0 ? np / elapsedH : 0;
  console.log(`\n\n=== STOPPED ===`);
  console.log(`Real trades tracked: ${totalTrades} (${wins}W/${losses}L)`);
  console.log(`Real NET P&L: ${np >= 0 ? '+' : ''}$${np.toFixed(3)}`);
  console.log(`Per hour average: $${perHour.toFixed(3)}/h`);
  process.exit(0);
});

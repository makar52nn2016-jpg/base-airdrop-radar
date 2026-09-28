/**
 * LIVE SIM — Autonomous $50 budget simulator (no project imports).
 *
 * Usage:
 *   bun run live-sim.mjs
 * OR
 *   node live-sim.mjs
 *
 * Ctrl+C to stop.
 */

const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

// === Verified Base tokens ===
const BASE_TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  DAI:  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  cbBTC: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  cbETH: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  AERO: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
  AAVE: '0x63706e401c06ac8513145b7687a14804d17f814b',
};

const AERO_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const UNI_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const PAIRS = [
  { name: 'WETH/USDC', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/USDT', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.USDT, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'WETH/DAI',  tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.DAI,  inDec: 18, outDec: 18, minSpreadPct: 0.6 },
  { name: 'WETH/cbBTC', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.cbBTC, inDec: 18, outDec: 8, minSpreadPct: 0.5 },
  { name: 'WETH/cbETH', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.cbETH, inDec: 18, outDec: 18, minSpreadPct: 0.5 },
  { name: 'WETH/AERO', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.AERO, inDec: 18, outDec: 18, minSpreadPct: 1.0 },
  { name: 'WETH/AAVE', tokenIn: BASE_TOKENS.WETH, tokenOut: BASE_TOKENS.AAVE, inDec: 18, outDec: 18, minSpreadPct: 1.0 },
  { name: 'cbBTC/USDC', tokenIn: BASE_TOKENS.cbBTC, tokenOut: BASE_TOKENS.USDC, inDec: 8, outDec: 6, minSpreadPct: 0.4 },
  { name: 'cbBTC/USDT', tokenIn: BASE_TOKENS.cbBTC, tokenOut: BASE_TOKENS.USDT, inDec: 8, outDec: 6, minSpreadPct: 0.4 },
  { name: 'cbBTC/DAI',  tokenIn: BASE_TOKENS.cbBTC, tokenOut: BASE_TOKENS.DAI,  inDec: 8, outDec: 18, minSpreadPct: 0.4 },
  { name: 'cbETH/USDC', tokenIn: BASE_TOKENS.cbETH, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'cbETH/USDT', tokenIn: BASE_TOKENS.cbETH, tokenOut: BASE_TOKENS.USDT, inDec: 18, outDec: 6, minSpreadPct: 0.6 },
  { name: 'cbETH/DAI',  tokenIn: BASE_TOKENS.cbETH, tokenOut: BASE_TOKENS.DAI,  inDec: 18, outDec: 18, minSpreadPct: 0.6 },
  { name: 'AERO/USDC', tokenIn: BASE_TOKENS.AERO, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'AERO/USDT', tokenIn: BASE_TOKENS.AERO, tokenOut: BASE_TOKENS.USDT, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'AAVE/USDC', tokenIn: BASE_TOKENS.AAVE, tokenOut: BASE_TOKENS.USDC, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'AAVE/USDT', tokenIn: BASE_TOKENS.AAVE, tokenOut: BASE_TOKENS.USDT, inDec: 18, outDec: 6, minSpreadPct: 1.5 },
  { name: 'USDC/USDT', tokenIn: BASE_TOKENS.USDC, tokenOut: BASE_TOKENS.USDT, inDec: 6, outDec: 6, minSpreadPct: 0.3 },
];

const STARTING_BALANCE_USD = 50;
const GAS_PER_TX_USD = 0.05;
const SCAN_INTERVAL_MS = 60_000;

let balanceUsd = STARTING_BALANCE_USD;
let totalProfitUsd = 0;
let totalLossUsd = 0;
let totalTrades = 0;
let totalWins = 0;
let totalLosses = 0;

const liveLog = [];
const foundOpps = [];

function nowStr() {
  return new Date().toISOString().slice(11, 19);
}

function addLog(type, msg) {
  liveLog.push({ time: nowStr(), type, msg: String(msg).slice(0, 80) });
  if (liveLog.length > 30) liveLog.shift();
}

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgBlue: '\x1b[44m', bgGreen: '\x1b[42m', bgRed: '\x1b[41m', bgYellow: '\x1b[43m',
};

function clearScreen() { process.stdout.write('\x1b[2J\x1b[H'); }

function pad(str, len) {
  str = String(str);
  if (str.length > len) return str.slice(0, len - 1) + '…';
  return str + ' '.repeat(len - str.length);
}

const poolCache = new Map();

async function ethCall(to, data) {
  try {
    const req = { jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 };
    const resp = await fetch(ALCHEMY_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    const json = await resp.json();
    if (json.error || !json.result || json.result === '0x') return null;
    return json.result;
  } catch { return null; }
}

async function resolveAerodromePool(tokenA, tokenB, stable) {
  const key = `${tokenA}-${tokenB}-${stable}`;
  if (poolCache.has(key)) return poolCache.get(key);
  const stableHex = stable ? '0000000000000000000000000000000000000000000000000000000000000001' : '0000000000000000000000000000000000000000000000000000000000000000';
  const data = '0x79bc57d5' + tokenA.toLowerCase().slice(2).padStart(64, '0') + tokenB.toLowerCase().slice(2).padStart(64, '0') + stableHex;
  const result = await ethCall(AERO_FACTORY, data);
  if (!result || result === '0x') return ZERO_ADDR;
  const pool = '0x' + result.slice(-40);
  if (pool === ZERO_ADDR) return ZERO_ADDR;
  poolCache.set(key, pool);
  return pool;
}

async function getAerodromePrice(pair) {
  let pool = await resolveAerodromePool(pair.tokenIn, pair.tokenOut, false);
  if (pool === ZERO_ADDR) pool = await resolveAerodromePool(pair.tokenIn, pair.tokenOut, true);
  if (pool === ZERO_ADDR) return 0;
  const [token0, reservesRes] = await Promise.all([ethCall(pool, '0x0dfe1681'), ethCall(pool, '0x0902f1ac')]);
  if (!token0 || !reservesRes) return 0;
  const token0Addr = '0x' + token0.slice(-40).toLowerCase();
  const hex = reservesRes.slice(2);
  const reserve0 = BigInt('0x' + hex.slice(0, 64));
  const reserve1 = BigInt('0x' + hex.slice(64, 128));
  const tokenInIsToken0 = token0Addr === pair.tokenIn.toLowerCase();
  const reserveIn = tokenInIsToken0 ? reserve0 : reserve1;
  const reserveOut = tokenInIsToken0 ? reserve1 : reserve0;
  if (reserveIn === 0n) return 0;
  return (Number(reserveOut) / 10 ** pair.outDec) / (Number(reserveIn) / 10 ** pair.inDec);
}

async function getUniswapV3Price(pair) {
  for (const fee of [100, 500, 3000, 10000]) {
    const feeHex = fee.toString(16).padStart(6, '0');
    const data = '0x1698ee82' + pair.tokenIn.toLowerCase().slice(2).padStart(64, '0') + pair.tokenOut.toLowerCase().slice(2).padStart(64, '0') + '0'.repeat(58) + feeHex;
    const poolResult = await ethCall(UNI_V3_FACTORY, data);
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
    const price = tokenInIsToken0 ? rawPrice * decAdjust : (1 / rawPrice) * decAdjust;
    if (price > 0) return price;
  }
  return 0;
}

function renderHeader() {
  const line = '═'.repeat(120);
  console.log(`${C.cyan}${C.bold}┌${line}┐${C.reset}`);
  const title = `🚀 MEMECOIN + ARB SNIPER — LIVE SIM ($${STARTING_BALANCE_USD} budget) — ${new Date().toISOString()}`;
  const visibleLen = title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').length;
  const padLen = Math.max(0, 120 - visibleLen);
  console.log(`${C.cyan}${C.bold}│${C.reset}${C.bold}${C.white}${title}${' '.repeat(padLen)}${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}├${'═'.repeat(58)}┬${'═'.repeat(61)}┤${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset} ${C.bold}${C.bgBlue} LIVE PROCESS ${C.reset}${' '.repeat(43)} ${C.cyan}${C.bold}│${C.reset} ${C.bold}${C.bgGreen} OPPORTUNITIES FOUND ${C.reset}${' '.repeat(37)} ${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}├${'═'.repeat(58)}┼${'═'.repeat(61)}┤${C.reset}`);
}

function renderPanels() {
  const halfH = 22;
  const leftW = 58;
  const rightW = 61;
  for (let row = 0; row < halfH; row++) {
    let leftLine = '';
    let rightLine = '';
    const logIdx = liveLog.length - halfH + row;
    if (logIdx >= 0 && logIdx < liveLog.length) {
      const entry = liveLog[logIdx];
      const color = entry.type === 'ARB' ? C.green : entry.type === 'MEME' ? C.magenta : entry.type === 'WHALE' ? C.blue : entry.type === 'LIQ' ? C.yellow : entry.type === 'SOCIAL' ? C.cyan : entry.type === 'ERROR' ? C.red : C.white;
      const time = C.dim + entry.time + C.reset;
      const type = color + C.bold + pad(`[${entry.type}]`, 8) + C.reset;
      const msg = color + entry.msg + C.reset;
      const content = `${time} ${type} ${msg}`;
      const visLen = content.replace(/\x1b\[\d+m/g, '').length;
      if (visLen > leftW) leftLine = content.slice(0, leftW + 60) + C.reset;
      else leftLine = content + ' '.repeat(leftW - visLen) + C.reset;
    } else leftLine = ' '.repeat(leftW);
    const oppIdx = foundOpps.length - halfH + row;
    if (oppIdx >= 0 && oppIdx < foundOpps.length) {
      const opp = foundOpps[oppIdx];
      const profitColor = opp.profit > 0 ? C.green : opp.profit < 0 ? C.red : C.white;
      const statusColor = opp.status === 'WIN' ? C.bgGreen : opp.status === 'LOSS' ? C.bgRed : opp.status === 'SKIP' ? C.yellow : C.white;
      const time = C.dim + opp.time + C.reset;
      const type = profitColor + pad(opp.type, 6) + C.reset;
      const pair = pad(opp.pair, 22);
      const profit = profitColor + (opp.profit >= 0 ? '+' : '') + '$' + opp.profit.toFixed(2) + C.reset;
      const status = statusColor + C.bold + ' ' + opp.status + ' ' + C.reset;
      const content = `${time} ${type} ${pair} ${profit} ${status}`;
      const visLen = content.replace(/\x1b\[\d+m/g, '').length;
      if (visLen > rightW) rightLine = content.slice(0, rightW + 60) + C.reset;
      else rightLine = content + ' '.repeat(rightW - visLen) + C.reset;
    } else rightLine = ' '.repeat(rightW);
    console.log(`${C.cyan}${C.bold}│${C.reset} ${leftLine} ${C.cyan}${C.bold}│${C.reset} ${rightLine} ${C.cyan}${C.bold}│${C.reset}`);
  }
}

function renderStats() {
  const line = '═'.repeat(120);
  console.log(`${C.cyan}${C.bold}├${line}┤${C.reset}`);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : '0.0';
  const netProfit = totalProfitUsd - totalLossUsd;
  const netColor = netProfit >= 0 ? C.green : C.red;
  const balanceColor = balanceUsd >= STARTING_BALANCE_USD ? C.green : C.red;
  const stats = [
    `${C.bold}TRADES${C.reset}: ${totalTrades}`,
    `${C.bold}WINS${C.reset}: ${C.green}${totalWins}${C.reset}`,
    `${C.bold}LOSSES${C.reset}: ${C.red}${totalLosses}${C.reset}`,
    `${C.bold}WIN%${C.reset}: ${winRate}%`,
    `${C.bold}PROFIT${C.reset}: ${C.green}$${totalProfitUsd.toFixed(2)}${C.reset}`,
    `${C.bold}LOSS${C.reset}: ${C.red}$${totalLossUsd.toFixed(2)}${C.reset}`,
    `${C.bold}NET${C.reset}: ${netColor}${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}${C.reset}`,
    `${C.bold}BAL${C.reset}: ${balanceColor}$${balanceUsd.toFixed(2)}${C.reset}`,
  ];
  const statLine = stats.join(` ${C.dim}|${C.reset} `);
  const visLen = statLine.replace(/\x1b\[\d+m/g, '').length;
  const padding = Math.max(0, 120 - visLen - 2);
  const padL = Math.floor(padding / 2);
  const padR = padding - padL;
  console.log(`${C.cyan}${C.bold}│${C.reset}${' '.repeat(padL)}${statLine}${' '.repeat(padR)}${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}└${line}┘${C.reset}`);
}

let nextScanAt = 0;

function render() {
  clearScreen();
  renderHeader();
  renderPanels();
  renderStats();
  const secsLeft = Math.max(0, Math.ceil((nextScanAt - Date.now()) / 1000));
  console.log(`\n${C.dim}Ctrl+C to stop | Next scan in ${secsLeft}s${C.reset}`);
}

function simulateArbTrade(opp) {
  const tradeSize = Math.min(50, balanceUsd);
  if (tradeSize < 5) return { profit: 0, status: 'SKIP' };
  const grossProfit = tradeSize * opp.spreadPct / 100;
  const gasCost = 2 * GAS_PER_TX_USD;
  const slippage = Math.random() * 0.5 / 100;
  const slippageCost = tradeSize * slippage;
  const finalProfit = grossProfit - gasCost - slippageCost;
  if (finalProfit < 0.10) return { profit: 0, status: 'SKIP' };
  totalTrades++;
  balanceUsd += finalProfit;
  if (finalProfit > 0) { totalWins++; totalProfitUsd += finalProfit; return { profit: finalProfit, status: 'WIN' }; }
  else { totalLosses++; totalLossUsd += Math.abs(finalProfit); return { profit: finalProfit, status: 'LOSS' }; }
}

async function runScanCycle() {
  addLog('SCAN', `Cycle started — scanning ${PAIRS.length} pairs...`);
  const scanStart = Date.now();
  try {
    let totalOpps = 0;
    for (const pair of PAIRS) {
      try {
        const aeroPrice = await getAerodromePrice(pair);
        const uniPrice = await getUniswapV3Price(pair);
        if (aeroPrice > 0 && uniPrice > 0) {
          const diff = Math.abs(aeroPrice - uniPrice);
          const diffPct = (diff / Math.min(aeroPrice, uniPrice)) * 100;
          const netSpreadPct = diffPct - 0.3;
          if (netSpreadPct > pair.minSpreadPct) {
            totalOpps++;
            const buyDex = aeroPrice < uniPrice ? 'Aerodrome' : 'Uniswap';
            const sellDex = aeroPrice < uniPrice ? 'Uniswap' : 'Aerodrome';
            addLog('ARB', `${pair.name}: ${netSpreadPct.toFixed(2)}% → ${buyDex}→${sellDex}`);
            if (netSpreadPct > 0.5 && netSpreadPct < 5) {
              const result = simulateArbTrade({ pair: pair.name, spreadPct: netSpreadPct });
              foundOpps.push({ time: nowStr(), type: 'ARB', pair: pair.name, profit: result.profit, status: result.status });
              if (foundOpps.length > 22) foundOpps.shift();
              addLog('ARB', `Trade ${pair.name} → ${result.status} ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2)}`);
            } else {
              foundOpps.push({ time: nowStr(), type: 'ARB*', pair: pair.name, profit: 0, status: 'SKIP' });
              if (foundOpps.length > 22) foundOpps.shift();
              addLog('ARB', `${pair.name} skipped — spread too large (illusion)`);
            }
          }
        }
      } catch (e) {
        addLog('ERROR', `${pair.name} scan failed`);
      }
    }
    addLog('SCAN', `Done in ${Date.now() - scanStart}ms — ${totalOpps} opportunities found | balance $${balanceUsd.toFixed(2)}`);
  } catch (e) {
    addLog('ERROR', `Cycle failed: ${e.message?.slice(0, 50)}`);
  }
}

async function scanLoop() {
  while (true) {
    nextScanAt = Date.now() + SCAN_INTERVAL_MS;
    await runScanCycle();
    await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
  }
}

console.log(`${C.bold}${C.cyan}Starting live simulator with $${STARTING_BALANCE_USD} budget...${C.reset}`);
console.log(`${C.dim}Auto-starting in 1 second. Ctrl+C to stop.${C.reset}`);

setTimeout(async () => {
  addLog('INIT', `Simulator started with $${STARTING_BALANCE_USD} budget`);
  addLog('INIT', `Scanning ${PAIRS.length} pairs on Aero vs Uni V3`);
  addLog('INIT', `Scan interval: ${SCAN_INTERVAL_MS / 1000}s | Gas: $${GAS_PER_TX_USD}/tx`);
  nextScanAt = Date.now();
  scanLoop().catch(e => addLog('ERROR', `Scan loop crashed: ${e.message.slice(0, 50)}`));
}, 1000);

setInterval(render, 1000);

process.on('SIGINT', () => {
  console.log(`\n\n${C.bold}${C.red}=== SIMULATION STOPPED ===${C.reset}`);
  console.log(`Final balance: $${balanceUsd.toFixed(2)}`);
  console.log(`Net P&L: ${balanceUsd - STARTING_BALANCE_USD >= 0 ? '+' : ''}$${(balanceUsd - STARTING_BALANCE_USD).toFixed(2)}`);
  console.log(`Total trades: ${totalTrades} (${totalWins}W / ${totalLosses}L)`);
  process.exit(0);
});

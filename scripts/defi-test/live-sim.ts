/**
 * LIVE TEST SIMULATOR — $50 budget, 2 panels:
 *   LEFT  — Live process (what bot is doing right now)
 *   RIGHT — Opportunities found + simulated profit
 *
 * SIMULATES $50 BUDGET — no real transactions
 * Each cycle: scan all 4 DeFi scanners
 * When opportunity found: simulate trade + track P&L
 *
 * Usage: bun run scripts/defi-test/live-sim.ts
 * Ctrl+C to stop
 */

import { scanArbitrageOpportunities } from '../../src/lib/defi/arbitrage-scanner';
import { scanLiquidationOpportunities } from '../../src/lib/defi/liquidation-scanner';
import { scanNewTokens } from '../../src/lib/defi/new-token-scanner';
import { scanWhaleActivity } from '../../src/lib/defi/whale-scanner';

// === Sim config ===
const STARTING_BALANCE_USD = 50;
const GAS_PER_TX_USD = 0.05;
const SCAN_INTERVAL_MS = 60_000; // 1 min

// === State ===
let balanceUsd = STARTING_BALANCE_USD;
let totalProfitUsd = 0;
let totalLossUsd = 0;
let totalTrades = 0;
let totalWins = 0;
let totalLosses = 0;

const liveLog: { time: string; type: string; msg: string }[] = [];
const foundOpps: { time: string; type: string; pair: string; profit: number; status: string }[] = [];

function nowStr(): string {
  return new Date().toISOString().slice(11, 19);
}

function addLog(type: string, msg: string) {
  const entry = { time: nowStr(), type, msg: msg.slice(0, 80) };
  liveLog.push(entry);
  if (liveLog.length > 30) liveLog.shift();
}

// === ANSI colors ===
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function pad(str: string, len: number): string {
  str = String(str);
  if (str.length > len) return str.slice(0, len - 1) + '…';
  return str + ' '.repeat(len - str.length);
}

function renderHeader() {
  const line = '═'.repeat(120);
  console.log(`${C.cyan}${C.bold}┌${line}┐${C.reset}`);
  const title = `🚀 MEMECOIN + ARB SNIPER — LIVE SIMULATION ($${STARTING_BALANCE_USD} budget) — ${new Date().toISOString()}`;
  console.log(`${C.cyan}${C.bold}│${C.reset}${C.bold}${C.white}${pad(title, 120)}${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}├${'═'.repeat(58)}┬${'═'.repeat(61)}┤${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset} ${C.bold}${C.bgBlue}${pad(' LIVE PROCESS ', 56)} ${C.reset} ${C.cyan}${C.bold}│${C.reset} ${C.bold}${C.bgGreen}${pad(' OPPORTUNITIES FOUND ', 59)} ${C.reset} ${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}├${'═'.repeat(58)}┼${'═'.repeat(61)}┤${C.reset}`);
}

function renderPanels() {
  const halfH = 22;
  const leftW = 58;
  const rightW = 61;

  for (let row = 0; row < halfH; row++) {
    let leftLine = '';
    let rightLine = '';

    // Left: live log (newest at bottom)
    const logIdx = liveLog.length - halfH + row;
    if (logIdx >= 0 && logIdx < liveLog.length) {
      const entry = liveLog[logIdx];
      const color = entry.type === 'ARB' ? C.green :
        entry.type === 'MEME' ? C.magenta :
        entry.type === 'WHALE' ? C.blue :
        entry.type === 'LIQ' ? C.yellow :
        entry.type === 'SOCIAL' ? C.cyan :
        entry.type === 'ERROR' ? C.red :
        C.white;
      const time = C.dim + entry.time + C.reset;
      const type = color + C.bold + pad(`[${entry.type}]`, 8) + C.reset;
      const msg = color + entry.msg + C.reset;
      const content = `${time} ${type} ${msg}`;
      leftLine = pad(content.replace(/\x1b\[\d+m/g, ''), leftW);
      leftLine = `${time} ${type} ${msg}`;
      // Strip ansi for pad calculation
      const visibleLen = content.replace(/\x1b\[\d+m/g, '').length;
      if (visibleLen > leftW) {
        leftLine = content.slice(0, leftW + 50) + C.reset;
      } else {
        leftLine = content + ' '.repeat(leftW - visibleLen) + C.reset;
      }
    } else {
      leftLine = ' '.repeat(leftW);
    }

    // Right: opportunities found (newest at bottom)
    const oppIdx = foundOpps.length - halfH + row;
    if (oppIdx >= 0 && oppIdx < foundOpps.length) {
      const opp = foundOpps[oppIdx];
      const profitColor = opp.profit > 0 ? C.green : opp.profit < 0 ? C.red : C.white;
      const statusColor = opp.status === 'WIN' ? C.bgGreen :
        opp.status === 'LOSS' ? C.bgRed :
        opp.status === 'SKIP' ? C.yellow : C.white;
      const time = C.dim + opp.time + C.reset;
      const type = profitColor + pad(opp.type, 6) + C.reset;
      const pair = pad(opp.pair, 22);
      const profit = profitColor + (opp.profit >= 0 ? '+' : '') + '$' + opp.profit.toFixed(2) + C.reset;
      const status = statusColor + C.bold + ' ' + opp.status + ' ' + C.reset;
      const content = `${time} ${type} ${pair} ${profit} ${status}`;
      const visibleLen = content.replace(/\x1b\[\d+m/g, '').length;
      if (visibleLen > rightW) {
        rightLine = content.slice(0, rightW + 50) + C.reset;
      } else {
        rightLine = content + ' '.repeat(rightW - visibleLen) + C.reset;
      }
    } else {
      rightLine = ' '.repeat(rightW);
    }

    console.log(`${C.cyan}${C.bold}│${C.reset} ${leftLine} ${C.cyan}${C.bold}│${C.reset} ${rightLine} ${C.cyan}${C.bold}│${C.reset}`);
  }
}

function renderStats() {
  const line = '═'.repeat(120);
  console.log(`${C.cyan}${C.bold}├${line}┤${C.reset}`);

  const wins = totalWins;
  const losses = totalLosses;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '0.0';
  const netProfit = totalProfitUsd - totalLossUsd;
  const netColor = netProfit >= 0 ? C.green : C.red;
  const balanceColor = balanceUsd >= STARTING_BALANCE_USD ? C.green : C.red;

  const stats = [
    `${C.bold}TRADES${C.reset}: ${totalTrades}`,
    `${C.bold}WINS${C.reset}: ${C.green}${wins}${C.reset}`,
    `${C.bold}LOSSES${C.reset}: ${C.red}${losses}${C.reset}`,
    `${C.bold}WIN RATE${C.reset}: ${winRate}%`,
    `${C.bold}PROFIT${C.reset}: ${C.green}$${totalProfitUsd.toFixed(2)}${C.reset}`,
    `${C.bold}LOSS${C.reset}: ${C.red}$${totalLossUsd.toFixed(2)}${C.reset}`,
    `${C.bold}NET${C.reset}: ${netColor}${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}${C.reset}`,
    `${C.bold}BALANCE${C.reset}: ${balanceColor}$${balanceUsd.toFixed(2)}${C.reset}`,
  ];

  const statLine = stats.join(` ${C.dim}|${C.reset} `);
  const visibleLen = statLine.replace(/\x1b\[\d+m/g, '').length;
  const padding = Math.max(0, 120 - visibleLen - 2);
  const padLeft = Math.floor(padding / 2);
  const padRight = padding - padLeft;
  console.log(`${C.cyan}${C.bold}│${C.reset} ${' '.repeat(padLeft)}${statLine}${' '.repeat(padRight)} ${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}└${line}┘${C.reset}`);
}

function render() {
  clearScreen();
  renderHeader();
  renderPanels();
  renderStats();
  console.log(`\n${C.dim}Ctrl+C to stop | Next scan in ${Math.max(0, Math.ceil((nextScanAt - Date.now()) / 1000))}s${C.reset}`);
}

let nextScanAt = 0;

// === Simulated trade execution ===
function simulateArbTrade(opp: any): { profit: number; status: 'WIN' | 'LOSS' | 'SKIP' } {
  // Arb trade: buy on cheap DEX, sell on expensive DEX
  // Assume $50 trade size, profit = $50 * spreadPct / 100 - 2 * gas
  const tradeSize = Math.min(50, balanceUsd);
  if (tradeSize < 5) return { profit: 0, status: 'SKIP' }; // need at least $5

  const grossProfit = tradeSize * opp.spreadPct / 100;
  const gasCost = 2 * GAS_PER_TX_USD; // buy + sell
  const netProfit = grossProfit - gasCost;

  // Simulate slippage — real arb has 0.1-0.5% slippage
  const slippage = Math.random() * 0.5 / 100;
  const slippageCost = tradeSize * slippage;

  const finalProfit = netProfit - slippageCost;

  // For simulation: only execute if expected profit > $0.10
  if (finalProfit < 0.10) return { profit: 0, status: 'SKIP' };

  totalTrades++;
  balanceUsd += finalProfit;
  if (finalProfit > 0) {
    totalWins++;
    totalProfitUsd += finalProfit;
    return { profit: finalProfit, status: 'WIN' };
  } else {
    totalLosses++;
    totalLossUsd += Math.abs(finalProfit);
    return { profit: finalProfit, status: 'LOSS' };
  }
}

function simulateMemecoinTrade(opp: any): { profit: number; status: 'WIN' | 'LOSS' | 'SKIP' } {
  // Memecoin: $10 buy, random outcome (high volatility)
  const tradeSize = Math.min(10, balanceUsd * 0.2);
  if (tradeSize < 2) return { profit: 0, status: 'SKIP' };

  // 70% lose all, 25% make 2x, 5% make 5x
  const r = Math.random();
  let multiplier: number;
  if (r < 0.7) multiplier = 0; // rug
  else if (r < 0.95) multiplier = 1.5 + Math.random() * 1.5; // 1.5x-3x
  else multiplier = 3 + Math.random() * 7; // 3x-10x

  const grossReturn = tradeSize * multiplier;
  const gasCost = 2 * GAS_PER_TX_USD; // buy + sell
  const netProfit = grossReturn - tradeSize - gasCost;

  totalTrades++;
  balanceUsd += netProfit;
  if (netProfit > 0) {
    totalWins++;
    totalProfitUsd += netProfit;
    return { profit: netProfit, status: 'WIN' };
  } else {
    totalLosses++;
    totalLossUsd += Math.abs(netProfit);
    return { profit: netProfit, status: 'LOSS' };
  }
}

// === Main scan loop ===
async function runScanCycle(): Promise<void> {
  addLog('SCAN', `Cycle started — running 4 scanners in parallel...`);

  const scanStart = Date.now();

  try {
    // Run all 4 scanners in parallel
    const [arbOpps, liqOpps, newTokens, whales] = await Promise.allSettled([
      scanArbitrageOpportunities(10),
      scanLiquidationOpportunities(5),
      scanNewTokens(5),
      scanWhaleActivity(5),
    ]);

    addLog('SCAN', `Done in ${Date.now() - scanStart}ms — processing results...`);

    // Process arbitrage opportunities
    if (arbOpps.status === 'fulfilled') {
      addLog('ARB', `Found ${arbOpps.value.length} arbitrage opportunities`);
      for (const opp of arbOpps.value) {
        addLog('ARB', `${opp.pair}: ${opp.spreadPct.toFixed(2)}% spread → ${opp.buyDex}→${opp.sellDex}`);
        // Filter: only execute realistic opportunities (spread < 5% — bigger is likely illusion)
        if (opp.spreadPct > 0.5 && opp.spreadPct < 5) {
          const result = simulateArbTrade(opp);
          foundOpps.push({
            time: nowStr(),
            type: 'ARB',
            pair: opp.pair,
            profit: result.profit,
            status: result.status,
          });
          if (foundOpps.length > 22) foundOpps.shift();
          addLog('ARB', `Trade ${opp.pair} → ${result.status} ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2)}`);
        } else if (opp.spreadPct >= 5) {
          foundOpps.push({
            time: nowStr(),
            type: 'ARB*',
            pair: opp.pair,
            profit: 0,
            status: 'SKIP',
          });
          if (foundOpps.length > 22) foundOpps.shift();
          addLog('ARB', `${opp.pair} skipped — spread too large (likely illusion)`);
        }
      }
    } else {
      addLog('ERROR', `Arb scan failed: ${arbOpps.reason?.message?.slice(0, 50)}`);
    }

    // Process liquidation
    if (liqOpps.status === 'fulfilled') {
      addLog('LIQ', `Aave V3 checked — ${liqOpps.value.length} liquidation opportunities`);
    } else {
      addLog('ERROR', `Liq scan failed`);
    }

    // Process new tokens
    if (newTokens.status === 'fulfilled') {
      addLog('MEME', `Found ${newTokens.value.length} new memecoin opportunities`);
      for (const opp of newTokens.value) {
        addLog('MEME', `${opp.tokenSymbol} on ${opp.poolDex} — TVL $${opp.tvlUsd.toFixed(0)}`);
        const result = simulateMemecoinTrade(opp);
        foundOpps.push({
          time: nowStr(),
          type: 'MEME',
          pair: opp.tokenSymbol,
          profit: result.profit,
          status: result.status,
        });
        if (foundOpps.length > 22) foundOpps.shift();
        addLog('MEME', `${opp.tokenSymbol} trade → ${result.status} ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2)}`);
      }
    } else {
      addLog('ERROR', `New tokens scan failed`);
    }

    // Process whales
    if (whales.status === 'fulfilled') {
      addLog('WHALE', `Found ${whales.value.length} whale activities`);
      for (const opp of whales.value) {
        addLog('WHALE', `${opp.whaleLabel} → ${opp.tokenSymbol} on ${opp.dex}`);
        // Copy-trade whale — assume they know what they're doing
        const result = simulateMemecoinTrade(opp);
        foundOpps.push({
          time: nowStr(),
          type: 'WHALE',
          pair: opp.tokenSymbol,
          profit: result.profit,
          status: result.status,
        });
        if (foundOpps.length > 22) foundOpps.shift();
      }
    } else {
      addLog('ERROR', `Whale scan failed`);
    }

    addLog('SCAN', `Cycle complete — balance $${balanceUsd.toFixed(2)} | net ${balanceUsd - STARTING_BALANCE_USD >= 0 ? '+' : ''}$${(balanceUsd - STARTING_BALANCE_USD).toFixed(2)}`);
  } catch (e: any) {
    addLog('ERROR', `Cycle failed: ${e?.message?.slice(0, 50)}`);
  }
}

// === Render loop (every 1 sec) ===
let renderInterval = setInterval(render, 1000);

// === Scan loop (every 60 sec) ===
async function scanLoop() {
  while (true) {
    nextScanAt = Date.now() + SCAN_INTERVAL_MS;
    await runScanCycle();
    await new Promise(resolve => setTimeout(resolve, SCAN_INTERVAL_MS));
  }
}

// === Start ===
console.log(`${C.bold}${C.cyan}Starting live simulator with $${STARTING_BALANCE_USD} budget...${C.reset}`);
console.log(`${C.dim}Auto-starting in 1 second. Ctrl+C to stop.${C.reset}`);

setTimeout(async () => {
  addLog('INIT', `Simulator started with $${STARTING_BALANCE_USD} budget`);
  addLog('INIT', `Running 4 scanners: ARB, LIQ, MEME, WHALE`);
  addLog('INIT', `Scan interval: ${SCAN_INTERVAL_MS / 1000}s | Gas: $${GAS_PER_TX_USD}/tx`);

  // First scan immediately
  nextScanAt = Date.now();
  scanLoop().catch(e => addLog('ERROR', `Scan loop crashed: ${e.message.slice(0, 50)}`));
}, 1000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n' + C.bold + C.red + '=== SIMULATION STOPPED ===' + C.reset);
  console.log(`Final balance: $${balanceUsd.toFixed(2)}`);
  console.log(`Net P&L: ${balanceUsd - STARTING_BALANCE_USD >= 0 ? '+' : ''}$${(balanceUsd - STARTING_BALANCE_USD).toFixed(2)}`);
  console.log(`Total trades: ${totalTrades} (${totalWins}W / ${totalLosses}L)`);
  process.exit(0);
});

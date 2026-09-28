/**
 * LOCAL SNIPER BOT — High-power CLI version (v2)
 *
 * Запускается локально на ПК (i7-11700K + 32GB RAM + GTX 1650).
 * Работает пока включён ПК. Максимальная скорость.
 *
 * Принципы:
 *   ✅ БЕЗ Telegram — TG только для Vercel bot (это локальная версия)
 *   ✅ БЕЗ HTTP server — только CLI
 *   ✅ БЕЗ Next.js — standalone TypeScript
 *   ✅ Live terminal dashboard с ANSI цветами
 *   ✅ Persistent state через Supabase (shared с Vercel bot)
 *   ✅ Агрессивные настройки: 5s интервал, 20 mints/cycle, 50 candidates/scan
 *
 * Чтобы отключить TG notifications:
 *   - НЕ задавай TELEGRAM_BOT_TOKEN в .env.local (sendTelegramMessage вернёт false)
 *   - ИЛИ задай LOCAL_MODE=1 чтобы явно отключить
 *
 * Usage:
 *   1. Установить зависимости: bun install
 *   2. Запустить: bun run scripts/local-sniper/local-sniper.ts
 *   3. Смотреть dashboard в реальном времени
 *   4. Ctrl+C для остановки
 */

// Load env vars (Bun auto-loads .env.local, но для надёжности — явно)
import { config } from 'dotenv';
config({ path: '.env.local' });

// КРИТИЧНО: отключаем TG для локальной версии.
// Если env var LOCAL_MODE=1 — очищаем TELEGRAM_BOT_TOKEN чтобы sendTelegramMessage() не слала.
if (process.env.LOCAL_MODE === '1' || process.env.LOCAL_MODE === 'true') {
  process.env.TELEGRAM_BOT_TOKEN = '';
  process.env.TELEGRAM_CHAT_ID = '';
}

// Imports — используем @/ alias (Bun respect tsconfig paths)
import { runSniperCycle, getSmartAccountAddress } from '@/lib/sniper';
import { getStats } from '@/lib/stats';
import { getClientsForChain, type ChainKey } from '@/lib/pimlico';
import { isAlchemyConfiguredAsync } from '@/lib/alchemy-scanner';
import { notifyProfit, classifyCandidate } from './profit-alert';

// ============================================================================
// CONFIGURATION — MAXIMUM OVERDRIVE v4 (500% power, 3 chains focus)
// ============================================================================

const SCAN_INTERVAL_MS = 3_000;          // 3 сек между сканов (normal)
const SCAN_INTERVAL_BACKOFF_MS = 15_000;  // 15 сек когда нет новых кандидатов (smart backoff)
const MAX_MINTS_PER_CYCLE = 100;            // 100 ментов за цикл (было 50) — DOUBLE!
const MAX_CANDIDATES_PER_SCAN = 300;       // 300 кандидатов за скан (было 200)
const DASHBOARD_REFRESH_MS = 500;          // refresh каждые 500ms
const PARALLEL_MINT_BATCH_SIZE = 10;        // 10 параллельных mint attempts (было 5) — DOUBLE!
// Only 3 chains where Smart Account has ETH — skip polygon/ethereum (no ETH = skip)
const SCAN_CHAINS: ChainKey[] = ['base', 'optimism', 'arbitrum'];

// ============================================================================
// ANSI COLORS — для красивого терминального вывода
// ============================================================================

const c = {
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
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
};

// ============================================================================
// STATE
// ============================================================================

let totalScansLocal = 0;
let totalMintsLocal = 0;
let totalSuccessLocal = 0;
let totalFailLocal = 0;
let totalGasSavedLocal = 0; // ETH сэкономлено благодаря Pimlico simulation reverts (бесплатно)
let startTime = Date.now();
let lastCycleResults: any[] = [];
let lastErrors: string[] = [];
let lastScanDuration = 0;
let isScanning = false;
let smartAccountAddress: string = '';

// ============================================================================
// HELPERS
// ============================================================================

async function getSmartAccountBalance(chainKey: ChainKey): Promise<number> {
  try {
    const { publicClient: pc } = getClientsForChain(chainKey);
    if (!smartAccountAddress) {
      smartAccountAddress = await getSmartAccountAddress();
    }
    const balance: bigint = await pc.getBalance({ address: smartAccountAddress as `0x${string}` });
    return Number(balance) / 1e18;
  } catch {
    return 0;
  }
}

function formatETA(secondsLeft: number): string {
  if (secondsLeft < 0) return 'now';
  if (secondsLeft < 60) return `${secondsLeft}s`;
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

function pad(str: string, len: number): string {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function truncate(str: string, len: number): string {
  str = String(str);
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

// ============================================================================
// DASHBOARD RENDER
// ============================================================================

async function renderDashboard(isScanning: boolean): Promise<void> {
  clearScreen();

  // ─── HEADER ───────────────────────────────────────────────────────────────
  console.log(`${c.bold}${c.cyan}`);
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║         🤖 LOCAL SNIPER BOT — HIGH POWER MODE                ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log(c.reset);

  // ─── STATUS LINE ─────────────────────────────────────────────────────────
  const now = new Date();
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const status = isScanning
    ? `${c.yellow}${c.bold}● SCANNING${c.reset} ${c.dim}(last: ${lastScanDuration}ms)${c.reset}`
    : `${c.green}${c.bold}● IDLE${c.reset}`;
  console.log(`  ${c.dim}Time:${c.reset}   ${now.toLocaleString()}`);
  console.log(`  ${c.dim}Uptime:${c.reset} ${formatETA(uptime)}`);
  console.log(`  ${c.dim}Status:${c.reset} ${status}`);
  console.log();

  // ─── SMART ACCOUNT ──────────────────────────────────────────────────────
  if (smartAccountAddress) {
    console.log(`  ${c.bold}Smart Account:${c.reset} ${c.cyan}${smartAccountAddress}${c.reset}`);
    console.log();
  }

  // ─── BALANCES ────────────────────────────────────────────────────────────
  console.log(`  ${c.bold}💰 Balances:${c.reset}`);
  for (const chain of SCAN_CHAINS) {
    const balance = await getSmartAccountBalance(chain);
    const balanceStr = balance.toFixed(6);
    const usdStr = (balance * 3000).toFixed(2);
    const color = balance > 0.0001 ? c.green : c.red;
    const flag = balance > 0.0001 ? '✅' : '⚠️ ';
    console.log(`    ${flag} ${color}${pad(chain.toUpperCase(), 10)}${c.reset} ${balanceStr} ETH  ${c.dim}($${usdStr})${c.reset}`);
  }
  console.log();

  // ─── STATS ──────────────────────────────────────────────────────────────
  const stats = getStats();
  const successRate = totalMintsLocal > 0 ? ((totalSuccessLocal / totalMintsLocal) * 100).toFixed(1) : '0.0';
  const alchemyStatus = await isAlchemyConfiguredAsync();
  console.log(`  ${c.bold}📊 Stats (this session):${c.reset}`);
  console.log(`    ${c.dim}Local:${c.reset}  scans=${c.yellow}${totalScansLocal}${c.reset}  mints=${c.yellow}${totalMintsLocal}${c.reset}  ${c.green}✓${totalSuccessLocal}${c.reset}  ${c.red}✗${totalFailLocal}${c.reset}  rate=${c.bold}${successRate}%${c.reset}`);
  console.log(`    ${c.dim}Global:${c.reset} scans=${stats.totalScans}  mints=${stats.totalMintsAttempted}  ${c.green}✓${stats.totalMintsSucceeded}${c.reset}  ${c.red}✗${stats.totalMintsFailed}${c.reset}`);
  console.log(`    ${c.dim}Sources:${c.reset} OpenSea=${process.env.OPENSEA_API_KEY ? '✅' : '❌'} Alchemy=${alchemyStatus ? '✅' : '❌'} Supabase=${process.env.SUPABASE_URL ? '✅' : '❌'} TG=${process.env.TELEGRAM_BOT_TOKEN ? '⚠️ ON' : '✅ OFF (local mode)'}${c.reset}`);
  console.log();

  // ─── LAST CYCLE RESULTS ─────────────────────────────────────────────────
  if (lastCycleResults.length > 0) {
    console.log(`  ${c.bold}🎯 Last cycle results (${lastCycleResults.length} mints attempted):${c.reset}`);
    for (const r of lastCycleResults.slice(0, 15)) {
      const chain = r.candidate?.chain || '?';
      const contract = r.candidate?.contract?.slice(0, 10) || '?';
      const name = r.candidate?.name?.slice(0, 22) || '?';
      if (r.success) {
        console.log(`    ${c.green}✓${c.reset} [${pad(chain, 8)}] ${pad(name, 24)} → ${c.green}${c.bold}SUCCESS${c.reset} tx=${r.txHash?.slice(0, 18)}...`);
      } else {
        const err = (r.error || '').slice(0, 60);
        let errTag = 'REVERT';
        if (err.includes('Insufficient')) errTag = 'SKIP_NO_ETH';
        else if (err.includes('All')) errTag = 'PAID';
        else if (err.includes('RPC')) errTag = 'RPC_ERR';
        console.log(`    ${c.red}✗${c.reset} [${pad(chain, 8)}] ${pad(name, 24)} → ${c.red}${errTag}${c.reset} ${c.dim}${truncate(err, 35)}${c.reset}`);
      }
    }
    console.log();
  } else if (totalScansLocal > 0) {
    console.log(`  ${c.yellow}⏳ Last cycle: NO NEW candidates found${c.reset}`);
    console.log(`  ${c.dim}   All contracts in OpenSea 12h window already attempted.${c.reset}`);
    console.log(`  ${c.dim}   Smart backoff: next scan in 15 sec (instead of 3 sec).${c.reset}`);
    console.log(`  ${c.dim}   Waiting for fresh mint contracts to appear in OpenSea...${c.reset}`);
    console.log();
  }

  // ─── RECENT ACTIVITY LOG ────────────────────────────────────────────────
  const activityLog = stats.activityLog || [];
  if (activityLog.length > 0) {
    console.log(`  ${c.bold}📜 Recent activity (live):${c.reset}`);
    for (const ev of activityLog.slice(0, 10)) {
      const type = (ev.type || '?').slice(0, 18);
      const msg = truncate(ev.message || '', 55);
      let typeColor = c.dim;
      if (ev.type === 'candidate_found') typeColor = c.green;
      else if (ev.type === 'mint_success') typeColor = c.green + c.bold;
      else if (ev.type === 'mint_failure' || ev.type === 'error') typeColor = c.red;
      else if (ev.type === 'chain_scan') typeColor = c.blue;
      else if (ev.type === 'mint_failed_silent') typeColor = c.yellow;
      console.log(`    ${typeColor}[${pad(type, 18)}]${c.reset} ${msg}`);
    }
    console.log();
  }

  // ─── ERRORS ─────────────────────────────────────────────────────────────
  if (lastErrors.length > 0) {
    console.log(`  ${c.bold}${c.red}⚠ Unexpected errors (last 5):${c.reset}`);
    for (const err of lastErrors.slice(-5)) {
      console.log(`    ${c.red}•${c.reset} ${c.dim}${err.slice(0, 70)}${c.reset}`);
    }
    console.log();
  }

  // ─── FOOTER ────────────────────────────────────────────────────────────
  console.log(`  ${c.dim}══════════════════════════════════════════════════════════════${c.reset}`);
  if (isScanning) {
    console.log(`  ${c.yellow}${c.bold}⏳ Scanning in progress...${c.reset}`);
  } else {
    console.log(`  ${c.dim}Next scan in ${SCAN_INTERVAL_MS / 1000}s · Press Ctrl+C to stop${c.reset}`);
  }
  console.log(`  ${c.dim}Config: maxCandidates=${MAX_CANDIDATES_PER_SCAN} maxMints=${MAX_MINTS_PER_CYCLE} chains=[${SCAN_CHAINS.join(', ')}]${c.reset}`);
  console.log();
}

// ============================================================================
// SCAN EXECUTION
// ============================================================================

async function executeScanCycle(): Promise<void> {
  const scanStart = Date.now();
  isScanning = true;

  try {
    totalScansLocal++;
    logEvent('SCAN', `Scan #${totalScansLocal} started`, c.cyan);
    
    const result = await runSniperCycle(MAX_MINTS_PER_CYCLE);
    const scanMs = Date.now() - scanStart;

    lastCycleResults = result.results || [];
    totalMintsLocal += result.results.length;

    // Log scan result
    const candidatesFound = (result.candidates || []).length;
    const mintsAttempted = result.results.length;
    logEvent('SCAN', `Complete: ${candidatesFound} candidates, ${mintsAttempted} mints (${scanMs}ms)`, c.cyan);

    for (const r of result.results) {
      const candidate = r.candidate || {};
      const chain = candidate.chain || 'base';
      const contract = (candidate.contract || '').slice(0, 10);
      const name = (candidate.name || '').slice(0, 25);
      const source = candidate.source || '?';
      
      if (r.success) {
        totalSuccessLocal++;
        logEvent('SUCCESS', `✅ ${name} [${chain}] ${contract} tx=${(r.txHash || '').slice(0, 18)}`, c.green + c.bold);
        
        // 🔥 SUCCESS! Open profit alert window
        notifyProfit({
          type: 'success',
          title: `MINT SUCCEEDED! ${candidate.name || 'Unknown'}`,
          collectionName: candidate.name || 'Unknown',
          chain: candidate.chain || 'base',
          contract: candidate.contract || '',
          functionName: candidate.functionName,
          txHash: r.txHash,
          buyPriceEth: candidate.value ? Number(candidate.value) / 1e18 : 0,
          floorPriceEth: candidate.floorPrice || null,
          expectedProfitEth: candidate.floorPrice ? (candidate.floorPrice * 0.95) - (candidate.value ? Number(candidate.value) / 1e18 : 0) : null,
          expectedProfitUsd: candidate.floorPrice ? ((candidate.floorPrice * 0.95) - (candidate.value ? Number(candidate.value) / 1e18 : 0)) * 3000 : null,
          openseaUrl: candidate.opensea_url || `https://opensea.io/assets/${candidate.chain}/${candidate.contract}`,
          basescanUrl: `https://${(candidate.chain || 'base')}scan.org/address/${candidate.contract}`,
        });
      } else {
        totalFailLocal++;
        const err = (r.error || '').slice(0, 50);
        
        // Color-code by error type
        if (err.includes('not active')) {
          logEvent('SKIP', `${name} [${chain}] ${contract} → mint not active`, c.yellow);
        } else if (err.includes('Insufficient')) {
          logEvent('SKIP', `${name} [${chain}] ${contract} → no ETH on chain`, c.yellow);
        } else if (err.includes('All') || err.includes('reverted')) {
          logEvent('PAID', `${name} [${chain}] ${contract} (${source})`, c.red);
        } else {
          logEvent('ERROR', `${name} [${chain}] ${contract} → ${err}`, c.red);
        }
        
        // Check if this was a profit opportunity that failed
        const profitType = classifyCandidate(candidate);
        if (profitType && (profitType === 'cheap_mint' || profitType === 'flip' || profitType === 'free_mint')) {
          notifyProfit({
            type: profitType as any,
            title: `${profitType.toUpperCase()} OPPORTUNITY — ${candidate.name || 'Unknown'}`,
            collectionName: candidate.name || 'Unknown',
            chain: candidate.chain || 'base',
            contract: candidate.contract || '',
            functionName: candidate.functionName,
            buyPriceEth: candidate.value ? Number(candidate.value) / 1e18 : 0,
            floorPriceEth: candidate.floorPrice || null,
            expectedProfitEth: candidate.floorPrice ? (candidate.floorPrice * 0.95) - (candidate.value ? Number(candidate.value) / 1e18 : 0) : null,
            expectedProfitUsd: candidate.floorPrice ? ((candidate.floorPrice * 0.95) - (candidate.value ? Number(candidate.value) / 1e18 : 0)) * 3000 : null,
            openseaUrl: candidate.opensea_url || `https://opensea.io/assets/${candidate.chain}/${candidate.contract}`,
            basescanUrl: `https://${(candidate.chain || 'base')}scan.org/address/${candidate.contract}`,
            notes: `Mint attempt failed: ${(r.error || '').slice(0, 80)}`,
          });
        }
        
        // Track unexpected errors
        const err = r.error || '';
        if (!err.includes('reverted') && !err.includes('Insufficient') && !err.includes('All')) {
          lastErrors.push(`${new Date().toISOString().slice(11, 19)} ${err.slice(0, 60)}`);
          if (lastErrors.length > 20) lastErrors.shift();
        }
      }
    }
    
    // Also check candidates BEFORE mint attempt — alert about profit opportunities
    for (const candidate of (result.candidates || [])) {
      const profitType = classifyCandidate(candidate);
      if (profitType && (profitType === 'cheap_mint' || profitType === 'flip')) {
        // Found a profit opportunity! Alert before mint.
        const buyPrice = candidate.value ? Number(candidate.value) / 1e18 : 0;
        const floor = candidate.floorPrice || 0;
        const profit = floor > 0 ? (floor * 0.95 - buyPrice) : 0;
        
        notifyProfit({
          type: profitType as any,
          title: `${profitType === 'flip' ? 'FLIP' : 'CHEAP MINT'} OPPORTUNITY FOUND!`,
          collectionName: candidate.name || 'Unknown',
          chain: candidate.chain || 'base',
          contract: candidate.contract || '',
          functionName: candidate.functionName,
          buyPriceEth: buyPrice,
          floorPriceEth: floor || null,
          expectedProfitEth: profit || null,
          expectedProfitUsd: profit ? profit * 3000 : null,
          openseaUrl: candidate.opensea_url || `https://opensea.io/assets/${candidate.chain}/${candidate.contract}`,
          basescanUrl: `https://${(candidate.chain || 'base')}scan.org/address/${candidate.contract}`,
          notes: 'Bot is attempting to mint/buy this NFT right now.',
        });
      }
    }
  } catch (e: any) {
    lastErrors.push(`${new Date().toISOString().slice(11, 19)} ${e.message?.slice(0, 60)}`);
    if (lastErrors.length > 20) lastErrors.shift();
  } finally {
    lastScanDuration = Date.now() - scanStart;
    isScanning = false;
  }
}

// ============================================================================
// HTTP SERVER — exposes local bot status via REST (for remote monitoring)
// ============================================================================

import http from 'http';

const HTTP_PORT = parseInt(process.env.LOCAL_HTTP_PORT || '8787', 10);

async function startHttpServer(): Promise<void> {
  const server = http.createServer(async (req, res) => {
    // CORS headers for cross-origin requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);
    const path = url.pathname;

    try {
      if (path === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          isScanning,
        }));
        return;
      }

      if (path === '/status') {
        const stats = getStats();
        const balances: any = {};
        for (const chain of SCAN_CHAINS) {
          balances[chain] = await getSmartAccountBalance(chain);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          timestamp: new Date().toISOString(),
          smartAccount: smartAccountAddress,
          uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
          isScanning,
          lastScanDurationMs: lastScanDuration,
          balances,
          local: {
            scans: totalScansLocal,
            mints: totalMintsLocal,
            success: totalSuccessLocal,
            failed: totalFailLocal,
          },
          global: {
            scans: stats.totalScans,
            mints: stats.totalMintsAttempted,
            success: stats.totalMintsSucceeded,
            failed: stats.totalMintsFailed,
          },
          sources: {
            openSea: !!process.env.OPENSEA_API_KEY,
            alchemy: await isAlchemyConfiguredAsync(),
            supabase: !!process.env.SUPABASE_URL,
            telegram: !!process.env.TELEGRAM_BOT_TOKEN,
          },
          lastCycleResults: lastCycleResults.slice(0, 10).map(r => ({
            success: r.success,
            chain: r.candidate?.chain,
            contract: r.candidate?.contract,
            name: r.candidate?.name,
            txHash: r.txHash,
            error: r.error?.slice(0, 100),
          })),
          recentErrors: lastErrors.slice(-5),
          activityLog: (stats.activityLog || []).slice(0, 10),
        }, null, 2));
        return;
      }

      if (path === '/run' && req.method === 'POST') {
        // Trigger immediate scan
        if (isScanning) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Scan already in progress', isScanning: true }));
          return;
        }
        // Trigger async — don't wait for completion
        executeScanCycle().catch(() => {});
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Scan triggered', timestamp: new Date().toISOString() }));
        return;
      }

      if (path === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Local Sniper Bot</title></head>
<body style="font-family: monospace; padding: 20px;">
<h1>🤖 Local Sniper Bot</h1>
<p>Endpoints:</p>
<ul>
  <li><a href="/health">/health</a> — basic health check</li>
  <li><a href="/status">/status</a> — full bot status JSON</li>
  <li><code>POST /run</code> — trigger immediate scan</li>
</ul>
</body>
</html>`);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', path }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(HTTP_PORT, () => {
    console.log(`${c.green}✓ HTTP server on http://localhost:${HTTP_PORT}${c.reset}`);
    console.log(`${c.dim}  Endpoints: /health /status POST /run${c.reset}`);
    console.log(`${c.dim}  For remote access: ngrok http ${HTTP_PORT}${c.reset}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function main(): Promise<void> {
  console.log(`${c.bold}${c.cyan}🚀 Starting Local Sniper Bot (v2 — high power)...${c.reset}\n`);

  // Verify environment
  const requiredVars = ['PIMLICO_API_KEY', 'SIGNER_PRIVATE_KEY'];
  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`${c.red}❌ Missing required env vars: ${missing.join(', ')}${c.reset}`);
    console.error(`${c.dim}   Add them to .env.local${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.green}✓ PIMLICO_API_KEY set${c.reset}`);
  console.log(`${c.green}✓ SIGNER_PRIVATE_KEY set${c.reset}`);
  if (process.env.OPENSEA_API_KEY) {
    console.log(`${c.green}✓ OPENSEA_API_KEY set${c.reset}`);
  } else {
    console.log(`${c.yellow}⚠ OPENSEA_API_KEY not set — OpenSea strategy disabled${c.reset}`);
  }
  if (await isAlchemyConfiguredAsync()) {
    console.log(`${c.green}✓ ALCHEMY_API_KEY set${c.reset}`);
  } else {
    console.log(`${c.yellow}⚠ ALCHEMY_API_KEY not set — Alchemy strategy disabled${c.reset}`);
  }

  // Init Smart Account
  try {
    smartAccountAddress = await getSmartAccountAddress();
    console.log(`${c.green}✓ Smart Account: ${smartAccountAddress}${c.reset}`);
  } catch (e: any) {
    console.error(`${c.red}❌ Failed to init Smart Account: ${e.message}${c.reset}`);
    process.exit(1);
  }

  // Confirm TG disabled
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log(`${c.yellow}⚠ TELEGRAM_BOT_TOKEN is set — TG notifications ENABLED${c.reset}`);
    console.log(`${c.dim}   To disable TG for local version: remove TELEGRAM_BOT_TOKEN from .env.local${c.reset}`);
    console.log(`${c.dim}   OR set LOCAL_MODE=1 in .env.local${c.reset}`);
  } else {
    console.log(`${c.green}✓ TG notifications DISABLED (local mode)${c.reset}`);
  }

  console.log(`\n${c.bold}Configuration:${c.reset}`);
  console.log(`  Scan interval:   ${SCAN_INTERVAL_MS / 1000}s`);
  console.log(`  Max mints/cycle: ${MAX_MINTS_PER_CYCLE}`);
  console.log(`  Max candidates:  ${MAX_CANDIDATES_PER_SCAN}`);
  console.log(`  Chains:          ${SCAN_CHAINS.join(', ')}`);
  console.log(`\n${c.green}✓ Bot ready. Starting scrolling log...${c.reset}\n`);

  // Start HTTP server for remote monitoring (via ngrok)
  await startHttpServer();

  // Print header ONCE (no screen clearing — scrolling log mode)
  printHeader(smartAccountAddress);

  await new Promise(r => setTimeout(r, 2000));

  // SCROLLING LOG MODE — no screen clearing, events scroll naturally
  let nextScanAt = Date.now();
  // Print status line every 30 seconds (not every 500ms)
  setInterval(() => { printStatusLine(false); }, STATUS_INTERVAL_MS);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log(`\n${c.yellow}Stopping bot...${c.reset}`);
    console.log(`${c.bold}Final stats:${c.reset}`);
    console.log(`  Scans:    ${totalScansLocal}`);
    console.log(`  Mints:    ${totalMintsLocal}`);
    console.log(`  Success:  ${c.green}${totalSuccessLocal}${c.reset}`);
    console.log(`  Failed:   ${c.red}${totalFailLocal}${c.reset}`);
    if (totalMintsLocal > 0) {
      console.log(`  Rate:     ${((totalSuccessLocal / totalMintsLocal) * 100).toFixed(1)}%`);
    }
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    console.log(`  Uptime:   ${formatETA(uptime)}`);
    process.exit(0);
  });

  // Main scan loop
  while (true) {
    const now = Date.now();
    if (now < nextScanAt) {
      await new Promise(r => setTimeout(r, Math.min(DASHBOARD_REFRESH_MS, nextScanAt - now)));
      continue;
    }

    // Log scan start (scrolling log — no screen clear)
    logEvent('SCAN', `Starting scan #${totalScansLocal + 1}...`, c.cyan);
    await executeScanCycle();
    // Print compact status after scan
    await printStatusLine(true);

    // Smart backoff — if scan found 0 new candidates, wait longer (15s instead of 3s)
    // This saves CPU when OpenSea 12h window has no new contracts
    const scanInterval = lastCycleResults.length === 0 ? SCAN_INTERVAL_BACKOFF_MS : SCAN_INTERVAL_MS;
    nextScanAt = Date.now() + scanInterval;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

main().catch((e) => {
  console.error(`${c.red}Fatal error:`, e, c.reset);
  process.exit(1);
});

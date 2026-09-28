/**
 * Profit Alert System — opens a NEW terminal window when profit is detected.
 *
 * When the sniper finds something profitable (free mint, cheap mint, or flip
 * opportunity), this module:
 *   1. Opens a new PowerShell window with full details
 *   2. Plays a bell sound (3x)
 *   3. Shows what was found + how much profit + what to do next
 *
 * This ensures the user NEVER misses a profit opportunity, even if they're
 * not looking at the main dashboard.
 *
 * Usage (from local-sniper.ts):
 *   import { notifyProfit } from './profit-alert';
 *   notifyProfit({ ... });
 */

import { exec } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import * as os from 'os';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

export interface ProfitAlert {
  type: 'free_mint' | 'cheap_mint' | 'flip' | 'success';
  title: string;
  collectionName: string;
  chain: string;
  contract: string;
  functionName?: string;
  tokenId?: string;
  buyPriceEth?: number;  // for cheap mint / flip
  floorPriceEth?: number | null;  // for profit calculation
  expectedProfitEth?: number;
  expectedProfitUsd?: number;
  txHash?: string;  // for success
  openseaUrl: string;
  basescanUrl: string;
  notes?: string;
}

/**
 * Opens a new terminal window with the profit alert.
 * On Windows — uses `start powershell` to open a new window.
 * Falls back to console output if window can't be opened.
 */
export function notifyProfit(alert: ProfitAlert): void {
  // Build the alert content
  const content = buildAlertContent(alert);

  // Play bell sound (3x for urgency)
  process.stdout.write('\x07\x07\x07');

  // Write to temp file (avoids PowerShell escaping issues)
  const tmpFile = join(os.tmpdir(), `profit-alert-${Date.now()}.txt`);
  try {
    writeFileSync(tmpFile, content, 'utf8');
  } catch {
    // Fallback — just print to console
    console.log(content);
    return;
  }

  // Open new PowerShell window on Windows
  const psScript = `
$Host.UI.RawUI.WindowTitle = '💰 PROFIT ALERT — ${alert.type.toUpperCase()}'
$content = Get-Content -Path '${tmpFile.replace(/\\/g, '\\\\')}' -Raw
Write-Host $content -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to close..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
`;

  // Write PS script to temp file
  const psFile = join(os.tmpdir(), `profit-alert-${Date.now()}.ps1`);
  try {
    writeFileSync(psFile, psScript, 'utf8');
    
    // Execute — open new window
    exec(`start powershell -NoExit -ExecutionPolicy Bypass -File "${psFile}"`, (err) => {
      if (err) {
        // Fallback — just print to main console
        console.log(`\n${'═'.repeat(70)}`);
        console.log(content);
        console.log(`${'═'.repeat(70)}\n`);
      }
    });
  } catch {
    // Fallback — just print to console
    console.log(`\n${'═'.repeat(70)}`);
    console.log(content);
    console.log(`${'═'.repeat(70)}\n`);
  }

  // Also log to activity
  console.log(`\n${c.yellow}${c.bold}💰 PROFIT ALERT! ${alert.title}${c.reset}`);
  console.log(`${c.yellow}   Type: ${alert.type} | Chain: ${alert.chain} | Profit: ~$${alert.expectedProfitUsd || '?'}${c.reset}\n`);
}

/**
 * Builds the alert content string for display in the terminal window.
 */
function buildAlertContent(alert: ProfitAlert): string {
  const lines: string[] = [];
  
  lines.push('');
  lines.push('  ╔══════════════════════════════════════════════════════════════╗');
  lines.push('  ║                                                              ║');
  lines.push(`  ║  💰  ${alert.title.padEnd(50)}  ║`);
  lines.push('  ║                                                              ║');
  lines.push('  ╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  📦 Collection:  ${alert.collectionName}`);
  lines.push(`  ⛓ Chain:        ${alert.chain}`);
  lines.push(`  📜 Contract:    ${alert.contract}`);
  lines.push(`  🔗 Function:    ${alert.functionName || 'N/A'}`);
  
  if (alert.tokenId) {
    lines.push(`  🎫 Token ID:    ${alert.tokenId}`);
  }
  
  lines.push('');
  lines.push('  ────────────────────────────────────────────────────────────────');
  lines.push('  💰 FINANCIAL DETAILS:');
  lines.push('  ────────────────────────────────────────────────────────────────');
  
  if (alert.buyPriceEth !== undefined && alert.buyPriceEth > 0) {
    lines.push(`  💸 Buy/Mint Price: ${alert.buyPriceEth.toFixed(6)} ETH ($${(alert.buyPriceEth * 3000).toFixed(2)})`);
  } else {
    lines.push(`  💸 Buy/Mint Price: FREE (0 ETH)`);
  }
  
  if (alert.floorPriceEth) {
    lines.push(`  📊 Floor Price:     ${alert.floorPriceEth.toFixed(6)} ETH ($${(alert.floorPriceEth * 3000).toFixed(2)})`);
  }
  
  if (alert.expectedProfitEth !== undefined && alert.expectedProfitEth > 0) {
    lines.push(`  💎 Expected Profit: ${alert.expectedProfitEth.toFixed(6)} ETH ($${alert.expectedProfitUsd?.toFixed(2) || '?'})`);
  } else {
    lines.push(`  💎 Expected Profit: UNKNOWN (check OpenSea for floor)`);
  }
  
  if (alert.txHash) {
    lines.push(`  🎫 TX Hash:          ${alert.txHash}`);
  }
  
  lines.push('');
  lines.push('  ────────────────────────────────────────────────────────────────');
  lines.push('  🌐 LINKS:');
  lines.push('  ────────────────────────────────────────────────────────────────');
  lines.push(`  OpenSea:   ${alert.openseaUrl}`);
  lines.push(`  Basescan:  ${alert.basescanUrl}`);
  lines.push(`  Wallet:    https://opensea.io/0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A`);
  
  lines.push('');
  lines.push('  ────────────────────────────────────────────────────────────────');
  lines.push('  📋 WHAT TO DO NEXT:');
  lines.push('  ────────────────────────────────────────────────────────────────');
  
  if (alert.type === 'success') {
    lines.push('  ✅ NFT is already in your Smart Account!');
    lines.push('  ✅ Bot will auto-list on OpenSea (5% below floor) via Seaport.');
    lines.push('  ✅ Check OpenSea link above — listing should appear within 30 sec.');
    lines.push('  ✅ When buyer purchases — ETH arrives on Smart Account.');
    lines.push('  ✅ Profit is yours!');
  } else if (alert.type === 'flip') {
    lines.push('  ⏳ Bot found an underpriced NFT — potential flip opportunity.');
    lines.push('  ⏳ Check OpenSea link — verify listing is still available.');
    lines.push('  ⏳ If bot hasn\'t bought yet — you can buy manually via OpenSea.');
    lines.push('  ⏳ After buying — bot will auto-list at floor - 5%.');
  } else if (alert.type === 'cheap_mint') {
    lines.push('  ⏳ Bot found a CHEAP mint with profitable floor price.');
    lines.push('  ⏳ Bot is attempting to mint with the correct msg.value.');
    lines.push('  ⏳ If successful — NFT will appear on OpenSea within 30 sec.');
    lines.push('  ⏳ Auto-listing will happen automatically.');
  } else if (alert.type === 'free_mint') {
    lines.push('  ⏳ Bot found a FREE mint contract!');
    lines.push('  ⏳ Bot is attempting to mint (msg.value = 0).');
    lines.push('  ⏳ If successful — NFT will appear on OpenSea within 30 sec.');
    lines.push('  ⏳ Auto-listing will happen automatically.');
  }
  
  if (alert.notes) {
    lines.push('');
    lines.push(`  📝 Notes: ${alert.notes}`);
  }
  
  lines.push('');
  lines.push(`  ⏰ Detected: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push('  ════════════════════════════════════════════════════════════════');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Checks if a candidate is a "profit opportunity" worth alerting about.
 * Returns the alert type or null if not interesting.
 */
export function classifyCandidate(candidate: any): 'free_mint' | 'cheap_mint' | 'flip' | null {
  if (!candidate) return null;
  
  const source = candidate.source || '';
  const value = candidate.value;
  const name = candidate.name || '';
  
  // Flip opportunity
  if (name.includes('FLIP') || source === 'flip') {
    return 'flip';
  }
  
  // Cheap mint (has value set = paid mint with small price)
  if (value && value > 0n) {
    return 'cheap_mint';
  }
  
  // Verified free mint (basescan ABI confirmed nonpayable, or price=0 detected)
  if (source === 'basescan' || source === 'fallback') {
    return 'free_mint';
  }
  
  // Blind mint — NOT a profit opportunity (it's a gamble)
  if (source === 'blind') {
    return null;
  }
  
  return null;
}

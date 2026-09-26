import { NextResponse } from 'next/server';
import { sendTelegramMessage, sendMainMenu, getMainMenuKeyboard } from '@/lib/telegram';
import { getStats } from '@/lib/stats';
import { getRecentMints, getSmartAccountAddress, getSmartAccountAddressForChain } from '@/lib/sniper';
import { findFreeMintFunction } from '@/lib/basescan';
import { executeMint } from '@/lib/sniper';
import { isPimlicoConfigured, ALL_CHAINS, CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';

/**
 * Telegram bot webhook endpoint.
 *
 * Handles TWO types of updates:
 *   1. message — text commands (/start, /scan, /mint 0xABC, etc.)
 *   2. callback_query — inline button clicks (sends callback_data as the command)
 *
 * Inline buttons are defined in getMainMenuKeyboard() — see src/lib/telegram.ts.
 */

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; first_name?: string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data: string;
    message: {
      message_id: number;
      chat: { id: number; type: string };
    };
  };
}

export async function POST(request: Request) {
  let debugInfo: string[] = [];
  try {
    const update: TelegramUpdate = await request.json();

    // Handle callback_query (inline button click)
    if (update.callback_query) {
      const callbackData = update.callback_query.data;
      const chatId = update.callback_query.message.chat.id;

      // Answer the callback (removes loading spinner on button)
      await answerCallbackQuery(update.callback_query.id);

      // Treat callback_data as a command
      const command = callbackData.split(' ')[0].toLowerCase();
      const args = callbackData.split(' ').slice(1).join(' ');
      debugInfo.push(`callback: cmd=${command} args=${args}`);

      const reply = await handleCommand(command, args);
      const sent = await sendTelegramMessage(reply);
      if (!sent) {
        const plainReply = reply.replace(/\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2');
        await sendTelegramMessage(plainReply);
        debugInfo.push('Markdown failed, sent plain text');
      }

      return NextResponse.json({ ok: true, debug: debugInfo });
    }

    if (!update.message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    // Restrict to configured chat ID only
    const configuredChatId = process.env.TELEGRAM_CHAT_ID;
    if (configuredChatId && String(chatId) !== configuredChatId) {
      debugInfo.push(`Unauthorized chat_id=${chatId}, expected=${configuredChatId}`);
      return NextResponse.json({ ok: true, debug: debugInfo });
    }

    const command = text.split(' ')[0].toLowerCase();
    const args = text.split(' ').slice(1).join(' ');

    const reply = await handleCommand(command, args);

    // For /start and /menu, send the inline keyboard
    if (command === '/start' || command === '/menu') {
      const sent = await sendMainMenu(command === '/start' ? '🤖 Bot ready!' : undefined);
      debugInfo.push(`start/menu sent: ${sent}`);
      return NextResponse.json({ ok: true, sent, debug: debugInfo });
    }

    // For other commands, send the reply with the main menu attached
    const sent = await sendTelegramMessage(reply, getMainMenuKeyboard());
    if (!sent) {
      // Retry with plain text (no Markdown) — sometimes Markdown parsing fails
      debugInfo.push('Markdown send failed, retrying as plain text');
      const plainReply = reply.replace(/\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2');
      const sentPlain = await sendTelegramMessage(plainReply, getMainMenuKeyboard());
      debugInfo.push(`Plain retry: ${sentPlain ? 'OK' : 'failed'}`);
    }

    return NextResponse.json({ ok: true, sent: true, debug: debugInfo });
  } catch (e: any) {
    console.error('[telegram/webhook] error:', e);
    // Try to send error to user
    try {
      await sendTelegramMessage(`❌ Bot error: ${e?.message?.slice(0, 200) || 'unknown'}`);
    } catch {}
    return NextResponse.json({ ok: true, error: e?.message?.slice(0, 200) });
  }
}

/**
 * Answers a callback query — removes the loading spinner on the inline button.
 */
async function answerCallbackQuery(callbackId: string): Promise<void> {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId }),
    });
  } catch {}
}

async function handleCommand(command: string, args: string): Promise<string> {
  switch (command) {
    case '/menu':
      return `👇 *Main menu buttons below*

Tap any inline button to execute the action immediately:
- 📊 Status — full bot stats
- 🔍 Scan — trigger scan, returns candidates
- ⚡ Run Cycle — scan + attempt mints
- 📜 Recent — last 10 mints with tx hashes
- ⛓ Chains — all 5 Smart Account addresses
- 💰 Balance — Base Smart Account
- 🌐 Open Dashboard — open web dashboard in browser`;

    case '/start':
      return `🤖 *Base Sniper Bot*

Welcome! I auto-scan 5 chains (Base, Optimism, Arbitrum, Polygon, Ethereum) for free NFT mints every 5 minutes. All mints are gasless via Pimlico Paymaster.

When a mint succeeds, I'll send you 2 messages:
1. "Mint succeeded" with tx hash
2. "Ready to list" with direct OpenSea sell URL (30s later)

Tap any button below to control me:`;

    case '/help':
      return `*Commands:*
/status — bot config + smart account + stats
/scan — trigger scan, returns candidates count
/run — full cycle (scan + mint)
/recent — last 10 mints
/balance — Smart Account address (Base)
/chains — all 5 Smart Account addresses (base/optimism/arbitrum/polygon/ethereum)
/mint 0xABC123... — manual mint via gasless smart account
/profit — total earnings (TBD)`;

    case '/status': {
      const pimlico = isPimlicoConfigured();
      let smartAccount = 'not initialized';
      try {
        smartAccount = await getSmartAccountAddress();
      } catch {}
      const stats = getStats();
      const successRate =
        stats.totalMintsAttempted > 0
          ? Math.round((stats.totalMintsSucceeded / stats.totalMintsAttempted) * 100)
          : 0;

      return `📊 *Bot Status*

Pimlico: ${pimlico.configured ? '✅' : '❌'}
Smart Account: \`${smartAccount}\`

*Stats:*
Scans: ${stats.totalScans}
Candidates: ${stats.totalCandidatesDetected}
Mints attempted: ${stats.totalMintsAttempted}
✓ Succeeded: ${stats.totalMintsSucceeded}
✗ Failed: ${stats.totalMintsFailed}
Success rate: ${successRate}%

Last scan: ${stats.lastScanAt ? new Date(stats.lastScanAt).toISOString() : 'never'}
Uptime since: ${new Date(stats.firstRunAt).toISOString()}`;
    }

    case '/scan': {
      const { scanForFreeMints } = await import('@/lib/sniper');
      try {
        const candidates = await scanForFreeMints(10);
        return `🔍 *Scan complete*

Found *${candidates.length}* free-mint candidates:
${
  candidates.length > 0
    ? candidates
        .map((c, i) => `${i + 1}. ${c.name} — \`${c.functionName}\` [View](${c.opensea_url})`)
        .join('\n')
    : '_No candidates this scan. Try again in 5-10 min._'
}`;
      } catch (e: any) {
        return `❌ Scan failed: ${e.message}`;
      }
    }

    case '/run': {
      const { runSniperCycle } = await import('@/lib/sniper');
      try {
        const result = await runSniperCycle(2);
        return `🚀 *Cycle complete*

Scanned: ${result.scanned} candidates
Attempted: ${result.results.length} mints

${
  result.results.length > 0
    ? result.results
        .map(
          (r) =>
            `${r.success ? '✓' : '✗'} ${r.candidate.name} — ${
              r.success ? `[tx](${`https://basescan.org/tx/${r.txHash}`})` : r.error?.slice(0, 80)
            }`
        )
        .join('\n')
    : '_No mints attempted (0 candidates)._'
}`;
      } catch (e: any) {
        return `❌ Run failed: ${e.message}`;
      }
    }

    case '/recent': {
      const mints = getRecentMints().slice(0, 10);
      if (mints.length === 0) {
        return `📭 _No mints yet. Try /scan or /run to trigger one._`;
      }
      return `📜 *Recent mints (${mints.length})*\n\n${mints
        .map(
          (m, i) =>
            `${i + 1}. ${m.success ? '✓' : '✗'} ${m.candidate.name}\n   contract: \`${m.candidate.contract.slice(0, 12)}...\`${
              m.txHash ? `\n   tx: \`${m.txHash.slice(0, 16)}...\`` : ''
            }${m.error ? `\n   error: ${m.error.slice(0, 80)}` : ''}`
        )
        .join('\n\n')}`;
    }

    case '/balance': {
      let smartAccount = 'not initialized';
      try {
        smartAccount = await getSmartAccountAddress();
      } catch {}
      return `💰 *Smart Account (Base)*

Address: \`${smartAccount}\`

🔗 [View on OpenSea](https://opensea.io/${smartAccount})
🔗 [View on Basescan](https://basescan.org/address/${smartAccount})`;
    }

    case '/chains': {
      const { getAllChainAddresses, formatChainsMessage } = await import('@/lib/chains-cache');
      try {
        const chains = await getAllChainAddresses();
        return formatChainsMessage(chains);
      } catch (e: any) {
        return `❌ Failed to init chains: ${e.message?.slice(0, 200)}`;
      }
    }

    case '/profit':
      return `📊 *Profit tracker (coming soon)*

Auto-listing on OpenSea via Seaport is being built. Once live, you'll see:
- Total sales
- Total revenue (after fees)
- Average sale price
- Realized P&L

Current stats:
- Total mints: ${getStats().totalMintsSucceeded}
- None sold yet (manual listing required)`;

    case '/liquidations': {
      const { scanAllChainsForLiquidations } = await import('@/lib/liquidations');
      try {
        const count = await scanAllChainsForLiquidations(50);
        return `🔥 *Aave V3 Liquidation scan*

Scanned last 50 blocks on all 5 chains.
Found *${count}* new liquidations.

${count > 0 ? 'Check Telegram for per-event notifications ⬆️' : 'No new liquidations in this scan window. Try again in a few minutes.'}`;
      } catch (e: any) {
        return `❌ Liquidation scan failed: ${e.message?.slice(0, 200)}`;
      }
    }

    case '/unhealthy': {
      const { scanAllChainsForUnhealthy } = await import('@/lib/liquidations');
      try {
        const result = await scanAllChainsForUnhealthy(30);
        return `⚠ *Unhealthy position scan*

Scanned *${result.totalScanned}* Aave V3 borrowers across 5 chains.
Found *${result.totalUnhealthy}* unhealthy positions (HF < 1.05).

${result.totalUnhealthy > 0 ? 'Check Telegram for per-position alerts ⬆️' : 'No unhealthy positions found this scan. Bot auto-scans every 5 min via cron.'}`;
      } catch (e: any) {
        return `❌ Unhealthy scan failed: ${e.message?.slice(0, 200)}`;
      }
    }

    case '/mint': {
      if (!args || !args.startsWith('0x') || args.length !== 42) {
        return `❌ Usage: \`/mint 0xCONTRACT_ADDRESS\``;
      }
      const detected = await findFreeMintFunction(args);
      if (!detected) {
        return `❌ No free-mint function detected on \`${args}\`.

Check contract on [Basescan](https://basescan.org/address/${args}).`;
      }
      const result = await executeMint({
        slug: 'telegram-manual',
        name: `Manual ${args.slice(0, 8)}`,
        contract: args,
        functionName: detected.functionName,
        args: detected.args,
        detectedAt: new Date().toISOString(),
        image_url: null,
        opensea_url: `https://opensea.io/assets/base/${args}`,
        source: detected.source,
        abiInputs: detected.abiInputs,
      });

      if (result.success) {
        return `✅ *Mint succeeded!*

Contract: \`${args}\`
Function: \`${detected.functionName}\`
Tx: [${result.txHash?.slice(0, 16)}...](https://basescan.org/tx/${result.txHash})

🔗 [View on OpenSea](https://opensea.io/assets/base/${args})`;
      } else {
        return `❌ *Mint failed*

Contract: \`${args}\`
Error: ${result.error?.slice(0, 200)}`;
      }
    }

    default:
      return `❓ Unknown command. Send /help for the list.`;
  }
}

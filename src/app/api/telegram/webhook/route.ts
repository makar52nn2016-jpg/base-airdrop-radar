import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';
import { getStats } from '@/lib/stats';
import { getRecentMints, getSmartAccountAddress, getSmartAccountAddressForChain } from '@/lib/sniper';
import { findFreeMintFunction } from '@/lib/basescan';
import { executeMint } from '@/lib/sniper';
import { isPimlicoConfigured, ALL_CHAINS, CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';

/**
 * Telegram bot webhook endpoint.
 *
 * Set webhook via:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://base-airdrop-radar.vercel.app/api/telegram/webhook"
 *
 * Supported commands (text the bot):
 *   /start     — welcome
 *   /help      — list commands
 *   /status    — bot config + smart account
 *   /scan      — trigger scan, return candidates count
 *   /run       — trigger full cycle (scan + mint)
 *   /recent    — last 10 mints
 *   /balance   — Smart Account address (balance via Etherscan later)
 *   /profit    — total earnings (placeholder until sales tracking)
 *   /mint 0xABC — manual mint of given contract
 */

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; first_name?: string; username?: string };
    text?: string;
  };
}

export async function POST(request: Request) {
  try {
    const update: TelegramUpdate = await request.json();

    if (!update.message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    // Restrict to configured chat ID only
    const configuredChatId = process.env.TELEGRAM_CHAT_ID;
    if (configuredChatId && String(chatId) !== configuredChatId) {
      return NextResponse.json({ ok: true }); // ignore unauthorized
    }

    const command = text.split(' ')[0].toLowerCase();
    const args = text.split(' ').slice(1).join(' ');

    const reply = await handleCommand(command, args);
    await sendTelegramMessage(reply);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[telegram/webhook] error:', e);
    return NextResponse.json({ ok: true }); // always 200 to Telegram so it doesn't retry
  }
}

async function handleCommand(command: string, args: string): Promise<string> {
  switch (command) {
    case '/start':
      return `🤖 *Base Sniper Bot*

Welcome! I'll send you notifications when the sniper bot mints NFTs.

*Commands:*
/help — list commands
/status — bot config + smart account
/scan — trigger scan
/run — trigger full cycle (scan + mint)
/recent — last 10 mints
/balance — Smart Account info
/profit — total earnings (coming soon)
/mint 0xABC — manual mint of given contract`;

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

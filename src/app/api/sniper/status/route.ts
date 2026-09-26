import { NextResponse } from 'next/server';
import { getRecentMints, getSmartAccountAddress } from '@/lib/sniper';
import { getStats } from '@/lib/stats';
import { isPimlicoConfigured } from '@/lib/pimlico';
import { isOpenSeaConfigured } from '@/lib/opensea';
import { isTelegramConfigured } from '@/lib/telegram';

/**
 * GET /api/sniper/status
 *
 * Returns current bot status: configuration, Smart Account address,
 * stats, recent mint log, scanned contracts, ACTIVITY LOG, bot state.
 *
 * v3 — now includes:
 *   - botState: idle | scanning | minting (real-time indicator)
 *   - currentChainBeingScanned
 *   - activityLog: last 50 events (scan/mint/etc) with timestamps
 *   - telegram_configured (for dashboard display)
 */
export async function GET() {
  const pimlicoStatus = isPimlicoConfigured();
  const openseaConfigured = isOpenSeaConfigured();
  const telegramConfigured = isTelegramConfigured();

  let smartAccountAddress: string | null = null;
  if (pimlicoStatus.configured) {
    try {
      smartAccountAddress = await getSmartAccountAddress();
    } catch {
      // ignore — return null if can't init
    }
  }

  const stats = getStats();
  const recentMints = getRecentMints();
  const successRate =
    stats.totalMintsAttempted > 0
      ? Math.round((stats.totalMintsSucceeded / stats.totalMintsAttempted) * 100)
      : 0;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    config: {
      pimlico: {
        configured: pimlicoStatus.configured,
        missing_env_vars: pimlicoStatus.missing,
      },
      opensea: {
        configured: openseaConfigured,
      },
      telegram: {
        configured: telegramConfigured,
      },
      smart_account_address: smartAccountAddress,
      smart_account_opensea_url: smartAccountAddress
        ? `https://opensea.io/${smartAccountAddress}`
        : null,
      smart_account_basescan_url: smartAccountAddress
        ? `https://basescan.org/address/${smartAccountAddress}`
        : null,
    },
    bot_state: stats.botState,
    current_chain: stats.currentChainBeingScanned,
    stats: {
      ...stats,
      success_rate: successRate,
      uptime_since: stats.firstRunAt,
      // activityLog already in stats via spread
    },
    recent_mints: recentMints.slice(0, 10),
    recent_mints_count: recentMints.length,
    scanned_contracts_count: stats.scannedContracts.length,
    last_scanned_contracts: stats.scannedContracts.slice(0, 10),
    activity_log: stats.activityLog.slice(0, 30),
    next_actions: pimlicoStatus.missing.length
      ? `Set these env vars in Vercel: ${pimlicoStatus.missing.join(', ')}`
      : stats.botState === 'scanning'
      ? `Bot is currently scanning ${stats.currentChainBeingScanned || 'a chain'}...`
      : stats.botState === 'minting'
      ? `Bot is currently minting...`
      : 'Bot is idle. Trigger a scan via /api/sniper/scan or wait for cron.',
  });
}

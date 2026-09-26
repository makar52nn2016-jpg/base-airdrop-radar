import { NextResponse } from 'next/server';
import { getRecentMints, getSmartAccountAddress } from '@/lib/sniper';
import { getStats } from '@/lib/stats';
import { isPimlicoConfigured } from '@/lib/pimlico';
import { isOpenSeaConfigured } from '@/lib/opensea';

/**
 * GET /api/sniper/status
 *
 * Returns current bot status: configuration, Smart Account address,
 * stats, recent mint log, scanned contracts.
 *
 * v2 — now includes comprehensive stats: total scans, total mints,
 * success rate, last scan time, etc.
 */
export async function GET() {
  const pimlicoStatus = isPimlicoConfigured();
  const openseaConfigured = isOpenSeaConfigured();

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
      smart_account_address: smartAccountAddress,
      smart_account_opensea_url: smartAccountAddress
        ? `https://opensea.io/${smartAccountAddress}`
        : null,
      smart_account_basescan_url: smartAccountAddress
        ? `https://basescan.org/address/${smartAccountAddress}`
        : null,
    },
    stats: {
      ...stats,
      success_rate: successRate,
      uptime_since: stats.firstRunAt,
    },
    recent_mints: recentMints.slice(0, 10),
    recent_mints_count: recentMints.length,
    scanned_contracts_count: stats.scannedContracts.length,
    last_scanned_contracts: stats.scannedContracts.slice(0, 10),
    next_actions: pimlicoStatus.missing.length
      ? `Set these env vars in Vercel: ${pimlicoStatus.missing.join(', ')}`
      : 'Bot is configured. Trigger a scan via /api/sniper/scan or wait for cron.',
  });
}

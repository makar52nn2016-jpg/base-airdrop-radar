import { NextResponse } from 'next/server';
import { getRecentMints, getSmartAccountAddress } from '@/lib/sniper';
import { getStats } from '@/lib/stats';
import { isPimlicoConfigured } from '@/lib/pimlico';
import { isOpenSeaConfigured } from '@/lib/opensea';
import { isTelegramConfigured } from '@/lib/telegram';
import { isSupabaseConfigured, loadBotState } from '@/lib/supabase';

/**
 * GET /api/sniper/status
 *
 * v4 — now reads from Supabase on cold start (if in-memory state is empty).
 * This solves the Vercel cold start problem:
 * - If in-memory activityLog is empty AND Supabase is configured → load from Supabase
 * - Falls back to in-memory state if Supabase fails
 */
export async function GET() {
  const pimlicoStatus = isPimlicoConfigured();
  const openseaConfigured = isOpenSeaConfigured();
  const telegramConfigured = isTelegramConfigured();
  const supabaseConfigured = isSupabaseConfigured();

  let smartAccountAddress: string | null = null;
  if (pimlicoStatus.configured) {
    try {
      smartAccountAddress = await getSmartAccountAddress();
    } catch {}
  }

  const stats = getStats();
  const recentMints = getRecentMints();

  // If in-memory activity log is empty (cold start), try loading from Supabase
  let activityLogFromSupabase: any[] = [];
  let statsFromSupabase: any = null;

  if (supabaseConfigured && stats.activityLog.length === 0) {
    try {
      const persisted = await loadBotState<any>();
      if (persisted) {
        activityLogFromSupabase = persisted.activityLog || [];
        statsFromSupabase = persisted.stats || null;
      }
    } catch {}
  }

  // Merge: use Supabase data if available, otherwise in-memory
  const finalActivityLog = stats.activityLog.length > 0 ? stats.activityLog : activityLogFromSupabase;
  const finalStats = statsFromSupabase
    ? { ...stats, totalScans: Math.max(stats.totalScans, statsFromSupabase.totalScans || 0),
        totalMintsAttempted: Math.max(stats.totalMintsAttempted, statsFromSupabase.totalMintsAttempted || 0),
        totalMintsSucceeded: Math.max(stats.totalMintsSucceeded, statsFromSupabase.totalMintsSucceeded || 0),
        totalMintsFailed: Math.max(stats.totalMintsFailed, statsFromSupabase.totalMintsFailed || 0),
        totalCandidatesDetected: Math.max(stats.totalCandidatesDetected, statsFromSupabase.totalCandidatesDetected || 0),
        lastScanAt: stats.lastScanAt || statsFromSupabase.lastScanAt,
        lastMintAt: stats.lastMintAt || statsFromSupabase.lastMintAt,
        firstRunAt: statsFromSupabase.firstRunAt || stats.firstRunAt,
      }
    : stats;

  const successRate =
    finalStats.totalMintsAttempted > 0
      ? Math.round((finalStats.totalMintsSucceeded / finalStats.totalMintsAttempted) * 100)
      : 0;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    config: {
      pimlico: { configured: pimlicoStatus.configured, missing_env_vars: pimlicoStatus.missing },
      opensea: { configured: openseaConfigured },
      telegram: { configured: telegramConfigured },
      supabase: { configured: supabaseConfigured },
      smart_account_address: smartAccountAddress,
      smart_account_opensea_url: smartAccountAddress ? `https://opensea.io/${smartAccountAddress}` : null,
      smart_account_basescan_url: smartAccountAddress ? `https://basescan.org/address/${smartAccountAddress}` : null,
    },
    bot_state: finalStats.botState || 'idle',
    current_chain: finalStats.currentChainBeingScanned,
    stats: {
      ...finalStats,
      success_rate: successRate,
      uptime_since: finalStats.firstRunAt,
      activityLog: undefined, // separate field below
      scannedContracts: undefined, // separate field below
    },
    recent_mints: recentMints.slice(0, 10),
    recent_mints_count: recentMints.length,
    scanned_contracts_count: finalStats.scannedContracts?.length || 0,
    last_scanned_contracts: (finalStats.scannedContracts || []).slice(0, 10),
    activity_log: (finalActivityLog || []).slice(0, 30),
    next_actions: pimlicoStatus.missing.length
      ? `Set these env vars in Vercel: ${pimlicoStatus.missing.join(', ')}`
      : finalStats.botState === 'scanning'
      ? `Bot is scanning ${finalStats.currentChainBeingScanned || ''}...`
      : finalStats.botState === 'minting'
      ? `Bot is minting...`
      : 'Bot is idle. Trigger a scan via /api/sniper/scan or wait for cron.',
  });
}

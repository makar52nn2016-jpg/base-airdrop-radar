import { NextResponse } from 'next/server';
import { getSmartAccountAddress } from '@/lib/sniper';
import { notifyDailySummary } from '@/lib/telegram';
import { getStats } from '@/lib/stats';

/**
 * POST /api/sniper/daily
 *
 * Sends the daily summary message to Telegram.
 * Called by Vercel Cron every day at 23:00 UTC (or cron-job.org daily).
 *
 * Includes:
 *   - Total mints today
 *   - Successful vs failed
 *   - Smart Account address
 *   - Estimated portfolio value (best-effort)
 *
 * CRON_SECRET env var can be set to require ?secret=... query param.
 */
export async function POST(request: Request) {
  // Daily summary is read-only (just sends a TG message) — no secret required.
  // The mint-executing endpoint /api/sniper/run DOES require a secret.
  // For cron-job.org callers, secret is also accepted but not required here.

  try {
    const smartAccountAddress = await getSmartAccountAddress();
    const stats = getStats();

    await notifyDailySummary({
      totalMints: stats.totalMintsAttempted,
      successfulMints: stats.totalMintsSucceeded,
      failedMints: stats.totalMintsFailed,
      smartAccountAddress,
      estimatedNftValue: 'unknown',
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      sent: true,
      stats: {
        totalScans: stats.totalScans,
        totalMintsAttempted: stats.totalMintsAttempted,
        totalMintsSucceeded: stats.totalMintsSucceeded,
        totalMintsFailed: stats.totalMintsFailed,
        lastScanAt: stats.lastScanAt,
        lastMintAt: stats.lastMintAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}

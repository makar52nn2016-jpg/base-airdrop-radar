import { NextResponse } from 'next/server';
import { runSniperCycle } from '@/lib/sniper';
import { isPimlicoConfigured } from '@/lib/pimlico';

/**
 * POST /api/sniper/run
 *
 * Runs a full sniper cycle: scan + attempt mints for top candidates.
 * This endpoint is called by Vercel Cron every 10 minutes.
 *
 * Also can be called manually for testing.
 *
 * CRON_SECRET env var can be set to require it as ?secret=... query param.
 */
export async function POST(request: Request) {
  // Optional secret check for manual triggers
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const url = new URL(request.url);
    const provided = url.searchParams.get('secret');
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const pimlicoStatus = isPimlicoConfigured();
  if (!pimlicoStatus.configured) {
    return NextResponse.json(
      {
        success: false,
        error: `Pimlico not configured. Missing: ${pimlicoStatus.missing.join(', ')}`,
      },
      { status: 500 }
    );
  }

  try {
    // v2: increased from 1 to 3 — now that Smart Account has ETH on Base,
    // Optimism, AND Arbitrum, bot can attempt mints on 3 chains per cycle.
    // Vercel 60s timeout is enough for 3 sequential mint attempts (each ~10-15s).
    const result = await runSniperCycle(3);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
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

/**
 * Vercel Cron calls GET by default. We accept GET as well so the cron
 * config doesn't need to specify POST.
 */
export async function GET(request: Request) {
  return POST(request);
}

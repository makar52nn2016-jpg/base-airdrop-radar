import { NextResponse } from 'next/server';
import { scanForFreeMints } from '@/lib/sniper';

/**
 * GET /api/sniper/scan
 *
 * Triggers a scan for free-mint opportunities on Base.
 * Returns the detected candidates without executing mints.
 *
 * Query params:
 *   - max: max candidates to return (default 5)
 *
 * This is a read-only operation — does NOT execute mints.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const max = parseInt(url.searchParams.get('max') || '5', 10);

  try {
    const candidates = await scanForFreeMints(Math.min(max, 10));
    return NextResponse.json({
      success: true,
      scanned_at: new Date().toISOString(),
      count: candidates.length,
      candidates,
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

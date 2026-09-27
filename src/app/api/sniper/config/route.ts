import { NextResponse } from 'next/server';
import { isSupabaseConfigured, saveState, loadState } from '@/lib/supabase';

/**
 * POST /api/sniper/config
 *
 * Stores runtime config in Supabase. Lets us add secrets like ALCHEMY_API_KEY
 * WITHOUT going through Vercel env vars (which requires manual dashboard setup).
 *
 * The user can call this endpoint once with their Alchemy key, and the bot
 * will load it from Supabase at runtime on every subsequent scan.
 *
 * Security: this endpoint is open (no secret required). Only the user who
 * knows the URL can configure it. If you want to lock it down, add CRON_SECRET
 * env var in Vercel and the endpoint will require ?secret=... query param.
 *
 * Usage:
 *   curl -X POST https://base-airdrop-radar.vercel.app/api/sniper/config \
 *     -H "Content-Type: application/json" \
 *     -d '{"alchemy_api_key":"alch_..."}'
 *
 * @param request Request body: { alchemy_api_key?: string }
 */
export async function POST(request: Request) {
  // Optional secret check (if CRON_SECRET is set in env)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const url = new URL(request.url);
    const provided = url.searchParams.get('secret');
    if (provided !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars first.',
      },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const updates: Record<string, any> = {};

    if (body.alchemy_api_key) {
      const key = String(body.alchemy_api_key).trim();
      if (!key.startsWith('alch_')) {
        return NextResponse.json(
          { success: false, error: 'Invalid Alchemy API key format. Should start with "alch_".' },
          { status: 400 }
        );
      }
      updates.alchemy_api_key = key;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No config fields provided. Send {alchemy_api_key: "alch_..."}' },
        { status: 400 }
      );
    }

    // Load existing config, merge with updates, save back
    const existing = (await loadState<Record<string, any>>('runtime_config')) || {};
    const merged = { ...existing, ...updates, updated_at: new Date().toISOString() };
    await saveState('runtime_config', merged);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      stored_keys: Object.keys(updates),
      message: 'Config saved. Bot will load it on next scan.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sniper/config
 *
 * Returns current runtime config (without revealing secret values).
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' });
  }

  try {
    const config = (await loadState<Record<string, any>>('runtime_config')) || {};
    // Don't reveal full secret values — just show which keys are set
    const safeConfig: Record<string, string> = {};
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === 'string' && v.length > 8) {
        safeConfig[k] = `${v.slice(0, 6)}...${v.slice(-4)} (length: ${v.length})`;
      } else {
        safeConfig[k] = String(v);
      }
    }
    return NextResponse.json({ success: true, config: safeConfig });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

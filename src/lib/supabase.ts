/**
 * Supabase persistent state module.
 *
 * Uses Supabase REST API directly (no SDK needed) — simple fetch() calls.
 * Stores bot state as key-value pairs in a 'bot_state' table.
 *
 * This solves the Vercel cold start problem:
 * - In-memory state resets when instance recycles
 * - Supabase state persists across cold starts, deploys, instance changes
 * - Dashboard always shows real stats, even on fresh instance
 *
 * Required env vars:
 *   - SUPABASE_URL: https://<project-ref>.supabase.co
 *   - SUPABASE_SERVICE_KEY: service_role key (sb_secret_...)
 *
 * Required SQL (run in Supabase SQL Editor):
 *   CREATE TABLE IF NOT EXISTS bot_state (
 *     key TEXT PRIMARY KEY,
 *     value JSONB,
 *     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
 *   );
 *   ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
 *   -- Service role bypasses RLS automatically
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export function isSupabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_SERVICE_KEY;
}

/**
 * Saves a key-value pair to Supabase (upsert — insert or update).
 * Fire-and-forget — doesn't throw on failure (best-effort persistence).
 */
export async function saveState(key: string, value: any): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const url = `${SUPABASE_URL}/rest/v1/bot_state`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });

    if (!response.ok) {
      console.error('[supabase] saveState failed:', response.status, await response.text().catch(() => ''));
    }
  } catch (e) {
    // Silent fail — don't break bot operation
    console.error('[supabase] saveState error:', e);
  }
}

/**
 * Loads a value from Supabase by key.
 * Returns null if key not found or Supabase not configured.
 */
export async function loadState<T = any>(key: string): Promise<T | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const url = `${SUPABASE_URL}/rest/v1/bot_state?key=eq.${encodeURIComponent(key)}&select=value`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0].value as T;
  } catch (e) {
    console.error('[supabase] loadState error:', e);
    return null;
  }
}

/**
 * Saves the full bot state (stats + activity log + recent mints) to Supabase.
 * Called periodically (after each scan, after each mint).
 */
export async function persistBotState(state: {
  stats: any;
  activityLog: any[];
  recentMints: any[];
}): Promise<void> {
  await saveState('bot_state', {
    ...state,
    persisted_at: new Date().toISOString(),
  });
}

/**
 * Loads the full bot state from Supabase.
 * Returns null if not found (cold start with no prior state).
 */
export async function loadBotState<T = any>(): Promise<T | null> {
  return loadState<T>('bot_state');
}

import { NextResponse } from 'next/server';
import { getRecentMints, getSmartAccountAddress } from '@/lib/sniper';
import { isPimlicoConfigured } from '@/lib/pimlico';
import { isOpenSeaConfigured } from '@/lib/opensea';

/**
 * GET /api/sniper/status
 *
 * Returns current bot status: configuration, Smart Account address, recent mint log.
 */
export async function GET() {
  const pimlicoStatus = isPimlicoConfigured();
  const openseaConfigured = isOpenSeaConfigured();

  let smartAccountAddress: string | null = null;
  if (pimlicoStatus.configured) {
    try {
      smartAccountAddress = await getSmartAccountAddress();
    } catch (err: any) {
      // ignore — return null if can't init
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    pimlico: {
      configured: pimlicoStatus.configured,
      missing_env_vars: pimlicoStatus.missing,
    },
    opensea: {
      configured: openseaConfigured,
    },
    smart_account_address: smartAccountAddress,
    recent_mints_count: getRecentMints().length,
    recent_mints: getRecentMints().slice(0, 10),
    next_actions: pimlicoStatus.missing.length
      ? `Set these env vars in Vercel: ${pimlicoStatus.missing.join(', ')}`
      : 'Bot is configured. Trigger a scan via /api/sniper/scan or wait for cron.',
  });
}

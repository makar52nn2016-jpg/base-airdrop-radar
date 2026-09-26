import { getTopAirdrops } from '@/lib/radar';

/**
 * Farcaster Frame POST handler.
 *
 * State machine:
 *   "initial"   → list view (3 buttons, each goes to detail:N-1)
 *   "detail:N" → campaign N detail view
 *                 - button 1 (link action): open campaign URL — no POST
 *                 - button 2 (post): go to detail:(N+1)%3  [Next]
 *                 - button 3 (post): go to "initial"     [Back]
 *
 * Warpcast POST body format:
 *   - JSON: { untrustedData: { buttonIndex, state }, trustedData }
 *   - Form-encoded: untrustedData[buttonIndex]=1&untrustedData[state]=initial
 */
export async function POST(request: Request) {
  const { state, buttonIndex } = await parseFrameRequest(request);
  const campaigns = getTopAirdrops(3);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://base-airdrop-radar.vercel.app';

  let html: string;

  if (state.startsWith('detail:')) {
    const idx = parseInt(state.split(':')[1], 10);

    if (buttonIndex === 2) {
      // "Next" — advance to next campaign
      const nextIdx = (idx + 1) % campaigns.length;
      html = renderDetail(campaigns[nextIdx], nextIdx, baseUrl);
    } else {
      // buttonIndex === 3 ("Back") or default — return to list
      html = renderList(campaigns, baseUrl);
    }
  } else {
    // "initial" or unknown — button N selects campaign N-1
    const idx = Math.max(0, Math.min(campaigns.length - 1, buttonIndex - 1));
    html = renderDetail(campaigns[idx], idx, baseUrl);
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

async function parseFrameRequest(request: Request): Promise<{ state: string; buttonIndex: number }> {
  const contentType = request.headers.get('content-type') || '';
  const fallback = { state: 'initial', buttonIndex: 1 };

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      return {
        state: String(body?.untrustedData?.state ?? 'initial'),
        buttonIndex: Number(body?.untrustedData?.buttonIndex ?? 1),
      };
    }
    // form-encoded
    const text = await request.text();
    const params = new URLSearchParams(text);
    return {
      state: params.get('untrustedData[state]') ?? params.get('state') ?? 'initial',
      buttonIndex: Number(params.get('untrustedData[buttonIndex]') ?? params.get('buttonIndex') ?? 1),
    };
  } catch {
    return fallback;
  }
}

function renderList(campaigns: ReturnType<typeof getTopAirdrops>, baseUrl: string): string {
  const buttons = campaigns
    .map((c, i) => {
      const n = i + 1;
      return `
      <meta property="fc:frame:button:${n}" content="${escapeAttr(c.name)}" />
      <meta property="fc:frame:button:${n}:action" content="post" />
      <meta property="fc:frame:button:${n}:target" content="${baseUrl}/api/frame" />`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta property="fc:frame" content='${JSON.stringify({ version: 'vNext' })}' />
<meta property="fc:frame:image" content="${baseUrl}/api/og" />
<meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
<meta property="og:image" content="${baseUrl}/api/og" />
<meta property="og:title" content="Base Airdrop Radar — Top 3 gasless campaigns" />
<meta property="fc:frame:state" content="initial" />
${buttons}
<meta property="fc:frame:button:4" content="☕ Tip 0.001 ETH" />
<meta property="fc:frame:button:4:action" content="tx" />
<meta property="fc:frame:button:4:target" content="${baseUrl}/api/tip" />
</head>
<body>
<h1>Base Airdrop Radar</h1>
<p>Tap a campaign below to see details.</p>
</body></html>`;
}

function renderDetail(
  campaign: ReturnType<typeof getTopAirdrops>[number],
  idx: number,
  baseUrl: string
): string {
  const nextIdx = (idx + 1) % 3;
  const campaigns = getTopAirdrops(3);
  const nextCampaign = campaigns[nextIdx];
  const imageUrl = `${baseUrl}/api/og?highlight=${encodeURIComponent(campaign.id)}`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta property="fc:frame" content='${JSON.stringify({ version: 'vNext' })}' />
<meta property="fc:frame:image" content="${imageUrl}" />
<meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:title" content="${escapeAttr(campaign.name)} — Base Airdrop Radar" />
<meta property="fc:frame:button:1" content="Open ${escapeAttr(campaign.protocol)} ↗" />
<meta property="fc:frame:button:1:action" content="link" />
<meta property="fc:frame:button:1:target" content="${campaign.url}?ref=base-airdrop-radar" />
<meta property="fc:frame:button:2" content="Next: ${escapeAttr(nextCampaign.name)} →" />
<meta property="fc:frame:button:2:action" content="post" />
<meta property="fc:frame:button:2:target" content="${baseUrl}/api/frame" />
<meta property="fc:frame:button:3" content="← Back to list" />
<meta property="fc:frame:button:3:action" content="post" />
<meta property="fc:frame:button:3:target" content="${baseUrl}/api/frame" />
<meta property="fc:frame:state" content="detail:${idx}" />
</head>
<body>
<h1>${escapeHtml(campaign.name)}</h1>
<p>${escapeHtml(campaign.action)}</p>
<p>Difficulty: ${'●'.repeat(campaign.difficulty)}${'○'.repeat(5 - campaign.difficulty)} · Time: ${campaign.timePerWeek}m/week · Capital: $${campaign.capitalRequired}</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

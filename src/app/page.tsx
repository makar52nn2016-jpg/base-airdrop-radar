import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { getTopAirdrops } from '@/lib/radar';
import { RadarCard } from '@/components/radar-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Rocket, Zap, ShieldCheck, Clock } from 'lucide-react';

/**
 * Detects the public base URL from headers (works on Vercel + most reverse proxies).
 * Falls back to NEXT_PUBLIC_BASE_URL env var, then to localhost for dev.
 */
async function getBaseUrl(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (envUrl) return envUrl;

  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host');
  const proto = headersList.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  if (host) return `${proto}://${host}`;

  return 'http://localhost:3000';
}

/**
 * Frame metadata — the initial state of the Farcaster Frame when cast.
 * Same as the POST handler's renderList() output, but rendered via Next.js Metadata API.
 */
export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = await getBaseUrl();
  const campaigns = getTopAirdrops(3);
  const imageUrl = `${baseUrl}/api/og`;

  // Farcaster Frame vNext spec — meta tags via `other` field.
  const other: Record<string, string> = {
    'fc:frame': JSON.stringify({ version: 'vNext' }),
    'fc:frame:image': imageUrl,
    'fc:frame:image:aspect_ratio': '1.91:1',
    'fc:frame:state': 'initial',
  };

  campaigns.forEach((c, i) => {
    const n = i + 1;
    other[`fc:frame:button:${n}`] = c.name;
    other[`fc:frame:button:${n}:action`] = 'post';
    other[`fc:frame:button:${n}:target`] = `${baseUrl}/api/frame`;
  });

  return {
    title: 'Base Airdrop Radar — Top 3 gasless campaigns, updated weekly',
    description:
      'Hand-curated list of the 3 highest-ROI gasless airdrop campaigns on Base right now. Tap to explore, no ETH required.',
    openGraph: {
      title: 'Base Airdrop Radar',
      description: 'Top 3 gasless campaigns on Base, updated weekly.',
      images: [{ url: imageUrl, width: 1200, height: 628 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Base Airdrop Radar',
      description: 'Top 3 gasless campaigns on Base, updated weekly.',
      images: [imageUrl],
    },
    other,
  };
}

export default async function Home() {
  const campaigns = getTopAirdrops(3);

  return (
    <main className="min-h-screen bg-[#0a0b14] text-white flex flex-col">
      {/* Hero */}
      <section className="border-b border-[#1f2233] bg-gradient-to-b from-[#0d1020] to-[#0a0b14]">
        <div className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 max-w-5xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#0052ff] to-[#00d4ff] flex items-center justify-center text-2xl font-bold">
              ◉
            </div>
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-[#00d4ff]">
                Live · Updated weekly
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight">
                Base Airdrop Radar
              </h1>
            </div>
          </div>

          <p className="text-lg sm:text-xl text-[#a0a8bc] max-w-2xl mb-8 leading-relaxed">
            The 3 highest-ROI gasless airdrop campaigns on Base right now. Sorted by
            effort-to-reward ratio. All entries work with{' '}
            <span className="text-[#00d4ff] font-semibold">$0 starting capital</span> — gas is
            sponsored by CDP Paymaster.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex items-center gap-2 text-sm text-[#7a8295]">
              <ShieldCheck className="w-4 h-4 text-[#00ff88]" />
              <span>$0 capital</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#7a8295]">
              <Zap className="w-4 h-4 text-[#ffaa00]" />
              <span>Gasless</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#7a8295]">
              <Clock className="w-4 h-4 text-[#00d4ff]" />
              <span>~10 min/week</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#7a8295]">
              <Rocket className="w-4 h-4 text-[#ff0088]" />
              <span>Updated weekly</span>
            </div>
          </div>
        </div>
      </section>

      {/* Radar cards */}
      <section className="flex-1">
        <div className="container mx-auto px-4 sm:px-6 py-10 max-w-5xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl sm:text-2xl font-bold">Top 3 this week</h2>
            <span className="text-xs font-mono text-[#5a6178]">
              Last verified: {campaigns[0]?.lastVerified}
            </span>
          </div>

          <div className="grid gap-4 sm:gap-5">
            {campaigns.map((c, i) => (
              <RadarCard key={c.id} campaign={c} rank={i + 1} />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[#1f2233] bg-[#0d1020]">
        <div className="container mx-auto px-4 sm:px-6 py-10 max-w-5xl">
          <h2 className="text-xl sm:text-2xl font-bold mb-6">How to use this radar</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                step: '1',
                title: 'Tap a campaign',
                body: 'Open the Farcaster Frame or the card above. You\'ll see what to do, how long it takes, and the direct link.',
              },
              {
                step: '2',
                title: 'Use CDP Smart Wallet',
                body: 'Create a Coinbase Developer Platform smart wallet — free, no ETH needed. CDP Paymaster covers every transaction fee.',
              },
              {
                step: '3',
                title: 'Repeat weekly',
                body: 'Most campaigns reward consistency. Spend 10-15 minutes a week per campaign and you\'re qualified for the next airdrop snapshot.',
              },
            ].map((s) => (
              <Card key={s.step} className="bg-[#13151f] border-[#1f2233]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#0052ff] flex items-center justify-center font-bold">
                      {s.step}
                    </div>
                    <CardTitle className="text-base">{s.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-[#a0a8bc] leading-relaxed">{s.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-8 p-4 rounded-lg bg-[#1a1d2e] border border-[#2a2e44]">
            <p className="text-sm text-[#7a8295] leading-relaxed">
              <span className="text-[#ffaa00] font-semibold">⚠ Risk disclaimer:</span> Past
              airdrops do not guarantee future ones. Treat this as a side activity with low
              opportunity cost — never invest money you can't afford to lose. Always verify
              campaigns on the official protocol site before signing anything.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1f2233] py-6">
        <div className="container mx-auto px-4 sm:px-6 max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#5a6178]">
          <div>Base Airdrop Radar · Not affiliated with Coinbase or Base</div>
          <div className="font-mono">Built with Next.js 16 + Farcaster Frames</div>
        </div>
      </footer>
    </main>
  );
}

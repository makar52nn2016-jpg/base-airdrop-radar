import Link from 'next/link';
import { ArrowUpRight, Clock, DollarSign, Activity } from 'lucide-react';
import type { AirdropCampaign } from '@/lib/radar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface RadarCardProps {
  campaign: AirdropCampaign;
  rank: number;
}

const RANK_COLORS = ['#00d4ff', '#00ff88', '#ffaa00', '#ff0088'];

export function RadarCard({ campaign, rank }: RadarCardProps) {
  const accent = RANK_COLORS[rank - 1] ?? RANK_COLORS[0];

  return (
    <Card
      className="bg-[#13151f] border-[#1f2233] hover:border-[#2a2e44] transition-colors overflow-hidden"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className="text-3xl font-extrabold shrink-0"
              style={{ color: accent }}
            >
              #{rank}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="text-lg font-bold truncate">{campaign.name}</h3>
                <Badge
                  variant="secondary"
                  className="text-[10px] uppercase tracking-wide bg-[#1f2233] text-[#7a8295] border-0"
                >
                  {campaign.category}
                </Badge>
              </div>
              <div className="text-sm text-[#5a6178]">
                {campaign.protocol} · Verified {campaign.lastVerified}
              </div>
            </div>
          </div>

          <Button
            asChild
            size="sm"
            className="bg-[#0052ff] hover:bg-[#0040cc] text-white shrink-0"
          >
            <Link href={`${campaign.url}?ref=base-airdrop-radar`} target="_blank" rel="noopener noreferrer">
              Open
              <ArrowUpRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#5a6178] mb-1">
            What to do
          </div>
          <p className="text-sm text-[#e0e6f5] leading-relaxed">{campaign.action}</p>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#5a6178] mb-1">
            Why this might airdrop
          </div>
          <p className="text-sm text-[#a0a8bc] leading-relaxed">{campaign.rationale}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#1f2233]">
          <div className="flex items-center gap-2">
            <DollarSign className="w-3 h-3 text-[#00ff88]" />
            <div>
              <div className="text-[10px] text-[#5a6178] uppercase">Capital</div>
              <div className="text-sm font-semibold text-[#00ff88]">
                ${campaign.capitalRequired}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-[#00d4ff]" />
            <div>
              <div className="text-[10px] text-[#5a6178] uppercase">Time</div>
              <div className="text-sm font-semibold text-[#00d4ff]">
                {campaign.timePerWeek}m/wk
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-[#ffaa00]" />
            <div>
              <div className="text-[10px] text-[#5a6178] uppercase">Difficulty</div>
              <div className="text-sm font-mono font-semibold text-[#ffaa00] tracking-wider">
                {'●'.repeat(campaign.difficulty)}
                <span className="text-[#3a4159]">
                  {'○'.repeat(5 - campaign.difficulty)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

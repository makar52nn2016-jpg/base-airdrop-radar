import { ImageResponse } from 'next/og';
import { getTopAirdrops } from '@/lib/radar';

export const runtime = 'edge';

/**
 * Generates the OG image for the Farcaster Frame.
 * 1200x628 (1.91:1 — standard Farcaster Frame aspect ratio).
 *
 * IMPORTANT: ImageResponse requires every <div> with multiple children
 * to have explicit `display: 'flex'` or `display: 'none'`. Single-text
 * divs are fine without it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const highlightId = url.searchParams.get('highlight');
  const campaigns = getTopAirdrops(3);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0a0b14',
          color: '#ffffff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '40px 50px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '28px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #0052ff 0%, #00d4ff 100%)',
                fontSize: '28px',
                fontWeight: 700,
              }}
            >
              ◉
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.5px' }}>
                BASE AIRDROP RADAR
              </div>
              <div style={{ fontSize: '16px', color: '#7a8295', marginTop: '2px' }}>
                Top 3 gasless campaigns · Updated weekly
              </div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 18px',
              backgroundColor: '#1a1d2e',
              borderRadius: '8px',
              fontSize: '14px',
              color: '#00d4ff',
              fontWeight: 600,
              border: '1px solid #2a2e44',
            }}
          >
            ● LIVE
          </div>
        </div>

        {/* Campaigns list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
          {campaigns.map((c, i) => {
            const isHighlighted = highlightId === c.id;
            const difficultyDots = '●'.repeat(c.difficulty) + '○'.repeat(5 - c.difficulty);
            const rankColor = i === 0 ? '#00d4ff' : i === 1 ? '#00ff88' : '#ffaa00';
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '20px',
                  padding: '18px 22px',
                  backgroundColor: isHighlighted ? '#1c2640' : '#13151f',
                  borderRadius: '12px',
                  border: isHighlighted
                    ? '1px solid #0052ff'
                    : '1px solid #1f2233',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontSize: '34px',
                    fontWeight: 800,
                    color: rankColor,
                    minWidth: '48px',
                  }}
                >
                  #{i + 1}
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ display: 'flex', fontSize: '22px', fontWeight: 700 }}>
                      {c.name}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        fontSize: '11px',
                        padding: '2px 8px',
                        backgroundColor: '#1f2233',
                        borderRadius: '4px',
                        color: '#7a8295',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {c.category}
                    </div>
                  </div>
                  <div style={{ display: 'flex', fontSize: '15px', color: '#a0a8bc' }}>
                    {c.action}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '4px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      fontSize: '12px',
                      color: '#00ff88',
                      fontWeight: 600,
                    }}
                  >
                    $0 · {c.timePerWeek}m/wk
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: '14px',
                      color: '#ffaa00',
                      letterSpacing: '2px',
                    }}
                  >
                    {difficultyDots}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid #1f2233',
            fontSize: '14px',
            color: '#5a6178',
          }}
        >
          <div style={{ display: 'flex' }}>
            Tap buttons below to explore each campaign →
          </div>
          <div style={{ display: 'flex', color: '#00d4ff', fontWeight: 600 }}>
            base-airdrop-radar.app
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 628,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    }
  );
}

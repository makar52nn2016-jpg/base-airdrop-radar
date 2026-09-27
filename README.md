# Base Airdrop Radar

A Farcaster Frame + landing page that surfaces the **3 highest-ROI gasless airdrop campaigns on Base**, hand-curated weekly. All entries work with **$0 starting capital** — gas is sponsored by CDP Paymaster.

Built with Next.js 16, TypeScript, Tailwind, and Farcaster Frames vNext.

## Features

- **Landing page** at `/` — full UI with detailed campaign cards, how-it-works section, risk disclaimer.
- **Farcaster Frame** — cast any URL of this site in Warpcast and users get an interactive Frame with 3 buttons (one per campaign) → click → see details → click "Open" → goes to protocol with `?ref=base-airdrop-radar`.
- **Dynamic OG image** at `/api/og` — 1200×628 PNG generated via `next/og`. Highlights the selected campaign via `?highlight=<id>` query param.
- **Frame POST handler** at `/api/frame` — implements a simple state machine: `initial` ↔ `detail:N` with next/back navigation.

## Quick deploy (5 minutes)

### Prerequisites
- GitHub account (free)
- Vercel account (free — sign up with GitHub)
- Farcaster account (free — Warpcast app on iOS/Android/desktop)

### Steps
1. **Fork or push this repo to your GitHub** (see "Push from sandbox" below).
2. Go to [vercel.com/new](https://vercel.com/new), import the GitHub repo.
3. Vercel auto-detects Next.js. Leave defaults. Click **Deploy**.
4. After deploy (1-2 minutes), set the production URL as an env var:
   - Settings → Environment Variables
   - Key: `NEXT_PUBLIC_BASE_URL`
   - Value: your Vercel URL (e.g. `https://base-airdrop-radar.vercel.app`)
   - Apply to Production + Preview + Development
   - Redeploy (Deployments → ⋮ → Redeploy)
5. Open Warpcast → compose → paste your root URL → cast. Frame renders inline.

### Push from sandbox
```bash
cd /home/z/my-project
git init
git add .
git commit -m "Initial commit — Base Airdrop Radar"
git branch -M main
git remote add origin https://github.com/<your-username>/base-airdrop-radar.git
git push -u origin main
```

## Local development
```bash
bun install
bun run dev
# Open http://localhost:3000
```

## Updating the radar

Edit `src/lib/radar.ts` and update the `CAMPAIGNS` array. The OG image, landing page, and Frame will pick up changes automatically on next deploy.

Each entry needs:
- `id` — unique slug
- `name`, `protocol`, `category` — display fields
- `action` — what user actually does (imperative, short)
- `rationale` — why this might airdrop (1 sentence)
- `difficulty` 1-5 (1 = trivial, 5 = expert)
- `capitalRequired` — USD amount (filter for $0 only)
- `timePerWeek` — minutes of weekly activity
- `url` — official protocol URL (your referral params are auto-appended)
- `lastVerified` — ISO date (YYYY-MM-DD)
- `referenceUrl` — DeFiLlama / CoinGecko / docs URL

## Monetization paths

1. **Referral params** — all "Open" buttons append `?ref=base-airdrop-radar`. Replace with your own referral code in `src/lib/radar.ts` to earn signup bonuses from Coinbase/CDP/Morpho/Aerodrome.
2. **Tips in Frame** — Warpcast users can tip in $DEGEN, $HAM, $ETH. Add a mint or post button to capture tips.
3. **Promoted placement** — once you have traffic, charge protocols for top-3 slots.

## Risk disclaimer

Past airdrops do not guarantee future ones. This is a side activity with low opportunity cost — never invest money you can't afford to lose. Always verify campaigns on the official protocol site before signing anything.

## License

MIT — fork it, ship it, monetize it.

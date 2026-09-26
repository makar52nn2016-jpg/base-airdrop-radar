---
Task ID: 1
Agent: main (Super Z)
Task: Build a Farcaster Frame + landing page for "Base Airdrop Radar" — top-3 gasless airdrop campaigns on Base, deployable to Vercel from iPhone in <3 hours.

Work Log:
- Initialized Next.js 16 + Tailwind + shadcn/ui project via fullstack-dev skill.
- Created src/lib/radar.ts — data module with 3 hand-curated campaigns (Morpho, Aerodrome, Base Name Service).
- Created src/app/api/og/route.tsx — dynamic OG image (1200×628 PNG) using next/og. Highlights selected campaign via ?highlight=<id>.
- Created src/app/api/frame/route.ts — POST handler implementing state machine (initial ↔ detail:N with next/back navigation).
- Rewrote src/app/page.tsx — landing page with hero, 3 RadarCard components, how-it-works section, risk disclaimer, footer. Includes generateMetadata that injects all fc:frame:* meta tags via Next.js Metadata API `other` field.
- Created src/components/radar-card.tsx — campaign card UI with rank, action, rationale, capital/time/difficulty stats.
- Updated src/app/layout.tsx — removed Z.ai branding, set Inter + JetBrains Mono fonts, set page-level metadata.
- Created vercel.json — Next.js framework config with 512MB memory for OG image generation.
- Created README.md — quick deploy guide + radar update instructions + monetization paths.

Verified:
- Lint passes (bun run lint — no errors).
- Home page returns 200, contains 24 fc:frame meta tags, all 3 campaign names, all key UI sections.
- /api/og returns 200 PNG (1200×628, ~62KB) with and without ?highlight param.
- /api/frame POST returns 200 with valid HTML containing fc:frame:button:1-3 for initial state, fc:frame:button:1 (link) + button:2 (next) + button:3 (back) for detail state.
- State machine verified: initial+button1 → detail:0; detail:0+button2 → detail:1; etc.

Stage Summary:
- Project ready at /home/z/my-project/
- All endpoints functional, no runtime errors
- Awaiting user's GitHub username + Personal Access Token to push to their repo
- After push, user will connect repo to Vercel, set NEXT_PUBLIC_BASE_URL env var, redeploy, then cast root URL in Warpcast
- Click tracking via Supabase intentionally deferred — v1 is fully functional without DB

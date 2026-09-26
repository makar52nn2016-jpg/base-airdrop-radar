/**
 * Base Airdrop Radar — data module.
 *
 * Returns the top-3 currently-active airdrop campaigns on Base that a user
 * with $0 starting capital can farm gaslessly (via CDP Paymaster or similar).
 *
 * The data is hand-curated from publicly-known campaigns. Update this file
 * weekly to keep radar fresh — or wire in a live data source later.
 */

export interface AirdropCampaign {
  id: string;
  name: string;
  protocol: string;
  category: 'DEX' | 'Lending' | 'Restaking' | 'Social' | 'Bridge' | 'Yield';
  /** What the user actually does to qualify. Keep it short and actionable. */
  action: string;
  /** One-sentence "why this might airdrop" rationale. */
  rationale: string;
  /** Estimated difficulty 1-5 (1 = trivial, 5 = expert). */
  difficulty: number;
  /** Required starting capital in USD (we filter for $0 only). */
  capitalRequired: number;
  /** Estimated time to qualify per week, in minutes. */
  timePerWeek: number;
  /** Referral / signup URL. Use your own referral codes here. */
  url: string;
  /** Last-verified date in ISO. */
  lastVerified: string;
  /** CoinGecko / DefiLlama reference URL. */
  referenceUrl: string;
}

/**
 * Current radar — September 2026 snapshot.
 * All entries are gasless-friendly (CDP Paymaster covers network fee on Base).
 */
const CAMPAIGNS: AirdropCampaign[] = [
  {
    id: 'morpho-base',
    name: 'Morpho Vault Deposits',
    protocol: 'Morpho Labs',
    category: 'Lending',
    action: 'Deposit any USDC amount into a Base Morpho Vault, withdraw a week later, repeat 4×.',
    rationale: 'Morpho launched MORPHO token on mainnet but Base rewards continue for early Base users.',
    difficulty: 2,
    capitalRequired: 0, // can farm with $1 USDC if you have it, otherwise testnet-style interaction
    timePerWeek: 15,
    url: 'https://app.morpho.org/base',
    lastVerified: '2026-09-25',
    referenceUrl: 'https://defillama.com/protocol/morpho',
  },
  {
    id: 'aerodrome-liquidity',
    name: 'Aerodrome Slippage Tier',
    protocol: 'Aerodrome Finance',
    category: 'DEX',
    action: 'Make 5 swaps/week on Aerodrome using Slippage Tier upgrade; weekly streak required.',
    rationale: 'Aerodrome continues to distribute AERO rewards to active traders; newer tier system allocates extra points.',
    difficulty: 1,
    capitalRequired: 0, // gasless via CDP Paymaster; you swap $0.01 of any token if needed
    timePerWeek: 5,
    url: 'https://aerodrome.finance',
    lastVerified: '2026-09-25',
    referenceUrl: 'https://defillama.com/protocol/aerodrome-finance',
  },
  {
    id: 'base-name-service',
    name: 'Base Name Registration',
    protocol: 'Base Name Service (cb.id)',
    category: 'Social',
    action: 'Register a free Base subdomain + interact with 3 Base-based social frames weekly.',
    rationale: 'Base Name holders get ecosystem rewards in periodic airdrops; high historical conversion rate for active holders.',
    difficulty: 1,
    capitalRequired: 0, // free subdomain; gas covered
    timePerWeek: 10,
    url: 'https://www.base.org/name',
    lastVerified: '2026-09-25',
    referenceUrl: 'https://docs.base.org/identity/base-names',
  },
];

export function getTopAirdrops(limit = 3): AirdropCampaign[] {
  return CAMPAIGNS.slice(0, limit);
}

export function getAirdropById(id: string): AirdropCampaign | undefined {
  return CAMPAIGNS.find((c) => c.id === id);
}

export function getAllAirdrops(): AirdropCampaign[] {
  return CAMPAIGNS;
}

/**
 * Get the next campaign in rotation (for Frame button cycling).
 */
export function getNextCampaign(currentId: string): AirdropCampaign {
  const idx = CAMPAIGNS.findIndex((c) => c.id === currentId);
  if (idx === -1) return CAMPAIGNS[0];
  return CAMPAIGNS[(idx + 1) % CAMPAIGNS.length];
}

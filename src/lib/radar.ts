/**
 * Base Airdrop Radar — data module (v2, verified campaigns).
 *
 * Real, currently-active campaigns on Base that a user with $0 starting
 * capital can farm gaslessly (via Coinbase Developer Platform Paymaster).
 *
 * All URLs are official protocol websites. Referral params are auto-appended
 * by the Frame POST handler for affiliate tracking.
 *
 * Last verified: 2026-09-26
 */

export interface AirdropCampaign {
  id: string;
  name: string;
  protocol: string;
  category: 'DEX' | 'Lending' | 'Identity' | 'Restaking' | 'Social';
  /** What the user actually does to qualify. Keep it short and actionable. */
  action: string;
  /** One-sentence "why this might airdrop" rationale. */
  rationale: string;
  /** Estimated difficulty 1-5 (1 = trivial, 5 = expert). */
  difficulty: number;
  /** Required starting capital in USD. */
  capitalRequired: number;
  /** Estimated time to qualify per week, in minutes. */
  timePerWeek: number;
  /** Official protocol URL. */
  url: string;
  /** Last-verified date in ISO. */
  lastVerified: string;
  /** Reference URL for verification (DeFiLlama / docs). */
  referenceUrl: string;
  /** Affiliate/referral tag appended as ?ref=<value>. */
  referralTag: string;
}

const CAMPAIGNS: AirdropCampaign[] = [
  {
    id: 'aerodrome-trading',
    name: 'Aerodrome Trading Rewards',
    protocol: 'Aerodrome Finance',
    category: 'DEX',
    action: 'Make 5+ swaps per week on Aerodrome. Stake slippage in AERO lockup for bonus emissions.',
    rationale:
      'Aerodrome is the #1 DEX on Base by volume. Active traders and AERO lockers get ongoing rewards; weekly streak required for snapshot eligibility.',
    difficulty: 1,
    capitalRequired: 0,
    timePerWeek: 10,
    url: 'https://aerodrome.finance',
    lastVerified: '2026-09-26',
    referenceUrl: 'https://defillama.com/protocol/aerodrome-finance',
    referralTag: 'base-radar',
  },
  {
    id: 'base-name-service',
    name: 'Free Base Name Registration',
    protocol: 'Base Name Service (cb.id)',
    category: 'Identity',
    action: 'Register a free <name>.base.eth subdomain, then use it to interact with 3+ Base apps weekly.',
    rationale:
      'Base Name holders historically get ecosystem airdrops and rewards. Free registration takes 30 seconds, no ETH needed (gas sponsored).',
    difficulty: 1,
    capitalRequired: 0,
    timePerWeek: 5,
    url: 'https://www.base.org/name',
    lastVerified: '2026-09-26',
    referenceUrl: 'https://docs.base.org/identity/base-names',
    referralTag: 'base-radar',
  },
  {
    id: 'cdp-gasless-credits',
    name: 'CDP Gasless Credits ($15k)',
    protocol: 'Coinbase Developer Platform',
    category: 'Social',
    action: 'Create a CDP Smart Wallet, deploy one Frame or one Base transaction. Get up to $15,000 gas credits.',
    rationale:
      'Coinbase is actively funding Base onboarding. Developer accounts get generous gas credits, plus all your users get gasless transactions.',
    difficulty: 2,
    capitalRequired: 0,
    timePerWeek: 30,
    url: 'https://www.coinbase.com/developer-platform',
    lastVerified: '2026-09-26',
    referenceUrl: 'https://docs.cdp.coinbase.com/',
    referralTag: 'base-radar',
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

export function getNextCampaign(currentId: string): AirdropCampaign {
  const idx = CAMPAIGNS.findIndex((c) => c.id === currentId);
  if (idx === -1) return CAMPAIGNS[0];
  return CAMPAIGNS[(idx + 1) % CAMPAIGNS.length];
}

export function getCampaignByIndex(idx: number): AirdropCampaign {
  return CAMPAIGNS[idx % CAMPAIGNS.length];
}

import { getCollectionDetail } from '@/lib/opensea';

/**
 * Quality filter — skips contracts that look like spam/low-quality.
 *
 * Heuristics:
 *   1. Collection has no image_url (most legit collections have logo)
 *   2. Collection has no description (most legit collections describe themselves)
 *   3. Name contains obvious spam keywords ("test", "spam", "fake", "scam", "airdrop claim free")
 *   4. Collection is disabled or NSFW on OpenSea
 *
 * Returns true if contract looks spammy (should skip).
 */

const SPAM_NAME_KEYWORDS = [
  'test',
  'spam',
  'fake',
  'scam',
  'phishing',
  'free claim', // common spam pattern
  'unlimited',
  'mint anything',
  '1000000',
  '0000000',
];

export interface QualityCheckResult {
  isSpam: boolean;
  reason?: string;
  floorPrice?: number | null;
  collectionName?: string;
  collectionImage?: string | null;
}

/**
 * Checks if a contract looks like a legitimate free-mint collection.
 *
 * Uses OpenSea collection detail API (requires the slug or contract address).
 *
 * @param slugOrContract — collection slug or contract address
 * @param skipFloorCheck — if true, doesn't require floor price > 0 (useful for new collections)
 */
export async function checkContractQuality(
  slug?: string
): Promise<QualityCheckResult> {
  if (!slug) {
    // No slug provided — can't check OpenSea, allow by default
    return { isSpam: false };
  }

  try {
    const detail = await getCollectionDetail(slug);
    if (!detail) {
      return { isSpam: false }; // unknown — allow
    }

    // Check 1: disabled or NSFW
    if (detail.is_disabled) {
      return { isSpam: true, reason: 'Collection disabled on OpenSea' };
    }
    if (detail.is_nsfw) {
      return { isSpam: true, reason: 'NSFW collection' };
    }

    // Check 2: name spam keywords
    const nameLower = (detail.name || '').toLowerCase();
    for (const kw of SPAM_NAME_KEYWORDS) {
      if (nameLower.includes(kw)) {
        return { isSpam: true, reason: `Name contains spam keyword: "${kw}"` };
      }
    }

    // Check 3: no image AND no description — likely spam
    if (!detail.image_url && !detail.description) {
      return { isSpam: true, reason: 'No image and no description' };
    }

    return {
      isSpam: false,
      floorPrice: detail.floor_price ?? null,
      collectionName: detail.name,
      collectionImage: detail.image_url,
    };
  } catch (e) {
    // OpenSea API error — allow (don't block mints on API failures)
    return { isSpam: false };
  }
}

/**
 * Faster check: just looks at collection name for spam keywords.
 * No OpenSea API call — used as pre-filter before minting.
 */
export function isSpammyName(name: string): boolean {
  const nameLower = (name || '').toLowerCase();
  return SPAM_NAME_KEYWORDS.some((kw) => nameLower.includes(kw));
}

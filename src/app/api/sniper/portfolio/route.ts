import { NextResponse } from 'next/server';
import { getAccountNFTs } from '@/lib/opensea';
import { getSmartAccountAddressForChain } from '@/lib/sniper';
import { CHAIN_CONFIGS, ALL_CHAINS, isPimlicoConfigured } from '@/lib/pimlico';
import { isOpenSeaConfigured } from '@/lib/opensea';

/**
 * GET /api/sniper/portfolio
 *
 * Returns all NFTs currently owned by all 5 Smart Accounts (one per chain).
 * Uses OpenSea API — fetches from on-chain state, so PERSISTENT across
 * Vercel cold starts (unlike in-memory activity log).
 *
 * This is the REAL portfolio — what the bot has actually minted.
 *
 * Response:
 *   {
 *     total_nfts: number,
 *     per_chain: { base: NFT[], optimism: NFT[], ... },
 *     all_nfts: NFT[]
 *   }
 */
export async function GET() {
  if (!isOpenSeaConfigured()) {
    return NextResponse.json(
      { error: 'OpenSea API not configured' },
      { status: 500 }
    );
  }

  const pimlicoStatus = isPimlicoConfigured();
  if (!pimlicoStatus.configured) {
    return NextResponse.json(
      { error: `Pimlico not configured: ${pimlicoStatus.missing.join(', ')}` },
      { status: 500 }
    );
  }

  const perChain: Record<string, any[]> = {};
  const allNFTs: any[] = [];
  let totalNfts = 0;

  // For each chain, get Smart Account address + fetch its NFTs from OpenSea
  for (const chainKey of ALL_CHAINS) {
    try {
      const smartAccountAddress = await getSmartAccountAddressForChain(chainKey);
      const chainConfig = CHAIN_CONFIGS[chainKey];

      // Use OpenSea chain identifier (e.g. 'base', 'optimism', 'matic' for polygon)
      const nfts = await getAccountNFTs(smartAccountAddress, chainConfig.openSeaChain, 50);

      perChain[chainKey] = nfts.map((nft) => ({
        ...nft,
        smart_account: smartAccountAddress,
        chain_key: chainKey,
      }));

      allNFTs.push(...perChain[chainKey]);
      totalNfts += nfts.length;
    } catch (err: any) {
      perChain[chainKey] = [];
      // Continue to next chain
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    total_nfts: totalNfts,
    per_chain: perChain,
    all_nfts: allNFTs,
    smart_accounts: ALL_CHAINS.reduce((acc, chainKey) => {
      // We'll populate this on the client side using the per_chain data
      return acc;
    }, {} as Record<string, string>),
  });
}

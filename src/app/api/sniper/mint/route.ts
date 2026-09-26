import { NextResponse } from 'next/server';
import { executeMint, type MintCandidate } from '@/lib/sniper';

/**
 * POST /api/sniper/mint
 *
 * Executes a mint for a given candidate. Body must contain candidate fields:
 *   { slug, name, contract, functionName, args, ... }
 *
 * The mint is sponsored by Pimlico Paymaster — no ETH needed on Smart Account.
 *
 * Returns: { success, txHash?, smartAccountAddress?, error? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<MintCandidate>;
    if (!body.contract || !body.functionName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: contract, functionName' },
        { status: 400 }
      );
    }

    const candidate: MintCandidate = {
      slug: body.slug || 'manual',
      name: body.name || 'Unknown',
      contract: body.contract,
      functionName: body.functionName,
      args: body.args || [],
      detectedAt: body.detectedAt || new Date().toISOString(),
      image_url: body.image_url || null,
      opensea_url: body.opensea_url || null,
    };

    const result = await executeMint(candidate);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

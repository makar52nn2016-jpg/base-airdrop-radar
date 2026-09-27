import { NextResponse } from 'next/server';
import { findFreeMintFunction } from '@/lib/basescan';
import { executeMint } from '@/lib/sniper';

/**
 * POST /api/sniper/manual
 *
 * Manually trigger a mint for a given contract address.
 * Useful when user finds a free-mint opportunity on Twitter/Farcast
 * and wants the bot to execute it gaslessly.
 *
 * Body:
 *   { "contract": "0xabc...", "slug": "optional-slug", "name": "Optional Name" }
 *
 * Pipeline:
 *   1. Detect free-mint function on the contract (static call, no gas)
 *   2. If found, execute mint via Pimlico Smart Account + Paymaster (gasless)
 *   3. Return result with txHash
 *
 * If no free-mint function found, returns success=false with diagnostic info.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const contract = (body.contract || body.address || '').toString().trim();

    if (!contract || !contract.startsWith('0x') || contract.length !== 42) {
      return NextResponse.json(
        { success: false, error: 'Invalid contract address. Must be 0x + 40 hex chars.' },
        { status: 400 }
      );
    }

    // Step 1: Detect free-mint function
    console.log(`[manual] Detecting free-mint on ${contract}...`);
    const detected = await findFreeMintFunction(contract);
    if (!detected) {
      return NextResponse.json({
        success: false,
        contract,
        error: 'No free-mint function detected. Contract may use paid mint, owner-only mint, or custom function name.',
        suggestions: [
          'Check the contract on Basescan to see actual mint function name.',
          'If the contract uses a paid mint, the bot will skip it (gasless only).',
          'For non-standard mint functions, you may need to call it manually via ethers.js.',
        ],
      });
    }

    // Step 2: Execute mint via Pimlico
    const candidate = {
      slug: body.slug || 'manual',
      name: body.name || `Manual ${contract.slice(0, 8)}`,
      contract,
      functionName: detected.functionName,
      args: detected.args,
      detectedAt: new Date().toISOString(),
      image_url: null,
      opensea_url: `https://opensea.io/assets/base/${contract}`,
    };

    console.log(
      `[manual] Found free-mint: ${detected.functionName}(${detected.args.join(', ')}). Executing...`
    );
    const result = await executeMint(candidate);
    return NextResponse.json({
      ...result,
      detected_function: detected.functionName,
      detected_args: detected.args,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sniper/manual?contract=0x...
 *
 * Same as POST but via query param — easier for testing in browser.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const contract = url.searchParams.get('contract');
  if (!contract) {
    return NextResponse.json({
      usage: 'GET /api/sniper/manual?contract=0x...',
      description: 'Manually trigger a free-mint on the given contract.',
      note: 'Bot will detect free-mint function via static-call, then execute via Pimlico (gasless).',
      example: '/api/sniper/manual?contract=0x1234567890abcdef...',
    });
  }
  // Convert GET to POST-like flow
  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract }),
    })
  );
}

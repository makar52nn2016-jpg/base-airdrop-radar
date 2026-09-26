/**
 * Farcaster Frame tx-action endpoint.
 *
 * When user clicks the "Tip ☕" button in Warpcast, Warpcast POSTs here
 * to get the transaction spec. We return a simple ETH transfer to the
 * configured wallet.
 *
 * Set RECIPIENT_ETH_ADDRESS in Vercel env vars to your own wallet.
 * Falls back to the address set at build time below.
 */

const RECIPIENT_ADDRESS =
  process.env.RECIPIENT_ETH_ADDRESS || '0x30450A8B96535e4ee1897f1E59ff2556f6191bcc';
const TIP_AMOUNT_ETH = '0.001';
const TIP_AMOUNT_WEI = BigInt(Number(TIP_AMOUNT_ETH) * 1e18).toString();

// Base mainnet = eip155:8453. Change to eip155:1 for Ethereum mainnet.
const CHAIN_ID = 'eip155:8453';

export async function POST(_request: Request) {
  const responseBody = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction' as const,
    attribution: {
      action: 'tip',
      state: 'tip',
    },
    params: {
      abi: [],
      to: RECIPIENT_ADDRESS,
      value: TIP_AMOUNT_WEI,
      data: '0x',
    },
  };

  return new Response(JSON.stringify(responseBody), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function GET() {
  return new Response(
    JSON.stringify(
      {
        description: 'Farcaster Frame tx-action endpoint',
        recipient: RECIPIENT_ADDRESS,
        amount_eth: TIP_AMOUNT_ETH,
        amount_wei: TIP_AMOUNT_WEI,
        chain: CHAIN_ID,
        usage:
          'POST to this endpoint from a Farcaster Frame tx action. ' +
          'Returns a transaction spec for a 0.001 ETH transfer to the recipient.',
      },
      null,
      2
    ),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

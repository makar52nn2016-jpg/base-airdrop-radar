/**
 * Farcaster Frame tx-action endpoint.
 *
 * Returns a transaction spec for an ETH transfer to the configured wallet.
 *
 * Spec compliance (per Warpcast Frames vNext validator):
 * - chainId: "eip155:<decimal>" (NOT hex)
 * - method: "eth_sendTransaction"
 * - params.to: hex address (with 0x prefix)
 * - params.value: hex string of wei amount (with 0x prefix)
 * - params.data: "0x" for simple ETH transfers
 * - params.abi: empty array for ETH transfers
 *
 * Query param `?amount=<eth>` selects tip tier:
 *   - 0.001 (default)  → 0x38d7ea4c68000 wei
 *   - 0.01            → 0x2386f26fc10000 wei
 *   - 0.05            → 0xb1a2bc2ec50000 wei
 */

const RECIPIENT_ADDRESS =
  process.env.RECIPIENT_ETH_ADDRESS || '0x30450A8B96535e4ee1897f1E59ff2556f6191bcc';

// Base mainnet = eip155:8453. Change to "eip155:1" for Ethereum mainnet.
const CHAIN_ID = 'eip155:8453';

// Pre-computed wei amounts (in hex with 0x prefix) for each tip tier.
const TIP_TIERS: Record<string, string> = {
  '0.001': '0x38d7ea4c68000', // 10^15 wei
  '0.01': '0x2386f26fc10000', // 10^16 wei
  '0.05': '0xb1a2bc2ec50000', // 5 * 10^16 wei
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const amountEth = url.searchParams.get('amount') || '0.001';
  const valueHex = TIP_TIERS[amountEth] || TIP_TIERS['0.001'];

  // Strict spec-compliant response. NO extra fields.
  const responseBody = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      abi: [],
      to: RECIPIENT_ADDRESS,
      value: valueHex,
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const amountEth = url.searchParams.get('amount') || '0.001';
  const valueHex = TIP_TIERS[amountEth] || TIP_TIERS['0.001'];

  return new Response(
    JSON.stringify(
      {
        description: 'Farcaster Frame tx-action endpoint',
        recipient: RECIPIENT_ADDRESS,
        amount_eth: amountEth,
        amount_wei_hex: valueHex,
        chain: CHAIN_ID,
        supported_tiers: Object.keys(TIP_TIERS),
        usage:
          'POST to this endpoint from a Farcaster Frame tx action. ' +
          'Optional ?amount=0.001|0.01|0.05 to select tip tier.',
      },
      null,
      2
    ),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

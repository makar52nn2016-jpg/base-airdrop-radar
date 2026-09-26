/**
 * Seaport Auto-Listing — automatically list minted NFTs on OpenSea
 *
 * Approach:
 *   1. After mint, NFT is in Smart Account (Safe v1.4.1)
 *   2. Construct Seaport order with offerer = Smart Account address
 *   3. Compute Seaport order hash (EIP-712 typed data)
 *   4. Sign the hash with EOA private key (Smart Account owner, threshold=1)
 *   5. Safe's isValidSignature verifies the signature came from an approved owner
 *   6. POST signed order to OpenSea API
 *   7. Order goes live on OpenSea at the specified price
 *
 * Required env vars:
 *   - SMART_ACCOUNT_ADDRESS (computed from signer at runtime)
 *   - SIGNER_PRIVATE_KEY (EOA that owns the Safe)
 *   - OPENSEA_API_KEY
 *
 * When NFT sells:
 *   - Buyer pays ETH to Smart Account
 *   - OpenSea transfers NFT to buyer
 *   - ETH stays in Smart Account (withdrawable to user's personal wallet)
 */

import { privateKeyToAccount } from 'viem/accounts';
import { signTypedData } from 'viem/accounts';
import { http, createWalletClient, createPublicClient } from 'viem';
import { getSmartAccountAddressForChain } from '@/lib/sniper';
import { getClientsForChain, CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';
import { sendTelegramMessage } from '@/lib/telegram';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

// Seaport 1.5 contract address (same on most EVM chains)
const SEAPORT_1_5_ADDRESS = '0x00000000000000ADc04C56B30aC47d4e9360DEd9';

// EIP-712 domain for Seaport
const SEAPORT_DOMAIN = {
  name: 'Seaport',
  version: '1.5',
  chainId: 0, // set per chain
  verifyingContract: SEAPORT_1_5_ADDRESS,
} as const;

// Seaport OrderComponents EIP-712 type
const ORDER_COMPONENTS_TYPE = [
  {
    name: 'consideration',
    type: 'ConsiderationComponent[]',
  },
  { name: 'offer', type: 'OfferComponent[]' },
  { name: 'counter', type: 'uint256' },
  { name: 'endTime', type: 'uint256' },
  { name: 'startTime', type: 'uint256' },
  { name: 'zoneHash', type: 'bytes32' },
  { name: 'salt', type: 'uint256' },
  { name: 'conduitKey', type: 'bytes32' },
  { name: 'zone', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'offerer', type: 'address' },
];

const OFFER_CONSIDERATION_TYPES = [
  { name: 'endAmount', type: 'uint256' },
  { name: 'startAmount', type: 'uint256' },
  { name: 'identifierOrCriteria', type: 'uint256' },
  { name: 'token', type: 'address' },
  { name: 'itemType', type: 'uint8' },
];

// ItemType enum values (Seaport 1.5)
const ItemType = {
  NATIVE: 0,
  ERC20: 1,
  ERC721: 2,
  ERC1155: 3,
  ERC721_WITH_CRITERIA: 4,
  ERC1155_WITH_CRITERIA: 5,
} as const;

/**
 * Creates a listing on OpenSea for an NFT owned by the Smart Account.
 *
 * @param nftContract ERC-721 or ERC-1155 contract address
 * @param tokenId NFT token ID
 * @param priceEth listing price in ETH (e.g. 0.01)
 * @param chainKey which chain the NFT is on
 * @param isErc1155 true if ERC-1155, false if ERC-721
 *
 * Returns { listingUrl, orderId } on success
 */
export async function createOpenSeaListing(opts: {
  nftContract: string;
  tokenId: string;
  priceEth: string;
  chainKey: ChainKey;
  isErc1155?: boolean;
  collectionName?: string;
}): Promise<{ listingUrl: string; success: boolean; error?: string }> {
  const { nftContract, tokenId, priceEth, chainKey, isErc1155, collectionName } = opts;

  if (!OPENSEA_API_KEY) {
    return { listingUrl: '', success: false, error: 'OPENSEA_API_KEY not set' };
  }

  const chainConfig = CHAIN_CONFIGS[chainKey];
  const smartAccountAddress = await getSmartAccountAddressForChain(chainKey);

  // Convert price to wei
  const priceWei = BigInt(Math.floor(Number(priceEth) * 1e18));

  // Order parameters
  const now = Math.floor(Date.now() / 1000);
  const startTime = now;
  const endTime = now + 30 * 24 * 60 * 60; // 30 days

  const offer = [
    {
      itemType: isErc1155 ? ItemType.ERC1155 : ItemType.ERC721,
      token: nftContract,
      identifierOrCriteria: BigInt(tokenId),
      startAmount: 1n,
      endAmount: 1n,
    },
  ];

  const consideration = [
    {
      itemType: ItemType.NATIVE,
      token: '0x0000000000000000000000000000000000000000',
      identifierOrCriteria: 0n,
      startAmount: priceWei,
      endAmount: priceWei,
      recipient: smartAccountAddress,
    },
  ];

  // Build EIP-712 typed data for signing
  const domain = {
    ...SEAPORT_DOMAIN,
    chainId: BigInt(chainConfig.chain.id),
  };

  const types = {
    OrderComponents: ORDER_COMPONENTS_TYPE,
    OfferComponent: OFFER_CONSIDERATION_TYPES,
    ConsiderationComponent: OFFER_CONSIDERATION_TYPES,
  };

  // Get Safe's current counter (nonce)
  const { publicClient: pc } = getClientsForChain(chainKey);
  let counter = 0n;
  try {
    // Read counter from Seaport for the Smart Account
    const counterResult = (await pc.readContract({
      address: SEAPORT_1_5_ADDRESS as `0x${string}`,
      abi: [
        {
          name: 'getCounter',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'offerer', type: 'address' }],
          outputs: [{ name: 'counter', type: 'uint256' }],
        },
      ] as any,
      functionName: 'getCounter',
      args: [smartAccountAddress as `0x${string}`],
    } as any)) as bigint;
    counter = counterResult;
  } catch {
    // Default to 0 if can't read
  }

  const orderComponents = {
    offerer: smartAccountAddress,
    zone: '0x0000000000000000000000000000000000000000',
    recipient: smartAccountAddress,
    conduitKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
    startTime: BigInt(startTime),
    endTime: BigInt(endTime),
    salt: BigInt(Math.floor(Math.random() * 1000000)),
    counter,
    offer,
    consideration,
    zoneHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  };

  // Sign with EOA private key (Smart Account owner)
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;
  if (!signerPrivateKey) {
    return { listingUrl: '', success: false, error: 'SIGNER_PRIVATE_KEY not set' };
  }

  const signer = privateKeyToAccount(signerPrivateKey);

  // Sign the EIP-712 typed data
  let signature: `0x${string}`;
  try {
    signature = await signTypedDataWithAccount(
      signer,
      {
        domain,
        types,
        primaryType: 'OrderComponents',
        message: orderComponents as any,
      },
      chainConfig.rpcUrl
    );
  } catch (e: any) {
    return { listingUrl: '', success: false, error: `Signing failed: ${e.message}` };
  }

  // Build the full order to POST to OpenSea
  const fullOrder = {
    parameters: orderComponents,
    signature,
  };

  // POST to OpenSea API
  try {
    const postUrl = `${OPENSEA_API_BASE}/orders/${chainConfig.openSeaChain}/seaport/${SEAPORT_1_5_ADDRESS}`;
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'X-API-KEY': OPENSEA_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fullOrder),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errText = await response.text();
      return { listingUrl: '', success: false, error: `OpenSea API ${response.status}: ${errText.slice(0, 200)}` };
    }

    const result = await response.json();
    const listingUrl = `https://opensea.io/assets/${chainConfig.openSeaChain}/${nftContract}/${tokenId}`;

    // Send Telegram notification about successful listing
    const msg = `🚀 *NFT LISTED for sale!*

📦 *Collection:* ${collectionName || nftContract.slice(0, 10)}
🎫 *Token ID:* \`${tokenId}\`
💰 *Price:* ${priceEth} ETH
⛓ *Chain:* ${chainKey}

🌐 *[View listing on OpenSea](${listingUrl})*

👤 Smart Account: \`${smartAccountAddress}\``;

    await sendTelegramMessage(msg);

    return { listingUrl, success: true };
  } catch (e: any) {
    return { listingUrl: '', success: false, error: `POST failed: ${e.message}` };
  }
}

/**
 * Helper: sign EIP-712 typed data using a private key account.
 * Uses viem's signTypedData internally.
 */
async function signTypedDataWithAccount(
  account: ReturnType<typeof privateKeyToAccount>,
  data: {
    domain: any;
    types: any;
    primaryType: string;
    message: any;
  },
  _rpcUrl: string
): Promise<`0x${string}`> {
  // viem's account.signTypedData handles EIP-712 signing locally (no RPC needed)
  return await account.signTypedData(data);
}

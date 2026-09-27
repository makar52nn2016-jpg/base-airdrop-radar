/**
 * Price-aware Free Mint Detector.
 *
 * Many NFT contracts have `mint()` marked as `payable` but with a
 * DYNAMIC price that can be 0 during a "free phase". The current
 * findFreeMintFunction() uses staticCall which reverts on payable
 * functions (because msg.value = 0). But if price() returns 0,
 * the mint IS free even though the function is payable!
 *
 * This module:
 *   1. Reads price() / mintPrice() / cost() from the contract
 *   2. If price == 0 → the mint is currently free
 *   3. Try mint() anyway (it might work with value=0)
 *   4. If staticCall succeeds → confirmed free mint
 */

import { getContract, parseAbi } from 'viem';
import { publicClient } from '@/lib/pimlico';

// ABI for price-reading functions
const PRICE_ABI = parseAbi([
  'function price() view returns (uint256)',
  'function mintPrice() view returns (uint256)',
  'function cost() view returns (uint256)',
  'function getPrice() view returns (uint256)',
  'function freePrice() view returns (uint256)',
  'function publicPrice() view returns (uint256)',
  'function freeSupply() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function mintActive() view returns (bool)',
  'function mintPaused() view returns (bool)',
  'function isMintActive() view returns (bool)',
  'function saleActive() view returns (bool)',
  'function publicMintActive() view returns (bool)',
]);

/**
 * Checks if a contract has a currently-free mint by reading price functions.
 * Returns { priceFunction, priceValue } if mint is currently free, null otherwise.
 */
export async function checkMintPrice(
  contractAddress: string
): Promise<{ priceFunction: string; priceValue: bigint } | null> {
  const contract = getContract({
    address: contractAddress as `0x${string}`,
    abi: PRICE_ABI,
    client: publicClient,
  });

  // Try each price function
  const priceFunctions = [
    'price', 'mintPrice', 'cost', 'getPrice',
    'freePrice', 'publicPrice',
  ];

  for (const fn of priceFunctions) {
    try {
      const result = (contract as any)[fn];
      if (!result) continue;
      const value = await result.read();
      if (value === 0n) {
        // Price is 0 → mint is currently FREE!
        return { priceFunction: fn, priceValue: 0n };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Checks if mint is currently active (not paused).
 */
export async function isMintActive(contractAddress: string): Promise<boolean | null> {
  const contract = getContract({
    address: contractAddress as `0x${string}`,
    abi: PRICE_ABI,
    client: publicClient,
  });

  const activeFunctions = ['mintActive', 'isMintActive', 'saleActive', 'publicMintActive'];
  const pausedFunctions = ['mintPaused'];

  for (const fn of activeFunctions) {
    try {
      const result = (contract as any)[fn];
      if (!result) continue;
      const value = await result.read();
      return !!value;
    } catch {
      continue;
    }
  }

  for (const fn of pausedFunctions) {
    try {
      const result = (contract as any)[fn];
      if (!result) continue;
      const value = await result.read();
      return !value; // if paused = false → mint is active
    } catch {
      continue;
    }
  }

  return null; // can't determine
}

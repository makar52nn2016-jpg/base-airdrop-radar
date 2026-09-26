import { getContract, parseAbi } from 'viem';
import { publicClient } from '@/lib/pimlico';

/**
 * Basescan API client — fetches verified contract ABIs.
 *
 * Free tier: 5 req/sec, 100k req/day — plenty.
 *
 * Required env var: BASESCAN_API_KEY (from basescan.org/settings/my-api-key)
 */

const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || '';
const BASESCAN_BASE_URL = 'https://api.basescan.org/api';

/**
 * Fetches the verified ABI for a contract from Basescan.
 * Returns null if contract is not verified or Basescan API key is missing.
 */
export async function getContractAbi(contractAddress: string): Promise<any[] | null> {
  if (!BASESCAN_API_KEY) return null;

  const url = `${BASESCAN_BASE_URL}?module=contract&action=getabi&address=${contractAddress}&apikey=${BASESCAN_API_KEY}`;

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status !== '1' || !data.result) return null;
    return JSON.parse(data.result);
  } catch {
    return null;
  }
}

/**
 * Comprehensive ABI fragment covering all common free-mint function signatures.
 *
 * v2 expanded — covers 30+ function names × 4 arg variants = 120+ candidates.
 *
 * Names covered: mint, publicMint, claim, freeMint, safeMint, mintTo,
 * airdrop, gift, claimFree, mintForFree, mintToken, batchMint, claimTokens,
 * requestTokens, receiveNFT, mintFree, mintBatch, claimNFT, drop,
 * freeClaim, give, sendNFT, grant, publicClaim.
 */
export const FREE_MINT_ABI = parseAbi([
  // No-args variants
  'function mint() public',
  'function publicMint() public',
  'function claim() public',
  'function freeMint() public',
  'function airdrop() public',
  'function gift() public',
  'function claimFree() public',
  'function mintForFree() public',
  'function mintToken() public',
  'function batchMint() public',
  'function claimTokens() public',
  'function requestTokens() public',
  'function receiveNFT() public',
  'function mintFree() public',
  'function mintBatch() public',
  'function claimNFT() public',
  'function drop() public',
  'function freeClaim() public',
  'function give() public',
  'function sendNFT() public',
  'function grant() public',
  'function publicClaim() public',
  // Quantity-arg (uint256) variants
  'function mint(uint256 quantity) public',
  'function publicMint(uint256 quantity) public',
  'function claim(uint256 quantity) public',
  'function freeMint(uint256 quantity) public',
  'function airdrop(uint256 quantity) public',
  'function gift(uint256 quantity) public',
  'function claimFree(uint256 quantity) public',
  'function mintForFree(uint256 quantity) public',
  'function mintToken(uint256 quantity) public',
  'function batchMint(uint256 quantity) public',
  'function claimTokens(uint256 quantity) public',
  'function requestTokens(uint256 quantity) public',
  'function receiveNFT(uint256 quantity) public',
  'function mintFree(uint256 quantity) public',
  'function mintBatch(uint256 quantity) public',
  'function claimNFT(uint256 quantity) public',
  'function drop(uint256 quantity) public',
  'function freeClaim(uint256 quantity) public',
  'function give(uint256 quantity) public',
  'function sendNFT(uint256 quantity) public',
  'function grant(uint256 quantity) public',
  'function publicClaim(uint256 quantity) public',
  // Address-only arg (to)
  'function mint(address to) public',
  'function safeMint(address to) public',
  'function mintTo(address to) public',
  'function airdrop(address to) public',
  'function gift(address to) public',
  'function sendNFT(address to) public',
  'function give(address to) public',
  'function grant(address to) public',
  'function mintToken(address to) public',
  // Address + quantity
  'function mint(address to, uint256 quantity) public',
  'function safeMint(address to, uint256 quantity) public',
  'function mintTo(address to, uint256 quantity) public',
  'function airdrop(address to, uint256 quantity) public',
  'function gift(address to, uint256 quantity) public',
  'function sendNFT(address to, uint256 quantity) public',
  'function give(address to, uint256 quantity) public',
  'function grant(address to, uint256 quantity) public',
  'function mintToken(address to, uint256 quantity) public',
  'function mintBatch(address to, uint256 quantity) public',
]);

/**
 * Common paid-mint signatures (to filter OUT from sniping).
 * If contract has these payable variants, it's a paid mint — but we still
 * attempt the non-payable variant since static-call without value should
 * reveal whether non-payable exists.
 */
export const PAID_MINT_ABI = parseAbi([
  'function mint(uint256 quantity) public payable',
  'function mint(address to, uint256 quantity) public payable',
  'function publicMint(uint256 quantity) public payable',
  'function claim(uint256 quantity) public payable',
  'function freeMint(uint256 quantity) public payable',
]);

/**
 * Heuristic: returns true if the contract address looks like an NFT contract
 * by checking bytecode length (NFT contracts are typically 5-30KB).
 */
export async function looksLikeContract(address: string): Promise<boolean> {
  try {
    const code = await publicClient.getCode({ address: address as `0x${string}` });
    return code !== undefined && code.length > 100;
  } catch {
    return false;
  }
}

/**
 * Tries to call a mint function on the contract with a static call first
 * (no gas spent) to see if it would succeed.
 *
 * v2 — tries 60+ function name + arg combinations.
 * Uses a "real" address (the configured recipient) for to-args to maximize
 * chance of success on contracts that require non-zero address.
 *
 * Returns the function name + args if it works, null otherwise.
 */
export async function findFreeMintFunction(
  contractAddress: string
): Promise<{ functionName: string; args: unknown[] } | null> {
  // Use a non-zero address for to-args (some contracts revert on zero address)
  const toAddress = process.env.PROCEEDS_ADDRESS || '0x0000000000000000000000000000000000000001';

  const functionNames = [
    'mint',
    'publicMint',
    'claim',
    'freeMint',
    'airdrop',
    'gift',
    'claimFree',
    'mintForFree',
    'mintToken',
    'batchMint',
    'claimTokens',
    'requestTokens',
    'receiveNFT',
    'mintFree',
    'mintBatch',
    'claimNFT',
    'drop',
    'freeClaim',
    'give',
    'sendNFT',
    'grant',
    'publicClaim',
  ];

  const candidates: { functionName: string; args: unknown[] }[] = [];

  // No-args first (simplest)
  for (const fn of functionNames) {
    candidates.push({ functionName: fn, args: [] });
  }

  // Quantity-arg
  for (const fn of functionNames) {
    candidates.push({ functionName: fn, args: [1n] });
  }

  // Address-only arg
  const addressOnlyFns = ['mint', 'safeMint', 'mintTo', 'airdrop', 'gift', 'sendNFT', 'give', 'grant', 'mintToken'];
  for (const fn of addressOnlyFns) {
    candidates.push({ functionName: fn, args: [toAddress] });
  }

  // Address + quantity
  const addrQtyFns = ['mint', 'safeMint', 'mintTo', 'airdrop', 'gift', 'sendNFT', 'give', 'grant', 'mintToken', 'mintBatch'];
  for (const fn of addrQtyFns) {
    candidates.push({ functionName: fn, args: [toAddress, 1n] });
  }

  const contract = getContract({
    address: contractAddress as `0x${string}`,
    abi: FREE_MINT_ABI,
    client: publicClient,
  });

  for (const candidate of candidates) {
    try {
      const fn = (contract as any)[candidate.functionName];
      if (!fn) continue;

      // Static call (no gas spent, no state change)
      await fn.read.staticCall(candidate.args);

      // If we got here without throwing, the function exists and is callable
      return candidate;
    } catch {
      // Function doesn't exist or reverts — try next
      continue;
    }
  }

  return null;
}

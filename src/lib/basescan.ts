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
  if (!BASESCAN_API_KEY) {
    // Skip ABI fetch silently if not configured — sniper will fall back to method signature checks.
    return null;
  }

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
 * Minimal ABI fragment covering common free-mint function signatures.
 * Used as a fallback when verified ABI isn't available.
 *
 * Many free-mint contracts use one of these signatures:
 *   - mint()                 — no args, often free
 *   - mint(uint256)           — quantity, often free
 *   - mint(address)           — to address, often free
 *   - mint(address, uint256)  — to + quantity
 *   - publicMint()            — explicit public mint
 *   - publicMint(uint256)     — explicit public mint with quantity
 *   - claim()                 — claim-style mint
 *   - claim(uint256)          — claim with quantity
 */
export const FREE_MINT_ABI = parseAbi([
  'function mint() public',
  'function mint(uint256 quantity) public',
  'function mint(address to) public',
  'function mint(address to, uint256 quantity) public',
  'function publicMint() public',
  'function publicMint(uint256 quantity) public',
  'function claim() public',
  'function claim(uint256 quantity) public',
  'function freeMint() public',
  'function freeMint(uint256 quantity) public',
]);

/**
 * Common paid-mint signatures (to filter OUT from sniping).
 * If contract has these, it's likely a paid mint — skip.
 */
export const PAID_MINT_ABI = parseAbi([
  'function mint(uint256 quantity) public payable',
  'function mint(address to, uint256 quantity) public payable',
  'function publicMint(uint256 quantity) public payable',
  'function claim(uint256 quantity) public payable',
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
 * Returns the function name if it works, null otherwise.
 */
export async function findFreeMintFunction(
  contractAddress: string
): Promise<{ functionName: string; args: unknown[] } | null> {
  // Try the simplest signature first: mint() with no args
  const candidates: { functionName: string; args: unknown[] }[] = [
    { functionName: 'mint', args: [] },
    { functionName: 'publicMint', args: [] },
    { functionName: 'claim', args: [] },
    { functionName: 'freeMint', args: [] },
    { functionName: 'mint', args: [1n] },
    { functionName: 'publicMint', args: [1n] },
    { functionName: 'claim', args: [1n] },
    { functionName: 'freeMint', args: [1n] },
  ];

  const contract = getContract({
    address: contractAddress as `0x${string}`,
    abi: FREE_MINT_ABI,
    client: publicClient,
  });

  for (const candidate of candidates) {
    try {
      // Static call (no gas spent, no state change)
      // For mint() with no args:
      const fn = (contract as any)[candidate.functionName];
      if (!fn) continue;

      const result = await fn.read.staticCall(candidate.args);
      // If we got here without throwing, the function exists and is callable
      return candidate;
    } catch (err) {
      // Function doesn't exist or reverts — try next
      continue;
    }
  }

  return null;
}

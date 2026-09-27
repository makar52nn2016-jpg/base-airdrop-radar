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
 * v3 — expanded with ERC-1155 specific signatures.
 * Most new NFT contracts on Base/L2s are ERC-1155 (cheaper to mint, batch support).
 *
 * Names covered: mint, publicMint, claim, freeMint, safeMint, mintTo,
 * airdrop, gift, claimFree, mintForFree, mintToken, batchMint, claimTokens,
 * requestTokens, receiveNFT, mintFree, mintBatch, claimNFT, drop,
 * freeClaim, give, sendNFT, grant, publicClaim.
 *
 * Arg variants: no-args, uint256, address, (address,uint256), ERC-1155 batch signatures.
 */
export const FREE_MINT_ABI = parseAbi([
  // ============ ERC-721 standard signatures ============
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
  // ============ Allowlist / Presale / Whitelist (NEW!) ============
  'function allowlistMint() public',
  'function presaleMint() public',
  'function whitelistMint() public',
  'function earlyMint() public',
  'function allowlistMint(uint256 quantity) public',
  'function presaleMint(uint256 quantity) public',
  'function whitelistMint(uint256 quantity) public',
  'function earlyMint(uint256 quantity) public',
  'function allowlistMint(address to) public',
  'function presaleMint(address to) public',
  'function whitelistMint(address to) public',
  'function earlyMint(address to) public',
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

  // ============ ERC-1155 specific signatures ============
  // mint(address to, uint256 id, uint256 amount, bytes data) — standard ERC-1155 single
  'function mint(address to, uint256 id, uint256 amount, bytes data) public',
  'function mintTo(address to, uint256 id, uint256 amount, bytes data) public',
  'function safeMint(address to, uint256 id, uint256 amount, bytes data) public',
  'function airdrop(address to, uint256 id, uint256 amount, bytes data) public',
  'function gift(address to, uint256 id, uint256 amount, bytes data) public',
  'function claim(address to, uint256 id, uint256 amount, bytes data) public',
  'function freeMint(address to, uint256 id, uint256 amount, bytes data) public',
  'function mintForFree(address to, uint256 id, uint256 amount, bytes data) public',
  // mintBatch(address to, uint256[] ids, uint256[] amounts, bytes data) — standard ERC-1155 batch
  'function mintBatch(address to, uint256[] ids, uint256[] amounts, bytes data) public',
  'function batchMint(address to, uint256[] ids, uint256[] amounts, bytes data) public',
  'function airdropBatch(address to, uint256[] ids, uint256[] amounts, bytes data) public',
  // Simpler ERC-1155 patterns (no bytes data arg)
  'function mint(address to, uint256 id, uint256 amount) public',
  'function mintTo(address to, uint256 id, uint256 amount) public',
  'function safeMint(address to, uint256 id, uint256 amount) public',
  'function claim(address to, uint256 id, uint256 amount) public',
  'function freeMint(address to, uint256 id, uint256 amount) public',
  'function airdrop(address to, uint256 id, uint256 amount) public',
  'function gift(address to, uint256 id, uint256 amount) public',
  // ERC-1155 claim style: claim(uint256 id, uint256 amount)
  'function claim(uint256 id, uint256 amount) public',
  'function freeMint(uint256 id, uint256 amount) public',
  'function mint(uint256 id, uint256 amount) public',
  'function publicMint(uint256 id, uint256 amount) public',
  'function claimFree(uint256 id, uint256 amount) public',
  'function mintForFree(uint256 id, uint256 amount) public',
  // ERC-1155 with just id (1 amount implied)
  'function claim(uint256 id) public',
  'function freeMint(uint256 id) public',
  'function mint(uint256 id) public',
  'function publicMint(uint256 id) public',
  'function claimFree(uint256 id) public',
  'function mintForFree(uint256 id) public',
]);

/**
 * Tries to find and call a claim/reward function on an NFT contract.
 * Many NFT collections distribute ERC-20 tokens to holders via claim() functions.
 *
 * Detection strategy:
 *   1. Basescan ABI lookup — find any function with claim/reward/harvest/collect keyword
 *   2. Fallback — try common claim function signatures
 *
 * @param contractAddress NFT contract address
 * @param tokenId NFT token ID (some claim functions need it as arg)
 * @param holderAddress Smart Account address (for functions that take address arg)
 * @returns { functionName, args, abiInputs, tokenContract?, source } if claimable, null otherwise
 */
export async function findClaimFunction(
  contractAddress: string,
  tokenId?: string,
  holderAddress?: string
): Promise<{
  functionName: string;
  args: unknown[];
  abiInputs?: any[];
  source: 'basescan' | 'fallback';
} | null> {
  const toAddress = (holderAddress || '0x0000000000000000000000000000000000000001') as `0x${string}`;

  // Strategy 1: Basescan verified ABI
  const abi = await getContractAbi(contractAddress);
  if (abi && Array.isArray(abi)) {
    const CLAIM_KEYWORDS = ['claim', 'reward', 'harvest', 'collect', 'stake', 'unstake', 'airdrop', 'distribute'];
    const claimCandidates: { functionName: string; inputs: any[] }[] = [];

    for (const item of abi) {
      if (item.type !== 'function') continue;
      if (item.stateMutability === 'view' || item.stateMutability === 'pure') continue;

      const nameLower = (item.name || '').toLowerCase();
      const isClaim = CLAIM_KEYWORDS.some((kw) => nameLower.includes(kw));
      if (!isClaim) continue;

      claimCandidates.push({ functionName: item.name, inputs: item.inputs || [] });
    }

    for (const c of claimCandidates) {
      const args: unknown[] = [];
      let skip = false;

      for (const input of c.inputs) {
        const t = input.type;
        if (t === 'address') args.push(toAddress);
        else if (t === 'uint256') args.push(tokenId ? BigInt(tokenId) : 1n);
        else if (t === 'uint8' || t === 'uint16') args.push(1);
        else if (t === 'bool') args.push(true);
        else if (t === 'string') args.push('');
        else if (t.startsWith('bytes')) args.push('0x');
        else if (t.startsWith('uint') || t.startsWith('int')) args.push(tokenId ? BigInt(tokenId) : 1n);
        else { skip = true; break; }
      }

      if (skip) continue;

      try {
        const fnAbi = [{
          type: 'function',
          name: c.functionName,
          inputs: c.inputs,
          outputs: [],
          stateMutability: 'nonpayable',
        }];
        const contract = getContract({
          address: contractAddress as `0x${string}`,
          abi: fnAbi as any,
          client: publicClient,
        });
        const fn = (contract as any)[c.functionName];
        if (!fn) continue;
        await fn.read.staticCall(args);
        return { functionName: c.functionName, args, abiInputs: c.inputs, source: 'basescan' };
      } catch {
        continue;
      }
    }
  }

  // Strategy 2: Fallback — common claim signatures
  const CLAIM_ABI = parseAbi([
    'function claim() public',
    'function claim(uint256 tokenId) public',
    'function claim(address to) public',
    'function claim(address to, uint256 tokenId) public',
    'function claimReward() public',
    'function claimReward(uint256 tokenId) public',
    'function claimTokens() public',
    'function claimTokens(uint256 tokenId) public',
    'function claimAirdrop() public',
    'function claimAirdrop(uint256 tokenId) public',
    'function getReward() public',
    'function getReward(uint256 tokenId) public',
    'function harvest() public',
    'function harvest(uint256 tokenId) public',
    'function collect() public',
    'function collect(uint256 tokenId) public',
    'function stake(uint256 tokenId) public',
    'function unstake(uint256 tokenId) public',
  ]);

  const contract = getContract({
    address: contractAddress as `0x${string}`,
    abi: CLAIM_ABI,
    client: publicClient,
  });

  const candidates: { functionName: string; args: unknown[] }[] = [
    { functionName: 'claim', args: [] },
    { functionName: 'claimReward', args: [] },
    { functionName: 'claimTokens', args: [] },
    { functionName: 'claimAirdrop', args: [] },
    { functionName: 'getReward', args: [] },
    { functionName: 'harvest', args: [] },
    { functionName: 'collect', args: [] },
  ];

  if (tokenId) {
    candidates.push(
      { functionName: 'claim', args: [BigInt(tokenId)] },
      { functionName: 'claimReward', args: [BigInt(tokenId)] },
      { functionName: 'claimTokens', args: [BigInt(tokenId)] },
      { functionName: 'claimAirdrop', args: [BigInt(tokenId)] },
      { functionName: 'getReward', args: [BigInt(tokenId)] },
      { functionName: 'harvest', args: [BigInt(tokenId)] },
      { functionName: 'collect', args: [BigInt(tokenId)] },
    );
  }

  for (const candidate of candidates) {
    try {
      const fn = (contract as any)[candidate.functionName];
      if (!fn) continue;
      await fn.read.staticCall(candidate.args);
      return { ...candidate, source: 'fallback' };
    } catch {
      continue;
    }
  }

  return null;
}

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
 * v3 — now uses Basescan verified ABI (if available) to find ALL functions
 * whose name contains mint-like keywords (mint, claim, airdrop, gift, drop,
 * give, grant, send, receive). This catches custom names like `mintPhase1`,
 * `claimWhitelist`, `airdropV2`, etc.
 *
 * Falls back to hardcoded 60+ candidates if no verified ABI.
 *
 * Returns the function name + args if a callable function is found.
 */
export async function findFreeMintFunction(
  contractAddress: string
): Promise<{ functionName: string; args: unknown[]; source: 'basescan' | 'fallback'; abiInputs?: any[] } | null> {
  // Try Basescan ABI first (catches ALL custom function names)
  const basescanResult = await findFreeMintViaBasescanAbi(contractAddress);
  if (basescanResult) {
    return { ...basescanResult, source: 'basescan' };
  }

  // Fallback: hardcoded 60+ candidates
  const fallbackResult = await findFreeMintViaFallback(contractAddress);
  if (fallbackResult) {
    return { ...fallbackResult, source: 'fallback' };
  }

  return null;
}

/**
 * Uses Basescan verified ABI to find any mint-like function.
 * Catches custom names like mintPhase1, claimWhitelist, airdropV2.
 */
async function findFreeMintViaBasescanAbi(
  contractAddress: string
): Promise<{ functionName: string; args: unknown[]; abiInputs: any[] } | null> {
  const abi = await getContractAbi(contractAddress);
  if (!abi || !Array.isArray(abi)) return null;

  // Find all functions whose name contains a mint-like keyword
  // AND that are NOT payable (no ETH required = free mint candidate)
  const MINT_KEYWORDS = [
    'mint',
    'claim',
    'airdrop',
    'gift',
    'drop',
    'give',
    'grant',
    'sendnft',
    'receivenft',
    'free',
  ];

  const candidates: { functionName: string; inputs: any[] }[] = [];
  for (const item of abi) {
    if (item.type !== 'function') continue;
    if (item.stateMutability === 'payable') continue; // skip paid mints

    const nameLower = (item.name || '').toLowerCase();
    const isMintLike = MINT_KEYWORDS.some((kw) => nameLower.includes(kw));
    if (!isMintLike) continue;

    candidates.push({ functionName: item.name, inputs: item.inputs || [] });
  }

  if (candidates.length === 0) return null;

  // For each candidate, build args based on input types and try static-call
  const toAddress = (process.env.PROCEEDS_ADDRESS ||
    '0x0000000000000000000000000000000000000001') as `0x${string}`;

  for (const c of candidates) {
    // Build args from input types
    const args: unknown[] = [];
    let skipCandidate = false;

    for (const input of c.inputs) {
      const t = input.type;
      if (t === 'address') {
        args.push(toAddress);
      } else if (t === 'uint256' || t === 'uint128' || t === 'uint64' || t === 'uint32') {
        args.push(1n);
      } else if (t === 'uint16' || t === 'uint8') {
        args.push(1);
      } else if (t === 'bool') {
        args.push(true);
      } else if (t === 'string') {
        args.push('');
      } else if (t === 'bytes' || t.startsWith('bytes')) {
        args.push('0x');
      } else if (t.startsWith('uint')) {
        args.push(1n);
      } else if (t.startsWith('int')) {
        args.push(1n);
      } else {
        // Unknown type — can't safely call
        skipCandidate = true;
        break;
      }
    }

    if (skipCandidate) continue;

    try {
      // Build a minimal ABI for just this function
      const fnAbi = [
        {
          type: 'function',
          name: c.functionName,
          inputs: c.inputs,
          outputs: [{ type: 'uint256', name: '' }],
          stateMutability: 'nonpayable',
        },
      ];

      const contract = getContract({
        address: contractAddress as `0x${string}`,
        abi: fnAbi as any,
        client: publicClient,
      });

      const fn = (contract as any)[c.functionName];
      if (!fn) continue;

      await fn.read.staticCall(args);
      return { functionName: c.functionName, args, abiInputs: c.inputs };
    } catch {
      // Function reverts or doesn't exist via this signature — try next
      continue;
    }
  }

  return null;
}

/**
 * Fallback: tries 60+ hardcoded function name + arg combinations.
 * Used when Basescan ABI is not available or contract is unverified.
 */
async function findFreeMintViaFallback(
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
      await fn.read.staticCall(candidate.args);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

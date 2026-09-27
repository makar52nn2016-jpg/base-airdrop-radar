/**
 * Contract Deployment Scanner — FIRST-MOVER free-mint discovery.
 *
 * Instead of scanning for mint EVENTS (someone already minted), this scans
 * for NEW CONTRACT DEPLOYMENTS. When a new NFT contract is deployed, we
 * check it IMMEDIATELY for a free-mint function — BEFORE anyone else mints.
 *
 * This is the most powerful strategy for catching free mints early:
 * - Other strategies: find mints that ALREADY happened (too late, MEV bots got them)
 * - This strategy: find contracts at DEPLOYMENT time (first to mint!)
 *
 * Implementation:
 *   1. Fetch latest block with full transactions
 *   2. Filter for contract creation (to === null)
 *   3. For each, fetch receipt → get contractAddress
 *   4. Check if contract implements ERC-721/1155 (supportsInterface)
 *   5. If yes → check for free-mint function
 *   6. If found → add to candidates for immediate minting
 */

import { getClientsForChain, CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';
import { findFreeMintFunction } from '@/lib/basescan';
import { logActivity } from '@/lib/stats';
import type { MintCandidate } from '@/lib/sniper';

// ERC-721 interface ID: 0x80ac58cd
const ERC721_INTERFACE_ID = '0x80ac58cd';
// ERC-1155 interface ID: 0xd9b67a26
const ERC1155_INTERFACE_ID = '0xd9b67a26';

// supportsInterface ABI
const SUPPORTS_INTERFACE_ABI = [
  {
    type: 'function',
    name: 'supportsInterface',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
];

/**
 * Scans the latest block for newly deployed contracts.
 * For each new contract, checks if it's an NFT and has a free-mint function.
 *
 * This catches contracts at BIRTH — before anyone mints from them.
 *
 * @param chainKey which chain to scan
 * @param maxCandidates max candidates to return
 */
export async function scanRecentContractDeployments(
  chainKey: ChainKey,
  maxCandidates = 3
): Promise<MintCandidate[]> {
  const candidates: MintCandidate[] = [];
  const chainConfig = CHAIN_CONFIGS[chainKey];

  try {
    const { publicClient: pc } = getClientsForChain(chainKey);

    // Get latest block WITH full transactions
    const latestBlock = await pc.getBlock({
      blockTag: 'latest',
      includeTransactions: true,
    } as any);

    if (!latestBlock || !latestBlock.transactions) return [];

    // Filter for contract creation transactions (to === null)
    const creationTxs = (latestBlock.transactions as any[]).filter(
      (tx: any) => tx && tx.to === null
    );

    if (creationTxs.length === 0) return [];

    logActivity({
      type: 'chain_scan',
      message: `Deployment scan: ${creationTxs.length} new contracts deployed on ${chainKey} in latest block`,
      chain: chainKey,
    });

    // For each contract creation, get receipt → contract address → check if NFT
    for (const tx of creationTxs.slice(0, 10)) { // limit to 10 per block
      if (candidates.length >= maxCandidates) break;

      try {
        const txHash = typeof tx === 'string' ? tx : tx.hash;
        if (!txHash) continue;

        // Get receipt to find the deployed contract address
        const receipt = await pc.waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
          timeout: 10_000,
        } as any).catch(() => null);

        if (!receipt || !receipt.contractAddress) continue;

        const contractAddress = receipt.contractAddress.toLowerCase();

        // Check if this contract implements ERC-721 or ERC-1155
        let isNFT = false;
        try {
          const data = await pc.readContract({
            address: contractAddress as `0x${string}`,
            abi: SUPPORTS_INTERFACE_ABI,
            functionName: 'supportsInterface',
            args: [ERC721_INTERFACE_ID as `0x${string}`],
          } as any).catch(() => false);
          isNFT = !!data;
        } catch {}

        if (!isNFT) {
          // Try ERC-1155
          try {
            const data2 = await pc.readContract({
              address: contractAddress as `0x${string}`,
              abi: SUPPORTS_INTERFACE_ABI,
              functionName: 'supportsInterface',
              args: [ERC1155_INTERFACE_ID as `0x${string}`],
            } as any).catch(() => false);
            isNFT = !!data2;
          } catch {}
        }

        if (!isNFT) continue; // not an NFT contract

        // Check for free-mint function
        const found = await findFreeMintFunction(contractAddress);
        if (found) {
          logActivity({
            type: 'candidate_found',
            message: `🚀 DEPLOYMENT SCAN: New NFT contract ${contractAddress.slice(0, 12)}... has free-mint: ${found.functionName}()`,
            contract: contractAddress,
            chain: chainKey,
          });

          candidates.push({
            slug: `deploy-${chainKey}`,
            name: `New deployment ${contractAddress.slice(0, 8)}`,
            contract: contractAddress,
            functionName: found.functionName,
            args: found.args,
            detectedAt: new Date().toISOString(),
            image_url: null,
            opensea_url: `https://opensea.io/assets/${chainConfig.openSeaChain}/${contractAddress}`,
            source: found.source,
            abiInputs: found.abiInputs,
            chain: chainKey,
          });
        }
      } catch {
        continue;
      }
    }
  } catch (err: any) {
    logActivity({
      type: 'error',
      message: `Deployment scan failed on ${chainKey}: ${err.message?.slice(0, 60)}`,
      chain: chainKey,
    });
  }

  return candidates;
}

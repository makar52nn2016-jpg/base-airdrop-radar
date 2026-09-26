/**
 * Aave V3 Liquidation Monitor — scans for LiquidationCall events on Aave V3 Pool.
 *
 * LiquidationCall event signature:
 *   event LiquidationCall(
 *     address indexed collateralAsset,
 *     address indexed debtAsset,
 *     address indexed user,
 *     uint256 debtToCover,
 *     uint256 liquidatedCollateralAmount,
 *     address liquidator,
 *     bool receiveAToken
 *   );
 *
 * When a liquidation happens, the liquidator receives collateral at a discount.
 * This monitor DETECTS liquidations (doesn't execute — that requires flash loans
 * and MEV-level competition). Sends Telegram notification with details so user
 * can see real-time DeFi activity.
 *
 * Aave V3 Pool addresses (verified):
 *   - Base: 0x794a313d1f9291A4Ef4a0e9F6c05330513add5d2 (L2Pool — Base-optimized version)
 *   - Ethereum mainnet: 0x87870Bca3F4829B19760f7dC0D6BcBBc6f9ff9B3 (Pool)
 *   - Polygon: 0x794a313d1f9291A4Ef4a0e9F6c05330513add5d2 (L2Pool)
 *   - Optimism: 0x794a313d1f9291A4Ef4a0e9F6c05330513add5d2 (L2Pool)
 *   - Arbitrum: 0x794a313d1f9291A4Ef4a0e9F6c05330513add5d2 (L2Pool)
 */

import { parseAbiItem, parseAbi } from 'viem';
import { getClientsForChain, CHAIN_CONFIGS, type ChainKey } from '@/lib/pimlico';
import { sendTelegramMessage } from '@/lib/telegram';
import { logActivity } from '@/lib/stats';

// Aave V3 L2Pool contract address (same on Base/Polygon/Optimism/Arbitrum)
const AAVE_V3_L2POOL = '0x794a313d1f9291A4Ef4a0e9F6c05330513add5d2';
// Aave V3 Pool on Ethereum mainnet
const AAVE_V3_POOL_MAINNET = '0x87870Bca3F4829B19760f7dC0D6BcBBc6f9ff9B3';

const LIQUIDATION_CALL_EVENT = parseAbiItem(
  'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
);

// Cache: last block we scanned per chain (avoid duplicate notifications)
const lastScannedBlock = new Map<ChainKey, bigint>();

/**
 * Scans last N blocks on a chain for Aave V3 LiquidationCall events.
 * Returns number of liquidations detected.
 *
 * @param chainKey which chain to scan
 * @param blockRange how many recent blocks to scan (default 50)
 */
export async function scanAaveLiquidations(
  chainKey: ChainKey,
  blockRange = 50
): Promise<number> {
  const { publicClient: pc } = getClientsForChain(chainKey);
  const poolAddress = chainKey === 'ethereum' ? AAVE_V3_POOL_MAINNET : AAVE_V3_L2POOL;
  const chainConfig = CHAIN_CONFIGS[chainKey];

  try {
    const latestBlock = await pc.getBlockNumber();
    const lastScanned = lastScannedBlock.get(chainKey) || latestBlock - BigInt(blockRange);
    const fromBlock = lastScanned + 1n;

    if (fromBlock >= latestBlock) {
      return 0; // nothing new to scan
    }

    const logs = await pc.getLogs({
      address: poolAddress as `0x${string}`,
      event: LIQUIDATION_CALL_EVENT,
      fromBlock,
      toBlock: latestBlock,
    } as any);

    lastScannedBlock.set(chainKey, latestBlock);

    if (logs.length === 0) {
      logActivity({
        type: 'chain_scan',
        message: `No Aave liquidations on ${chainKey} in last ${Number(latestBlock - fromBlock)} blocks`,
        chain: chainKey,
      });
      return 0;
    }

    for (const log of logs) {
      const args = (log as any).args;
      if (!args) continue;

      const collateral = String(args.collateralAsset || '').slice(0, 10);
      const debt = String(args.debtAsset || '').slice(0, 10);
      const user = String(args.user || '').slice(0, 10);
      const liquidator = String(args.liquidator || '').slice(0, 10);
      const debtCovered = (args.debtToCover || 0n).toString();
      const collateralLiquidated = (args.liquidatedCollateralAmount || 0n).toString();

      logActivity({
        type: 'candidate_found',
        message: `Aave liquidation on ${chainKey}: user ${user}..., liquidator ${liquidator}...`,
        chain: chainKey,
        contract: poolAddress,
      });

      // Send Telegram notification
      const msg = `🔥 *Aave V3 Liquidation on ${chainKey}*

👤 *User:* [${user}...](${chainConfig.scannerUrl}/address/${args.user})
⚡ *Liquidator:* [${liquidator}...](${chainConfig.scannerUrl}/address/${args.liquidator})
📦 *Collateral:* [${collateral}...](${chainConfig.scannerUrl}/address/${args.collateralAsset})
💵 *Debt:* [${debt}...](${chainConfig.scannerUrl}/address/${args.debtAsset})

💰 *Debt covered:* ${debtCovered} (raw units)
💎 *Collateral liquidated:* ${collateralLiquidated} (raw units)

🔗 [View tx](${chainConfig.scannerUrl}/tx/${log.transactionHash})`;

      await sendTelegramMessage(msg);
    }

    return logs.length;
  } catch (err: any) {
    logActivity({
      type: 'error',
      message: `Aave scan error on ${chainKey}: ${err.message?.slice(0, 80)}`,
      chain: chainKey,
    });
    return 0;
  }
}

/**
 * Scans Aave V3 on all 5 chains for recent liquidations.
 * Returns total liquidations found across all chains.
 */
export async function scanAllChainsForLiquidations(blockRange = 50): Promise<number> {
  let total = 0;
  for (const chainKey of ['base', 'optimism', 'arbitrum', 'polygon', 'ethereum'] as ChainKey[]) {
    try {
      const count = await scanAaveLiquidations(chainKey, blockRange);
      total += count;
    } catch {
      // Continue to next chain
    }
  }
  return total;
}

// ============================================================================
// UNHEALTHY POSITION MONITORING
// ============================================================================

// Borrow event signature on Aave V3 Pool
// event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)
const BORROW_EVENT = parseAbiItem(
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)'
);

// getUserAccountData function selector
const GET_USER_ACCOUNT_DATA_ABI = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
]);

// Cache of recent borrowers per chain (avoid re-checking same addresses)
const recentBorrowers = new Map<ChainKey, Set<string>>();
const MAX_BORROWERS_PER_CHAIN = 200;

/**
 * Fetches recent Borrow events on Aave V3 Pool and returns unique borrower addresses.
 */
async function getRecentBorrowers(chainKey: ChainKey, blockRange = 200): Promise<string[]> {
  const { publicClient: pc } = getClientsForChain(chainKey);
  const poolAddress = chainKey === 'ethereum' ? AAVE_V3_POOL_MAINNET : AAVE_V3_L2POOL;

  try {
    const latestBlock = await pc.getBlockNumber();
    const fromBlock = latestBlock - BigInt(blockRange);

    const logs = await pc.getLogs({
      address: poolAddress as `0x${string}`,
      event: BORROW_EVENT,
      fromBlock,
      toBlock: latestBlock,
    } as any);

    // Extract unique borrower addresses (args.user is the borrower, NOT args.onBehalfOf which is the delegator)
    const borrowers = new Set<string>();
    for (const log of logs) {
      const args = (log as any).args;
      if (args?.user) {
        borrowers.add(String(args.user).toLowerCase());
      }
    }

    return [...borrowers];
  } catch (err: any) {
    logActivity({
      type: 'error',
      message: `Failed to fetch borrowers on ${chainKey}: ${err.message?.slice(0, 80)}`,
      chain: chainKey,
    });
    return [];
  }
}

/**
 * Checks the health factor of an Aave V3 borrower.
 * Returns health factor * 1e18 (Aave V3 returns health factor in 1e18 scale).
 * Health factor < 1e18 = unhealthy (liquidatable).
 * Health factor < 1.05e18 = close to liquidation (alert).
 */
async function getHealthFactor(
  chainKey: ChainKey,
  userAddress: string
): Promise<{ healthFactor: bigint; totalDebt: bigint; totalCollateral: bigint } | null> {
  const { publicClient: pc } = getClientsForChain(chainKey);
  const poolAddress = chainKey === 'ethereum' ? AAVE_V3_POOL_MAINNET : AAVE_V3_L2POOL;

  try {
    const data = (await pc.readContract({
      address: poolAddress as `0x${string}`,
      abi: GET_USER_ACCOUNT_DATA_ABI,
      functionName: 'getUserAccountData',
      args: [userAddress as `0x${string}`],
    } as any)) as [bigint, bigint, bigint, bigint, bigint, bigint];

    const [totalCollateral, totalDebt, , , , healthFactor] = data;
    return { healthFactor, totalDebt, totalCollateral };
  } catch {
    return null;
  }
}

/**
 * Scans recent Aave V3 borrowers on a chain for unhealthy positions.
 * Sends Telegram alert when health factor < 1.05 (close to liquidation).
 *
 * @param chainKey which chain to scan
 * @param maxBorrowers max borrowers to check (default 50, to limit RPC calls)
 */
export async function scanUnhealthyPositions(
  chainKey: ChainKey,
  maxBorrowers = 50
): Promise<{ scanned: number; unhealthy: number }> {
  const chainConfig = CHAIN_CONFIGS[chainKey];

  // Get cached borrowers set or initialize
  if (!recentBorrowers.has(chainKey)) {
    recentBorrowers.set(chainKey, new Set());
  }
  const cachedSet = recentBorrowers.get(chainKey)!;

  // Fetch recent borrowers
  const borrowers = await getRecentBorrowers(chainKey, 200);

  // Add new borrowers to cache (limit to MAX_BORROWERS_PER_CHAIN)
  let newCount = 0;
  for (const borrower of borrowers) {
    if (!cachedSet.has(borrower)) {
      cachedSet.add(borrower);
      newCount++;
      // Trim if too large
      if (cachedSet.size > MAX_BORROWERS_PER_CHAIN) {
        // Remove oldest (first item — Set preserves insertion order in JS)
        const first = cachedSet.values().next().value;
        if (first) cachedSet.delete(first);
      }
    }
  }

  logActivity({
    type: 'chain_scan',
    message: `Scanned ${borrowers.length} recent borrowers on ${chainKey} (${newCount} new), checking health...`,
    chain: chainKey,
  });

  // Check health factor for up to maxBorrowers cached borrowers
  const allBorrowers = [...cachedSet];
  const toCheck = allBorrowers.slice(0, maxBorrowers);
  let unhealthyCount = 0;

  for (const borrower of toCheck) {
    const result = await getHealthFactor(chainKey, borrower);
    if (!result) continue;

    const { healthFactor, totalDebt, totalCollateral } = result;

    // Skip if no debt (borrower fully repaid)
    if (totalDebt === 0n) continue;

    // Health factor 1e18 = 1.0 = liquidatable threshold
    // 1.05e18 = 1.05 = close to liquidation (alert)
    const ALERT_THRESHOLD = BigInt('1050000000000000000'); // 1.05e18
    const LIQUIDATABLE_THRESHOLD = BigInt('1000000000000000000'); // 1.0e18

    if (healthFactor < ALERT_THRESHOLD) {
      unhealthyCount++;
      const isLiquidatable = healthFactor < LIQUIDATABLE_THRESHOLD;
      const hfFloat = Number(healthFactor) / 1e18;

      logActivity({
        type: 'candidate_found',
        message: `${isLiquidatable ? '🔴 LIQUIDATABLE' : '⚠ Unhealthy'} position on ${chainKey}: HF=${hfFloat.toFixed(3)}`,
        chain: chainKey,
        contract: borrower,
      });

      // Send Telegram alert
      const debtBase = (Number(totalDebt) / 1e8).toFixed(2); // Aave returns in 8 decimals (USD base)
      const collateralBase = (Number(totalCollateral) / 1e8).toFixed(2);

      const msg = `${isLiquidatable ? '🔴 *LIQUIDATABLE*' : '⚠ *UNHEALTHY*'} position on ${chainKey}

👤 *User:* [${borrower.slice(0, 10)}...](${chainConfig.scannerUrl}/address/${borrower})
❤️ *Health Factor:* ${hfFloat.toFixed(4)}${isLiquidatable ? ' (below 1.0!)' : ' (below 1.05)'}
💵 *Total Debt:* $${debtBase}
💎 *Total Collateral:* $${collateralBase}

${isLiquidatable ? '⚡ *This position can be liquidated NOW!*' : '⚠ Watch this position — it may become liquidatable soon.'}

🔗 [View user on scanner](${chainConfig.scannerUrl}/address/${borrower})
🔗 [Aave V3 Pool](${chainConfig.scannerUrl}/address/${chainKey === 'ethereum' ? AAVE_V3_POOL_MAINNET : AAVE_V3_L2POOL})`;

      await sendTelegramMessage(msg);
    }
  }

  return { scanned: toCheck.length, unhealthy: unhealthyCount };
}

/**
 * Scans all 5 chains for unhealthy Aave V3 positions.
 */
export async function scanAllChainsForUnhealthy(maxBorrowersPerChain = 30): Promise<{
  totalScanned: number;
  totalUnhealthy: number;
}> {
  let totalScanned = 0;
  let totalUnhealthy = 0;

  for (const chainKey of ['base', 'optimism', 'arbitrum', 'polygon', 'ethereum'] as ChainKey[]) {
    try {
      const result = await scanUnhealthyPositions(chainKey, maxBorrowersPerChain);
      totalScanned += result.scanned;
      totalUnhealthy += result.unhealthy;
    } catch (err: any) {
      logActivity({
        type: 'error',
        message: `Unhealthy scan failed on ${chainKey}: ${err.message?.slice(0, 80)}`,
        chain: chainKey,
      });
    }
  }

  return { totalScanned, totalUnhealthy };
}

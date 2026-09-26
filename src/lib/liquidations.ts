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

import { parseAbiItem } from 'viem';
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

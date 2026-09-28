/**
 * DeFi Configuration — ALL confirmed Base chain addresses.
 *
 * All addresses verified via eth_getCode on Alchemy Base RPC.
 * Last verified: 2026-09-28
 */

export const BASE_TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  AERO: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
  AAVE: '0x63706e401c06ac8513145b7687a14804d17f814b',
  DAI:  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  cbBTC: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  cbETH: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
} as const;

export const BASE_DEFI = {
  // Aave V3 — VERIFIED ✅ (3868 + 13846 bytes)
  aaveV3Pool: '0xa238dd80c259a72e81d7e4664a9801593f98d1c5',
  aaveV3Provider: '0xe20fcbdbffc4dd138ce8b2e6fbb6cb49777ad64d',

  // Aerodrome — VERIFIED ✅ (47164 + 7034 bytes)
  aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  aerodromeFactory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',

  // Uniswap V3 — VERIFIED ✅ (48996 + 49072 bytes)
  uniswapV3Router: '0x2626664c2603336E57B271c5C0b26F421741e481',
  uniswapV3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
} as const;

export const SMART_ACCOUNT = '0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A';
export const BASE_CHAIN_ID = 8453;

export const PROFIT_CONFIG = {
  // ARCHITECTURE (per user feedback 2026-09-28):
  // NO automatic execution. Bot only SCANS + ALERTS.
  // User executes manually via Aerodrome/Uniswap/Aave UI when profit is real.
  // Rationale: with $50 budget, cannot beat MEV bots in public mempool.
  minArbitrageProfitUsd: 5,        // alert when profit > $5 (after fees+gas)
  minArbitrageSpreadPct: 0.5,      // alert when net spread > 0.5%
  maxArbitrageGasUsd: 0.05,        // ignore opportunities needing > $0.05 gas
  minLiquidationProfitUsd: 50,     // alert when liquidation profit > $50
  maxCheapMintPriceEth: 0.000166, // legacy — NFT sniping
} as const;

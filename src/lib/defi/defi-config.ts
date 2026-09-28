/**
 * DeFi Configuration — ALL confirmed Base chain addresses.
 *
 * Discovered by: Alchemy getAssetTransfers + getTokenMetadata +
 * Aerodrome JS bundle extraction + eth_getCode verification.
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
  aerodromeRouter: '0xfe678BFfC3C1c8D1De4478CC5C3e1b93EE4638aE',
  aerodromeFactory: '0x932d0b4c00a2a33ef1ec5fe0aa981bd1a00a6f5c',
  unknownLarge1: '0x44647Cd983E80558793780f9a0c7C2aa9F384D07',
  unknownLarge2: '0x69dD9db6d8f8E7d83887A704f447b1a584b599A1',
} as const;

export const SMART_ACCOUNT = '0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A';

export const PROFIT_CONFIG = {
  minArbitrageProfitEth: 0.000333,
  maxArbitrageGasEth: 0.000050,
  minLiquidationProfitEth: 0.000500,
  maxCheapMintPriceEth: 0.000166,
} as const;

// Live test all 4 DeFi scanners
import { scanArbitrageOpportunities } from '/home/z/my-project/src/lib/defi/arbitrage-scanner.ts';
import { scanLiquidationOpportunities } from '/home/z/my-project/src/lib/defi/liquidation-scanner.ts';
import { scanNewTokens } from '/home/z/my-project/src/lib/defi/new-token-scanner.ts';
import { scanWhaleActivity } from '/home/z/my-project/src/lib/defi/whale-scanner.ts';

console.log('=== Testing 4 DeFi scanners ===\n');

console.log('1. Arbitrage Scanner (28 pairs)...');
const arbOpps = await scanArbitrageOpportunities(5);
console.log(`   Found ${arbOpps.length} arbitrage opportunities`);
arbOpps.forEach((o, i) => console.log(`   ${i+1}. ${o.pair}: ${o.spreadPct.toFixed(2)}% → ${o.action.slice(0, 80)}`));

console.log('\n2. Liquidation Scanner (Aave V3)...');
const liqOpps = await scanLiquidationOpportunities(5);
console.log(`   Found ${liqOpps.length} liquidation opportunities`);

console.log('\n3. New Tokens Scanner (Transfer events)...');
const newTokens = await scanNewTokens(5);
console.log(`   Found ${newTokens.length} new token opportunities`);
newTokens.forEach((t, i) => console.log(`   ${i+1}. ${t.tokenSymbol} on ${t.poolDex} TVL $${t.tvlUsd.toFixed(0)}`));

console.log('\n4. Whale Scanner (large swaps)...');
const whales = await scanWhaleActivity(5);
console.log(`   Found ${whales.length} whale opportunities`);
whales.forEach((w, i) => console.log(`   ${i+1}. ${w.whaleLabel} → ${w.tokenSymbol} on ${w.dex}`));

console.log('\n=== SUMMARY ===');
console.log(`Total opportunities found: ${arbOpps.length + liqOpps.length + newTokens.length + whales.length}`);

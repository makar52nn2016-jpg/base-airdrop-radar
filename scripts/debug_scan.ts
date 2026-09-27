/**
 * Debug script — runs scan step-by-step and logs intermediate results.
 * Run with: npx tsx scripts/debug_scan.ts
 */

import { getRecentBaseTransfers, filterBaseMintEvents } from '../src/lib/opensea';
import { findFreeMintFunction } from '../src/lib/basescan';

async function main() {
  console.log('=== Step 1: Fetch recent transfer events (last hour) ===');
  const events = await getRecentBaseTransfers(100, 3600);
  console.log(`Got ${events.length} events total`);

  const byChain = new Map<string, number>();
  for (const e of events) {
    const c = e.chain || 'unknown';
    byChain.set(c, (byChain.get(c) || 0) + 1);
  }
  console.log('Events by chain:');
  for (const [chain, count] of byChain) {
    console.log(`  ${chain}: ${count}`);
  }

  console.log('\n=== Step 2: Filter for Base mint events ===');
  const mints = filterBaseMintEvents(events);
  console.log(`Found ${mints.length} distinct Base mint contracts`);
  for (const m of mints.slice(0, 10)) {
    console.log(`  ${m.contract} (slug: ${m.slug || 'n/a'})`);
  }

  console.log('\n=== Step 3: Check each contract for free mint function ===');
  for (const { contract } of mints.slice(0, 5)) {
    console.log(`\nChecking ${contract}...`);
    try {
      const found = await findFreeMintFunction(contract);
      if (found) {
        console.log(`  ✓ FREE MINT: ${found.functionName}(${found.args.join(', ')})`);
      } else {
        console.log(`  ✗ No free mint function detected`);
      }
    } catch (e: any) {
      console.log(`  ✗ Error: ${e.message}`);
    }
  }
}

main().catch(console.error);

// Memecoin sniper — chunked scan over 1000 blocks
const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';
const AERO_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';

const BASE_TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  DAI:  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
};

async function rpc(method, params) {
  try {
    const req = { jsonrpc: '2.0', method, params, id: 1 };
    const resp = await fetch(ALCHEMY_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    return await resp.json();
  } catch (e) { return { error: e.message }; }
}

async function ethCall(to, data) {
  const r = await rpc('eth_call', [{ to, data }, 'latest']);
  return r.error || !r.result || r.result === '0x' ? null : r.result;
}

function parseString(hex) {
  if (!hex || hex === '0x') return '';
  const cleanHex = hex.slice(2);
  if (cleanHex.length < 128) return '';
  const length = parseInt(cleanHex.slice(64, 128), 16);
  if (length === 0 || length > 100) return '';
  const dataHex = cleanHex.slice(128, 128 + length * 2);
  let result = '';
  for (let i = 0; i < dataHex.length; i += 2) {
    const byte = parseInt(dataHex.slice(i, i + 2), 16);
    if (byte >= 32 && byte <= 126) result += String.fromCharCode(byte);
  }
  return result;
}

(async () => {
  console.log('=== MEMECOIN SNIPER LIVE TEST (1000 blocks ~33 min) ===\n');
  
  const blockRes = await rpc('eth_blockNumber', []);
  const currentBlock = parseInt(blockRes.result, 16);
  console.log('Current block:', currentBlock);
  
  const CHUNK_SIZE = 9;  // Alchemy free tier allows 10 blocks (exclusive)
  const TOTAL_BLOCKS = 1000;
  const startBlock = currentBlock - TOTAL_BLOCKS;
  
  console.log(`Scanning ${TOTAL_BLOCKS} blocks in chunks of ${CHUNK_SIZE} (~${TOTAL_BLOCKS * 2 / 60} min history)\n`);
  
  let totalLogs = 0;
  let totalNewPools = 0;
  const eventGroups = {};
  const basePairedPools = [];
  
  for (let chunkStart = startBlock; chunkStart < currentBlock; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, currentBlock);
    
    const logsRes = await rpc('eth_getLogs', [{
      fromBlock: '0x' + chunkStart.toString(16),
      toBlock: '0x' + chunkEnd.toString(16),
      address: AERO_FACTORY,
    }]);
    
    if (logsRes.error) {
      console.log(`Chunk ${chunkStart}-${chunkEnd} ERROR: ${logsRes.error.message?.slice(0, 80)}`);
      continue;
    }
    
    const logs = logsRes.result || [];
    totalLogs += logs.length;
    
    for (const log of logs) {
      const t0 = log.topics && log.topics[0] ? log.topics[0].slice(0, 10) : 'none';
      if (!eventGroups[t0]) eventGroups[t0] = [];
      eventGroups[t0].push(log);
      
      // Try to identify PoolCreated — needs 3+ indexed topics
      if (!log.topics || log.topics.length < 3) continue;
      
      totalNewPools++;
      
      // Parse 3 common Aerodrome layouts
      let poolAddress = null;
      let token0 = '0x' + log.topics[1].slice(-40);
      let token1 = '0x' + log.topics[2].slice(-40);
      
      if (log.topics.length >= 5) {
        // 4 indexed params: token0, token1, stable, pool
        poolAddress = '0x' + log.topics[4].slice(-40);
      } else if (log.topics.length >= 4) {
        // 3 indexed + 1 in data
        if (log.topics[3] === '0x' + '0'.repeat(63) + '0' || 
            log.topics[3] === '0x' + '0'.repeat(63) + '1') {
          // stable is in topics[3]
          poolAddress = log.data ? '0x' + log.data.slice(-40) : null;
        } else {
          // pool address in topics[3]
          poolAddress = '0x' + log.topics[3].slice(-40);
        }
      } else if (log.data && log.data.length >= 66) {
        poolAddress = '0x' + log.data.slice(-40);
      }
      
      if (!poolAddress || token0 === token1) continue;
      
      // Check if pool pairs with base asset
      const t0IsBase = token0.toLowerCase() === BASE_TOKENS.WETH.toLowerCase() ||
                       token0.toLowerCase() === BASE_TOKENS.USDC.toLowerCase() ||
                       token0.toLowerCase() === BASE_TOKENS.USDT.toLowerCase();
      const t1IsBase = token1.toLowerCase() === BASE_TOKENS.WETH.toLowerCase() ||
                       token1.toLowerCase() === BASE_TOKENS.USDC.toLowerCase() ||
                       token1.toLowerCase() === BASE_TOKENS.USDT.toLowerCase();
      
      if (!t0IsBase && !t1IsBase) continue;
      
      // Get pool reserves and symbols
      const [reservesRes, t0SymRes, t1SymRes] = await Promise.all([
        ethCall(poolAddress, '0x0902f1ac'),
        ethCall(token0, '0x95d89b41'),
        ethCall(token1, '0x95d89b41'),
      ]);
      
      if (!reservesRes) continue;
      const hex = reservesRes.slice(2);
      const reserve0 = BigInt('0x' + hex.slice(0, 64));
      const reserve1 = BigInt('0x' + hex.slice(64, 128));
      
      if (reserve0 === 0n || reserve1 === 0n) continue;
      
      const t0Sym = parseString(t0SymRes) || '?';
      const t1Sym = parseString(t1SymRes) || '?';
      
      // Compute TVL
      let tvl = 0;
      if (token0.toLowerCase() === BASE_TOKENS.WETH.toLowerCase()) tvl = Number(reserve0) / 1e18 * 2650;
      else if (token1.toLowerCase() === BASE_TOKENS.WETH.toLowerCase()) tvl = Number(reserve1) / 1e18 * 2650;
      else if (token0.toLowerCase() === BASE_TOKENS.USDC.toLowerCase()) tvl = Number(reserve0) / 1e6;
      else if (token1.toLowerCase() === BASE_TOKENS.USDC.toLowerCase()) tvl = Number(reserve1) / 1e6;
      
      basePairedPools.push({
        block: parseInt(log.blockNumber, 16),
        token0, token1, poolAddress,
        t0Sym, t1Sym, tvl,
      });
    }
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total logs from Factory: ${totalLogs}`);
  console.log(`Total candidate events (3+ indexed): ${totalNewPools}`);
  console.log(`Base-paired pools found: ${basePairedPools.length}`);
  
  console.log('\n=== EVENT TYPES ===');
  for (const [t, entries] of Object.entries(eventGroups)) {
    console.log(`  ${t}...: ${entries.length} events`);
  }
  
  if (basePairedPools.length > 0) {
    console.log('\n=== INTERESTING NEW POOLS (last 33 min) ===\n');
    basePairedPools.sort((a, b) => b.tvl - a.tvl);
    basePairedPools.forEach((p, i) => {
      console.log(`${i+1}. ${p.t0Sym}/${p.t1Sym}`);
      console.log(`   Block: ${p.block} (~${(currentBlock - p.block) * 2}s ago)`);
      console.log(`   TVL: $${p.tvl.toFixed(2)}`);
      console.log(`   Pool: ${p.poolAddress}`);
      console.log('');
    });
  }
})().catch(e => console.error('ERR:', e.message, e.stack));

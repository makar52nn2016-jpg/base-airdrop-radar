// Verify popular Base tokens via Alchemy
const ALCHEMY_BASE = 'https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';

// Verified addresses from various sources — let's verify
const CANDIDATES = {
  // Major Base tokens (already verified)
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  DAI:  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  cbBTC: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  cbETH: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  AERO: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
  AAVE: '0x63706e401c06ac8513145b7687a14804d17f814b',
  // Memecoins on Base (popular)
  BRETT: '0x4efe22f2ba1c7924648be540f0ff3a30dd12ace8',
  TOSHI: '0x281aCB5acB2cbbB63274681dAce9F5ab5f7eEdD2',
  DEGEN: '0x4ed4e862860be52d6b9e823c3e60b8c3b3c0d0d1',  // Need to verify
  HIGHER: '0x8e1ea9c0faf5af0d6fde24e1e8be3eb86c6c0f8c',  // Need to verify
  WELL: '0x5Aa653A3D6aC6c1a543f4752DB73cae6E5C2669C',  // Need to verify
  ONDO: '0x9ec34d9dB3D0E6415b2F6f6c9FD6204b7C8E0F0D',  // Need to verify
  EXA: '0x8e47E8A53c0614bCE4d49F8d3a5006FA9b9b9627',  // Need to verify
  MOEUR: '0x8bd6966cb2f6e2bf6ad0452219c6dc6c20c3a4ab',
  WSTETH: '0xc1cba3fcea344f92d9ead90504fef6e6893c79aa',
  USD3: '0x53c93be9c87ff47b5836f5d4f9cd6ba44ce0aac3',
  RETH: '0x6f44d1e4c1d0c9b6865f0c1f4c1f1f8d5e5e5e5e', // placeholder
  SNX: '0xcD3f56d9f8f3c6b1c4c8e2e5b9e7c0e1f4f8e2e5e', // placeholder
  LDO: '0xE911b2c4D8244Eab7B67957D3A3E4f4f5f5e5e5e5', // placeholder
  VELAND: '0xc1cba3fcea344f92d9ead90504fef6e6893c79aa', // duplicate of wstETH
  // Major stablecoins
  axlUSDC: '0xEB4C2A9DAfE7d3F2D5C5E0A1B9b7C0c5c9d6C5E0', // placeholder
  USDbC: '0xd9a9c5c1a1f3c4a2b5c4b1b4f8e6c5e9a1b1b1b1', // placeholder
  // More memecoins
  KEYCAT: '0xeCCF4Da0AA5675904d329CcC0C4059a3D8f7a4d3',
  BAG: '0xb8F7c7122b3b8b3a3b1c4D7F9c4B3F1D2a9c4B3F',
  LILY: '0xE9c5A9Cb3d3a3b1c4D7F9c4B3F1D2a9c4B3F1D2a', // placeholder
  TRENCH: '0x88AaC2B7c1C5b4E3d2A9c4B3F1D2a9c4B3F1D2a', // placeholder
  SPROUT: '0x77Bb08e5806Fb9693a4f1a3b2c4D7F9c4B3F1D2a', // placeholder
};

const ERC20_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

async function verifyToken(addr) {
  try {
    // symbol() = 0x95d89b41
    // decimals() = 0x313ce567
    const req = {
      jsonrpc: '2.0', method: 'eth_call',
      params: [{ to: addr, data: '0x95d89b41' }, 'latest'],
      id: 1,
    };
    const resp = await fetch(ALCHEMY_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    const data = await resp.json();
    if (data.error || !data.result || data.result === '0x') return null;
    
    const hex = data.result.slice(2);
    if (hex.length < 128) return null;
    const length = parseInt(hex.slice(64, 128), 16);
    if (length === 0 || length > 50) return null;
    const dataHex = hex.slice(128, 128 + length * 2);
    let symbol = '';
    for (let i = 0; i < dataHex.length; i += 2) {
      const byte = parseInt(dataHex.slice(i, i + 2), 16);
      if (byte >= 32 && byte <= 126) symbol += String.fromCharCode(byte);
    }
    return symbol || null;
  } catch {
    return null;
  }
}

(async () => {
  console.log('Verifying tokens...\n');
  const verified = {};
  for (const [name, addr] of Object.entries(CANDIDATES)) {
    const symbol = await verifyToken(addr);
    if (symbol) {
      verified[name] = { addr, symbol };
      console.log(`✅ ${name} (${addr.slice(0, 10)}...) → symbol: ${symbol}`);
    } else {
      console.log(`❌ ${name} (${addr.slice(0, 10)}...) → not a valid ERC-20`);
    }
  }
  console.log(`\n=== VERIFIED TOKENS ===`);
  Object.entries(verified).forEach(([name, info]) => {
    console.log(`  ${name}: { addr: '${info.addr}', symbol: '${info.symbol}' },`);
  });
})().catch(e => console.error('ERR:', e.message));

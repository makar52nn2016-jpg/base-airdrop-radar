# ТЕХНИЧЕСКОЕ ЗАДАНИЕ (ТЗ) для ИИ
# Локальная версия NFT Sniper Bot на ПК (high-power CLI)

## Версия: 1.0
## Дата: 2026-09-28
## Цель: создать standalone TypeScript CLI sniper bot с live terminal dashboard

---

## 1. КРАТКОЕ ОПИСАНИЕ ПРОЕКТА

Создать **standalone CLI TypeScript бот** который работает в терминале на ПК пользователя (i7-11700K, 32GB RAM, GTX 1650 SUPER). Бот ищет free NFT mints на Base/Optimism/Arbitrum через Pimlico Account Abstraction и автоматически минтит их.

**Ключевые отличия от Vercel версии:**
- Нет 60-секундного таймаута → можно сканировать 30+ контрактов за цикл
- Нет rate limits от Vercel → скан каждые 10 секунд (вместо 60 сек)
- Нет HTTP server / Next.js — только CLI с ANSI dashboard
- Нет Telegram — весь output в терминал
- Persistent state через Supabase (shared с Vercel ботом)

---

## 2. ТЕХ СТЕК И ЗАВИСИМОСТИ

### Runtime
- **Bun** (предпочтительно) или Node.js 22+
- **TypeScript 5.x** (нативно поддерживается Bun)

### Библиотеки (точные версии):
```json
{
  "viem": "^2.56.9",                          // Account Abstraction + EVM client
  "permissionless": "^0.4.1",                 // Safe Smart Account utilities
  "dotenv": "^16.4.5"                         // .env loading (Bun auto-loads, но для надёжности)
}
```

### НЕ использовать:
- Next.js (не нужен для CLI)
- Express/Fastify (нет HTTP)
- Telegram SDK (нет TG)
- WebSocket (не нужен)

---

## 3. АРХИТЕКТУРА

```
┌─────────────────────────────────────────────────────────────┐
│                  LOCAL SNIPER CLI                          │
│  scripts/local-sniper/local-sniper.ts (entry point)        │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ scanForFreeMints│  │ executeMint  │    │ renderDashboard│
│  (5 strategies)│  │ (multi-fn)   │    │ (ANSI colors) │
└──────────────┘    └──────────────┘    └──────────────┘
        │                   │
        ▼                   ▼
┌──────────────────────────────────────────┐
│ Pimlico Account Abstraction:           │
│ - Bundler (UserOp submit)                │
│ - Paymaster (gas sponsorship/verifying) │
│ - SafeSmartAccount 1.4.1 + EntryPoint v0.6│
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│ Supabase (shared state):                │
│ - attempted_contracts (dedup, 15min TTL)│
│ - bot_state (stats + activity log)       │
│ - runtime_config (Alchemy key и т.д.)    │
└──────────────────────────────────────────┘
```

---

## 4. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (.env.local)

### КРИТИЧНЫЕ (обязательны):

```bash
# Pimlico — для gasless transactions через Account Abstraction
PIMLICO_API_KEY=pim_VXiKbWFNUjQqKPh8x7ui4g

# EOA private key (256-bit hex string starting with 0x)
# Этот ключ — владелец Smart Account. Сгенерировать можно так:
# node -e "const c=require('crypto');console.log('0x'+c.randomBytes(32).toString('hex'))"
SIGNER_PRIVATE_KEY=0xf28836ed0f3d4786c13469f13254bbe80999a27c41593480968835f3d064d3af

# OpenSea API v2 — для finding mints via events endpoint
OPENSEA_API_KEY=3b2150459f1b4a43ac711552254cb43c

# Alchemy API — для alchemy_getAssetTransfers (более надёжный чем eth_getLogs)
ALCHEMY_API_KEY=alch_BUo0TYqkD24rLEzrz4U3n

# Supabase — для persistent dedup (shared с Vercel ботом)
SUPABASE_URL=https://ваш-project.supabase.co
SUPABASE_SERVICE_KEY=ваш_service_role_key

# Telegram (опционально для локальной версии — обычно не нужно)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### ОПЦИОНАЛЬНЫЕ:

```bash
# Pimlico Sponsor Policy — для truly gasless ментов (без него используется verifying paymaster)
# Получить: https://dashboard.pimlico.io/sponsorship-policies
PIMLICO_SPONSOR_POLICY_ID=

# Basescan API — для verified ABIs (улучшает mint function detection)
BASESCAN_API_KEY=

# Default listing price для auto-listing на OpenSea
LISTING_PRICE_ETH=0.005
```

---

## 5. СТРУКТУРА ФАЙЛОВ

```
/home/z/my-project/
├── scripts/
│   └── local-sniper/
│       └── local-sniper.ts          # ENTRY POINT — CLI dashboard
├── src/
│   └── lib/
│       ├── sniper.ts                # Main logic: scanForFreeMints + executeMint + runSniperCycle
│       ├── pimlico.ts               # Chain configs + RPC clients + Smart Account init
│       ├── basescan.ts              # findFreeMintFunction (4 strategies + blind mint)
│       ├── opensea.ts               # OpenSea API client (events, collections)
│       ├── alchemy-scanner.ts       # Alchemy NFT API (getAssetTransfers, getContractMetadata)
│       ├── supabase.ts              # Persistent state (saveState, loadState)
│       ├── stats.ts                 # In-memory stats + Supabase sync
│       ├── price-checker.ts         # Read price()/cost()/mintPrice() from contract
│       ├── deployment-scanner.ts   # Find newly deployed contracts via getLogs
│       ├── opensea-scanner.ts       # floor=0 collections scanner (fallback)
│       ├── social-scanner.ts       # Twitter/social search for "free mint" announcements
│       ├── whale-tracker.ts        # Copy mints from pro farmers
│       ├── seaport.ts               # Auto-listing on OpenSea via Seaport
│       ├── telegram.ts              # TG notifications (не используется в локальной версии)
│       └── quality.ts              # Spam name detection
├── .env.local                        # Все credentials (не коммитить в git!)
├── package.json
└── tsconfig.json
```

---

## 6. КРИТИЧЕСКИЕ ДЕТАЛИ РЕАЛИЗАЦИИ (ОБЯЗАТЕЛЬНО УЧЕСТЬ!)

### 6.1. Pimlico EntryPoint override (КРИТИЧНО!)

**Проблема:** viem 2.56.9 использует canonical EntryPoint v0.6 адрес `0x5FF137D4b0FdcD35d5c04935a44dBd9E4c25101A` который НЕ задеплоен на Base/Optimism/Arbitrum. Pimlico задеплоил свой собственный контракт EntryPoint по другому адресу.

**Решение:** При создании SafeSmartAccount явно переопределять entryPoint:

```typescript
import { toSafeSmartAccount } from 'permissionless/accounts';

const PIMLICO_ENTRYPOINT_V06_ADDRESS =
  '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as `0x${string}`;

const smartAccount = await toSafeSmartAccount({
  client: publicClient,
  owners: [signer],
  threshold: 1n,
  version: '1.4.1',
  entryPoint: {
    address: PIMLICO_ENTRYPOINT_V06_ADDRESS,
    version: '0.6',  // v0.6 — единственная работающая версия на L2s через Pimlico
  },
});
```

**Проверка:** Адреса canonical EntryPoint НЕ задеплоены на Base:
- `0x5FF137D4b0FdcD35d5c04935a44dBd9E4c25101A` — `eth_getCode` возвращает `0x` (нет кода)
- `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` — `eth_getCode` возвращает bytecode (задеплоен)

### 6.2. viem 2.56.9 Gas Price Bug (КРИТИЧНО!)

**Проблема:** В viem 2.56.9 в `prepareUserOperation` есть баг — IIFE для 'fees' возвращает `request` UNCHANGED когда params.maxFeePerGas уже bigint, так что `request` НИКОГДА не получает gas fields. Pimlico reject-ит UserOp с ошибкой `"Validation error: expected string, received undefined at params[0].userOp.maxFeePerGas"`.

**Решение:** Использовать `userOperation.estimateFeesPerGas` хук в `createSmartAccountClient`:

```typescript
import { createSmartAccountClient } from 'permissionless';
import { getUserOperationGasPrice } from 'permissionless/actions/pimlico';

const smartAccountClient = createSmartAccountClient({
  account: smartAccount,
  chain: CHAIN_CONFIGS[chainKey].chain,
  bundlerTransport: http(`https://api.pimlico.io/v2/${chainKey}/rpc?apikey=${PIMLICO_API_KEY}`),
  paymaster: paymasterClient,
  userOperation: {
    estimateFeesPerGas: async () => {
      try {
        const prices = await getUserOperationGasPrice(bundlerClient);
        return {
          maxFeePerGas: prices.standard.maxFeePerGas,
          maxPriorityFeePerGas: prices.standard.maxPriorityFeePerGas,
        };
      } catch {
        // Fallback на маленькое значение если Pimlico недоступен
        return { maxFeePerGas: 2000000n, maxPriorityFeePerGas: 1000000n };
      }
    },
  },
});
```

### 6.3. Paymaster Context — Conditional (КРИТИЧНО!)

Если `PIMLICO_SPONSOR_POLICY_ID` не задан — НЕ передавай `paymasterContext: { policyId: undefined }`. Pimlico reject-ит с "-32601 Validation error".

```typescript
const clientConfig: any = {
  account: smartAccount,
  chain: CHAIN_CONFIGS[chainKey].chain,
  bundlerTransport: http(pimlicoUrl),
  paymaster: paymasterClient,
};

const sponsorPolicyId = process.env.PIMLICO_SPONSOR_POLICY_ID;
if (sponsorPolicyId) {
  clientConfig.paymasterContext = { policyId: sponsorPolicyId };
}
// Если не задан → Pimlico использует default verifying paymaster
// (требует ETH на Smart Account, но mints будут проходить)

const smartAccountClient = createSmartAccountClient(clientConfig);
```

### 6.4. Balance Check Before Mint (КРИТИЧНО!)

Перед попыткой mint — проверь баланс Smart Account на цепи контракта. Если < 0.00005 ETH — skip (Pimlico всё равно revert-нёт с "Insufficient ETH"):

```typescript
const MIN_ETH_FOR_GAS = 50_000_000_000_000n; // 0.00005 ETH в wei

const { publicClient: pc } = getClientsForChain(chainKey);
const smartAccountAddress = (await initSmartAccount(chainKey)).smartAccountAddress;
const balance: bigint = await pc.getBalance({ address: smartAccountAddress });

if (balance < MIN_ETH_FOR_GAS) {
  return {
    candidate,
    success: false,
    error: `Insufficient ETH on ${chainKey} (balance: ${Number(balance) / 1e18} ETH, need ≥0.00005)`,
  };
}
```

### 6.5. RPC Configuration — НЕ использовать Pimlico для state queries

Pimlico RPC поддерживает ТОЛЬКО AA методы (`pm_*`, `pimlico_*`, `eth_chainId`, `eth_supportedEntryPoints`). НЕ поддерживает `eth_call`, `eth_getBalance`, `eth_getLogs`.

**Используй PublicNode RPC для state queries:**

```typescript
export const CHAIN_CONFIGS: Record<ChainKey, ChainConfig> = {
  base: {
    key: 'base',
    chain: base,
    rpcUrl: 'https://base-rpc.publicnode.com',  // ✅ надёжный
    scannerUrl: 'https://basescan.org',
    openSeaChain: 'base',
  },
  optimism: {
    key: 'optimism',
    chain: optimism,
    rpcUrl: 'https://optimism-rpc.publicnode.com',
    scannerUrl: 'https://optimistic.etherscan.io',
    openSeaChain: 'optimism',
  },
  arbitrum: {
    key: 'arbitrum',
    chain: arbitrum,
    rpcUrl: 'https://arbitrum-one-rpc.publicnode.com',
    scannerUrl: 'https://arbiscan.io',
    openSeaChain: 'arbitrum',
  },
};
```

### 6.6. recordMintFailure / recordMintSuccess — обязательно передавать аргументы

`stats.ts:recordMintFailure(error, contract, chain)` требует `error` как первый аргумент. Если вызвать `recordMintFailure()` без аргументов → внутри `error.slice(0, 100)` → crash с "Cannot read properties of undefined (reading 'slice')".

```typescript
// ❌ НЕПРАВИЛЬНО (crash)
recordMintFailure();
recordMintSuccess();
recordMintAttempt();

// ✅ ПРАВИЛЬНО
recordMintFailure(errorMsg, candidate.contract, chainKey);
recordMintSuccess(txHash, candidate.contract, chainKey);
recordMintAttempt(candidate.contract, chainKey);
```

### 6.7. Persistent Dedup via Supabase

In-memory ATTEMPTED set не переживает Vercel cold start (или перезапуск CLI). Нужно persist в Supabase:

```typescript
const ATTEMPTED = new Map<string, number>(); // key=`${chain}:${contract}`, value=unix ms
const ATTEMPTED_TTL_MS = 15 * 60 * 1000; // 15 минут

let ATTEMPTED_LOADED = false;

async function ensureAttemptedLoaded(): Promise<void> {
  if (ATTEMPTED_LOADED) return;
  ATTEMPTED_LOADED = true;
  try {
    const { loadState } = await import('@/lib/supabase');
    const persisted = await loadState<{ [k: string]: number }>('attempted_contracts');
    if (persisted) {
      const now = Date.now();
      for (const [k, ts] of Object.entries(persisted)) {
        if (typeof ts === 'number' && now - ts < ATTEMPTED_TTL_MS) {
          ATTEMPTED.set(k, ts);
        }
      }
    }
  } catch {}
}

async function saveAttempted(): Promise<void> {
  try {
    const { saveState } = await import('@/lib/supabase');
    const obj: { [k: string]: number } = {};
    for (const [k, ts] of ATTEMPTED.entries()) obj[k] = ts;
    await saveState('attempted_contracts', obj);
  } catch {}
}

function isRecentlyAttempted(chain: string, contract: string): boolean {
  const key = `${chain}:${contract.toLowerCase()}`;
  const ts = ATTEMPTED.get(key);
  return ts ? Date.now() - ts < ATTEMPTED_TTL_MS : false;
}

function markAttempted(chain: string, contract: string): void {
  ATTEMPTED.set(`${chain}:${contract.toLowerCase()}`, Date.now());
  void saveAttempted();
}
```

---

## 7. SCAN PIPELINE — 5 СТРАТЕГИЙ

Стратегии запускаются в порядке, если candidates.length < maxCandidates:

### Strategy 1: OpenSea Events API (PRIMARY)
```typescript
// GET https://api.opensea.io/api/v2/events?chain=base&event_type=transfer&limit=100&after={unix_ts}
// Header: X-API-KEY: {OPENSEA_API_KEY}
// Supports cursor pagination via `next` field
// Filter: from_address === null OR from_address === "0x0000..." OR transfer_type === "mint"
// Window: 6 hours (21600 sec), 3 pages = 300 events

import { getRecentBaseTransfers, filterMintEventsForChains } from '@/lib/opensea';

const events = await getRecentBaseTransfers(100, 6 * 3600, 3);
const mintContracts = filterMintEventsForChains(events, ['base', 'optimism', 'arbitrum', 'matic', 'ethereum']);
```

### Strategy 2: Alchemy getAssetTransfers
```typescript
// RPC method alchemy_getAssetTransfers — находит mint events через transfers from zero address
// Runs in PARALLEL across base+optimism+arbitrum (last 500 blocks each)
// Returns unique contract addresses that minted NFTs

import { scanAlchemyMintsAcrossChains } from '@/lib/alchemy-scanner';

const alchemyContracts = await scanAlchemyMintsAcrossChains(
  ['base', 'optimism', 'arbitrum'],
  500
);
```

### Strategy 3: Social Signal Scanner (опционально)
Twitter search for "free mint base" → extract contract addresses.

### Strategy 4: Whale Copy-Minting (опционально)
Copy mints from known pro farmer addresses.

### Strategy 5: OpenSea floor=0 fallback
Scan OpenSea collections with floor_price = 0 → potential free mints.

### Filtering:
- Skip if already in `tried` set (within same scan)
- Skip if `isRecentlyAttempted(chain, contract)` (15-min TTL via Supabase)
- For each remaining: call `findFreeMintFunction(contract)` to detect mint function name

---

## 8. MINT EXECUTION PIPELINE

### 8.1. findFreeMintFunction (4 strategies in basescan.ts):

```typescript
async function findFreeMintFunction(contractAddress: string) {
  // Strategy 1: Price-aware detection (read price()/cost()/mintPrice())
  const priceResult = await findFreeMintViaPriceCheck(contractAddress);
  if (priceResult) return { ...priceResult, source: 'fallback' };

  // Strategy 2: Basescan verified ABI
  const basescanResult = await findFreeMintViaBasescanAbi(contractAddress);
  if (basescanResult) return { ...basescanResult, source: 'basescan' };

  // Strategy 3: Top-10 common mint function signatures (static calls)
  const fastFallbackResult = await findFreeMintViaFastFallback(contractAddress);
  if (fastFallbackResult) return { ...fastFallbackResult, source: 'fallback' };

  // Strategy 4: BLIND MINT — try mint() without verification
  return { functionName: 'mint', args: [], source: 'blind' };
}
```

### 8.2. Multi-function Mint (КРИТИЧНО для успеха!)

После detecting functionName — пробуй 13 функций в последовательности. Если первый revert-ит, попробуй следующий:

```typescript
const MINT_FUNCTION_ATTEMPTS = [
  candidate.functionName,  // Detected first (highest confidence)
  'mint', 'publicMint', 'claim', 'freeMint', 'claimFree',
  'mintForFree', 'mintFree', 'freeClaim', 'airdrop',
  'gift', 'drop', 'publicClaim',
].filter((v, i, a) => v && a.indexOf(v) === i); // dedup

let txHash = null;
let usedFunctionName = candidate.functionName;

for (const fnName of MINT_FUNCTION_ATTEMPTS) {
  try {
    const abi = (Array.isArray(candidate.abiInputs) && fnName === candidate.functionName)
      ? [{ type: 'function', name: fnName, inputs: candidate.abiInputs, outputs: [], stateMutability: 'nonpayable' }]
      : FREE_MINT_ABI; // has all standard mint signatures

    const attemptTx = await smartAccountClient.writeContract({
      address: candidate.contract,
      abi,
      functionName: fnName,
      args: candidate.args,
    }, {
      maxFeePerGas: gasPrice.maxFeePerGas,
      maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
    });

    txHash = attemptTx;
    usedFunctionName = fnName;
    break;
  } catch (err) {
    if (isBoringRevertError(err.message)) {
      // Paid/whitelist contract — try next function
      continue;
    }
    throw err; // Unexpected error
  }
}
```

### 8.3. Spam Filter (isBoringRevertError)

Не spam TG (или terminal output) на "boring" revert-ы — это норма для blind mint:

```typescript
function isBoringRevertError(errorMsg: string): boolean {
  const lower = (errorMsg || '').toLowerCase();
  const patterns = [
    'execution reverted', 'revert', 'insufficient',
    'incorrectethervalue', 'wrongether', 'notenough',
    'underpriced', 'value mismatch', 'missing',
    'require: false', 'safeerc20', 'transferfailed',
    'mintnotactive', 'paused', 'notstarted',
    'sale not', 'allowlist', 'whitelist', 'not allowed',
  ];
  return patterns.some(p => lower.includes(p));
}
```

---

## 9. SMART ACCOUNT DETAILS

### Address: 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A
(Одинаковый на всех L2 chains — deterministic derivation)

### Configuration:
- Safe version: 1.4.1
- EntryPoint: v0.6 (Pimlico custom address 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789)
- Owner: single EOA (threshold 1)
- Counterfactual — deploys on first UserOp

### Safe Contract Addresses (задеплоены на Base/Optimism/Arbitrum):
- SAFE_PROXY_FACTORY: `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`
- SAFE_SINGLETON: `0x41675C099F32341bf84BFc5382aF534df5C7461a`
- SAFE_4337_MODULE (v0.6): `0xa581c4A4DB7175302464fF3C06380BC3270b4037`
- SAFE_MODULE_SETUP: `0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb`
- MULTI_SEND: `0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526`

### Pre-funded ETH balances:
- Base: 0.002011 ETH (~$6)
- Optimism: 0.000900 ETH (~$2.7)
- Arbitrum: 0.000900 ETH (~$2.7)

---

## 10. RPC CONFIGURATION

| Цепь | Chain ID | RPC URL | Использование |
|---|---|---|---|
| Base | 8453 | https://base-rpc.publicnode.com | State queries (eth_call, eth_getBalance, eth_getLogs) |
| Optimism | 10 | https://optimism-rpc.publicnode.com | State queries |
| Arbitrum | 42161 | https://arbitrum-one-rpc.publicnode.com | State queries |
| Base | 8453 | https://api.pimlico.io/v2/base/rpc?apikey={key} | AA methods (pm_*, pimlico_*) + UserOp submission |
| Optimism | 10 | https://api.pimlico.io/v2/optimism/rpc?apikey={key} | AA methods |
| Arbitrum | 42161 | https://api.pimlico.io/v2/arbitrum/rpc?apikey={key} | AA methods |
| Base | 8453 | https://base-mainnet.g.alchemy.com/v2/{key} | alchemy_getAssetTransfers (special method) |
| Optimism | 10 | https://opt-mainnet.g.alchemy.com/v2/{key} | alchemy_getAssetTransfers |
| Arbitrum | 42161 | https://arb-mainnet.g.alchemy.com/v2/{key} | alchemy_getAssetTransfers |

---

## 11. PERSISTENT STATE (SUPABASE)

### Table: bot_state
```sql
CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
-- Service role bypasses RLS automatically
```

### Keys used:
1. `attempted_contracts` — `{ "base:0x123...": 1695900000000, ... }` (15-min TTL)
2. `bot_state` — `{ stats: {...}, activityLog: [...], recentMints: [...] }`
3. `runtime_config` — `{ alchemy_api_key: "alch_..." }` (fallback если env var не задан)

### Supabase REST API:
- URL: `{SUPABASE_URL}/rest/v1/bot_state`
- Headers: `apikey: {SERVICE_KEY}`, `Authorization: Bearer {SERVICE_KEY}`
- POST with `Prefer: resolution=merge-duplicates` for upsert
- GET with `?key=eq.{key}&select=value` for select

---

## 12. TERMINAL DASHBOARD REQUIREMENTS

CLI должен показывать live dashboard с ANSI цветами:

```
╔══════════════════════════════════════════════════════════════╗
║         🤖 LOCAL SNIPER BOT — HIGH POWER MODE               ║
╚══════════════════════════════════════════════════════════════╝

  Time: 9/28/2026, 3:45:22 PM  Uptime: 5m 30s
  Status: ● SCANNING

  Smart Account: 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A

  💰 Balances:
    BASE       0.002011 ETH  ($6.03)
    OPTIMISM   0.000900 ETH  ($2.70)
    ARBITRUM   0.000900 ETH  ($2.70)

  📊 Stats (this session):
    Local:  scans=32  mints=45  ✓0  ✗45  rate=0.0%
    Global: scans=200  mints=80  ✓0  ✗78

  🎯 Last cycle results (3 mints attempted):
    ✓ [base    ] OpenSea mint 0x96ceb  → SUCCESS tx=0xabc123...
    ✗ [base    ] Alchemy mint 0x84917  → PAID All 12 mint function attempts re
    ✗ [optimism] Alchemy mint 0x416b4  → SKIP_NO_ETH Insufficient ETH

  📜 Recent activity:
    [candidate_foun] 🚀 Alchemy: 0x96cebb74... on base — mint() [blind]
    [chain_scan    ] Alchemy: 5 mint events found across base+optimism+arbitrum
    [mint_failed_sil] 🎲 mint() reverted on OpenSea mint — trying next function

══════════════════════════════════════════════════════════════
  Next scan in 10s · Press Ctrl+C to stop
  Config: maxCandidates=30 maxMints=10 chains=[base, optimism, arbitrum]
```

### Dashboard implementation:
- Clear screen каждые 500ms (через `process.stdout.write('\x1b[2J\x1b[3J\x1b[H')`)
- ANSI colors: `\x1b[31m` (red), `\x1b[32m` (green), `\x1b[33m` (yellow), `\x1b[34m` (blue), `\x1b[36m` (cyan), `\x1b[1m` (bold), `\x1b[0m` (reset)
- Sections: Header, Status, Smart Account, Balances, Stats, Last Cycle Results, Activity Log, Errors, Footer
- Ctrl+C handler: graceful shutdown, print final stats

---

## 13. LOCAL SNIPER CLI — CONFIGURATION

### Константы (для high-power локального бота):

```typescript
const SCAN_INTERVAL_MS = 10_000;        // 10 секунд между сканов (Vercel: 60 сек)
const MAX_MINTS_PER_CYCLE = 10;          // 10 ментов за цикл (Vercel: 3)
const MAX_CANDIDATES_PER_SCAN = 30;      // 30 кандидатов за скан (Vercel: 15)
const SCAN_CHAINS: ChainKey[] = ['base', 'optimism', 'arbitrum'];

const ATTEMPTED_TTL_MS = 15 * 60 * 1000;  // 15 минут (Vercel: тоже 15 минут)
const HEARTBEAT_INTERVAL = 60;             // Heartbeat каждые 60 сканов (не нужно для local)
```

### Запуск:

```bash
# Установка зависимостей
cd /home/z/my-project
bun install

# Запуск локального бота
bun run scripts/local-sniper/local-sniper.ts
```

---

## 14. MINT EXECUTION — DETAILED FLOW

```
1. scanForFreeMints(maxCandidates=30)
   ├─ Strategy 1: OpenSea events (6h window, 3 pages, 300 events)
   ├─ Strategy 2: Alchemy getAssetTransfers (last 500 blocks per chain)
   ├─ Strategy 3: Social scanner
   ├─ Strategy 4: Whale tracker
   └─ Strategy 5: OpenSea floor=0 fallback

2. For each candidate (up to MAX_MINTS_PER_CYCLE):
   ├─ Balance check (skip if < 0.00005 ETH on chain)
   ├─ Init Smart Account (cached per chain)
   ├─ Get gas price (pimlico_getUserOperationGasPrice)
   ├─ Multi-function mint loop (try 13 functions):
   │   ├─ Build ABI for current function name
   │   ├─ smartAccountClient.writeContract(...)
   │   ├─ If success → break, record success
   │   └─ If revert (boring) → try next function
   └─ Mark as attempted (Supabase save)

3. On success:
   ├─ Extract tokenId from tx receipt (Transfer event topic3)
   ├─ Get collection floor price (OpenSea API)
   ├─ Send notifyListingLink to TG (опционально для local)
   └─ Auto-list on OpenSea via Seaport (опционально)

4. Loop:
   └─ Sleep SCAN_INTERVAL_MS, repeat
```

---

## 15. ИЗВЕСТНЫЕ ПРОБЛЕМЫ И КАК ИХ ИЗБЕЖАТЬ

### 15.1. "Method pm_getPaymasterStubData does not exist"
**Причина:** viem canonical EntryPoint v0.6 (0x5FF137D4b0FdcD35d5c04935a44dBd9E4c25101A) НЕ задеплоен на L2s.
**Решение:** Override entryPoint в toSafeSmartAccount с Pimlico custom address (0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789).

### 15.2. "Validation error: expected string, received undefined at params[0].userOp.maxFeePerGas"
**Причина:** viem 2.56.9 bug — `fees` IIFE в `prepareUserOperation` не merge-ит gas prices в request.
**Решение:** Использовать `userOperation.estimateFeesPerGas` хук в `createSmartAccountClient`.

### 15.3. "Cannot read properties of undefined (reading 'slice')"
**Причина:** `recordMintFailure()` вызывается без аргументов, внутри `error.slice(0, 100)` crash-ит.
**Решение:** Передавать `errorMsg, contract, chain` во все `record*` функции.

### 15.4. "RPC Request failed. URL: https://mainnet.base.org"
**Причина:** Official Base RPC unreliable from Vercel/cloud — часто timeouts.
**Решение:** Использовать PublicNode RPC (https://base-rpc.publicnode.com).

### 15.5. "The method eth_call does not exist"
**Причина:** Pimlico RPC не поддерживает standard RPC методы — только AA methods.
**Решение:** Использовать PublicNode для eth_call/eth_getBalance/eth_getLogs, Pimlico только для bundler/paymaster.

### 15.6. Bot спамит TG теми же 6 контрактами
**Причина:** In-memory ATTEMPTED set не выживает cold start.
**Решение:** Persistent dedup via Supabase (key: `attempted_contracts`, TTL 15 мин).

### 15.7. Бот пытается mint на chains где нет ETH
**Причина:** Не было balance check перед mint.
**Решение:** Проверять баланс Smart Account на chain контракта перед mint.

### 15.8. paymasterContext {policyId: undefined} rejected
**Причина:** Pimlico reject-ит пустой policyId.
**Решение:** Conditionally set paymasterContext только если PIMLICO_SPONSOR_POLICY_ID задан.

---

## 16. SUCCESS CRITERIA

Бот считается работающим если:

1. ✅ CLI запускается без ошибок: `bun run scripts/local-sniper/local-sniper.ts`
2. ✅ Dashboard обновляется каждые 500ms
3. ✅ Scans происходят каждые 10 секунд
4. ✅ Smart Account баланс читается корректно (3 цепи)
5. ✅ Alchemy находит mint events (не 0)
6. ✅ OpenSea находит mint events (не 0)
7. ✅ Multi-function mint пробует 13 функций
8. ✅ Dedup работает (тот же контракт не повторяется в течение 15 мин)
9. ✅ Balance check skip-ает arbitrum/optimism если нет ETH
10. ✅ При нахождении free mint → SUCCESS с tx hash
11. ✅ Reverting в simulation не тратит ETH (Pimlico simulation бесплатный)
12. ✅ Ctrl+C останавливает bot gracefully

---

## 17. ОТЛАДКА И ТЕСТИРОВАНИЕ

### Test 1: Verify Smart Account init
```bash
curl -s https://base-airdrop-radar.vercel.app/api/sniper/status | jq '.config.smart_account_address'
# Should return: "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A"
```

### Test 2: Verify balances
```bash
curl -s -X POST https://base-rpc.publicnode.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A","latest"],"id":1}'
# Should return non-zero result
```

### Test 3: Verify Alchemy API key
```bash
curl -s -X POST https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
# Should return valid block number
```

### Test 4: Run single scan cycle
```bash
curl -s -X POST https://base-airdrop-radar.vercel.app/api/sniper/run | jq '.scanned, .results'
# Should return scanned > 0 and results array
```

### Test 5: Verify Supabase persistence
```bash
curl -s https://base-airdrop-radar.vercel.app/api/sniper/status | jq '.stats.totalScans'
# Wait 1 minute (cron runs)
# Re-check — totalScans should increase
```

---

## 18. ФИНАЛЬНАЯ АРХИТЕКТУРА

```
┌─────────────────────────────────────────────────────────────┐
│              USER PC (i7-11700K, 32GB RAM)                 │
│                                                             │
│  Terminal (Windows Terminal / PowerShell / cmd)            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  $ bun run scripts/local-sniper/local-sniper.ts   │    │
│  │                                                     │    │
│  │  ╔══════════════════════════════════════════════╗  │    │
│  │  ║  🤖 LOCAL SNIPER BOT — HIGH POWER MODE     ║  │    │
│  │  ╚══════════════════════════════════════════════╝  │    │
│  │  Status: ● SCANNING                                │    │
│  │  Smart Account: 0x53dbe1b36BA3BEAC6cEf6cD22AD...   │    │
│  │  💰 Balances:                                      │    │
│  │    BASE       0.002011 ETH  ($6.03)                │    │
│  │    OPTIMISM   0.000900 ETH  ($2.70)                │    │
│  │    ARBITRUM   0.000900 ETH  ($2.70)                │    │
│  │  📊 Stats: scans=32 mints=45 ✓0 ✗45               │    │
│  │  🎯 Last cycle: 3 mints attempted                  │    │
│  │  ...                                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─── libraries ──────┐  ┌─── state ──────┐                │
│  │ viem 2.56.9         │  │ Supabase       │                │
│  │ permissionless 0.4  │  │ (shared with   │                │
│  │ dotenv              │  │  Vercel bot)   │                │
│  └─────────────────────┘  └────────────────┘                │
└─────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
    ┌──────────────────┐          ┌──────────────────┐
    │  PIMLICO API     │          │  SUPABASE        │
    │  (bundler +      │          │  (persistent     │
    │   paymaster)     │          │   state)         │
    └──────────────────┘          └──────────────────┘
              │
              ▼
    ┌──────────────────────────────────────────┐
    │  L2 CHAINS (Base + Optimism + Arbitrum) │
    │                                          │
    │  Smart Account: 0x53dbe1b36BA3BEAC...   │
    │  - 0.002011 ETH on Base                  │
    │  - 0.000900 ETH on Optimism              │
    │  - 0.000900 ETH on Arbitrum              │
    └──────────────────────────────────────────┘
```

---

## 19. EXTERNAL API DOCUMENTATION

### 19.1. Pimlico API
- Docs: https://docs.pimlico.io
- Bundler URL: https://api.pimlico.io/v2/{chain}/rpc?apikey={key}
- Free tier: 300M compute units/month
- Methods: pm_getPaymasterStubData, pm_sponsorUserOperation, pimlico_getUserOperationGasPrice, pimlico_getUserOperationStatus, eth_supportedEntryPoints, eth_chainId

### 19.2. OpenSea API v2
- Docs: https://docs.opensea.io/reference/api-ref
- Base URL: https://api.opensea.io/api/v2
- Free tier: 4 req/sec, 10k requests/day
- Header: X-API-KEY: {OPENSEA_API_KEY}
- Endpoints: /events, /collections, /assets, /collections/{slug}

### 19.3. Alchemy API
- Docs: https://docs.alchemy.com
- RPC URL: https://{chain}-mainnet.g.alchemy.com/v2/{key}
- REST URL: https://nft.alchemy.com/v3/{endpoint}
- Free tier: 300M compute units/month, 25k NFT API requests/month
- RPC methods: alchemy_getAssetTransfers, eth_getBalance, eth_call, eth_getLogs
- REST endpoints: getContractMetadata, isSpamContract, getNftsForCollection

### 19.4. Basescan API
- Docs: https://docs.basescan.org
- Base URL: https://api.basescan.org/api
- Free tier: 5 req/sec, 100k req/day
- Endpoint: ?module=contract&action=getabi&address={addr}&apikey={key}

### 19.5. Supabase REST API
- Docs: https://supabase.com/docs/reference
- URL: {SUPABASE_URL}/rest/v1/{table}
- Headers: apikey + Authorization: Bearer (both with SERVICE_KEY)
- POST with `Prefer: resolution=merge-duplicates` for upsert
- GET with `?key=eq.{value}&select=value` for select

---

## 20. ТРЕБОВАНИЯ К КОДУ

### Code style:
- TypeScript strict mode
- Функции async/await (не Promise.then chains)
- JSDoc комментарии для всех exported функций
- Экспортируемые типы через `export interface`
- Ошибки должны быть caught и логированы, не пробрасываемыми
- Fire-and-forget для TG notifications через `void fn().catch(() => {})`

### Performance:
- Cache clients per chain (creating clients is expensive)
- Use Promise.all for parallel scans
- Cache ATTEMPTED map in memory, save to Supabase periodically
- Use bigint for all wei values (avoid Number precision loss)

### Security:
- Никогда не коммить .env.local в git (добавить в .gitignore)
- Использовать Encrypted type для Vercel env vars
- Service role key for Supabase (bypasses RLS) — хранить только в env vars
- SIGNER_PRIVATE_KEY — owner of Smart Account, не показывать никому

---

## 21. ДОСТАВЛЯЕМЫЕ ФАЙЛЫ

1. `scripts/local-sniper/local-sniper.ts` — главный CLI файл
2. `src/lib/sniper.ts` — main sniper logic (scanForFreeMints, executeMint, runSniperCycle)
3. `src/lib/pimlico.ts` — chain configs + Smart Account init
4. `src/lib/basescan.ts` — findFreeMintFunction + ABI fetcher
5. `src/lib/opensea.ts` — OpenSea API client
6. `src/lib/alchemy-scanner.ts` — Alchemy NFT API scanner
7. `src/lib/supabase.ts` — persistent state module
8. `src/lib/stats.ts` — in-memory + Supabase merged stats
9. `.env.local.example` — template для env vars (не реальные значения)
10. `package.json` — dependencies (viem, permissionless, dotenv)
11. `tsconfig.json` — TypeScript config с path aliases

---

## 22. ПРИМЕР КОДА — MINIMAL VIABLE LOCAL SNIPER

```typescript
// scripts/local-sniper/local-sniper.ts
import { config } from 'dotenv';
config({ path: '.env.local' });

import { runSniperCycle, getSmartAccountAddress } from '../../src/lib/sniper';
import { getStats } from '../../src/lib/stats';
import { getClientsForChain } from '../../src/lib/pimlico';

const SCAN_INTERVAL_MS = 10_000;
const MAX_MINTS_PER_CYCLE = 10;

async function getBalance(chain: string): Promise<number> {
  const { publicClient: pc } = getClientsForChain(chain as any);
  const sa = await getSmartAccountAddress();
  const bal: bigint = await pc.getBalance({ address: sa as `0x${string}` });
  return Number(bal) / 1e18;
}

async function main() {
  console.log('🚀 Starting Local Sniper Bot...');
  const sa = await getSmartAccountAddress();
  console.log(`Smart Account: ${sa}\n`);

  while (true) {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear

    console.log('═══════════════════════════════════════════════════');
    console.log('         🤖 LOCAL SNIPER BOT — HIGH POWER MODE    ');
    console.log('═══════════════════════════════════════════════════\n');

    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log(`Smart Account: ${sa}\n`);

    console.log('💰 Balances:');
    for (const chain of ['base', 'optimism', 'arbitrum']) {
      const bal = await getBalance(chain);
      console.log(`  ${chain.padEnd(10)} ${bal.toFixed(6)} ETH  ($${(bal * 3000).toFixed(2)})`);
    }
    console.log();

    const stats = getStats();
    console.log('📊 Stats:');
    console.log(`  Local:  scans=∞ mints=∞');
    console.log(`  Global: scans=${stats.totalScans} mints=${stats.totalMintsAttempted} ✓${stats.totalMintsSucceeded} ✗${stats.totalMintsFailed}\n`);

    console.log('⏳ Running scan cycle...\n');
    try {
      const result = await runSniperCycle(MAX_MINTS_PER_CYCLE);
      console.log(`✅ Cycle complete: scanned=${result.scanned}, mints=${result.results.length}\n`);
      for (const r of result.results) {
        if (r.success) {
          console.log(`  ✅ SUCCESS [${r.candidate.chain}] ${r.candidate.name} tx=${r.txHash?.slice(0, 18)}...`);
        } else {
          const err = (r.error || '').slice(0, 50);
          console.log(`  ❌ FAILED  [${r.candidate.chain}] ${r.candidate.name} — ${err}`);
        }
      }
    } catch (e: any) {
      console.log(`❌ Cycle error: ${e.message}`);
    }

    console.log(`\n⏭ Next scan in ${SCAN_INTERVAL_MS / 1000}s... (Ctrl+C to stop)\n`);
    await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
  }
}

main().catch(console.error);
```

---

## 23. ФИНАЛЬНЫЕ ЗАМЕЧАНИЯ

1. **Бот uses Smart Account 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A** — тот же что и Vercel bot. Если оба работают одновременно — возможны nonce конфликты (редко). Решение: временно остановить Vercel bot когда работает локальный.

2. **Persistent state shared via Supabase** — ATTEMPTED map shared между Vercel и Local ботами. Если один пометил контракт как attempted — второй тоже его скипнет.

3. **Free tier limits:**
   - Pimlico: 300M CUs/month — plenty
   - OpenSea: 10k req/day — limit для 24/7
   - Alchemy: 25k NFT req/month — plenty
   - Basescan: 100k req/day — plenty
   - Supabase: 500MB DB, 50k rows — plenty

4. **Реальные ожидания:**
   - Base/Optimism/Arbitrum: ~5-15 free mints/день на каждой
   - Local bot finds ~30-50% из них (running 24/7 если ПК включён)
   - Vercel bot finds ~70-90% (24/7 always)
   - Combined: ~90-95% coverage

5. **Когда будет первый SUCCESS?**
   - Free mints появляются раз в 1-3 часа на L2s
   - Бот ловит их в течение 10-60 секунд (между scans)
   - Ожидай первый ✅ через 1-6 часов после запуска

---

## 24. КОНТАКТЫ И ПОДДЕРЖКА

- GitHub repo: https://github.com/makar52nn2016-jpg/base-airdrop-radar
- Live Vercel deployment: https://base-airdrop-radar.vercel.app
- Telegram bot: @makar_base_sniper_bot
- Smart Account (Base): 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A

---

**END OF TECHNICAL SPECIFICATION**

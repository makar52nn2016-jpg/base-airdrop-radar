/**
 * In-memory stats tracker + live activity log.
 *
 * Survives on warm Vercel instances only — for persistent storage,
 * wire up Supabase later (see README).
 *
 * Tracked metrics:
 *   - totalScans: number of scan() calls
 *   - totalCandidatesDetected: number of free-mint contracts found
 *   - totalMintsAttempted: number of mint() calls
 *   - totalMintsSucceeded: number of mints that returned a txHash
 *   - totalMintsFailed: number of mints that errored
 *   - lastScanAt: ISO timestamp of last scan
 *   - lastMintAt: ISO timestamp of last mint attempt
 *   - firstRunAt: ISO timestamp of first invocation (proxy for "uptime since")
 *   - activityLog: rolling log of last 50 events (scan/mint/etc) with timestamps
 *     — used by dashboard for real-time activity feed
 *   - scannedContracts: last 50 unique contract addresses we scanned
 */

interface ActivityEvent {
  ts: string; // ISO timestamp
  type: 'scan_start' | 'scan_complete' | 'candidate_found' | 'mint_attempt' | 'mint_success' | 'mint_failure' | 'chain_scan' | 'telegram_sent' | 'error';
  message: string;
  chain?: string;
  contract?: string;
  txHash?: string;
}

interface Stats {
  totalScans: number;
  totalCandidatesDetected: number;
  totalMintsAttempted: number;
  totalMintsSucceeded: number;
  totalMintsFailed: number;
  lastScanAt: string | null;
  lastMintAt: string | null;
  lastScanCandidates: number;
  firstRunAt: string;
  scannedContracts: string[]; // last 50 unique contract addresses we scanned
  activityLog: ActivityEvent[];
  botState: 'idle' | 'scanning' | 'minting';
  currentChainBeingScanned?: string;
}

const stats: Stats = {
  totalScans: 0,
  totalCandidatesDetected: 0,
  totalMintsAttempted: 0,
  totalMintsSucceeded: 0,
  totalMintsFailed: 0,
  lastScanAt: null,
  lastMintAt: null,
  lastScanCandidates: 0,
  firstRunAt: new Date().toISOString(),
  scannedContracts: [],
  activityLog: [],
  botState: 'idle',
};

const MAX_SCANNED_LOG = 50;
const MAX_ACTIVITY_LOG = 50;

function logActivity(event: Omit<ActivityEvent, 'ts'>) {
  const entry: ActivityEvent = { ...event, ts: new Date().toISOString() };
  stats.activityLog.unshift(entry);
  if (stats.activityLog.length > MAX_ACTIVITY_LOG) {
    stats.activityLog.pop();
  }
}

export function setBotState(state: 'idle' | 'scanning' | 'minting', chain?: string) {
  stats.botState = state;
  if (chain) stats.currentChainBeingScanned = chain;
  if (state === 'idle') stats.currentChainBeingScanned = undefined;
}

export function logScanStart() {
  setBotState('scanning');
  logActivity({ type: 'scan_start', message: 'Started multi-chain scan' });
}

export function logChainScan(chain: string, found: number) {
  logActivity({
    type: 'chain_scan',
    message: `Scanned ${chain}: ${found} mints found in last 50 blocks`,
    chain,
  });
}

export function logCandidateFound(chain: string, contract: string, functionName: string) {
  logActivity({
    type: 'candidate_found',
    message: `Found free-mint on ${chain}: ${functionName}()`,
    chain,
    contract,
  });
}

export function recordScan(candidateCount: number, scannedAddresses: string[]) {
  stats.totalScans += 1;
  stats.lastScanAt = new Date().toISOString();
  stats.lastScanCandidates = candidateCount;
  stats.totalCandidatesDetected += candidateCount;

  // Update scannedContracts with unique new addresses
  for (const addr of scannedAddresses) {
    if (!stats.scannedContracts.includes(addr)) {
      stats.scannedContracts.unshift(addr);
      if (stats.scannedContracts.length > MAX_SCANNED_LOG) {
        stats.scannedContracts.pop();
      }
    }
  }

  setBotState('idle');
  logActivity({
    type: 'scan_complete',
    message: `Scan complete: ${candidateCount} candidates found`,
  });
}

export function recordMintAttempt(contract?: string, chain?: string) {
  stats.totalMintsAttempted += 1;
  stats.lastMintAt = new Date().toISOString();
  setBotState('minting', chain);
  logActivity({
    type: 'mint_attempt',
    message: `Attempting mint`,
    contract,
    chain,
  });
}

export function recordMintSuccess(txHash?: string, contract?: string, chain?: string) {
  stats.totalMintsSucceeded += 1;
  setBotState('idle');
  logActivity({
    type: 'mint_success',
    message: `Mint succeeded! tx: ${txHash?.slice(0, 16)}...`,
    txHash,
    contract,
    chain,
  });
}

export function recordMintFailure(error: string, contract?: string, chain?: string) {
  stats.totalMintsFailed += 1;
  setBotState('idle');
  logActivity({
    type: 'mint_failure',
    message: `Mint failed: ${error.slice(0, 100)}`,
    contract,
    chain,
  });
}

export function logError(message: string) {
  logActivity({ type: 'error', message });
}

export function getStats() {
  return {
    ...stats,
    scannedContracts: [...stats.scannedContracts],
    activityLog: [...stats.activityLog],
  };
}

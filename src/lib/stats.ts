/**
 * In-memory stats tracker.
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
 */

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
};

const MAX_SCANNED_LOG = 50;

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
}

export function recordMintAttempt() {
  stats.totalMintsAttempted += 1;
  stats.lastMintAt = new Date().toISOString();
}

export function recordMintSuccess() {
  stats.totalMintsSucceeded += 1;
}

export function recordMintFailure() {
  stats.totalMintsFailed += 1;
}

export function getStats() {
  return { ...stats, scannedContracts: [...stats.scannedContracts] };
}

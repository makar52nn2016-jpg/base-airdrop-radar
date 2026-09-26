'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Coins,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  Search,
  Wallet,
  XCircle,
} from 'lucide-react';

interface StatusResponse {
  timestamp: string;
  config: {
    pimlico: { configured: boolean; missing_env_vars: string[] };
    opensea: { configured: boolean };
    smart_account_address: string | null;
    smart_account_opensea_url: string | null;
    smart_account_basescan_url: string | null;
  };
  stats: {
    totalScans: number;
    totalCandidatesDetected: number;
    totalMintsAttempted: number;
    totalMintsSucceeded: number;
    totalMintsFailed: number;
    lastScanAt: string | null;
    lastMintAt: string | null;
    lastScanCandidates: number;
    firstRunAt: string;
    success_rate: number;
    uptime_since: string;
    scannedContracts: string[];
  };
  recent_mints: Array<{
    candidate: { slug: string; name: string; contract: string; opensea_url: string };
    success: boolean;
    txHash?: string;
    smartAccountAddress?: string;
    error?: string;
  }>;
  recent_mints_count: number;
  scanned_contracts_count: number;
  last_scanned_contracts: string[];
}

export default function DashboardPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [scanLoading, setScanLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [manualAddr, setManualAddr] = useState('');
  const [manualResult, setManualResult] = useState<any>(null);
  const [manualLoading, setManualLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/sniper/status', { cache: 'no-store' });
      const data = await resp.json();
      setStatus(data);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (e) {
      console.error('fetchStatus error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // every 30 sec
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const triggerScan = async () => {
    setScanLoading(true);
    try {
      const resp = await fetch('/api/sniper/scan?max=10', { cache: 'no-store' });
      const data = await resp.json();
      alert(`Scan complete: ${data.candidates?.length || 0} candidates found`);
      fetchStatus();
    } catch (e) {
      alert('Scan failed');
    } finally {
      setScanLoading(false);
    }
  };

  const triggerRun = async () => {
    setRunLoading(true);
    try {
      const resp = await fetch('/api/sniper/run', { cache: 'no-store' });
      const data = await resp.json();
      const count = data.results?.length || 0;
      alert(`Cycle complete: ${count} mints attempted. Check status for results.`);
      fetchStatus();
    } catch (e) {
      alert('Run failed');
    } finally {
      setRunLoading(false);
    }
  };

  const triggerManualMint = async () => {
    if (!manualAddr.startsWith('0x') || manualAddr.length !== 42) {
      alert('Invalid contract address. Must be 0x + 40 hex chars.');
      return;
    }
    setManualLoading(true);
    setManualResult(null);
    try {
      const resp = await fetch(`/api/sniper/manual?contract=${manualAddr}`, {
        cache: 'no-store',
      });
      const data = await resp.json();
      setManualResult(data);
      fetchStatus();
    } catch (e) {
      setManualResult({ success: false, error: 'Request failed' });
    } finally {
      setManualLoading(false);
    }
  };

  if (loading || !status) {
    return (
      <div className="min-h-screen bg-[#0a0b14] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00d4ff]" />
      </div>
    );
  }

  const stats = status.stats;
  const accountUrl = status.config.smart_account_opensea_url;

  return (
    <main className="min-h-screen bg-[#0a0b14] text-white">
      {/* Header */}
      <header className="border-b border-[#1f2233] bg-gradient-to-b from-[#0d1020] to-[#0a0b14]">
        <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0052ff] to-[#00d4ff] flex items-center justify-center text-xl font-bold">
                ◉
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  Base Airdrop Sniper
                </h1>
                <div className="text-xs text-[#5a6178] font-mono">
                  Live dashboard · Last update: {lastUpdate || 'never'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={`text-xs font-mono ${
                  status.config.pimlico.configured
                    ? 'bg-[#0a3a2a] text-[#00ff88]'
                    : 'bg-[#3a0a0a] text-[#ff0088]'
                }`}
              >
                {status.config.pimlico.configured ? '● ONLINE' : '● OFFLINE'}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchStatus}
                className="border-[#2a2e44] text-[#a0a8bc] hover:bg-[#1a1d2e]"
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Smart Account Banner */}
      <section className="border-b border-[#1f2233] bg-[#0d1020]">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-6xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-[#00d4ff]" />
              <div>
                <div className="text-xs text-[#5a6178] uppercase tracking-wide font-mono">
                  Smart Account (gasless)
                </div>
                <div className="text-sm font-mono text-white">
                  {status.config.smart_account_address || 'Not initialized'}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {accountUrl && (
                <a href={accountUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2081e2] hover:bg-[#1a6bc7] text-white">
                    <ExternalLink className="w-3 h-3 mr-1" /> OpenSea
                  </Button>
                </a>
              )}
              {status.config.smart_account_basescan_url && (
                <a
                  href={status.config.smart_account_basescan_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[#2a2e44] text-[#a0a8bc] hover:bg-[#1a1d2e]"
                  >
                    <ExternalLink className="w-3 h-3 mr-1" /> Basescan
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stats Grid */}
      <section className="py-6">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              icon={<Search className="w-4 h-4" />}
              label="Total Scans"
              value={stats.totalScans}
              color="#00d4ff"
            />
            <StatCard
              icon={<Rocket className="w-4 h-4" />}
              label="Candidates Found"
              value={stats.totalCandidatesDetected}
              color="#00ff88"
            />
            <StatCard
              icon={<Activity className="w-4 h-4" />}
              label="Mints Attempted"
              value={stats.totalMintsAttempted}
              color="#ffaa00"
            />
            <StatCard
              icon={<CheckCircle2 className="w-4 h-4" />}
              label="Successful Mints"
              value={stats.totalMintsSucceeded}
              color="#00ff88"
            />
            <StatCard
              icon={<XCircle className="w-4 h-4" />}
              label="Failed Mints"
              value={stats.totalMintsFailed}
              color="#ff0088"
            />
            <StatCard
              icon={<Coins className="w-4 h-4" />}
              label="Success Rate"
              value={`${stats.success_rate}%`}
              color="#00d4ff"
            />
          </div>
        </div>
      </section>

      {/* Action Buttons */}
      <section className="py-4">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <div className="flex gap-3 flex-wrap">
            <Button
              onClick={triggerScan}
              disabled={scanLoading}
              className="bg-[#0052ff] hover:bg-[#0040cc]"
            >
              {scanLoading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Search className="w-4 h-4 mr-1" />
              )}
              Trigger Scan
            </Button>
            <Button
              onClick={triggerRun}
              disabled={runLoading}
              className="bg-[#00ff88] hover:bg-[#00cc6a] text-[#0a0b14] font-semibold"
            >
              {runLoading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4 mr-1" />
              )}
              Trigger Full Cycle (Scan + Mint)
            </Button>
          </div>
          <div className="mt-2 text-xs text-[#5a6178] flex items-center gap-2">
            <Clock className="w-3 h-3" />
            Last scan: {stats.lastScanAt ? new Date(stats.lastScanAt).toLocaleString() : 'never'}
            {' · '}
            Last mint: {stats.lastMintAt ? new Date(stats.lastMintAt).toLocaleString() : 'never'}
            {' · '}
            Uptime since: {new Date(stats.firstRunAt).toLocaleString()}
          </div>
        </div>
      </section>

      {/* Two-column: Recent Mints + Manual Mint */}
      <section className="py-6">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl grid lg:grid-cols-3 gap-6">
          {/* Recent Mints - takes 2/3 */}
          <Card className="bg-[#13151f] border-[#1f2233] lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#00d4ff]" />
                  Recent Mints ({status.recent_mints_count})
                </span>
                <Badge variant="secondary" className="text-[10px] font-mono bg-[#1f2233] text-[#7a8295]">
                  Last 10
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status.recent_mints.length === 0 ? (
                <div className="text-center py-8 text-[#5a6178]">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No mints yet.</p>
                  <p className="text-xs mt-1">
                    Bot runs every 5 min via cron-job.org. First results may take 1-24 hours.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {status.recent_mints.map((m, i) => (
                    <MintRow key={i} mint={m} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Manual Mint - takes 1/3 */}
          <Card className="bg-[#13151f] border-[#1f2233]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-[#00ff88]" />
                Manual Mint
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="contract-addr" className="text-xs text-[#5a6178] mb-1 block">
                  Contract address (0x...)
                </Label>
                <Input
                  id="contract-addr"
                  value={manualAddr}
                  onChange={(e) => setManualAddr(e.target.value)}
                  placeholder="0x1234..."
                  className="bg-[#0a0b14] border-[#2a2e44] text-white font-mono text-xs"
                />
              </div>
              <Button
                onClick={triggerManualMint}
                disabled={manualLoading || !manualAddr}
                className="w-full bg-[#0052ff] hover:bg-[#0040cc]"
              >
                {manualLoading ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Rocket className="w-4 h-4 mr-1" />
                )}
                Mint Now
              </Button>
              {manualResult && (
                <div
                  className={`text-xs p-3 rounded-md border ${
                    manualResult.success
                      ? 'bg-[#0a3a2a] border-[#00ff88]/30 text-[#00ff88]'
                      : 'bg-[#3a0a0a] border-[#ff0088]/30 text-[#ff0088]'
                  }`}
                >
                  {manualResult.success ? (
                    <div className="space-y-1">
                      <div className="font-semibold">✓ Minted!</div>
                      <div className="font-mono text-[10px] break-all">
                        tx: {manualResult.txHash}
                      </div>
                      {manualResult.candidate?.opensea_url && (
                        <a
                          href={manualResult.candidate.opensea_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#00d4ff] underline flex items-center gap-1 mt-1"
                        >
                          View on OpenSea <ArrowUpRight className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="font-semibold">✗ Mint failed</div>
                      <div className="text-[10px] break-all">{manualResult.error}</div>
                    </div>
                  )}
                </div>
              )}
              <div className="text-[10px] text-[#5a6178] mt-2">
                Find free mints on Twitter/Farcast. Paste contract address here. Bot will detect
                free-mint function and execute gaslessly.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Scanned Contracts */}
      <section className="py-6">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <Card className="bg-[#13151f] border-[#1f2233]">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-[#00d4ff]" />
                  Recently Scanned Contracts ({status.scanned_contracts_count})
                </span>
                <Badge variant="secondary" className="text-[10px] font-mono bg-[#1f2233] text-[#7a8295]">
                  Last 10 (in-memory)
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status.last_scanned_contracts.length === 0 ? (
                <div className="text-center py-6 text-[#5a6178] text-sm">
                  No contracts scanned yet. Run a scan to see activity.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {status.last_scanned_contracts.map((addr) => (
                    <a
                      key={addr}
                      href={`https://opensea.io/assets/base/${addr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded-md bg-[#0a0b14] border border-[#1f2233] hover:border-[#2a2e44] text-xs font-mono text-[#a0a8bc] hover:text-[#00d4ff]"
                    >
                      <span className="truncate">{addr}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 ml-2" />
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1f2233] py-4">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#5a6178]">
          <div>Base Airdrop Sniper · Auto-refreshes every 30s</div>
          <div className="font-mono">Powered by Pimlico Smart Account + OpenSea API</div>
        </div>
      </footer>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card className="bg-[#13151f] border-[#1f2233]">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color }}>{icon}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider text-[#5a6178] font-mono">
            {label}
          </span>
        </div>
        <div className="text-xl sm:text-2xl font-bold" style={{ color }}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function MintRow({ mint }: { mint: StatusResponse['recent_mints'][number] }) {
  return (
    <div
      className={`p-3 rounded-md border ${
        mint.success
          ? 'bg-[#0a3a2a] border-[#00ff88]/30'
          : 'bg-[#3a0a0a] border-[#ff0088]/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {mint.success ? (
              <CheckCircle2 className="w-3 h-3 text-[#00ff88]" />
            ) : (
              <XCircle className="w-3 h-3 text-[#ff0088]" />
            )}
            <span className="text-sm font-semibold truncate">{mint.candidate.name}</span>
          </div>
          <div className="text-[10px] font-mono text-[#7a8295] truncate">
            {mint.candidate.contract}
          </div>
          {mint.txHash && (
            <a
              href={`https://basescan.org/tx/${mint.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#00d4ff] underline mt-1 inline-flex items-center gap-1"
            >
              tx: {mint.txHash.slice(0, 10)}... <ExternalLink className="w-2 h-2" />
            </a>
          )}
          {mint.error && (
            <div className="text-[10px] text-[#ff8899] mt-1 break-words">
              error: {mint.error.slice(0, 120)}
            </div>
          )}
        </div>
        {mint.candidate.opensea_url && (
          <a
            href={mint.candidate.opensea_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
          >
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-[#00d4ff] hover:bg-[#1a1d2e]"
            >
              OpenSea <ExternalLink className="w-2 h-2 ml-1" />
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

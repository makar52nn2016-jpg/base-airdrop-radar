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
  Zap,
} from 'lucide-react';

interface ActivityEvent {
  ts: string;
  type:
    | 'scan_start'
    | 'scan_complete'
    | 'candidate_found'
    | 'mint_attempt'
    | 'mint_success'
    | 'mint_failure'
    | 'chain_scan'
    | 'telegram_sent'
    | 'error';
  message: string;
  chain?: string;
  contract?: string;
  txHash?: string;
}

interface StatusResponse {
  timestamp: string;
  config: {
    pimlico: { configured: boolean; missing_env_vars: string[] };
    opensea: { configured: boolean };
    telegram: { configured: boolean };
    smart_account_address: string | null;
    smart_account_opensea_url: string | null;
    smart_account_basescan_url: string | null;
  };
  bot_state: 'idle' | 'scanning' | 'minting';
  current_chain: string | null;
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
    activityLog: ActivityEvent[];
  };
  recent_mints: Array<{
    candidate: { slug: string; name: string; contract: string; opensea_url: string; chain?: string };
    success: boolean;
    txHash?: string;
    smartAccountAddress?: string;
    error?: string;
  }>;
  recent_mints_count: number;
  scanned_contracts_count: number;
  last_scanned_contracts: string[];
  activity_log: ActivityEvent[];
  next_actions: string;
}

interface PortfolioNFT {
  identifier: string;
  contract: string;
  chain: string;
  chain_key?: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  collection: string;
  collection_name: string | null;
  opensea_url: string | null;
  token_standard: string | null;
}

interface PortfolioResponse {
  total_nfts: number;
  per_chain: Record<string, PortfolioNFT[]>;
  all_nfts: PortfolioNFT[];
}

export default function DashboardPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
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

  const fetchPortfolio = useCallback(async () => {
    try {
      const resp = await fetch('/api/sniper/portfolio', { cache: 'no-store' });
      const data = await resp.json();
      setPortfolio(data);
    } catch (e) {
      console.error('fetchPortfolio error', e);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchPortfolio();
    const statusInterval = setInterval(fetchStatus, 5000); // every 5s
    const portfolioInterval = setInterval(fetchPortfolio, 30000); // every 30s (slower, OpenSea API)
    return () => {
      clearInterval(statusInterval);
      clearInterval(portfolioInterval);
    };
  }, [fetchStatus, fetchPortfolio]);

  const triggerScan = async () => {
    setScanLoading(true);
    try {
      const resp = await fetch('/api/sniper/scan?max=20', { cache: 'no-store' });
      const data = await resp.json();
      fetchStatus();
      fetchPortfolio(); // refresh portfolio after scan
    } catch (e) {
      console.error('scan error', e);
    } finally {
      setScanLoading(false);
    }
  };

  const triggerRun = async () => {
    setRunLoading(true);
    try {
      const resp = await fetch('/api/sniper/run', { cache: 'no-store' });
      const data = await resp.json();
      fetchStatus();
      fetchPortfolio(); // refresh portfolio after run
    } catch (e) {
      console.error('run error', e);
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
      fetchPortfolio(); // refresh portfolio after manual mint
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
  const isScanning = status.bot_state === 'scanning';
  const isMinting = status.bot_state === 'minting';

  return (
    <main className="min-h-screen bg-[#0a0b14] text-white">
      {/* Header */}
      <header className="border-b border-[#1f2233] bg-gradient-to-b from-[#0d1020] to-[#0a0b14]">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-6xl">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0052ff] to-[#00d4ff] flex items-center justify-center text-xl font-bold">
                ◉
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  Base Sniper
                </h1>
                <div className="text-xs text-[#5a6178] font-mono">
                  Live · Last update: {lastUpdate || 'never'} · Auto-refresh 5s
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Live state indicator */}
              {isScanning ? (
                <Badge className="text-xs font-mono bg-[#0052ff]/20 text-[#00d4ff] border border-[#0052ff]/40">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#00d4ff] mr-1.5 animate-pulse" />
                  SCANNING {status.current_chain || ''}
                </Badge>
              ) : isMinting ? (
                <Badge className="text-xs font-mono bg-[#ffaa00]/20 text-[#ffaa00] border border-[#ffaa00]/40">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#ffaa00] mr-1.5 animate-pulse" />
                  MINTING
                </Badge>
              ) : (
                <Badge className="text-xs font-mono bg-[#1f2233] text-[#7a8295] border border-[#2a2e44]">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#5a6178] mr-1.5" />
                  IDLE
                </Badge>
              )}
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
        <div className="container mx-auto px-4 sm:px-6 py-3 max-w-6xl">
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
            </div>
          </div>
        </div>
      </section>

      {/* Stats Grid */}
      <section className="py-4">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={<Search className="w-4 h-4" />} label="Total Scans" value={stats.totalScans} color="#00d4ff" />
            <StatCard icon={<Rocket className="w-4 h-4" />} label="Candidates" value={stats.totalCandidatesDetected} color="#00ff88" />
            <StatCard icon={<Activity className="w-4 h-4" />} label="Mint Attempts" value={stats.totalMintsAttempted} color="#ffaa00" />
            <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Success" value={stats.totalMintsSucceeded} color="#00ff88" />
            <StatCard icon={<XCircle className="w-4 h-4" />} label="Failed" value={stats.totalMintsFailed} color="#ff0088" />
            <StatCard icon={<Coins className="w-4 h-4" />} label="Success %" value={`${stats.success_rate}%`} color="#00d4ff" />
          </div>
        </div>
      </section>

      {/* Action Buttons */}
      <section className="py-2">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <div className="flex gap-3 flex-wrap">
            <Button onClick={triggerScan} disabled={scanLoading} className="bg-[#0052ff] hover:bg-[#0040cc]">
              {scanLoading || isScanning ? (
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
              {runLoading || isMinting ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4 mr-1" />
              )}
              Trigger Full Cycle
            </Button>
          </div>
          <div className="mt-2 text-xs text-[#5a6178] flex items-center gap-2 flex-wrap">
            <Clock className="w-3 h-3" />
            Last scan: {stats.lastScanAt ? new Date(stats.lastScanAt).toLocaleString() : 'never'}
            {' · '}
            Last mint: {stats.lastMintAt ? new Date(stats.lastMintAt).toLocaleString() : 'never'}
          </div>
        </div>
      </section>

      {/* Live Activity Feed */}
      <section className="py-3">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <Card className="bg-[#13151f] border-[#1f2233]">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#00ff88]" />
                  Live Activity
                </span>
                <Badge variant="secondary" className="text-[10px] font-mono bg-[#1f2233] text-[#7a8295]">
                  {status.activity_log?.length || 0} events
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(!status.activity_log || status.activity_log.length === 0) ? (
                <div className="text-center py-6 text-[#5a6178]">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No activity yet (cold start — fresh Vercel instance).</p>
                  <p className="text-xs mt-1 text-[#5a6178]">
                    cron-job.org every 5 min keeps instance warm. Click Trigger Scan to populate.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {status.activity_log.map((ev, i) => (
                    <ActivityRow key={i} event={ev} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* NFT Portfolio (REAL on-chain data — persistent across cold starts) */}
      <section className="py-3">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <Card className="bg-[#13151f] border-[#1f2233]">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-[#2081e2]" />
                  NFT Portfolio
                </span>
                <Badge variant="secondary" className="text-[10px] font-mono bg-[#1f2233] text-[#7a8295]">
                  {portfolio?.total_nfts || 0} NFTs · 5 chains
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!portfolio || portfolio.total_nfts === 0 ? (
                <div className="text-center py-8 text-[#5a6178]">
                  <Coins className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No NFTs in portfolio yet.</p>
                  <p className="text-xs mt-1 text-[#5a6178]">
                    Bot is scanning 5 chains every 5 min for free mints. When found,
                    NFTs will appear here automatically (refreshes every 30s).
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {portfolio.all_nfts.map((nft, i) => (
                    <PortfolioCard key={i} nft={nft} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Two-column: Recent Mints + Manual Mint */}
      <section className="py-3">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl grid lg:grid-cols-3 gap-4">
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
                <div className="text-center py-6 text-[#5a6178]">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No mints yet.</p>
                  <p className="text-xs mt-1">Bot runs every 5 min via cron-job.org.</p>
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
                      <div className="font-mono text-[10px] break-all">tx: {manualResult.txHash}</div>
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
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-t border-[#1f2233] py-4">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#5a6178]">
          <div>Base Sniper · Auto-refresh every 5s · Multi-chain (Base/Optimism/Arbitrum/Polygon/Ethereum)</div>
          <div className="font-mono">Powered by Pimlico + OpenSea + Basescan</div>
        </div>
      </footer>
    </main>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <Card className="bg-[#13151f] border-[#1f2233]">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color }}>{icon}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider text-[#5a6178] font-mono">{label}</span>
        </div>
        <div className="text-xl sm:text-2xl font-bold" style={{ color }}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const color =
    event.type === 'mint_success' ? '#00ff88' :
    event.type === 'mint_failure' || event.type === 'error' ? '#ff0088' :
    event.type === 'candidate_found' ? '#ffaa00' :
    event.type === 'mint_attempt' ? '#ffaa00' :
    event.type === 'scan_start' || event.type === 'chain_scan' ? '#00d4ff' :
    '#7a8295';

  const icon = event.type === 'mint_success' ? '✓' :
    event.type === 'mint_failure' || event.type === 'error' ? '✗' :
    event.type === 'candidate_found' ? '🎯' :
    event.type === 'mint_attempt' ? '⚡' :
    event.type === 'scan_start' ? '🔍' :
    event.type === 'chain_scan' ? '⛓' :
    event.type === 'scan_complete' ? '✓' : '•';

  const time = new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-[#0a0b14] border border-[#1f2233] text-xs">
      <span className="font-mono text-[#5a6178] shrink-0">{time}</span>
      <span style={{ color }} className="shrink-0 font-bold">{icon}</span>
      <span className="text-[#a0a8bc] break-all">{event.message}</span>
      {event.chain && (
        <Badge variant="secondary" className="ml-auto text-[9px] font-mono bg-[#1f2233] text-[#7a8295] shrink-0">
          {event.chain}
        </Badge>
      )}
    </div>
  );
}

function MintRow({ mint }: { mint: StatusResponse['recent_mints'][number] }) {
  return (
    <div className={`p-3 rounded-md border ${
      mint.success ? 'bg-[#0a3a2a] border-[#00ff88]/30' : 'bg-[#3a0a0a] border-[#ff0088]/30'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {mint.success ? <CheckCircle2 className="w-3 h-3 text-[#00ff88]" /> : <XCircle className="w-3 h-3 text-[#ff0088]" />}
            <span className="text-sm font-semibold truncate">{mint.candidate.name}</span>
            {mint.candidate.chain && (
              <Badge variant="secondary" className="text-[9px] font-mono bg-[#1f2233] text-[#7a8295]">
                {mint.candidate.chain}
              </Badge>
            )}
          </div>
          <div className="text-[10px] font-mono text-[#7a8295] truncate">{mint.candidate.contract}</div>
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
          <a href={mint.candidate.opensea_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-[#00d4ff] hover:bg-[#1a1d2e]">
              OpenSea <ExternalLink className="w-2 h-2 ml-1" />
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

function PortfolioCard({ nft }: { nft: PortfolioNFT }) {
  const chain = nft.chain_key || nft.chain;
  return (
    <a
      href={nft.opensea_url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-[#0a0b14] border border-[#1f2233] rounded-md overflow-hidden hover:border-[#2a2e44] transition-colors"
    >
      <div className="aspect-square bg-[#1a1d2e] flex items-center justify-center overflow-hidden">
        {nft.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={nft.image_url}
            alt={nft.name || 'NFT'}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <Coins className="w-8 h-8 text-[#5a6178]" />
        )}
      </div>
      <div className="p-2 space-y-1">
        <div className="text-xs font-semibold truncate text-white">
          {nft.name || nft.collection_name || `Token #${nft.identifier.slice(0, 8)}`}
        </div>
        <div className="flex items-center justify-between gap-1">
          <Badge variant="secondary" className="text-[9px] font-mono bg-[#1f2233] text-[#7a8295]">
            {chain}
          </Badge>
          {nft.token_standard && (
            <span className="text-[9px] text-[#5a6178] font-mono">
              {nft.token_standard}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}


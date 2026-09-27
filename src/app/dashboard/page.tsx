'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Activity, ArrowUpRight, CheckCircle2, Clock, Coins,
  ExternalLink, Loader2, RefreshCw, Rocket, Search,
  Wallet, XCircle, Terminal, Radio, TrendingUp,
} from 'lucide-react';

interface ActivityEvent {
  ts: string;
  type: string;
  message: string;
  chain?: string;
  contract?: string;
  txHash?: string;
}

interface PortfolioNFT {
  identifier: string;
  contract: string;
  chain: string;
  chain_key?: string;
  name: string | null;
  image_url: string | null;
  opensea_url: string | null;
  token_standard: string | null;
}

interface StatusData {
  bot_state: string;
  current_chain: string | null;
  config: {
    pimlico: { configured: boolean };
    opensea: { configured: boolean };
    telegram: { configured: boolean };
    supabase: { configured: boolean };
    smart_account_address: string | null;
    smart_account_opensea_url: string | null;
  };
  stats: {
    totalScans: number;
    totalCandidatesDetected: number;
    totalMintsAttempted: number;
    totalMintsSucceeded: number;
    totalMintsFailed: number;
    success_rate: number;
    lastScanAt: string | null;
    firstRunAt: string;
  };
  activity_log: ActivityEvent[];
  recent_mints: any[];
}

export default function DashboardPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [portfolio, setPortfolio] = useState<{ total_nfts: number; all_nfts: PortfolioNFT[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanLoading, setScanLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [manualAddr, setManualAddr] = useState('');
  const [terminal, setTerminal] = useState<{ts: string; msg: string; type: string}[]>([]);
  const [displayedTs, setDisplayedTs] = useState<Set<string>>(new Set());
  const terminalRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/sniper/status', { cache: 'no-store' });
      const data = await resp.json();
      setStatus(data);
      // Add ONLY NEW events to terminal (dedup by timestamp)
      if (data.activity_log) {
        setTerminal(prev => {
          const newEvents: {ts: string; msg: string; type: string}[] = [];
          setDisplayedTs(prevTs => {
            const updated = new Set(prevTs);
            for (const ev of data.activity_log) {
              if (!updated.has(ev.ts)) {
                updated.add(ev.ts);
                newEvents.push({ts: ev.ts, msg: ev.message, type: ev.type});
              }
            }
            return updated;
          });
          if (newEvents.length === 0) return prev;
          return [...newEvents.reverse(), ...prev].slice(0, 50);
        });
      }
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
    const sInt = setInterval(fetchStatus, 5000);
    const pInt = setInterval(fetchPortfolio, 30000);
    return () => { clearInterval(sInt); clearInterval(pInt); };
  }, [fetchStatus, fetchPortfolio]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminal]);

  const triggerScan = async () => {
    setScanLoading(true);
    setTerminal(prev => [{ts: new Date().toISOString(), msg: '▶ Triggering scan...', type: 'action'}, ...prev]);
    try {
      await fetch('/api/sniper/scan?max=20', { cache: 'no-store' });
      fetchStatus();
      fetchPortfolio();
    } catch (e) { console.error('scan error', e); }
    finally { setScanLoading(false); }
  };

  const triggerRun = async () => {
    setRunLoading(true);
    setTerminal(prev => [{ts: new Date().toISOString(), msg: '▶ Triggering full cycle (scan + mint)...', type: 'action'}, ...prev]);
    try {
      await fetch('/api/sniper/run', { cache: 'no-store' });
      fetchStatus();
      fetchPortfolio();
    } catch (e) { console.error('run error', e); }
    finally { setRunLoading(false); }
  };

  const triggerManualMint = async () => {
    if (!manualAddr.startsWith('0x') || manualAddr.length !== 42) return;
    setTerminal(prev => [{ts: new Date().toISOString(), msg: `▶ Manual mint: ${manualAddr.slice(0,12)}...`, type: 'action'}, ...prev]);
    try {
      const resp = await fetch(`/api/sniper/manual?contract=${manualAddr}`, { cache: 'no-store' });
      const data = await resp.json();
      setTerminal(prev => [{
        ts: new Date().toISOString(),
        msg: data.success ? `✅ Minted! tx: ${data.txHash?.slice(0,20)}...` : `❌ Mint failed: ${data.error?.slice(0,60)}`,
        type: data.success ? 'success' : 'error',
      }, ...prev]);
      fetchStatus();
      fetchPortfolio();
    } catch (e) { console.error('manual mint error', e); }
  };

  if (loading || !status) {
    return (
      <div className="min-h-screen bg-[#0a0b14] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00d4ff]" />
      </div>
    );
  }

  const stats = status.stats;
  const isScanning = status.bot_state === 'scanning';
  const isMinting = status.bot_state === 'minting';

  const getEventColor = (type: string) => {
    if (type.includes('success') || type.includes('complete')) return '#00ff88';
    if (type.includes('error') || type.includes('failure')) return '#ff0088';
    if (type.includes('candidate')) return '#ffaa00';
    if (type.includes('social') || type.includes('whale')) return '#00d4ff';
    if (type.includes('action')) return '#ffaa00';
    return '#7a8295';
  };

  return (
    <main className="min-h-screen bg-[#0a0b14] text-white">
      {/* Header */}
      <header className="border-b border-[#1f2233] bg-[#0d1020] sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 max-w-7xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0052ff] to-[#00d4ff] flex items-center justify-center text-lg font-bold">◉</div>
              <div>
                <h1 className="text-lg font-extrabold">Base Sniper</h1>
                <div className="text-[10px] text-[#5a6178] font-mono">4-strategy · 3 chains · 24/7</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isScanning ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#00d4ff]">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#00d4ff] animate-pulse" />
                  SCANNING
                </span>
              ) : isMinting ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#ffaa00]">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#ffaa00] animate-pulse" />
                  MINTING
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#5a6178]">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#5a6178]" />
                  IDLE
                </span>
              )}
              <Button size="sm" variant="outline" onClick={fetchStatus} className="border-[#2a2e44] text-[#a0a8bc] hover:bg-[#1a1d2e] h-8">
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-4 max-w-7xl">
        {/* Stats Bar */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
          {[
            { label: 'SCANS', value: stats.totalScans, color: '#00d4ff' },
            { label: 'CANDIDATES', value: stats.totalCandidatesDetected, color: '#00ff88' },
            { label: 'MINTS', value: stats.totalMintsAttempted, color: '#ffaa00' },
            { label: 'SUCCESS', value: stats.totalMintsSucceeded, color: '#00ff88' },
            { label: 'FAILED', value: stats.totalMintsFailed, color: '#ff0088' },
            { label: 'NFTs', value: portfolio?.total_nfts || 0, color: '#2081e2' },
          ].map((s) => (
            <div key={s.label} className="bg-[#13151f] border border-[#1f2233] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[9px] font-mono text-[#5a6178] uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Action Bar */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <Button onClick={triggerScan} disabled={scanLoading} className="bg-[#0052ff] hover:bg-[#0040cc] h-9">
            {scanLoading || isScanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
            Scan
          </Button>
          <Button onClick={triggerRun} disabled={runLoading} className="bg-[#00ff88] hover:bg-[#00cc6a] text-[#0a0b14] font-semibold h-9">
            {runLoading || isMinting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Rocket className="w-4 h-4 mr-1" />}
            Run Cycle
          </Button>
          <div className="flex gap-2 flex-1 min-w-[200px]">
            <Input
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
              placeholder="0x... manual mint"
              className="bg-[#0a0b14] border-[#2a2e44] text-white font-mono text-xs h-9"
              onKeyDown={(e) => e.key === 'Enter' && triggerManualMint()}
            />
            <Button onClick={triggerManualMint} disabled={!manualAddr} className="bg-[#ffaa00] hover:bg-[#cc8800] text-black h-9">
              <Rocket className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Main Grid: Terminal + Portfolio */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Live Terminal (2/3 width) */}
          <div className="lg:col-span-2">
            <div className="bg-[#0a0b14] border border-[#1f2233] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-[#13151f] border-b border-[#1f2233]">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#00ff88]" />
                  <span className="text-sm font-semibold">Live Monitor</span>
                </div>
                <div className="flex items-center gap-2">
                  <Radio className={`w-3 h-3 ${isScanning || isMinting ? 'text-[#00ff88] animate-pulse' : 'text-[#5a6178]'}`} />
                  <span className="text-[10px] font-mono text-[#5a6178]">
                    {isScanning ? 'LIVE' : isMinting ? 'MINTING' : 'IDLE'}
                  </span>
                </div>
              </div>
              <div ref={terminalRef} className="p-3 h-96 overflow-y-auto font-mono text-xs space-y-1 bg-[#0a0b14]">
                {terminal.length === 0 ? (
                  <div className="text-[#5a6178] text-center py-8">
                    <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>Waiting for activity...</p>
                    <p className="text-[10px] mt-1">Click Scan or Run Cycle to start</p>
                  </div>
                ) : (
                  terminal.map((ev, i) => {
                    const color = getEventColor(ev.type);
                    const time = new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    return (
                      <div key={i} className="flex items-start gap-2 hover:bg-[#13151f] px-1 py-0.5 rounded">
                        <span className="text-[#5a6178] shrink-0">{time}</span>
                        <span style={{ color }} className="shrink-0">›</span>
                        <span className="text-[#a0a8bc] break-all">{ev.msg}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Activity Log from Supabase */}
            <div className="mt-4 bg-[#13151f] border border-[#1f2233] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-[#0d1020] border-b border-[#1f2233]">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#00d4ff]" />
                  <span className="text-sm font-semibold">Activity Log (Supabase)</span>
                </div>
                <Badge className="text-[9px] font-mono bg-[#1f2233] text-[#7a8295]">{status.activity_log?.length || 0} events</Badge>
              </div>
              <div className="p-2 max-h-48 overflow-y-auto space-y-1">
                {status.activity_log?.length === 0 ? (
                  <div className="text-center py-4 text-[#5a6178] text-xs">No activity logged yet</div>
                ) : (
                  status.activity_log?.slice(0, 15).map((ev, i) => {
                    const color = getEventColor(ev.type);
                    const time = new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    return (
                      <div key={i} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-[#0a0b14]">
                        <span className="text-[#5a6178] text-[10px] font-mono shrink-0">{time}</span>
                        <span style={{ color }} className="text-[10px] shrink-0">●</span>
                        <span className="text-[10px] text-[#a0a8bc] break-all">{ev.message}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Wallet + Portfolio */}
          <div className="space-y-4">
            {/* Wallet */}
            <div className="bg-[#13151f] border border-[#1f2233] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-[#00d4ff]" />
                <span className="text-sm font-semibold">Smart Account</span>
              </div>
              <div className="text-xs font-mono text-[#a0a8bc] break-all mb-2">
                {status.config.smart_account_address || 'Not initialized'}
              </div>
              {status.config.smart_account_opensea_url && (
                <a href={status.config.smart_account_opensea_url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="w-full bg-[#2081e2] hover:bg-[#1a6bc7] h-8 text-xs">
                    <ExternalLink className="w-3 h-3 mr-1" /> OpenSea
                  </Button>
                </a>
              )}
            </div>

            {/* Portfolio */}
            <div className="bg-[#13151f] border border-[#1f2233] rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-[#2081e2]" />
                  <span className="text-sm font-semibold">NFT Portfolio</span>
                </div>
                <Badge className="text-[9px] font-mono bg-[#1f2233] text-[#7a8295]">{portfolio?.total_nfts || 0}</Badge>
              </div>
              {portfolio?.total_nfts === 0 || !portfolio ? (
                <div className="text-center py-6 text-[#5a6178]">
                  <Coins className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No NFTs yet</p>
                  <p className="text-[10px] mt-1">Bot will mint when free-mints appear</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {portfolio.all_nfts.slice(0, 10).map((nft, i) => (
                    <a key={i} href={nft.opensea_url || '#'} target="_blank" rel="noopener noreferrer"
                      className="block bg-[#0a0b14] border border-[#1f2233] rounded overflow-hidden hover:border-[#2a2e44]">
                      <div className="aspect-square bg-[#1a1d2e] flex items-center justify-center overflow-hidden">
                        {nft.image_url ? (
                          <img src={nft.image_url} alt={nft.name || 'NFT'} className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <Coins className="w-6 h-6 text-[#5a6178]" />
                        )}
                      </div>
                      <div className="p-1.5">
                        <div className="text-[10px] font-semibold truncate">{nft.name || `#${nft.identifier.slice(0,6)}`}</div>
                        <div className="text-[8px] text-[#5a6178]">{nft.chain_key || nft.chain}</div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* System Status */}
            <div className="bg-[#13151f] border border-[#1f2233] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-[#00ff88]" />
                <span className="text-sm font-semibold">System Status</span>
              </div>
              <div className="space-y-1.5 text-xs">
                {[
                  { label: 'Pimlico', ok: status.config.pimlico?.configured },
                  { label: 'OpenSea', ok: status.config.opensea?.configured },
                  { label: 'Telegram', ok: status.config.telegram?.configured },
                  { label: 'Supabase', ok: status.config.supabase?.configured },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-[#7a8295]">{s.label}</span>
                    {s.ok ? <CheckCircle2 className="w-3 h-3 text-[#00ff88]" /> : <XCircle className="w-3 h-3 text-[#ff0088]" />}
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 border-t border-[#1f2233] mt-2">
                  <span className="text-[#7a8295]">Last scan</span>
                  <span className="text-[#5a6178] font-mono">
                    {stats.lastScanAt ? new Date(stats.lastScanAt).toLocaleTimeString() : 'never'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

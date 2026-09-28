$code = @'
// LIVE SIM — REALISTIC v3 with TVL filter (only trade pools > $10K TVL)
const ALCHEMY='https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n';
const T={WETH:'0x4200000000000000000000000000000000000006',USDC:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',USDT:'0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',DAI:'0x50c5725949a6f0c72e6c4a641f24049a917db0cb',cbBTC:'0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',cbETH:'0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',AERO:'0x940181a94a35a4569e4529a3cdfb74e38fd98631',AAVE:'0x63706e401c06ac8513145b7687a14804d17f814b'};
const AERO_F='0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const UNI_F='0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ZERO='0x0000000000000000000000000000000000000000';
const MIN_TVL_USD = 10000;
const PAIRS=[{n:'WETH/USDC',i:T.WETH,o:T.USDC,id:18,od:6,ms:0.6},{n:'WETH/USDT',i:T.WETH,o:T.USDT,id:18,od:6,ms:0.6},{n:'WETH/DAI',i:T.WETH,o:T.DAI,id:18,od:18,ms:0.6},{n:'cbBTC/USDC',i:T.cbBTC,o:T.USDC,id:8,od:6,ms:0.4},{n:'cbETH/USDC',i:T.cbETH,o:T.USDC,id:18,od:6,ms:0.6},{n:'cbETH/DAI',i:T.cbETH,o:T.DAI,id:18,od:18,ms:0.6},{n:'AERO/USDC',i:T.AERO,o:T.USDC,id:18,od:6,ms:1.5},{n:'AERO/USDT',i:T.AERO,o:T.USDT,id:18,od:6,ms:1.5},{n:'AAVE/USDC',i:T.AAVE,o:T.USDC,id:18,od:6,ms:1.5},{n:'USDC/USDT',i:T.USDC,o:T.USDT,id:6,od:6,ms:0.3}];
let bal=50,profit=0,loss=0,trades=0,wins=0,losses=0;
let mevLosses=0, slippageTotal=0, gasTotal=0, revertedTotal=0, skippedLowTvl=0;
const log=[],opps=[];
const now=()=>new Date().toISOString().slice(11,19);
function addLog(t,m){log.push({t:now(),type:t,msg:String(m).slice(0,70)});if(log.length>15)log.shift();}
const cache=new Map();
async function ethCall(to,data){try{const r=await fetch(ALCHEMY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'eth_call',params:[{to,data},'latest'],id:1})});const j=await r.json();if(j.error||!j.result||j.result==='0x')return null;return j.result;}catch{return null;}}
async function aeroPool(a,b,s){const k=`${a}-${b}-${s}`;if(cache.has(k))return cache.get(k);const sh=s?'1':'0';const d='0x79bc57d5'+a.toLowerCase().slice(2).padStart(64,'0')+b.toLowerCase().slice(2).padStart(64,'0')+'0'.repeat(63)+sh;const r=await ethCall(AERO_F,d);if(!r)return ZERO;const p='0x'+r.slice(-40);if(p===ZERO)return ZERO;cache.set(k,p);return p;}
async function aeroP(p){let pool=await aeroPool(p.i,p.o,false);if(pool===ZERO)pool=await aeroPool(p.i,p.o,true);if(pool===ZERO)return{price:0,tvl:0};const[t0,rr]=await Promise.all([ethCall(pool,'0x0dfe1681'),ethCall(pool,'0x0902f1ac')]);if(!t0||!rr)return{price:0,tvl:0};const t0a='0x'+t0.slice(-40).toLowerCase();const h=rr.slice(2);const r0=BigInt('0x'+h.slice(0,64));const r1=BigInt('0x'+h.slice(64,128));const in0=t0a===p.i.toLowerCase();const ri=in0?r0:r1;const ro=in0?r1:r0;if(ri===0n)return{price:0,tvl:0};const price=(Number(ro)/10**p.od)/(Number(ri)/10**p.id);const baseReserve=in0?r1:r0;const baseDec=in0?p.od:p.id;let tvl=0;if(p.o===T.WETH||p.i===T.WETH)tvl=2*(Number(baseReserve)/10**baseDec)*2650;else if(p.o===T.USDC||p.i===T.USDC)tvl=2*(Number(baseReserve)/10**baseDec);else if(p.o===T.USDT||p.i===T.USDT)tvl=2*(Number(baseReserve)/10**baseDec);else if(p.o===T.DAI||p.i===T.DAI)tvl=2*(Number(baseReserve)/10**baseDec);else tvl=2*(Number(baseReserve)/10**baseDec)*100;return{price,tvl};}
async function uniP(p){for(const f of[100,500,3000,10000]){const fh=f.toString(16).padStart(6,'0');const d='0x1698ee82'+p.i.toLowerCase().slice(2).padStart(64,'0')+p.o.toLowerCase().slice(2).padStart(64,'0')+'0'.repeat(58)+fh;const pr=await ethCall(UNI_F,d);if(!pr)continue;const pool='0x'+pr.slice(-40);if(pool===ZERO)continue;const s0=await ethCall(pool,'0x3850c7bd');if(!s0)continue;const h=s0.slice(2);const sq=BigInt('0x'+h.slice(0,64));if(sq===0n)continue;const num=sq*sq;const den=2n**192n;const raw=Number(num)/Number(den);const t0r=await ethCall(pool,'0x0dfe1681');if(!t0r)continue;const t0a='0x'+t0r.slice(-40).toLowerCase();const in0=t0a===p.i.toLowerCase();const adj=10**(p.id-p.od);const price=in0?raw*adj:(1/raw)*adj;if(price>0)return{price,tvl:50000};}return{price:0,tvl:0};}
function simReal(spreadPct, tvlUsd) {
  const sz = Math.min(50, bal);
  if (sz < 5) return { p: 0, st: 'SKIP', reason: 'low balance' };
  if (tvlUsd < MIN_TVL_USD) {
    skippedLowTvl++;
    return { p: 0, st: 'SKIP', reason: 'TVL < $10K' };
  }
  const effTvl = Math.max(500, tvlUsd);
  const slippagePct = (sz / (effTvl / 2)) * 100;
  const mevChance = spreadPct > 3 ? 0.50 : spreadPct > 1 ? 0.30 : 0.15;
  const reverted = Math.random() < mevChance;
  const gasSpike = Math.random() < 0.1 ? 2 : 1;
  const gasCost = 0.10 * gasSpike;
  const latencyReduction = 0.3 + Math.random() * 0.2;
  const effectiveSpread = spreadPct * (1 - latencyReduction);
  if (reverted) {
    trades++; losses++; revertedTotal++;
    bal -= gasCost; loss += gasCost; gasTotal += gasCost;
    return { p: -gasCost, st: 'LOSS', reason: 'MEV revert' };
  }
  const grossProfit = sz * effectiveSpread / 100;
  const slippageCost = sz * slippagePct / 100;
  const netProfit = grossProfit - gasCost - slippageCost;
  slippageTotal += slippageCost;
  gasTotal += gasCost;
  trades++;
  if (netProfit > 0.05) {
    bal += netProfit;
    wins++; profit += netProfit;
    return { p: netProfit, st: 'WIN', reason: 'slip '+slippagePct.toFixed(2)+'%' };
  } else {
    bal += netProfit;
    losses++; loss += Math.abs(netProfit);
    return { p: netProfit, st: 'LOSS', reason: 'slip '+slippagePct.toFixed(2)+'% high' };
  }
}
let nextScan=0;
function render(){console.log('\x1b[2J\x1b[H');console.log('===========================================================');console.log('REALISTIC LIVE SIM v3 - $50 budget - '+new Date().toISOString().slice(0,19));console.log('  TVL filter: SKIP trades where pool TVL < $'+MIN_TVL_USD);console.log('===========================================================');console.log('\n--- LIVE PROCESS (last 15 events) ---');if(log.length===0)console.log('(waiting for first scan...)');log.slice(-15).forEach(e=>console.log('['+e.t+'] ['+e.type.padEnd(5)+'] '+e.msg));console.log('\n--- TRADES (last 15) ---');if(opps.length===0)console.log('(none yet)');opps.slice(-15).forEach(o=>console.log('['+o.t+'] '+o.type.padEnd(5)+' '+o.pair.padEnd(15)+' '+(o.p>=0?'+':'')+'$'+o.p.toFixed(2).padStart(7)+' '+o.st.padEnd(4)+' '+(o.reason||'')));console.log('\n===========================================================');const wr=trades>0?(wins/trades*100).toFixed(1):'0.0';const np=profit-loss;console.log('TRADES: '+trades+' | WINS: '+wins+' | LOSS: '+losses+' | WIN%: '+wr+'% | MEV reverts: '+revertedTotal+' | skipped low-TVL: '+skippedLowTvl);console.log('PROFIT: $'+profit.toFixed(2)+' | LOSS: $'+loss.toFixed(2)+' | NET: '+(np>=0?'+':'')+'$'+np.toFixed(2)+' | BAL: $'+bal.toFixed(2));console.log('Slippage total: $'+slippageTotal.toFixed(2)+' | Gas total: $'+gasTotal.toFixed(2));const sl=Math.max(0,Math.ceil((nextScan-Date.now())/1000));console.log('\nNext scan in '+sl+'s | Ctrl+C to stop');}
async function runScan(){addLog('SCAN','Cycle started - scanning '+PAIRS.length+' pairs...');const s=Date.now();try{let to=0;for(const p of PAIRS){try{const aero=await aeroP(p);const uni=await uniP(p);if(aero.price>0&&uni.price>0){const d=Math.abs(aero.price-uni.price);const dp=(d/Math.min(aero.price,uni.price))*100;const ns=dp-0.3;if(ns>p.ms){to++;const bd=aero.price<uni.price?'Aero':'Uni';const sd=aero.price<uni.price?'Uni':'Aero';const tvl=Math.min(aero.tvl,uni.tvl);addLog('ARB',p.n+': '+ns.toFixed(2)+'% TVL $'+tvl.toFixed(0)+' -> '+bd+'->'+sd);if(ns>0.5&&ns<5){const r=simReal(ns,tvl);opps.push({t:now(),type:'ARB',pair:p.n,p:r.p,st:r.st,reason:r.reason});if(opps.length>15)opps.shift();addLog('ARB',p.n+' -> '+r.st+' '+(r.p>=0?'+':'')+'$'+r.p.toFixed(2)+' ('+(r.reason||'')+')');}else{opps.push({t:now(),type:'ARB*',pair:p.n,p:0,st:'SKIP',reason:'illusion'});if(opps.length>15)opps.shift();addLog('ARB',p.n+' skipped (illusion)');}}}}catch(e){addLog('ERROR',p.n+' scan failed');}}addLog('SCAN','Done '+(Date.now()-s)+'ms - '+to+' opps found | bal $'+bal.toFixed(2));}catch(e){addLog('ERROR','Cycle failed: '+e.message?.slice(0,50));}}
async function scanLoop(){while(true){nextScan=Date.now()+60000;await runScan();await new Promise(r=>setTimeout(r,60000));}}
console.log('Starting REALISTIC v3 simulator with $50 budget (TVL filter enabled)...');
setTimeout(()=>{addLog('INIT','Realistic simulator started - $50 budget');addLog('INIT','TVL filter: SKIP trades where pool TVL < $'+MIN_TVL_USD);addLog('INIT','Scanning '+PAIRS.length+' pairs | Slippage + MEV + gas spikes enabled');nextScan=Date.now();scanLoop().catch(e=>addLog('ERROR','Scan crashed: '+e.message?.slice(0,50)));},1000);
setInterval(render,1000);
process.on('SIGINT',()=>{console.log('\n\n=== STOPPED ===');console.log('Final: $'+bal.toFixed(2)+' ('+(bal-50>=0?'+':'')+'$'+(bal-50).toFixed(2)+')');console.log('Trades: '+trades+' ('+wins+'W/'+losses+'L) | MEV reverts: '+revertedTotal+' | skipped low-TVL: '+skippedLowTvl);console.log('Slippage loss: $'+slippageTotal.toFixed(2)+' | Gas spent: $'+gasTotal.toFixed(2));process.exit(0);});
'@
[System.IO.File]::WriteAllText('C:\Users\1\base-airdrop-radar\download\live-sim.mjs', $code, [System.Text.UTF8Encoding]::new($false))
Write-Host 'File created!' -ForegroundColor Green
cd C:\Users\1\base-airdrop-radar
bun run download/live-sim.mjs

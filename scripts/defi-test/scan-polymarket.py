import json

with open('/tmp/markets.json') as f:
    data = json.load(f)

print(f'Total markets: {len(data)}')

endgame = []
arbs = []

for m in data:
    q = m.get('question', '?')[:60]
    prices = m.get('outcomePrices', '[]')
    if isinstance(prices, str):
        try: prices = json.loads(prices)
        except: continue
    outcomes = m.get('outcomes', '[]')
    if isinstance(outcomes, str):
        try: outcomes = json.loads(outcomes)
        except: continue
    if len(prices) < 2: continue
    
    try:
        total = sum(float(p) for p in prices)
        max_p = max(float(p) for p in prices)
        diff_pct = abs(1.0 - total) * 100
        if max_p > 0.95:
            endgame.append({'q': q, 'prices': prices, 'sum': total, 'diff_pct': diff_pct, 'outcomes': outcomes})
        if diff_pct > 0.3:
            arbs.append({'q': q, 'prices': prices, 'sum': total, 'diff_pct': diff_pct, 'outcomes': outcomes})
    except: pass

print(f'Endgame markets (>95% one outcome): {len(endgame)}')
print(f'Arb opportunities (>0.3% sum diff): {len(arbs)}')
print()
print('Top endgame markets:')
for e in endgame[:5]:
    print(f'  Sum=${e["sum"]:.4f} diff={e["diff_pct"]:.2f}% - {e["q"]}')
    for i, o in enumerate(e['outcomes'][:2]):
        print(f'    {o[:25]}: ${e["prices"][i]}')
print()
print('Top arb opportunities:')
arbs.sort(key=lambda x: -x['diff_pct'])
for a in arbs[:5]:
    print(f'  Arb {a["diff_pct"]:.2f}% - {a["q"]}')
    for i, o in enumerate(a['outcomes'][:2]):
        print(f'    {o[:25]}: ${a["prices"][i]}')
    print(f'    Sum=${a["sum"]:.4f} -> profit ${1-a["sum"]:.4f}/$1')

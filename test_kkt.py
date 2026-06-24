"""Test KKT cap enforcement with user's scenario."""
import sys, os
sys.path.insert(0, r'c:\Users\user\OneDrive\Dokumenty\GitHub\data-pipeline')

# Import only the _kkt_project function
import importlib.util
spec = importlib.util.spec_from_file_location("main", r'c:\Users\user\OneDrive\Dokumenty\GitHub\data-pipeline\main.py')

# We can't import the full module (needs fastapi etc), so extract the function
exec_globals = {}
with open(r'c:\Users\user\OneDrive\Dokumenty\GitHub\data-pipeline\main.py') as f:
    code = f.read()

# Extract just the _kkt_project function
import re
# Find function start
start = code.find('def _kkt_project(')
# Find next function/class definition
rest = code[start:]
# Find the next @app or def at column 0
match = re.search(r'\n(?:@app\.|def [^_]|class )', rest[1:])
end = start + 1 + match.start() if match else len(code)
func_code = code[start:end]

exec(func_code, exec_globals)
_kkt_project = exec_globals['_kkt_project']

# Test case: BTC 71% from ERC, 5 tokens
# Simulated ERC weights (sum to 1.0)
w = [0.71, 0.10, 0.08, 0.06, 0.05]
syms = ['BTC', 'ETH', 'SOL', 'LINK', 'DOGE']
# Simulated volatilities (annualized)
vols = {'BTC': 0.60, 'ETH': 0.80, 'SOL': 1.00, 'LINK': 0.90, 'DOGE': 1.10}

pw, notes, caps = _kkt_project(w, syms, vols)

print("=" * 60)
print("KKT PROJECTION TEST")
print("=" * 60)
print(f"\nInput (ERC weights, sum={sum(w):.2f}):")
for i, s in enumerate(syms):
    print(f"  {s}: {w[i]*100:.1f}%")

print(f"\nDynamic caps:")
for s in syms:
    print(f"  {s}: {caps[s]*100:.1f}%")

print(f"\nProjected weights (sum={sum(pw)*100:.1f}%):")
for i, s in enumerate(syms):
    cap_ok = pw[i] <= caps[s] + 0.001
    status = "OK" if cap_ok else "BREACH!"
    print(f"  {s}: {pw[i]*100:.1f}% (cap: {caps[s]*100:.1f}%) [{status}]")

total = sum(pw)
cap_breaches = sum(1 for i, s in enumerate(syms) if pw[i] > caps[s] + 0.001)
print(f"\nTotal: {total*100:.1f}% (max_risky: 60%)")
print(f"Cap breaches: {cap_breaches}")
print(f"\nKKT notes:")
for n in notes:
    print(f"  - {n}")

if cap_breaches == 0 and total <= 0.601:
    print("\n*** PASS: All caps enforced, total within 60% ***")
else:
    print("\n*** FAIL: Caps breached or total exceeds 60% ***")

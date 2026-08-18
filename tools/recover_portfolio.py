"""Quick recovery tool: fetch your holdings from beta-auth and pending
signals from the engine, then show what your portfolio should look like.

Usage:
  1. Open https://aqmath.xyz/app in your browser
  2. F12 → Console → paste:
     JSON.parse(localStorage.getItem('aqmath_beta')||'{}').token
  3. Copy the token string (without quotes)
  4. Run: python tools/recover_portfolio.py YOUR_TOKEN_HERE
"""
import json
import sys
import urllib.request

BETA_AUTH = "https://api-auth.aqmath.xyz"
ENGINE = "https://aqmath-engine.up.railway.app"


def fetch_json(url, token):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "AQMath-Recovery/1.0",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/recover_portfolio.py YOUR_BETA_TOKEN")
        print("  Get token from browser console on aqmath.xyz/app:")
        print("  JSON.parse(localStorage.getItem('aqmath_beta')||'{}').token")
        sys.exit(1)

    token = sys.argv[1]

    # 1. Holdings from beta-auth
    print("=" * 60)
    print("HOLDINGS (from beta-auth)")
    print("=" * 60)
    try:
        data = fetch_json(f"{BETA_AUTH}/portfolio", token)
        holdings = data.get("holdings", [])
        if not holdings:
            print("  (empty — beta-auth has no holdings for you)")
        for h in holdings:
            sym = h.get("token", "?").upper()
            amt = h.get("amount", 0)
            entry = h.get("entry", "-")
            print(f"  {sym:>8s}  amount={amt}  entry={entry}")
    except Exception as e:
        print(f"  ERROR: {e}")
        holdings = []

    # 2. Pending signals from engine
    print()
    print("=" * 60)
    print("PENDING SIGNALS (from engine)")
    print("=" * 60)
    try:
        sig_data = fetch_json(f"{ENGINE}/portfolio/signals", token)
        signals = sig_data.get("signals", [])
        if not signals:
            print("  (no pending signals)")
        for s in signals:
            print(f"  {s['signal_id']}: {s['side']} {s['units']} {s['sym']} "
                  f"(${s['usd']:.0f}) — pending {s['days_pending']}d "
                  f"(regime: {s['shield_regime']})")
    except Exception as e:
        print(f"  ERROR: {e}")
        signals = []

    # 3. All confirmed signals (history)
    print()
    print("=" * 60)
    print("SIGNAL HISTORY (confirmed, from engine)")
    print("=" * 60)
    try:
        hist = fetch_json(f"{ENGINE}/portfolio/signal-stats", token)
        stats = hist.get("stats", {})
        if stats:
            for regime, s in stats.items():
                print(f"  {regime}: {s.get('total', 0)} signals, "
                      f"same_day={s.get('same_day_rate', 0):.0%}")
        else:
            print("  (no signal history)")
    except Exception as e:
        print(f"  ERROR: {e}")

    # 4. Summary: what to enter
    print()
    print("=" * 60)
    print("RECOVERY SUMMARY")
    print("=" * 60)
    if holdings:
        print("Enter these tokens in the UI portfolio table:")
        print()
        for h in holdings:
            sym = h.get("token", "?").upper()
            amt = h.get("amount", 0)
            try:
                amt_f = float(amt)
                print(f"  {sym:>8s}  {amt_f:.6f}")
            except (ValueError, TypeError):
                print(f"  {sym:>8s}  {amt}")
        if signals:
            print()
            print("Then apply today's pending signals manually:")
            for s in signals:
                print(f"  {s['side'].upper()} {s['units']} {s['sym']}")
    else:
        print("  Beta-auth has no holdings. You need to re-enter manually.")
        if signals:
            print("  But you have pending signals — those tell you what")
            print("  the engine expected you to hold:")
            for s in signals:
                print(f"    {s['sym']}: {s['side']} {s['units']} (${s['usd']:.0f})")


if __name__ == "__main__":
    main()

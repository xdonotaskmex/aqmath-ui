# Liveness Screen — Fixing the Dead-Token Weight Flaw in the KKT Macro Loop

**Date:** 2026-08-07
**Engine:** Dual-Speed E2E — identical wiring to the live paper trading service (180-day KKT risk-parity MACRO loop + v14 Deleverage Shield)
**Status:** 📊 RESEARCH — design study, fix implemented in the production service

---

## 1. Objective

The KKT risk-parity MACRO loop allocates purely on **volatility and
covariance**. That is a strength — no narratives, no timers — and a blind
spot: a token whose market has effectively died keeps printing daily closes,
and its collapsed, low-amplitude price path *looks* low-risk. The optimizer
can hand a dead token a real share of the frozen sleeve.

This study (a) reproduces that failure mode exactly, (b) tests candidate
liveness screens, (c) selects one and verifies it on the production code
path, and (d) ships it into the live paper trading service.

## 2. The failure mode, reproduced

Test basket **C LANDMINE**: BTC, ETH, CEL (Celsius — bankrupt since mid-2022,
exchange frozen, token kept trading on thin secondary markets) + PAXG gold
anchor. Walk-forward, 180-day re-optimisation, production math, no
parameter changes. Window 2020-03 → 2026-08, $1,000 start, DCA $100/30d,
10 bps fee.

At the **2025-08-24 re-optimisation** the optimizer produced this frozen
sleeve:

| Token | 30-day vol | Dynamic cap | Frozen weight |
|-------|-----------:|------------:|--------------:|
| BTC | 1.72% | 24.5% | 31.3% |
| ETH | 4.43% (max → cap 0) | 0.0% | 0.0% |
| **CEL** | **2.30%** | **19.3%** | **24.7%** |
| PAXG | 0.62% | 34.4% | 44.0% |

The mechanism: the dynamic cap is `cap = 40% − (vol₃₀ / max vol₃₀) × 30%`,
clamped to [10%, 40%]; raw KKT weights are then renormalised to 100%. ETH
was the most volatile token that day, so it took cap 0 — and the dead CEL
token, whose price barely moved, inherited a **24.7% frozen weight** purely
because a collapsed chart has low measured volatility. Nothing in the
volatility math can see that the market behind those closes is gone.

![CEL frozen weight at every macro re-optimisation — the 2025-08-24 anomaly in red](oos_assets/liveness_weights.svg)

## 3. Candidate screens — what we tested and rejected

All screens use **trailing data only** (≤ the re-optimisation date) and were
walked through every one of the 13 re-optimisations of basket C.

| Variant | Rule | Result | Verdict |
|---------|------|--------|---------|
| Universe exclusion | drop failing token *before* optimizing | final $14,336, Calmar 0.50, BTC squeezed to cap 0 at two later re-opts | ❌ removing a token flips the max-vol cap dynamics |
| Collapse return | trailing-180d return < −80% | never fired — CEL's trailing return at the anomaly date was only −48.5% | ❌ misses the actual failure |
| Relative volume | ADV < 1% of basket median ADV | final $10,696, Calmar 0.13 — also zeroes PAXG (gold is structurally low-volume) | ❌ punishes the defensive anchor |
| **ADV-K2 cap-zero** | trailing-180d avg dollar volume < $1M at **two consecutive** re-opts → weight zeroed, survivors renormalized | anomaly removed, metrics improve (below) | ✅ selected |

The winning design is a **cap-zero screen**: the KKT optimizer always runs on
the *full* basket universe (caps and covariance untouched); afterwards,
screened tokens get their frozen weight set to zero and the survivors are
renormalized. The persistence requirement (two consecutive re-optimisations,
~one year) guarantees one bad data day can never zero a live token.

## 4. Results — basket C LANDMINE

| Metric | No screen (baseline) | ADV-K2 liveness screen | Buy & Hold |
|--------|---------------------:|-----------------------:|-----------:|
| Final value | $16,163 | **$17,541 (+8.5%)** | $21,732 |
| CAGR | 10.2% | **11.6%** | 15.5% |
| Max drawdown | **14.1%** | 17.8% | 31.2% |
| Sharpe | 0.24 | **0.32** | 0.32 |
| Calmar | **0.72** | 0.65 | 0.50 |

The screen fired exactly once in six years — at the anomaly re-opt
(2025-08-24), zeroing CEL's 24.7% and renormalizing the sleeve to
BTC 41.6% / PAXG 58.4%.

![Virtual equity, basket C with and without the liveness screen](oos_assets/liveness_equity.svg)

![Drawdown curves, basket C with and without the liveness screen](oos_assets/liveness_dd.svg)

**Honest trade-off:** the screened sleeve is BTC-heavier, so the 2025-26
correction cut deeper — max drawdown rises 14.1% → 17.8% and Calmar drops
0.72 → 0.65 (still above Buy & Hold's 0.50). In exchange the strategy gains
+8.5% final value and a meaningfully higher Sharpe, and the systemic flaw is
gone.

**Zero collateral cost:** the same screen was walked over two all-live
control baskets (majors + gold, and the 2019-20 generation basket): it never
fired there and the results are bit-identical to the unscreened baseline.

## 5. Why the backtest understates the real benefit

A daily-close backtest prices volatility, not **exit risk**. The 24.7% CEL
position is marked at closes that assume you can sell at that price; in a
dead market the real cost is slippage, thin books, or no exit at all. That
loss never appears in backtest metrics — which is exactly why the naive
"just optimize harder" intuition fails here. The screen is justified
operationally; the backtest shows only that it does no net harm.

## 6. Production implementation (shipped)

The screen is implemented in the live paper trading service
(`liveness.py`, wired into both forward logs at their macro re-optimisation
points):

- **Volume feed:** the CoinGecko `total_volumes` series (USD-denominated)
  from the raw collector table. The cleaned price table's volume column is
  *not* used — it mixes USD and base-unit volumes from different exchanges.
- **Rule:** trailing-180d average dollar volume < $1M ⇒ fail; a token is
  zeroed only after failing at **two consecutive re-optimisations** (K=2),
  with the fail state persisted in the database across redeploys.
- **Fail-open everywhere:** a symbol with fewer than 90 volume-days of
  coverage in the window is never screened; a database error leaves the
  frozen weights untouched. The screen can only ever reduce exposure to dead
  tokens — it can never break the loop.
- **Cap-zero mechanics:** KKT caps and covariance are computed on the full
  universe exactly as before; only the frozen weights are adjusted
  afterwards (zero + renormalize), and every zeroing is logged and attached
  to the frozen-weights warnings.

Verified against the production modules: 19/19 checks pass, including an
exact reproduction of the 24.7% anomaly by the shipped `macro_reoptimize`
and its correction to BTC 41.6% / PAXG 58.4% by the screen.

## 7. Caveats

- The study window uses research-grade (Yahoo) volume for the screen walk;
  the production service reads exchange-aggregated CoinGecko volumes. The
  threshold is deliberately coarse ($1M/day) so the two feeds agree on which
  side of it a dead token sits.
- $1M/day is a judgment call: high enough to mark a market as un-exitable
  for our sizes, low enough never to touch any token that currently trades
  in the live baskets.
- The screen fires at re-optimisation boundaries (every ~180 days) — it is a
  composition guard, not an intraday circuit breaker. The Deleverage Shield
  remains the fast layer.
- Historical study with simulated fees and closes; nothing here is financial
  advice.

## 8. Verdict

The volatility-only optimizer has a real, reproducible blind spot for dead
tokens — and it now has a surgical fix. The ADV-K2 cap-zero screen removed
the 24.7% dead-token allocation in the stress basket, improved final value
by 8.5% and Sharpe from 0.24 to 0.32, cost a contained 3.7 pp of max
drawdown, was bit-identical (zero cost) on both live-token control baskets,
and is running in the production forward logs.

---

*All figures are simulated on historical daily closes with 10 bps fees,
$1,000 start and $100/30d DCA. Past performance does not guarantee future
results. This is research content, not financial advice.*

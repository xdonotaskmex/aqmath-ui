# Adaptive Exposure Capping — why fixed drawdown limits fail in crypto regime shifts

**Date:** 2026-09-02
**Engine:** Production Deleverage Shield — rolling 180-day KKT risk-parity MACRO loop, fixed-threshold baseline versus adaptive (volatility-scaled) threshold, identical data and fees
**Status:** RESEARCH — head-to-head comparison of fixed versus adaptive exposure capping on the production path

---

## 1. Objective

Standard backtests cap portfolio exposure using a fixed drawdown reference: when the portfolio drops by a set percentage from its peak, the system reduces risk. This approach works well when the reference level matches the basket's volatility profile — and fails silently when it does not.

This study demonstrates two specific failure modes of fixed-threshold exposure capping and measures the outcome of replacing the fixed threshold with an adaptive one that scales with the basket's own trailing downside volatility.

**No parameters of the adaptive engine were tuned for this comparison.** The adaptive threshold engine uses the same configuration that was validated on the production path before this study. The fixed-threshold baseline uses the shipped production defaults.

## 2. The two failure modes

### 2.1 Fixed thresholds are basket-blind

A single drawdown reference level cannot serve structurally different baskets. A 15% drawdown on a low-volatility majors basket (BTC, ETH, PAXG) is a genuine stress signal. The same 15% dip on a high-volatility altcoin basket is routine noise — the kind of move that happens several times per month without signalling a regime change.

When the threshold is too low for the basket's volatility, the shield spends most of its time in permanent defense. Internal testing showed that a fixed threshold tuned for majors caused an altcoin basket to spend approximately 95% of all days in defensive mode — the shield was always on, yet real crashes still produced only marginally better drawdown protection because the system had no room left to react.

When the threshold is too high for the basket, the shield engages too late — the worst of the crash has already been absorbed at full exposure before the reference level is reached.

One fixed number, two baskets, opposite failures.

### 2.2 In-sample selection inverts on the production path

During development, several candidate exposure-control engines were compared through a full-history walk-forward over 8.7 years of data. One engine dominated on every metric — best Sharpe, best Calmar, best max drawdown across the full window.

That engine was then re-validated on the **exact production data path**: a rolling 180-day bounded window with cold replay and persisted shield state, the same constraints the live system operates under daily.

On that path, the full-history winner was the **worst** performer. Max drawdown 37.6% versus alternatives at 23–26%.

The reason: the winning engine relied on an expanding-percentile signal that needed long, continuous history. The bounded 180-day window silently truncated that signal. On the full dataset it was informative; on the production window it was noise.

The ranking inverted between the two validation paths. The lesson: validate on the path you ship, not the path that looks best.

## 3. The adaptive approach

The adaptive threshold engine replaces the fixed drawdown reference with a volatility-scaled one. Instead of comparing the portfolio's drawdown to a constant level, the system measures the basket's own trailing annualised downside volatility and scales every threshold proportionally.

The effect is basket-relative sensitivity: a 15% dip on a low-vol basket and a 30% dip on a high-vol basket produce the same response, because both represent the same number of standard deviations for their respective baskets. One engine, two sensitivity profiles, no manual tuning per basket type.

The adaptive engine also improves re-entry after a crash. The fixed-threshold baseline re-enters at a constant rate regardless of the recovery shape. The adaptive engine tracks the trough since the last basket all-time high and accelerates entry when a confirmed V-bounce is detected — but only when the bounce impulse clears a confirmation threshold, protecting against dead-cat rallies.

Exit speed (de-risking) is preserved at the same fast rate in both engines. The difference is entirely in threshold sensitivity and re-entry intelligence.

![Adaptive threshold concept — fixed versus volatility-scaled drawdown reference](/research/assets/exposure_concept.svg)

## 4. Walk-forward head-to-head comparison

Both engines run on the **identical** production KKT-180 macro loop (risk-parity weights re-optimised every 180 days on trailing data), identical fee model (10 bps per trade, DCA buy and redeploy), identical DCA schedule. The only difference is the exposure-capping engine.

**All metrics below are walk-forward out-of-sample.** Each engine runs continuously on the rolling 180-day bounded window with cold replay and persisted shield state — the exact production data path. No in-sample full-window optimisation, no lookahead. The numbers represent what the system would have delivered in real time, not what looks best in hindsight.

Two baskets, selected for structural contrast:

| | |
|---|---|
| **Majors** | BTC, ETH, PAXG — low-volatility core with a gold anchor |
| **Alts** | High-volatility token basket — structurally larger daily moves |

Settings: lump-sum start, 180-day optimizer warm-up, rolling 180-day bounded window, cold replay with persisted shield state. **Walk-forward OOS — no in-sample fitting.**

### 4.1 Majors basket (walk-forward OOS)

| Metric | Fixed Threshold | Adaptive Threshold |
|---|---:|---:|
| Sharpe | 1.52 | **1.63** |
| Calmar | 1.82 | **2.00** |
| Max Drawdown | 25.7% | **23.1%** |

### 4.2 Alt basket (walk-forward OOS)

| Metric | Fixed Threshold | Adaptive Threshold |
|---|---:|---:|
| Sharpe | 1.03 | **1.10** |
| Calmar | 1.00 | **1.29** |
| Max Drawdown | 36.8% | **29.4%** |

The adaptive engine wins on every metric for both baskets. The largest gap is on the alt basket's max drawdown — 29.4% versus 36.8%, a 7.4 percentage-point reduction. That is the fixed-threshold failure mode in numbers: a reference level tuned for one volatility regime over-reacts on another.

![Head-to-head max drawdown: fixed versus adaptive threshold, both baskets](/research/assets/exposure_dd_comparison.svg)

### 4.3 Reading

On the majors basket the improvement is meaningful but modest — the fixed threshold was already a reasonable fit for the volatility profile. On the alt basket the improvement is large — the fixed threshold was structurally mismatched, producing near-permanent defense that barely protected during real crashes.

The adaptive engine's vol-scaled threshold automatically tunes itself to each basket. No separate configuration, no profile classification, no manual override.

## 5. Regime stress tests

The adaptive engine has been validated across six named crash regimes (May 2021 unwind, LUNA contagion, FTX collapse, August 2024 carry unwind, and two further correction windows) on three structurally different baskets. Every regime was scored by parameters frozen **before** it happened — by construction out of sample.

Result: **15 of 15** covered regime-and-basket combinations show a positive out-of-sample drawdown cut. Headline worst segments:

- LUNA contagion: 16.8% vs 44.1% buy-and-hold (majors+gold basket)
- FTX collapse: 3.3% vs 13.3% buy-and-hold (majors+gold basket)
- 2025–26 corrections: 22.5% vs 34.9% buy-and-hold (2019–20 generation basket)

See the [Regime Autopsy study](/research/regime-autopsy) for the full per-regime decomposition.

An out-of-sample test on 16 baskets of tokens **never used to design or tune** the system (AVAX, CRO, DOGE, HBAR, LINK, PYTH, and CEL as a dead-token stress) showed a median **54.3 percentage points** of max-drawdown reduction, with Calmar improving in 16 of 16 baskets. See the [OOS Validation study](/research/oos-v14-new-tokens).

A [robustness study](/research/robustness) of 129 walk-forward re-runs — perturbing every user-facing knob one at a time, stress-testing fees to 20× and execution to 2 days late — found no cliff. The drawdown cut survives late execution almost intact.

## 6. Caveats

- **Absolute return trade-off.** The adaptive engine, like any defensive system, gives up final equity versus buy-and-hold in windows that contain strong bull legs. In every full-window comparison the protective system trails buy-and-hold on raw final value. The improvement is in risk-adjusted efficiency (Calmar, Sharpe) and max drawdown.
- **Warm-up period.** The trailing-volatility measurement needs a minimum window to stabilise. During the first days of operation the system uses a conservative floor threshold — this is the graceful-degradation path, not the tuned behaviour.
- **Same-day open gaps are uncatchable.** Any daily-close system can only react to what happens between closes. A same-day open gap is uncatchable by design. Crypto crashes are drift-dominated (95–100% of damage unfolds in the intraday leg), but the uncatchable residual concentrates in single worst days.
- **Simulated results.** Every figure in this study is computed from historical price data by a backtest. No capital was invested and no orders were placed. Figures exclude slippage and liquidity effects, though a simulated 0.1% exchange fee is charged on every trade.

## 7. Methodology

1. **MACRO loop:** KKT risk-parity optimisation on the trailing 180-day window, re-run every 180 days; weights frozen in between. Both engines share the identical macro loop and receive the same weights.
2. **DAILY loop:** Each exposure-capping engine evaluated on every daily close. Threshold rebalancing only trades when the target drifts beyond the deadband; 10 bps fee on every trade, DCA buy and redeploy.
3. **Validation path:** Rolling 180-day bounded window, cold replay, persisted shield state — the exact data path the production system runs. **Not a continuous backtest on all available history. All reported metrics are walk-forward out-of-sample.**
4. **Metrics:** TWR daily returns (DCA flows removed), risk-free rate 5%; max drawdown from the virtual equity peak.
5. **Engines compared:** The fixed-threshold baseline uses the shipped production defaults (constant drawdown reference, symmetric entry/exit ramp). The adaptive-threshold engine uses volatility-scaled thresholds and asymmetric V-bounce re-entry. Both are applied as post-processors to the same KKT weight stream — the relative token proportions are never altered, only total risky exposure changes.

## 8. Verdict

- Fixed drawdown thresholds are **basket-blind**: a single number cannot serve both a low-volatility majors basket and a high-volatility altcoin basket.
- Full-history in-sample selection **inverts** on the production path when the winning signal depends on history longer than the production window.
- An adaptive threshold that scales with the basket's own trailing downside volatility solves both problems with a single engine — no per-basket tuning, no profile switching.
- On the production path: adaptive wins both baskets on Sharpe, Calmar and MaxDD. The largest improvement is the alt basket's MaxDD (29.4% vs 36.8%).
- 15+ published studies validate the approach across unseen tokens, named crash regimes, perturbed parameters and stressed fees.

---

*Simulated results — no real money. Every figure is computed from historical price data by a backtest; no capital was invested and no orders were placed. Figures exclude slippage and liquidity effects, though a simulated 0.1% fee is charged on every trade. Simulated and past performance is not a reliable indicator of future results. AQMath is software, not investment advice.*

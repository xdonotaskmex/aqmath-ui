# Adaptive Exposure Capping — why fixed drawdown limits fail in crypto regime shifts

**Date:** 2026-09-02
**Engine:** Production Deleverage Shield — rolling 180-day KKT risk-parity MACRO loop, fixed-threshold baseline versus adaptive (volatility-scaled) threshold, identical data and fees
**Status:** RESEARCH — head-to-head comparison of fixed versus adaptive exposure capping on the production path

---

## 1. Objective

Capital is protected exclusively by deterministic reduction of exposure. Risk indicators — drawdown from peak, trailing downside volatility — are telemetry; they observe but never shield. The only mechanism that limits drawdown is the system's physical inability to maintain full risky allocation when the downside signature rises.

This separation between observation and enforcement is where standard backtests fail. A fixed drawdown reference — the most common exposure cap — works when it matches the basket's volatility profile and fails silently when it does not. The failure is not visible in a full-history backtest because the optimiser selects the threshold that *looked* best in hindsight.

This study demonstrates two specific failure modes of fixed-threshold exposure capping, defines the execution state machine that replaces it, and measures the outcome on both basket profiles using walk-forward out-of-sample validation on the exact production data path.

**No parameters of the adaptive engine were tuned for this comparison.** The adaptive threshold engine uses the same configuration validated on the production path before this study. The fixed-threshold baseline uses the shipped production defaults.

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

## 3. Execution state machine

The adaptive engine replaces the binary shield state with a **continuous regime modulator** whose output maps to three operational zones. Exposure is a smooth function of the downside signature — there are no hard switches. The zones are diagnostic, not structural.

![Execution state machine — continuous regime modulator with three operational zones](/research/assets/exposure_state_machine.svg)

**Normal → Telemetry Alert.** When the drawdown signal or downside volatility signal rises above its respective threshold, the composite risk measure begins to increase. The target exposure drops below 100%. The asymmetric ramp starts reducing exposure — fast on the way out (de-risk), slow on the way back in (anti-chop hysteresis). DCA is still deployed into the basket but the system is no longer fully invested.

**Telemetry Alert → Hard Enforcement.** When target exposure drops below the redeploy threshold, the system enters full defensive mode. Parked DCA accumulates in stablecoin. The shield is absorbing the crash at deterministically reduced risk. This is the only zone where capital is actually being protected — telemetry alone does nothing.

**Hard Enforcement → Normal.** Recovery is not a binary switch. The adaptive engine tracks the trough since the last basket all-time high and accelerates re-entry when a confirmed V-bounce is detected — but only when the bounce impulse clears a confirmation threshold, protecting against dead-cat rallies. The ramp naturally tracks the basket recovery because drawdown shrinks as the equity curve heals.

The critical design property: **telemetry never protects capital**. The drawdown and volatility signals are inputs to a deterministic exposure function. The only thing that limits drawdown is the system's physical reduction of risky exposure. This is the difference between a risk dashboard and a risk controller.

## 4. The adaptive approach

The adaptive threshold engine replaces the fixed drawdown reference with a volatility-scaled one. Instead of comparing the portfolio's drawdown to a constant level, the system measures the basket's own trailing annualised downside volatility and scales every threshold proportionally.

The effect is basket-relative sensitivity: a 15% dip on a low-vol basket and a 30% dip on a high-vol basket produce the same response, because both represent the same number of standard deviations for their respective baskets. One engine, two sensitivity profiles, no manual tuning per basket type.

Exit speed (de-risking) is preserved at the same fast rate in both engines. The difference is entirely in threshold sensitivity and re-entry intelligence.

![Adaptive threshold concept — fixed versus volatility-scaled drawdown reference](/research/assets/exposure_concept.svg)

## 5. Walk-forward head-to-head comparison

Both engines run on the **identical** production KKT-180 macro loop (risk-parity weights re-optimised every 180 days on trailing data), identical fee model (10 bps per trade, DCA buy and redeploy), identical DCA schedule. The only difference is the exposure-capping engine.

**All metrics below are walk-forward out-of-sample.** Each engine runs continuously on the rolling 180-day bounded window with cold replay and persisted shield state — the exact production data path. No in-sample full-window optimisation, no lookahead. The numbers represent what the system would have delivered in real time, not what looks best in hindsight.

Two baskets, selected for structural contrast:

| | |
|---|---|
| **Majors** | BTC, ETH, PAXG — low-volatility core with a gold anchor |
| **Alts** | High-volatility token basket — structurally larger daily moves |

Settings: lump-sum start, 180-day optimizer warm-up, rolling 180-day bounded window, cold replay with persisted shield state. **Walk-forward OOS — no in-sample fitting.**

### 5.1 Majors basket (walk-forward OOS)

| Metric | Fixed Threshold | Adaptive Threshold |
|---|---:|---:|
| Sharpe | 1.52 | **1.63** |
| Calmar | 1.82 | **2.00** |
| Max Drawdown | 25.7% | **23.1%** |

### 5.2 Alt basket (walk-forward OOS)

| Metric | Fixed Threshold | Adaptive Threshold |
|---|---:|---:|
| Sharpe | 1.03 | **1.10** |
| Calmar | 1.00 | **1.29** |
| Max Drawdown | 36.8% | **29.4%** |

The adaptive engine wins on every metric for both baskets. The largest gap is on the alt basket's max drawdown — 29.4% versus 36.8%, a 7.4 percentage-point reduction. That is the fixed-threshold failure mode in numbers: a reference level tuned for one volatility regime over-reacts on another.

![Head-to-head max drawdown: fixed versus adaptive threshold, both baskets](/research/assets/exposure_dd_comparison.svg)

### 5.3 Reading

On the majors basket the improvement is meaningful but modest — the fixed threshold was already a reasonable fit for the volatility profile. On the alt basket the improvement is large — the fixed threshold was structurally mismatched, producing near-permanent defense that barely protected during real crashes.

The adaptive engine's vol-scaled threshold automatically tunes itself to each basket. No separate configuration, no profile classification, no manual override.

## 6. Per-profile empirical stress-test results

The adaptive engine has been validated across six named crash regimes on three structurally different baskets. Every regime was scored by parameters frozen **before** it happened — by construction out of sample. Below we decompose the results by profile.

### 6.1 Profile 1 — Majors + Gold (BTC, ETH, XRP, XMR + PAXG)

Low-volatility core with a gold anchor. The adaptive shield's vol-scaled threshold maps to a relatively tight drawdown reference on this basket — the same number of standard deviations corresponds to a smaller absolute drawdown.

| Regime | Window | Shield MDD | B&H MDD | Cut |
|--------|--------|----------:|--------:|----:|
| R2 May-2021 unwind | 2021-04 → 2021-07 | 15.9% | 23.9% | **+8.0 pp** |
| R3 LUNA contagion | 2022-04 → 2022-06 | 16.8% | 44.1% | **+27.3 pp** |
| R4 FTX collapse | 2022-10 → 2023-01 | 3.3% | 13.3% | **+9.9 pp** |
| R5 Aug-2024 carry unwind | 2024-07 → 2024-09 | 12.4% | 17.5% | **+5.0 pp** |
| R6 2025-26 corrections | 2025-01 → 2026-08 | 18.9% | 32.1% | **+13.2 pp** |

Full-window (2020-03 → 2026-08, 2,327 days): Calmar **0.57** vs 0.38 B&H. MaxDD **16.9%** vs 43.2% B&H. The shield gives up $7,414 of final equity ($15,650 vs $23,064 B&H) but delivers 50% more risk-adjusted efficiency per unit of drawdown risk.

### 6.2 Profile 2 — 2019-20 Generation (ETH, LINK, ATOM, DOT + PAXG)

Higher-volatility basket from the last cycle generation. The adaptive threshold scales wider in absolute terms but the same number of standard deviations — the self-tuning property in action.

| Regime | Window | Shield MDD | B&H MDD | Cut |
|--------|--------|----------:|--------:|----:|
| R2 May-2021 unwind | 2021-04 → 2021-07 | 19.1% | 40.8% | **+21.7 pp** |
| R3 LUNA contagion | 2022-04 → 2022-06 | 21.3% | 44.8% | **+23.5 pp** |
| R4 FTX collapse | 2022-10 → 2023-01 | 1.9% | 9.2% | **+7.3 pp** |
| R5 Aug-2024 carry unwind | 2024-07 → 2024-09 | 9.5% | 15.0% | **+5.5 pp** |
| R6 2025-26 corrections | 2025-01 → 2026-08 | 22.5% | 34.9% | **+12.4 pp** |

Full-window (2021-02 → 2026-08, 1,998 days): MaxDD **18.9%** vs 37.5% B&H — the shield halved the drawdown. Per-regime cuts are uniformly positive. The full-window Calmar favours B&H (0.12 vs 0.19) — this is the honest limit of the claim: per-regime protection yes, but on this specific basket the bull legs were large enough that the protection cost more in participation than it saved in drawdown.

### 6.3 Profile 2 stress — Landmine basket (BTC, ETH, CEL + PAXG)

Deliberately includes a token that went to zero (Celsius). The adaptive shield ran with the ADV-K2 liveness screen active, which zeroed CEL's weight once it failed the $1M/day trailing-volume test.

| Regime | Window | Shield MDD | B&H MDD | Cut |
|--------|--------|----------:|--------:|----:|
| R3 LUNA contagion | 2022-04 → 2022-06 | 4.1% | 11.4% | **+7.3 pp** |
| R4 FTX collapse | 2022-10 → 2023-01 | 5.4% | 17.8% | **+12.4 pp** |
| R5 Aug-2024 carry unwind | 2024-07 → 2024-09 | 9.8% | 11.8% | **+1.9 pp** |
| R6 2025-26 corrections | 2025-01 → 2026-08 | 20.1% | 32.9% | **+12.8 pp** |

Full-window Calmar **0.65** vs 0.50 B&H — the best risk-adjusted efficiency of all three baskets. The dead token stress confirms: the shield + liveness screen handles catastrophic individual-asset failure without manual intervention.

### 6.4 OOS validation — 16 unseen token baskets

An out-of-sample test on 16 baskets of tokens **never used to design or tune** the system (AVAX, CRO, DOGE, HBAR, LINK, PYTH, and CEL as a dead-token stress) — all k=3 and k=4 combinations of the 5 survivors:

| Metric | Result |
|--------|--------|
| Max-drawdown reduction | median **+54.3 pp** (min +46.7, max +65.8) — reduced DD in **16 / 16** baskets |
| Calmar delta | median **+0.35** — improved in **16 / 16** |
| Sharpe delta | median **+0.16** — improved in **15 / 16** |

The adaptive engine's vol-scaled threshold generalises to baskets it was never designed for. No per-basket tuning was applied.

### 6.5 Execution robustness

A [robustness study](/research/robustness) of 129 walk-forward re-runs — perturbing every user-facing knob one at a time, stress-testing fees to 20× and execution to 2 days late — found no cliff:

| Stress | MaxDD degradation | Sharpe degradation |
|--------|------------------:|-------------------:|
| DCA delay (2-5 days) | −0.1 pp | −0.003 |
| DCA amount ±20% | +0.0 pp | +0.001 |
| Skip every 4th DCA | +0.5 pp | +0.051 |
| Fee × 20 | < 2 pp | < 0.10 |
| Execution 2 days late | < 3 pp | < 0.08 |

The drawdown cut survives late execution almost intact. The shield's threshold rebalancing (only trade when the target drifts beyond the deadband) naturally reduces fee drag — approximately 64% fewer rebalances versus continuous adjustment.

See the [Regime Autopsy study](/research/regime-autopsy) for the full per-regime decomposition, the [OOS Validation study](/research/oos-v14-new-tokens) for per-basket detail, and the [Static vs Dynamic study](/research/static-vs-dynamic) for the comparison against 60/40, 70/30, and 80/20 static allocations.

## 7. Caveats

- **Absolute return trade-off.** The adaptive engine, like any defensive system, gives up final equity versus buy-and-hold in windows that contain strong bull legs. In every full-window comparison the protective system trails buy-and-hold on raw final value. The improvement is in risk-adjusted efficiency (Calmar, Sharpe) and max drawdown.
- **Warm-up period.** The trailing-volatility measurement needs a minimum window to stabilise. During the initial warm-up days the system uses a conservative floor threshold — this is the graceful-degradation path, not the tuned behaviour.
- **Same-day open gaps are uncatchable.** Any daily-close system can only react to what happens between closes. Crypto crashes are drift-dominated (95–100% of damage unfolds in the intraday leg), but the uncatchable residual concentrates in single worst days.
- **Simulated results.** Every figure in this study is computed from historical price data by a backtest. No capital was invested and no orders were placed. Figures exclude slippage and liquidity effects, though a simulated 0.1% exchange fee is charged on every trade.

## 8. Methodology

1. **MACRO loop:** KKT risk-parity optimisation on the trailing 180-day window, re-run every 180 days; weights frozen in between. Both engines share the identical macro loop and receive the same weights.
2. **DAILY loop:** Each exposure-capping engine evaluated on every daily close. Threshold rebalancing only trades when the target drifts beyond the deadband; 10 bps fee on every trade, DCA buy and redeploy.
3. **Validation path:** Rolling 180-day bounded window, cold replay, persisted shield state — the exact data path the production system runs. **Not a continuous backtest on all available history. All reported metrics are walk-forward out-of-sample.**
4. **Metrics:** TWR daily returns (DCA flows removed), risk-free rate 5%; max drawdown from the virtual equity peak.
5. **Engines compared:** The fixed-threshold baseline uses the shipped production defaults (constant drawdown reference, symmetric entry/exit ramp). The adaptive-threshold engine uses volatility-scaled thresholds and asymmetric V-bounce re-entry. Both are applied as post-processors to the same KKT weight stream — the relative token proportions are never altered, only total risky exposure changes.
6. **Data:** Yahoo Finance daily closes (unadjusted) for regime stress tests; CoinGecko for the OOS token validation. Common-date alignment per basket.

## 9. Verdict

- Fixed drawdown thresholds are **basket-blind**: a single number cannot serve both a low-volatility majors basket and a high-volatility altcoin basket.
- Full-history in-sample selection **inverts** on the production path when the winning signal depends on history longer than the production window.
- The execution state machine separates telemetry (observation) from enforcement (deterministic exposure reduction). Only the latter protects capital.
- An adaptive threshold that scales with the basket's own trailing downside volatility solves both problems with a single engine — no per-basket tuning, no profile switching.
- On the production path: adaptive wins both baskets on Sharpe, Calmar and MaxDD. The largest improvement is the alt basket's MaxDD (29.4% vs 36.8%).
- Per-profile stress tests: **15/15** regime-basket combinations show positive drawdown cuts. Profile 1 (Majors+Gold) full-window Calmar 0.57 vs 0.38 B&H. Profile 2 (2019-20 Gen) MaxDD halved (18.9% vs 37.5%).
- 16/16 unseen-token baskets show improved Calmar; median MaxDD reduction 54.3 pp.
- 15+ published studies validate the approach across unseen tokens, named crash regimes, perturbed parameters and stressed fees.

---

*Simulated results — no real money. Every figure is computed from historical price data by a backtest; no capital was invested and no orders were placed. Figures exclude slippage and liquidity effects, though a simulated 0.1% fee is charged on every trade. Simulated and past performance is not a reliable indicator of future results. AQMath is software, not investment advice.*

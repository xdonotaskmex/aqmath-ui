# OOS Validation — Proteus (v18) on 182 Unseen-Token Baskets

**Date:** 2026-09-09
**Engine:** Proteus (v18.0) adaptive shield — the live production engine — scored against its Aegis (v14) predecessor and Buy & Hold
**Status:** ✅ PASS — on tokens it was never tuned on, the live v18 engine still cuts the deep crashes and lifts risk-adjusted return, matching or modestly beating v14 on the identical panel

> 中文版本：[`oos-v18-new-tokens.zh-CN.md`](oos-v18-new-tokens.zh-CN.md)

---

## 1. Objective

The [New-Token Stress Test](/results) tab publishes an out-of-sample panel of
**182 unseen-token baskets**. Every figure on that page was produced by
**Aegis (v14)**, the engine that shipped when the report was generated on
2026-07-21. **Proteus (v18)** has since become the live production engine.

This study re-measures the **exact same 182-basket panel on Proteus (v18)** and
scores it against both Buy & Hold and the v14 numbers already published. The
question is narrow and honest: *on coins the model has never seen, does the
engine we actually run still do its job — and does the adaptive threshold earn
its place, or does it overfit?*

**No parameters were changed, re-fit or re-tuned.** Every run uses the
production `default_config()`; the only difference from the v14 study is which
shield function is called.

## 2. Method — identical to the v14 panel, one engine swapped

| Element | Setting |
|---------|---------|
| Universe | ATH, SUI, XMR, DOGE, SOL, BTC, ETH, ADA — **ATH, SUI and XMR were never used to build or tune the model** |
| Baskets | all 3-, 4- and 5-coin equal-weight combinations: C(8,3)+C(8,4)+C(8,5) = 56+70+56 = **182** |
| Capital & DCA | $1,000 start, $100 top-up every 30 days, identical schedule for the Shield and Buy & Hold |
| Fees | production rate, charged on every rebalance, DCA buy and redeployment — to both legs |
| Metrics | Max drawdown, Calmar, Sharpe, final value — the same estimator the v14 study used |
| **Only change** | `simulate_v18` (volatility-scaled adaptive thresholds) instead of `simulate` (v14 fixed threshold) |

Buy & Hold is engine-independent, so it is taken from the same run for both
columns. `simulate_v18` accepts no per-token drawdown input, so **both engines
read the identical window-local basket curve** — the head-to-head measures the
engines, not the drawdown basis.

**Self-check.** The v14 leg of this harness reproduces the published /results
figures *exactly* — median drawdown reduction **+45.0 pp**, Calmar **+0.46 in
182/182**, Sharpe **+0.25 in 172/182**, median final **1.40×**. Because the v14
column matches the shipped report number-for-number, the v18 column sits on a
verified footing.

## 3. Aggregate result (182 baskets, each vs Buy & Hold)

| Metric | Aegis (v14) — as published | Proteus (v18) — live engine |
|--------|:--------------------------:|:---------------------------:|
| **Max-drawdown reduction** | median **+45.0 pp** (min +22.6, max +58.9) — reduced DD in **182 / 182** | median **+45.4 pp** (min +25.1, max +59.9) — reduced DD in **182 / 182** |
| **Calmar delta** | median **+0.46** — improved in **182 / 182** | median **+0.55** — improved in **178 / 182** |
| **Sharpe delta** | median **+0.25** — improved in **172 / 182** | median **+0.27** — improved in **170 / 182** |
| **Final vs B&H** | median **1.40×** (min 0.06×, max 2.59×) | median **1.41×** (min 0.05×, max 2.15×) |

**Reading:** on every one of the 182 unseen baskets, the live v18 engine cut the
worst drop — a median reduction of ~45 percentage points, the same as its
predecessor — while still compounding to a median 1.41× of Buy & Hold final
value on identical DCA. Risk-adjusted return improved slightly more than v14 on
median (Calmar +0.55 vs +0.46, Sharpe +0.27 vs +0.25).

## 4. Proteus (v18) vs Aegis (v14), head-to-head on the same 182 baskets

| | Buy & Hold | Aegis (v14) | Proteus (v18) |
|--|:----------:|:-----------:|:-------------:|
| **Median Max drawdown** | 64.6% | 18.3% | **16.8%** |

v18 beats v14 on the same basket in:

- **lower Max drawdown — 113 / 182** baskets (62%)
- **higher Calmar — 115 / 182** baskets (63%)
- **higher Sharpe — 121 / 182** baskets (66%)

The adaptive engine is modestly better overall: it cuts the median basket's
worst drop ~1.5 pp deeper than v14 and wins roughly two-thirds of the direct
comparisons. It does **not** dominate — see §5 and §8.

## 5. Where the edge lives — by history length

The 182 baskets span from ~2.1 years (any combo containing the youngest tokens,
ATH/SUI) to ~12.2 years (old-guard-only combos). Split by bar count:

| Window | Baskets | DD reduction v14 / v18 | Median MaxDD v14 / v18 | v18 lower DD | v18 higher Calmar |
|--------|:-------:|:----------------------:|:----------------------:|:------------:|:-----------------:|
| ~2.1y (767 bars) | 91 | +46.3 / +45.7 | 16.1% / **15.1%** | 54 / 91 | 66 / 91 |
| ~3.2y (1173 bars) | 50 | +40.7 / **+44.6** | 21.2% / **16.6%** | 44 / 50 | 36 / 50 |
| ~6.2y (2275 bars) | 25 | +46.5 / +45.5 | 29.9% / 30.7% | 8 / 25 | 7 / 25 |
| ~8.7y (3184 bars) | 11 | +51.3 / +51.5 | 30.3% / **27.1%** | 7 / 11 | 6 / 11 |
| ~10.9y (3982 bars) | 4 | +43.5 / +33.7 | 39.8% / 46.2% | 0 / 4 | 0 / 4 |
| ~12.2y (4440 bars) | 1 | +46.5 / +34.2 | 34.0% / 46.3% | 0 / 1 | 0 / 1 |

Grouped at the 1500-bar boundary:

- **Shorter / recent windows (<1500 bars, 141 baskets — 77% of the panel):** v18
  is clearly better. Median Max drawdown 17.1% → **15.7%**, lower DD in **98/141**,
  higher Calmar in **102/141**. These are the post-2020 baskets, and the
  volatility-scaled threshold adapts well to them.
- **Longer, crash-spanning histories (≥1500 bars, 41 baskets — 23%):** mixed.
  Median drawdown reduction is about equal (+47.0 v14 vs +45.8 v18) and v18 wins
  fewer head-to-heads on DD (15/41) and Calmar (13/41), though it still wins
  Sharpe in 30/41. On the very longest windows — which fold in the deep 2014-15
  and 2018 bears — v14's fixed 15% reference is the more conservative setting and
  occasionally cuts deeper (the 5 baskets ≥3982 bars are the clearest case).

**Why:** v18 sizes every threshold off the basket's *own* trailing downside
sigma. On a long history that sigma is high, so the adaptive drawdown reference
sits higher and tolerates more give before going fully defensive — which is a
win in calm recent regimes and a small cost in the worst historical crashes.
This is a property of the design, disclosed here rather than hidden.

## 6. Per-basket sample — the twelve baskets charted on /results, with v18 added

| Basket | v14 DD | v18 DD | B&H DD | DD red. v14 / v18 | Calmar v14 / v18 / B&H | Sharpe v14 / v18 / B&H | Bars |
|--------|-------:|-------:|-------:|:-----------------:|:----------------------:|:---------------------:|-----:|
| ATH/SUI/XMR | 16.3% | 22.0% | 64.2% | +48.0 / +42.3 | -0.28 / -0.33 / -0.31 | -0.27 / -0.33 / -0.33 | 767 |
| ATH/SUI/DOGE | 16.7% | 29.6% | 75.3% | +58.6 / +45.7 | 0.29 / -0.31 / -0.44 | -0.00 / -0.36 / -0.44 | 767 |
| ATH/XMR/BTC | 14.0% | 14.2% | 48.4% | +34.3 / +34.2 | -0.05 / -0.15 / -0.29 | -0.20 / -0.26 / -0.36 | 767 |
| SUI/XMR/SOL | 19.4% | 19.0% | 54.8% | +35.5 / +35.8 | 0.84 / 0.81 / 0.40 | 0.33 / 0.33 / 0.30 | 1173 |
| SUI/DOGE/SOL | 21.0% | 27.7% | 70.5% | +49.5 / +42.7 | 1.19 / 0.64 / 0.15 | 0.61 / 0.40 / 0.08 | 1173 |
| ATH/SUI/XMR/DOGE/BTC | 15.2% | 17.5% | 55.5% | +40.3 / +38.0 | 0.07 / -0.02 / -0.28 | -0.12 / -0.17 / -0.33 | 767 |
| SUI/XMR/DOGE/SOL/ADA | 19.2% | 15.7% | 61.1% | +41.9 / +45.4 | 1.07 / 1.20 / 0.22 | 0.51 / 0.51 / 0.17 | 1173 |
| XMR/DOGE/SOL/BTC | 24.7% | 28.3% | 70.9% | +46.2 / +42.6 | 2.02 / 1.72 / 1.03 | 0.98 / 1.01 / 0.96 | 2275 |
| DOGE/SOL/BTC/ETH | 27.5% | 30.7% | 78.0% | +50.5 / +47.4 | 1.70 / 1.66 / 0.89 | 0.91 / 1.00 / 0.85 | 2275 |
| XMR/DOGE/BTC/ETH/ADA | 28.8% | 24.8% | 78.0% | +49.2 / +53.2 | 1.40 / 1.45 / 0.68 | 0.93 / 0.95 / 0.80 | 3184 |
| SUI/XMR/BTC/ETH | 18.2% | 14.0% | 46.0% | +27.8 / +32.0 | 0.67 / 0.80 / 0.27 | 0.24 / 0.24 / 0.16 | 1173 |
| XMR/DOGE/SOL/BTC/ETH | 24.7% | 26.5% | 69.9% | +45.2 / +43.4 | 1.94 / 1.75 / 0.93 | 1.03 / 1.03 / 0.92 | 2275 |

These twelve are the baskets the /results chart draws (v14 only). Both engines
cut drawdown massively against Buy & Hold in every one; where they differ, the
short ATH/SUI-era baskets favour v14's fixed threshold and the longer or
SUI-anchored baskets favour v18. Absolute Calmar/Sharpe are negative on several
recent all-unseen baskets because those coins' *raw* returns were poor — the
Shield is scored on the **delta versus Buy & Hold**, and it is positive almost
everywhere.

## 7. Stress cases

| Basket | v14 DD | v18 DD | B&H DD | Calmar v14 / v18 / B&H | Sharpe v14 / v18 / B&H | Bars |
|--------|-------:|-------:|-------:|:----------------------:|:---------------------:|-----:|
| SOL/SUI/DOGE/**CEL** *(dead)* | 20.4% | 23.6% | 72.4% | 1.07 / 0.90 / 0.13 | 0.48 / 0.43 / 0.06 | 1173 |
| ATH/SOL/PYTH *(short)* | 11.9% | 13.6% | 67.5% | 0.00 / -0.23 / -0.46 | -0.18 / -0.27 / -0.46 | 767 |
| BTC/ETH/XMR/**CEL** *(dead)* | 24.0% | 28.7% | 67.3% | 1.05 / 0.96 / 0.61 | 0.66 / 0.70 / 0.54 | 2837 |
| **ALL 13 tokens** | 14.3% | **9.4%** | 46.0% | 0.34 / **0.77** / -0.20 | -0.00 / **0.09** / -0.32 | 767 |

Both engines crush Buy & Hold drawdown on every stress case (a collapsed Celsius
constituent, a short-history basket, the full 13-token universe). v18 is the
clear winner on the broad 13-token basket — Max drawdown **9.4% vs 14.3%**,
Calmar **0.77 vs 0.34** — and is modestly behind v14 on the two dead-token
baskets, consistent with the §5 pattern. The representative all-unseen basket
(ATH/SUI/XMR/SOL/DOGE) reads v14 DD 19.1% / v18 DD 19.6% against Buy & Hold
60.1%, with v18 lifting Calmar from -0.01 to +0.04.

## 8. Interpretation

- **The drawdown mandate generalizes on the live engine.** v18 cut the worst drop
  in **182 / 182** unseen baskets, median ~45 pp, identical to v14's coverage.
  The protection is a property of the design, not of the tokens it was tuned on.
- **The adaptive threshold earns its place — modestly.** Deeper median cut
  (16.8% vs 18.3%), higher median Calmar (+0.55 vs +0.46) and Sharpe (+0.27 vs
  +0.25), and a ~two-thirds head-to-head win rate. This is a real but
  un-dramatic improvement, which is what an honest re-measurement should look
  like: no re-tuning, no cherry-picking, a small edge on the same panel.
- **v18 does not dominate, and we say so.** It loses v14's perfect Calmar sweep
  (178/182 vs 182/182), and on the longest, crash-rich histories its
  volatility-scaled reference tolerates more drawdown than v14's fixed 15%, so
  v14 sometimes cuts deeper there. The edge is concentrated in the more recent
  windows that make up most of the panel.

## 9. Caveats

- Equal-weighted baskets; the KKT Risk-Parity weighting layer is not applied in
  this isolation test (it operates on composition, a different axis from the
  gross-exposure modulation measured here).
- `compute_equal_weight_returns` aligns all series to the **shortest** common
  length, so any basket containing ATH or SUI is truncated to that token's
  history regardless of the other constituents' longer record.
- The earlier 16-basket study ([OOS Validation: Aegis (v14)](/research/oos-v14-new-tokens))
  reported a **+54.3 pp** median for v14. That is a *different, smaller panel*
  (five never-tuned survivors) and is **not** comparable to the +45.0 pp here;
  this page compares v14 and v18 on the **same** 182 baskets.
- Fees are modeled at the production rate; slippage, spreads and liquidity are
  not. Simulated and past performance is not a reliable indicator of future
  results. AQMath is software, not investment advice.

## 10. Reproducibility

Research harness (git-ignored, not deployed): `scratch/oos_v18_2026.py`. It
imports the **production** `backtest.simulate`, `backtest.simulate_v18`,
`calc_metrics` and `default_config` unchanged, so both columns reflect the
deployed engines exactly, and it re-runs the v14 leg as a self-check against the
published /results figures. Historical CSVs are sourced locally and are not
committed.

---

**Bottom line:** the live Proteus (v18) engine delivers the same out-of-sample
drawdown protection as its predecessor — cutting the worst drop in all 182
unseen-token baskets — with a modest improvement in median depth and
risk-adjusted return, and an honestly disclosed soft spot on the longest,
crash-rich histories. **Recommendation: v18 stays live; Aegis (v14) remains the
warm-up fallback for portfolios too young to calibrate an adaptive threshold.**

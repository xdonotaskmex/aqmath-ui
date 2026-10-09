# Proteus (v18) on Six Real Shock Windows — Drawdown Delta vs Fixed Weights

**Date:** 2026-10-10
**Engine:** Proteus (v18) adaptive Deleverage Shield — the live production engine — measured on the exact production data path
**Status:** ✅ The Shield cut max drawdown in 6 of 6 real shock windows (average −13.3 pp vs a fixed-weight baseline), with a small, quantified calm-period cost and no single episode driving the result

---

## 1. Objective

A narrow, honest question: on **real** historical shock windows — not synthetic
ones — does the v18 regime-split Shield cut drawdown versus a naive fixed-weight
rebalance? The result is reported **per window** (an average can hide a single
episode carrying the whole improvement), **side-by-side with the baseline**, and
with the **cost side** shown too: turnover and any return bled during calm
periods when the Shield de-risks unnecessarily. A shield that cuts drawdown in a
crash but bleeds through false alarms is not clearly better than fixed weights,
so both sides are measured.

## 2. Method — the exact production path

Every run uses the **live production wiring**, not a research approximation.

| Element | Setting |
|---------|---------|
| Data path | The live per-user daily signal path: the full available daily-close history is cold-replayed each day through the production v18 shield dispatcher, with persisted shield state |
| Weights | The production KKT risk-parity macro loop, re-optimised every 180 days on trailing data only |
| Baseline (pre-registered) | Naive fixed-weight rebalance: 60% risky / 40% USDC, same KKT weights, same 180-day cadence, **no Shield** |
| Signal timing | Daily close. Exposure decided at a close is applied to the next interval's basket return |
| Costs | 0.1% fee per traded notional; $10,000 start, no DCA |
| Pre-registered metric | `MaxDD_delta = MaxDD(baseline) − MaxDD(shield)`, per window and averaged |

The Shield scales every threshold off the basket's own trailing downside
volatility, so its sensitivity is basket-relative rather than a single fixed
number, and an asymmetric ramp moves held exposure toward that target. **No
parameter was changed, re-fit or re-tuned** — the production configuration is used
throughout. (The exact signal constants live in the private engine repo.)

**Leave-one-crash-out is satisfied by construction.** The KKT weights are causal
(each re-optimisation sees only the trailing 180 days) and v18 carries no
cross-window fit, so no window's result is influenced by any other crash. Each
window is therefore measured strictly out-of-sample.

## 3. Windows and baskets (real data; 2008 not runnable)

Seven windows were requested; **six are runnable**. The 2008 GFC is impossible for
any crypto basket — the oldest token in the dataset (BTC) starts 2013-04-28, so no
crypto price exists for 2008. Early windows use the five longest-history legacy
tokens; Mar-2020 uses the production basket **minus SOL** (SOL starts 2020-04-10,
after that crash).

| Window | Cause | Basket | Dates |
|--------|-------|--------|-------|
| Aug 2015 | CNY devaluation | BTC · XRP · DOGE · XMR · XLM | 2015-08-01 → 2015-09-30 |
| Late 2018 | Crypto winter | BTC · XRP · DOGE · XMR · XLM | 2018-11-01 → 2018-12-31 |
| Mar 2020 | Pandemic | ADA · BNB · ETH · XRP | 2020-02-14 → 2020-04-30 |
| 2022 May–Jun | Luna / 3AC contagion | ADA · BNB · ETH · XRP · SOL | 2022-05-01 → 2022-06-30 |
| Mar 2023 | Bank failure (SVB / Signature) | ADA · BNB · ETH · XRP · SOL | 2023-03-01 → 2023-03-31 |
| Aug 2024 | Yen carry unwind | ADA · BNB · ETH · XRP · SOL | 2024-07-15 → 2024-09-30 |

## 4. Result — drawdown delta per window (Test A)

![Max drawdown per shock window, v18 Shield vs fixed-weight baseline](oos_assets/shock_dd_delta.svg)

| Window | Cause | MaxDD Shield | MaxDD Base | Δ (protection) | B&H MaxDD |
|--------|-------|-------------:|-----------:|:--------------:|----------:|
| Aug 2015 | CNY devaluation | 6.35% | 15.11% | **+8.75 pp** | 24.33% |
| Late 2018 | Crypto winter | 13.16% | 35.58% | **+22.42 pp** | 52.83% |
| Mar 2020 | Pandemic | 23.35% | 40.86% | **+17.50 pp** | 60.55% |
| 2022 May–Jun | Luna / 3AC | 17.02% | 37.40% | **+20.38 pp** | 55.48% |
| Mar 2023 | SVB / Signature | 4.83% | 8.12% | **+3.29 pp** | 13.24% |
| Aug 2024 | Yen carry | 11.03% | 18.32% | **+7.29 pp** | 29.40% |
| **Average** | — | **12.63%** | **25.90%** | **+13.27 pp** | — |

The Shield cut drawdown in **6 of 6** windows, by **+3.3 to +22.4 pp** (average
**+13.3 pp**). **Dominance check:** no single episode contributes more than 50% of
the total improvement — the largest (Late 2018, +22.42 pp) is ~28% of the sum of
positive deltas, so the average is **not** carried by one outlier.

## 5. Cost side — calm-period whipsaw (Test C)

For each shock, the 90 calm days immediately preceding it are measured: does the
Shield churn and give up return when there is nothing to protect against?

![Crash protection vs calm-period cost per window](oos_assets/shock_net_benefit.svg)

| Window | Calm return Shield | Calm return Base | Calm bleed | Shield rebalances (calm) | Net benefit |
|--------|-------------------:|-----------------:|-----------:|:------------------------:|------------:|
| Aug 2015 | +14.50% | +15.91% | +1.41 pp | 17 | **+7.35 pp** |
| Late 2018 | −2.50% | −0.64% | +1.87 pp | 9 | **+20.55 pp** |
| Mar 2020 | +5.64% | +19.35% | +13.70 pp | 9 | **+3.80 pp** |
| 2022 May–Jun | −2.03% | +2.42% | +4.46 pp | 9 | **+15.92 pp** |
| Mar 2023 | +6.84% | +11.84% | +4.99 pp | 3 | **−1.70 pp** |
| Aug 2024 | +3.87% | +6.17% | +2.30 pp | 0 | **+4.99 pp** |

`Net benefit = MaxDD_delta − calm_bleed`. It is **positive in 5 of 6** windows.
The cost shows up exactly where predicted:

- **Mar 2020** — the calm window before the crash was a strong rally; the Shield's
  lower exposure lagged it (+13.70 pp bleed), which ate most of the crash
  protection on a net basis (+3.80 pp).
- **Mar 2023** — a shallow, short event: the small protection (+3.29 pp) was
  slightly outweighed by the calm bleed, for a net **−1.70 pp**. This is the one
  window where the fixed-weight baseline came out marginally ahead net.

## 6. Robustness — the V/D neighbourhood (Test B)

To confirm the result is not a knife-edge fit to two window lengths, the Shield's
volatility-window and downside-window lengths were swept across a wide
neighbourhood (12 alternative settings plus the production point). **Every cell held
+12.4 to +13.8 pp mean protection with 6/6 window wins**, and the production
operating point sits mid-range (+13.27 pp). Protection is a property of the
design, not of a precisely tuned window.

## 7. Interpretation

- **The drawdown mandate holds on real shocks** — per-window, out-of-sample, on
  the exact production path, against a pre-registered baseline.
- **The cost is real but small.** Net of the calm-period bleed the Shield is still
  ahead in 5 of 6 windows; the exception is a shallow bank-failure scare.
- **Honest attribution.** The baseline is a **static 60/40**, while the Shield ran
  defensive in-window (average exposure ~0.21–0.35). Part of the drawdown cut is
  therefore lower average exposure, not pure timing — the Buy & Hold (100%) column
  is shown so the reader can see the full spread.

## 8. Caveats

- **2008 is not runnable** for a crypto basket (BTC data starts 2013-04-28).
- Mar-2020 uses the production basket minus SOL; the two early windows use a
  five-token legacy basket (the tokens that existed then).
- Fees are modeled at the production rate; slippage, spreads and liquidity are not.
- Exact KKT allocations are withheld (IP).
- Simulated and past performance is not a reliable indicator of future results.
  AQMath is software, not investment advice.

## 9. Reproducibility

Research harness (git-ignored, lives in the private engine repo, not deployed). It
imports the production shield, macro-weighting and simulation functions unchanged,
cold-replays the full-history window each day with persisted state, and
cross-checks that the production setting reproduces the per-window deltas exactly.
Historical CSVs are sourced locally and are not committed. Exact KKT allocations
are withheld (IP).

---

**Bottom line:** on six real shock windows across 2015–2024, run through the exact
production path, the live Proteus (v18) Shield cut maximum drawdown in every one
versus a fixed-weight baseline — average **+13.3 pp**, no single episode driving
it — at a small, quantified calm-period cost that leaves net benefit positive in
five of six. The protection is robust across a wide parameter neighbourhood.

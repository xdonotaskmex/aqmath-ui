# OOS Validation — Deleverage Modulator v14.0 on an Unseen Token Universe

**Date:** 2026-07-17
**Engine:** Backtesting Engine v14.0 (production `default_config`)
**Status:** ✅ PASS — v14 generalizes out-of-sample on its design objective

> 中文版本：[`OOS_V14_NEW_TOKENS_RESULTS.zh-CN.md`](OOS_V14_NEW_TOKENS_RESULTS.zh-CN.md)

---

## 1. Objective

Test whether the **shipped production configuration** (v14.0) holds up on tokens
that were **never used to design or tune it**. This is a genuine
*asset-selection out-of-sample* test: none of the assets below were part of the
v14 tuning/validation basket.

The modulator is scored on **drawdown reduction and risk-adjusted return
(Calmar / Sharpe)** — *not* on beating Buy & Hold final value. The test measures
exactly that objective.

**No parameters were changed.** Every run uses production `default_config()`.

## 2. Universe

| Group | Tokens | Note |
|-------|--------|------|
| New survivors | AVAX, CRO, DOGE, HBAR, LINK | full history (~5.8–7.6y), never used for tuning |
| Short history | PYTH | ~2.7y (launched 2023-11) |
| Dead token | CEL (Celsius) | collapsed 2022 — survivorship-bias stress |

Settings: equal-weighted basket, start $1,000, DCA $100 every 30 days.
Both strategies receive identical DCA capital on the same schedule. Buy & Hold
stays fully exposed; the modulator scales exposure continuously off rising
drawdown and rising downside volatility.

## 3. Aggregate result (16 baskets, all k=3 / k=4 / k=5 combos of the 5 survivors)

| Metric | Result |
|--------|--------|
| **Max-drawdown reduction** | median **+54.3 pp** (min +46.7, max +65.8) — reduced DD in **16 / 16** baskets |
| **Calmar delta** | median **+0.35** — improved in **16 / 16** |
| **Sharpe delta** | median **+0.16** — improved in **15 / 16** |
| **Final vs B&H** | median **0.88×** (min 0.31×, max 1.64×) |

**Reading:** across every unseen basket the modulator cut peak drawdown by roughly
half (typically ~84% → ~28%), and improved risk-adjusted return almost
everywhere. On median it gives up ~12% of final equity versus fully-exposed
Buy & Hold — the expected, deliberate trade of upside for drawdown protection.

## 3a. Visualizations

**Max drawdown, every OOS basket** — modulator (green) vs Buy & Hold (red):

![Max drawdown: Modulator vs Buy & Hold across 16 OOS baskets](oos_assets/dd_comparison.svg)

**Underwater (drawdown) curve** — representative full 5-token basket (AVAX/CRO/DOGE/HBAR/LINK):

![Underwater drawdown curve, modulator vs Buy & Hold](oos_assets/underwater.svg)

**Equity curve (log scale)** — same basket, identical DCA schedule:

![Equity curve, modulator vs Buy & Hold, log scale](oos_assets/equity_curve.svg)

## 4. Per-basket detail

| Basket | Mod DD | B&H DD | DD red. | Calmar (mod/BH) | Sharpe (mod/BH) | Final (mod/BH) | Bars |
|--------|-------:|-------:|--------:|:---------------:|:---------------:|:--------------:|-----:|
| AVAX/CRO/DOGE | 30.8% | 83.4% | +52.6 | 0.84 / 0.27 | 0.68 / 0.26 | $30,458 / $26,400 | 2118 |
| AVAX/CRO/HBAR | 23.6% | 89.4% | +65.8 | 0.32 / 0.01 | 0.09 / −0.04 | $12,195 / $8,621 | 2118 |
| AVAX/CRO/LINK | 20.9% | 85.5% | +64.6 | 0.28 / −0.03 | 0.03 / −0.09 | $11,093 / $6,775 | 2118 |
| AVAX/DOGE/HBAR | 28.7% | 81.7% | +53.0 | 0.98 / 0.41 | 0.65 / 0.39 | $33,617 / $42,414 | 2118 |
| AVAX/DOGE/LINK | 27.7% | 76.3% | +48.6 | 0.81 / 0.33 | 0.53 / 0.28 | $25,856 / $29,236 | 2118 |
| AVAX/HBAR/LINK | 21.5% | 84.6% | +63.1 | 0.09 / 0.02 | −0.09 / −0.04 | $8,931 / $8,702 | 2118 |
| CRO/DOGE/HBAR | 33.8% | 83.9% | +50.1 | 0.74 / 0.47 | 0.65 / 0.49 | $42,309 / $88,142 | 2489 |
| CRO/DOGE/LINK | 33.3% | 79.9% | +46.7 | 1.08 / 0.73 | 0.84 / 0.75 | $104,674 / $332,376 | 2764 |
| CRO/HBAR/LINK | 26.4% | 87.1% | +60.7 | 0.42 / 0.12 | 0.19 / 0.06 | $18,706 / $18,326 | 2489 |
| DOGE/HBAR/LINK | 24.7% | 82.5% | +57.8 | 1.33 / 0.54 | 0.84 / 0.54 | $63,953 / $115,287 | 2489 |
| AVAX/CRO/DOGE/HBAR | 30.0% | 84.3% | +54.3 | 0.64 / 0.27 | 0.45 / 0.25 | $22,083 / $26,117 | 2118 |
| AVAX/CRO/DOGE/LINK | 26.2% | 80.6% | +54.5 | 0.60 / 0.21 | 0.35 / 0.17 | $18,591 / $19,960 | 2118 |
| AVAX/CRO/HBAR/LINK | 21.2% | 85.9% | +64.6 | 0.32 / 0.02 | 0.06 / −0.04 | $11,665 / $8,678 | 2118 |
| AVAX/DOGE/HBAR/LINK | 26.9% | 79.6% | +52.7 | 0.76 / 0.30 | 0.45 / 0.25 | $23,494 / $27,484 | 2118 |
| CRO/DOGE/HBAR/LINK | 31.6% | 81.8% | +50.2 | 0.77 / 0.44 | 0.59 / 0.44 | $40,828 / $74,949 | 2489 |
| AVAX/CRO/DOGE/HBAR/LINK | 28.3% | 82.0% | +53.8 | 0.46 / 0.22 | 0.26 / 0.18 | $16,149 / $20,612 | 2118 |

## 5. Stress cases

| Basket | Mod DD | B&H DD | DD red. | Calmar (mod/BH) | Sharpe (mod/BH) | Final (mod/BH) | Bars |
|--------|-------:|-------:|--------:|:---------------:|:---------------:|:--------------:|-----:|
| HBAR/CRO/DOGE/PYTH *(short)* | 17.8% | 49.4% | +31.7 | 0.70 / 0.13 | 0.28 / 0.03 | $5,731 / $4,987 | 973 |
| AVAX/LINK/DOGE/PYTH *(short)* | 20.0% | 53.1% | +33.1 | 0.32 / −0.07 | 0.06 / −0.18 | $4,963 / $3,780 | 973 |
| DOGE/LINK/AVAX/**CEL** *(dead)* | 32.0% | 87.0% | +55.0 | 0.60 / 0.13 | 0.51 / 0.09 | **$22,203** / $14,724 | 2118 |
| HBAR/CRO/LINK/**CEL** *(dead)* | 33.2% | 92.1% | +58.9 | 0.48 / 0.12 | 0.39 / 0.08 | **$25,023** / $18,554 | 2489 |

**Dead-token stress (survivorship bias):** when a constituent collapses (Celsius,
2022), the modulator beats Buy & Hold on **both** final value **and** drawdown
(+55–59 pp). Drawdown protection directly mitigates the single largest tail risk
of a fixed crypto basket.

**Harness fidelity:** the `HBAR/CRO/DOGE/PYTH` row reproduces the production UI
backtest exactly (final $5,731, Max DD 17.8%, Calmar 0.70, Sharpe 0.28 vs B&H
$4,987 / 49.4% / 0.13 / 0.03), confirming the local harness matches the deployed
engine.

## 6. Interpretation

- **The DD-protection mandate generalizes.** ~54 pp median drawdown reduction on
  16/16 unseen baskets, plus dead-token and short-history stress, is strong
  evidence the design is robust rather than curve-fit.
- **Final trails B&H by ~12% on median — by design.** The modulator is not scored
  on beating a fully-exposed benchmark; it trades a slice of upside for large,
  consistent tail protection. In the extreme up-only basket (CRO/DOGE/LINK, B&H
  → $332k) it "leaves money on the table" (0.31×) while still cutting DD 46.7 pp.
- **Re-tuning would hurt, not help.** A separate OOS-driven parameter sweep found
  that any config which raises final equity also adds drawdown out-of-sample
  (0 of 48 candidates held DD within tolerance across the cross-basket panel).
  The *shipped* config is the robust choice; per-basket "optimal" parameters
  overfit. See §7.

## 7. Related finding — parameter re-tuning does NOT generalize

An in-sample sweep on ADA/BNB/XRP/BTC produced a config that appeared to raise
final equity ~2.19× at the same drawdown. Out-of-sample it collapsed:
sealed second-half only ~1.12× (DD +3.2 pp worse), and across a cross-basket
panel only ~9–14% of combos held DD within +1 pt. A dedicated OOS-driven sweep
(selection by sealed half + cross-basket, hard DD gate) passed **0 of 48**
candidates. Conclusion: **do not change v14 constants.**

## 8. Caveats

- Equal-weighted baskets; the KKT Risk-Parity weighting layer is not applied in
  this isolation test (it operates on a different axis — composition, not gross
  exposure).
- `compute_equal_weight_returns` aligns all series to the **shortest** length, so
  any basket containing PYTH is truncated to ~2.7y regardless of the other
  tokens' longer history.
- Fees modeled at the production rate; slippage/liquidity not modeled.
- Past performance on historical data is not indicative of future results.

## 9. Reproducibility

Research harness (git-ignored, not deployed): `scratch/oos_new_tokens.py`.
It imports the **production** `backtest.simulate`, `calc_metrics`, and
`default_config` unchanged, so results reflect the deployed engine exactly.
Historical CSVs are sourced locally and are not committed.

---

**Bottom line:** v14.0 delivers its mandate — large, consistent drawdown
reduction and improved risk-adjusted returns — on tokens it has never seen,
including a collapsed token. **Recommendation: keep v14 unchanged.**

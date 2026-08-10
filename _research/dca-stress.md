# Human Factor Stress Test: Does the Shield Break When You Do?

**Date:** 2026-08-10
**Engine:** v14 Deleverage Shield — production `evaluate_shield` / `backtest_modulator` imported unmodified
**Status:** ✅ PASS — 5/5 scenarios, 0% failure rate, 30 seeds per scenario

---

## 1. Objective

Every backtest published so far assumed a perfect DCA schedule: $100 every 30 days,
on the dot, every time. Nobody trades like that. People forget. They pay late. The
amount varies. If the shield's protection collapses the moment the DCA schedule
gets sloppy, the whole design is a lab toy.

This test asks: **if you mess up your DCA — delay, variable amounts, skipped
months — does the shield still hold?**

The shield was scored on MaxDD and Sharpe, not on beating Buy & Hold. The test
measured exactly that: degradation of protection under human error.

**No parameters were changed.** Every run uses production `default_config()`.

## 2. Design

Five scenarios, each run 30 times with different random seeds. The published
basket (ADA, BNB, ETH, XRP, SOL) was used with $1,000 start and $100 every
30 days over the full 6.2-year window (2020-04-10 to 2026-07-04).

| Scenario | DCA | Delay | Amount | Notes |
|----------|-----|-------|--------|-------|
| **A — Perfect** | $100 / 30d | none | fixed | Baseline reference |
| **B — Delay** | $100 / 30d | 0–5 days random | fixed | Realistic — people are late |
| **C — Amount noise** | $100 / 30d | none | ±20% random | Some months more, some less |
| **D — Skip** | $100 / 30d | none | fixed, skip every 4th | Forgot a month |
| **E — Combined** | $100 / 30d | 0–5 days + ±20% + skip 4th | jittered | Worst realistic case |

The DCA jitter is applied identically to both the modulator and the Buy & Hold
reference, so both strategies see the same imperfect cash flow. The comparison
is fair: we are measuring whether the shield's protection degrades under
imperfect DCA, not whether imperfect DCA itself is worse.

## 3. Results

### 3a. MaxDD — all five scenarios (median of 30 runs)

| Scenario | Modulator | Buy & Hold | Δ from baseline | Shield still works? |
|----------|:---------:|:----------:|:---------------:|:-------------------:|
| A — Perfect | 34.2% | 81.5% | — | ✅ baseline |
| B — Delay 2–5d | 34.1% | 81.6% | −0.1 pp | ✅ |
| C — Amount ±20% | 34.2% | 81.5% | +0.0 pp | ✅ |
| D — Skip every 4th | 34.7% | 81.6% | +0.5 pp | ✅ |
| E — Combined | 34.7% | 81.6% | +0.5 pp | ✅ |

**The worst degradation is 0.5 percentage points on MaxDD.** The shield's
drawdown protection is essentially unaffected by the DCA schedule — even when
you delay, vary amounts, and skip months simultaneously.

![Max drawdown comparison across all five DCA scenarios](research/assets/dca_stress_dd.svg)

### 3b. Risk-adjusted return — Sharpe and Calmar

| Scenario | Mod Sharpe | Δ Sharpe | Mod Calmar | Δ Calmar |
|----------|:----------:|:--------:|:----------:|:--------:|
| A — Perfect | 0.493 | — | 0.659 | — |
| B — Delay 2–5d | 0.490 | −0.003 | 0.658 | −0.001 |
| C — Amount ±20% | 0.494 | +0.001 | 0.660 | +0.001 |
| D — Skip every 4th | 0.544 | +0.051 | 0.703 | +0.044 |
| E — Combined | 0.544 | +0.051 | 0.702 | +0.043 |

**Sharpe is within 0.003 of baseline for delay and amount noise** — effectively
zero. Skipping months (D and E) raises Sharpe because the total capital deployed
is lower, and in a rising market, less capital earlier means a higher percentage
return on what was invested. This is a quirk of the metric, not a flaw — the key
is that the shield does not *lose* risk-adjusted return under any jitter.

### 3c. Equity curves — baseline vs worst case

The equity curves for the perfect schedule (A) and the combined worst-case
schedule (E) are nearly indistinguishable:

![Equity curve: baseline vs worst-case DCA, log scale](research/assets/dca_stress_equity.svg)

The underwater (drawdown) chart tells the same story — the depth and timing of
drawdowns is identical between perfect and worst-case DCA:

![Underwater curve: baseline vs worst-case DCA](research/assets/dca_stress_underwater.svg)

## 4. What this proves

1. **The shield is not fragile.** DCA timing errors, amount variations, and
   skipped months degrade MaxDD by at most 0.5 pp — far below the 3 pp threshold
   that would indicate a real problem.

2. **The shield's protection is structural, not lucky.** The continuous
   modulator is driven by drawdown depth and downside volatility, not by the
   exact timing of cash inflows. As long as capital eventually enters the
   basket, the shield protects it the same way.

3. **You can be human.** The shield does not require robotic precision. It
   protects the portfolio whether you DCA perfectly or sloppily.

## 5. Test details

- **Basket:** ADA, BNB, ETH, XRP, SOL (equal weight)
- **Window:** 2020-04-10 to 2026-07-04 (2,275 days, 6.2 years)
- **Start capital:** $1,000
- **DCA:** $100 every 30 days (75 scheduled contributions)
- **Seeds per scenario:** 30
- **Engine:** `backtest.simulate()` with `dca_schedule` parameter (new in v14.1)
- **Fee:** 0.1% per trade (production `DL_FEE_RATE`)
- **All parameters:** production `default_config()`, unchanged

The DCA jitter is implemented as a pre-computed per-day schedule: on each
scheduled DCA day, a random delay (0–5 days), amount noise (±20%), and optional
skip (every 4th) are applied. The same schedule feeds both the modulator and
the Buy & Hold reference, so the comparison is fair.

## 6. Files

- `backtest.py` — added `generate_dca_schedule()` and `dca_schedule` kwarg on `simulate()`
- `scratch/stress_test_dca.py` — batch runner, 30 seeds × 5 scenarios
- `scratch/make_stress_charts.py` — branded SVG chart generator
- `SHIELD_STRESS_TESTS.md` — full test plan and results

---

*This is the first of five planned stress tests for the v14 Deleverage Shield.
[See the full test plan](https://aqmath.xyz) for the remaining four.*
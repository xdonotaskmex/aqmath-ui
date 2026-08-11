# Human Factor Stress Test: Does the Shield Break When You Do?

**Date:** 2026-08-10
**Engine:** v14 Deleverage Shield — production `evaluate_shield` / `backtest_modulator` imported unmodified
**Status:** ✅ PASS — 5/5 scenarios, 0% failure rate, 30 seeds per scenario · scope: DCA deposits only — see §5 for the test that can actually fail

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

![Max drawdown comparison across all five DCA scenarios](/research/assets/dca_stress_dd.svg)

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

![Equity curve: baseline vs worst-case DCA, log scale](/research/assets/dca_stress_equity.svg)

The underwater (drawdown) chart tells the same story — the depth and timing of
drawdowns is identical between perfect and worst-case DCA:

![Underwater curve: baseline vs worst-case DCA](/research/assets/dca_stress_underwater.svg)

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

## 5. Honest limits: this test could not fail

An external review of this article (reader comment, 2026-08-11) made a point
worth publishing in full, because it is correct:

> The reason it barely moved is that the risk engine reads portfolio vol and
> drawdown, not the deposit schedule — so messing with when cash arrives was
> never going to touch it. You proved the two are decoupled, which is worth
> knowing, but it means the test couldn't really fail.

That reframes what §4 actually proved: the DCA jitter tested a **design
property** (deposit timing is decoupled from the risk engine), not a fragile
edge. A test that cannot fail verifies robustness — it cannot discover
weakness. We tested everything around the engine, but not the thing the engine
actually reacts to.

**The version that can fail: delay the deleverage, not the deposit.** If a
shield signal fires and you act 3 days late — or skip the rebalance entirely
because you are asleep — that is the sloppiness that costs money. And it costs
most exactly when vol is spiking, so the damage clusters in the worst weeks
rather than spreading out evenly.

One more distinction the review nailed: **lag is not noise.** If you are always
late by the same amount, that is a lag, and lag has a direction. Random delays
average out across seeds; consistent lateness does not. Any follow-up test must
run the two separately or the seed averaging will hide the damage.

### Test 2 — Signal execution lag (next)

| Scenario | Execution error | Why |
|----------|-----------------|-----|
| N — Random delay | every signal executed 0–3 days late | noise — expected to average out |
| L — Constant lag | every signal exactly 3 days late | directional — does NOT average out |
| M — Missed rebalance | skip a share of signals entirely ("asleep") | worst realistic case |
| W — Lag in worst weeks | delays only during vol spikes | where the money actually is |

Pass criteria: the same 3 pp MaxDD degradation threshold as Test 1, plus a
clustering report — where in the timeline the damage lands. If N passes and L
fails, that is itself a finding: it would mean the shield tolerates
sloppiness but not routine.

## 6. Test details

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

## 7. Files

- `backtest.py` — added `generate_dca_schedule()` and `dca_schedule` kwarg on `simulate()`
- `scratch/stress_test_dca.py` — batch runner, 30 seeds × 5 scenarios
- `scratch/make_stress_charts.py` — branded SVG chart generator
- `SHIELD_STRESS_TESTS.md` — full test plan and results

---

*This is the first of five planned stress tests for the v14 Deleverage Shield.
Per the critique in §5, Test 2 moves from deposit jitter to signal execution
lag — the first test in this series that can actually fail.
[See the full test plan](https://aqmath.xyz) for the remaining four.*
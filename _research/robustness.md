# Robustness — how far can reality deviate before the Shield breaks?

**Date:** 2026-08-07
**Engine:** v14 Dual-Speed E2E — identical wiring to the live paper trading service (180-day KKT risk-parity MACRO loop with the ADV-K2 liveness screen + v14 Deleverage Shield)
**Status:** 📊 RESEARCH — parameter plateau + reality stress, no basket promoted

---

## 1. Objective

The [Regime Autopsy](/research/regime-autopsy) showed the Shield holds inside
every named crash regime. The next question a skeptic asks is different:
*were the parameters tuned to the history we happened to get?* A system can
be regime-robust and still stand on a knife-edge of tuned constants — or on
an execution assumption (trade exactly at the close, pay exactly 10 bps)
that reality never honours.

This study attacks both fronts with 129 full walk-forward re-runs:

1. **Parameter plateau** — every user-facing knob moved one at a time across
   a wide grid around the production value, all other knobs held at
   production. Does performance cliff, or plateau?
2. **Reality stress** — trading fees from 10 to 200 bps, and shield decisions
   applied 1 and 2 trading days late.

Same method as the Regime Autopsy: production `macro_reoptimize()` and
`daily_step()` imported unmodified, [ADV-K2 liveness
screen](/research/liveness-screen) active at every re-optimisation, three
baskets (A Majors+Gold, B 2019-20 Gen, C Landmine), $1,000 start + $100/30d
DCA, walk-forward, no lookahead. **No knob was moved in the baseline** —
every baseline run in this study reproduces the published figures bit for
bit (A $15,650 / B $8,555 / C $17,541).

Shield constants are shown as **multiples of the production value**; absolute
constants are not published.

## 2. Parameter plateau — one knob at a time

Each point below is a complete walk-forward re-run (~6 years, 12-13
re-optimisations) with exactly one knob displaced. Amber column: the
production setting.

| Knob | Grid | Calmar A | Calmar B | Calmar C | Verdict |
|------|------|---------:|---------:|---------:|---------|
| Macro lookback | 90-240 d | 0.51-0.89 | -0.12-0.12 | 0.40-0.79 | varies, no cliff |
| Re-opt cadence | 90-240 d | 0.31-0.77 | -0.10-0.12 | 0.47-0.72 | varies, no cliff |
| Drawdown reference | 0.53×-2.67× | 0.49-0.62 | 0.08-0.17 | 0.58-0.70 | protection dial |
| Rebalance threshold | 0.38×-3.13× | 0.50-0.57 | 0.06-0.14 | 0.63-0.74 | flat |
| Downside window | 0.50×-2.00× | 0.53-0.57 | 0.10-0.12 | 0.65-0.70 | flat |
| Risk budget | 0.70-1.00 | 0.57 | 0.12 | 0.65 | no-op (verified) |

![Parameter plateau, Calmar ratio per knob, three baskets](oos_assets/robust_plateau.svg)

**The flat knobs.** The rebalance threshold and the downside-volatility
window barely move anything across their entire grids — on basket A the
Calmar band is 0.50-0.57 and the max-drawdown band under 2.4 pp. These are
true plateaus: the system does not care where in the tested range they sit.

**The dial.** The shield's drawdown reference behaves exactly like a
protection dial, not like a fragile constant. Tightening it trades
participation for protection **monotonically** — on basket A the full-window
max drawdown moves from 25.1% at 2.67× to 14.6% at 0.53× of production —
while the Calmar stays inside a 0.49-0.62 band at every point. No grid point
breaks the mechanism; the knob chooses *how much* protection, not *whether*
it works.

**The macro knobs.** Lookback and re-optimisation cadence produce the widest
spread (on A, final equity ranges $14.5k-$23.3k with lookback alone). This
is honesty, not robustness theatre: the covariance window genuinely changes
which weights get frozen. What matters for this study is the shape — every
grid point on baskets A and C keeps a positive Calmar and stays inside a
narrow max-drawdown band (16.9-18.9% on A). No cliff anywhere in the grid.
Basket B remains the weak basket at every setting, consistent with the
Regime Autopsy: its full-window case never rested on tuning.

**The no-op.** The risk-budget knob scales the *reported* risky exposure but
is not applied to returns in the v14 accounting — the grid confirms this is
exact, not approximate: five settings, identical equity to the cent. We
publish this because a knob that looks protective but is cosmetic should be
known, not assumed.

## 3. Reality stress — fees

Every trade in the system (shield rebalances, DCA buys, tranche redeployment)
pays a simulated fee. The grid stresses it from the production 10 bps to
20× that level.

| Fee | A final | A Calmar | B final | B Calmar | C final | C Calmar |
|----:|--------:|---------:|--------:|---------:|--------:|---------:|
| 10 bps | $15,650 | 0.57 | $8,555 | 0.12 | $17,541 | 0.65 |
| 25 bps | $15,382 | 0.55 | $8,442 | 0.10 | $17,260 | 0.63 |
| 50 bps | $14,948 | 0.51 | $8,257 | 0.08 | $16,803 | 0.60 |
| 100 bps | $14,123 | 0.43 | $7,902 | 0.04 | $15,929 | 0.54 |
| 200 bps | $12,630 | 0.31 | $7,249 | -0.04 | $14,334 | 0.42 |

![Final equity versus trading fee, Shield vs Buy and Hold](oos_assets/robust_fees.svg)

The degradation is graceful and roughly linear. At **100 bps** — an order of
magnitude above production and above realistic retail taker fees — baskets A
and C still carry their strongest risk-adjusted numbers from most published
studies. Basket B, already marginal, crosses below zero only at 200 bps.
Buy & Hold pays the same fee on its DCA buys, so the Shield's *marginal*
cost is only the rebalance turnover — and threshold rebalancing was designed
precisely to keep that turnover down (the grid's fee totals confirm it).

## 4. Reality stress — late execution

The daily loop trades on the close after evaluating the shield on that same
close. What if the order lands a day or two late? The shield's exposure
decisions were delayed by 1 and 2 trading days, with everything else —
accounting, fees, DCA, redeployment — left on the production code path.

| Lag | A MDD | B MDD | C MDD | Buy & Hold (A/B/C) |
|----:|------:|------:|------:|-------------------:|
| 0 d (production) | 16.9% | 18.9% | 17.8% | 43.2% / 37.5% / 31.2% |
| 1 day late | 19.3% | 22.0% | 17.6% | unchanged |
| 2 days late | 19.5% | 21.6% | 17.8% | unchanged |

![Max drawdown under 0, 1 and 2 day execution lag](oos_assets/robust_lag.svg)

Late execution costs roughly **2.4-3.1 pp** of drawdown protection on
baskets A and B and essentially nothing on C — and the protection stays
large: even two days late, the Shield's max drawdown on basket A is 19.5%
against Buy & Hold's 43.2%, a cut of ~24 pp. Final equity is almost
unaffected (it even moves slightly up in two of six cells — the shield is
not a timing system, so late is not systematically worse, just slightly
blunter). A daily-close system that cannot trade instantly still does its
job.

## 5. Caveats

- **One-at-a-time design.** Every point moves exactly one knob. The grid
  proves there is no single-knob cliff, but it does not explore knob
  interactions; a hostile corner of the joint space is not ruled out.
- **Fees on weight rotation.** As in every earlier study, the weight change
  at a macro re-optimisation is not charged. Faster cadences therefore look
  slightly cheaper than they would live; the fee-stress results are the
  conservative complement of that assumption.
- **The lag model** delays the shield's decisions as a block, including its
  internal ramp feedback. It is an upper bound on sloppiness, not an order
  book model.
- **Basket B** stays the honest exception across the whole study: weak
  full-window numbers at every setting. It is kept because a robustness
  claim that hides its worst basket is not a robustness claim.

## 6. Verdict

No cliff found anywhere in the tested space. Two knobs are true plateaus,
one behaves as a clean protection dial, the macro knobs vary the level but
never break the mechanism, fees degrade the system gracefully far beyond
realistic levels, and execution two days late keeps almost the entire
drawdown cut. The Shield's published results do not stand on a knife-edge of
tuned constants or on perfect execution.

*Simulated on historical daily closes with fees; nothing here is financial
advice.*

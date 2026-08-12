# Static vs. Dynamic: The Test the Shield Only Half-Passed

**Date:** 2026-08-12
**Engine:** v14 Deleverage Shield — the same code that runs in production, unchanged
**Status:** Gates 2/4 — Shield wins protection (MaxDD, Calmar) but loses the
return gates: a robot-rebalanced 60/40 beats it on Sharpe and doubles its
final equity · 30 seeds per behavioral scenario

---

## Read this in 60 seconds

- The simplest value test there is: does the Shield beat a static crypto/
  stablecoin split you could draw on a napkin?
- Outside-the-box twist: the competitor was tested at three levels of
  human-ness — a **robot** (rebalanced yearly), a **drawer** (never
  touched), and a **human** (capitulates when the pain gets too big).
- Protection gates pass: Shield MaxDD 34.2% vs 60.7–81.1% for every
  static variant; Calmar is the best of all nine strategies.
- Return gates fail: the robot 60/40 has a higher Sharpe (0.621 vs
  0.493) and ends with more than double the equity.
- But the robot does not exist. The human versions of the same plan
  broke it 3–5 times each, gave up $12.5k–$16.4k per simulated
  lifetime, and spent ~81% of the window in stablecoin anyway.

*Vocabulary used below:* **MaxDD (maximum drawdown)** — how far the
portfolio falls from its highest point. **Sharpe** — return earned per
unit of risk; higher is better. **Calmar** — annualized return divided
by MaxDD; reward per unit of pain sat through.

## 1. Objective

If the Shield does not beat a simple strategy — hold X% in crypto,
(100−X)% in stablecoin — then all of its complexity is unnecessary.
That is the cleanest possible test of added value, and it was the
second crown test on the plan.

One lesson from the Human Factor series shaped the design: **a robot
competitor is not a real competitor.** The previous tests modeled human
error as mechanical randomness; the human themselves — fear, panic,
giving up — never entered the test. A static 60/40 that never flinches
through a 60% drawdown is the strongest possible version of the
alternative. Beating only that version proves little; beating it *and*
the human version is actual evidence.

One asymmetry is stated up front, not hidden: static allocations have
**zero operational surface** — no signals to miss, nothing to execute
late. The Human Factor series measured exactly that price on the Shield
side. This comparison is therefore protection **per unit of discipline
required**, and the article says so out loud.

## 2. Design

Everything shares the same inputs: basket ADA, BNB, ETH, XRP, SOL
(equal-weight risky sleeve), 2020-04-10 to 2026-07-04 (6.2 years, two
bear cycles), $1,000 start, $100 every 30 days perfect DCA, 0.1% fee
per trade, stablecoin earns zero. The DCA dimension stays perfect —
jitter was already tested in the Human Factor series.

| Strategy | Risky | Stable | Behavior |
|----------|:-----:|:------:|----------|
| **BH** | 100% | 0% | Buy & Hold reference |
| **S1 — Textbook (robot)** | 60/70/80% | rest | rebalanced to target once per year |
| **S2 — Drawer (drift)** | 60/70/80% | rest | never rebalanced — the sleeve drifts |
| **S3 — Capitulation (human)** | 60% plan | rest | holds the S1 plan until own equity drawdown crosses ~35%, then all-stable; three re-entry rules |
| **Shield v14** | dynamic | dynamic | production config, same-day execution |

S3 details: the pain threshold is 35% ± 5 percentage points, jittered
per seed (30 seeds). Re-entry variants: **never** return, return only
on a **new all-time high** of the basket (buying the top), or return
after **one year** out. After re-entry the plan resumes, and the human
can break it again.

S2 deserves a sentence: in a bull run the risky side grows, so a
"set and forget" 60/40 silently becomes ~90/10 exactly at the top —
full exposure into the crash. That drift is not a strawman; it is the
most common real-world version of a static split.

## 3. Results — robot and drawer

| Strategy | MaxDD | Sharpe | Calmar | CAGR | Final |
|----------|:-----:|:------:|:------:|:----:|:-----:|
| BH | 81.5% | 0.475 | 0.510 | 41.6% | $74,199 |
| S1 60/40 robot | 60.7% | **0.621** | 0.643 | 39.1% | $66,241 |
| S1 70/30 robot | 66.7% | 0.585 | 0.600 | 40.0% | $69,163 |
| S1 80/20 robot | 72.2% | 0.549 | 0.565 | 40.8% | $71,501 |
| S2 60/40 drawer | 80.5% | 0.452 | 0.482 | 38.8% | $65,595 |
| S2 70/30 drawer | 80.8% | 0.458 | 0.489 | 39.6% | $67,746 |
| S2 80/20 drawer | 81.1% | 0.464 | 0.497 | 40.3% | $69,897 |
| **Shield v14** | **34.2%** | 0.493 | **0.659** | 22.5% | $30,121 |

Three facts stand out:

1. **The robot is strong.** The textbook 60/40 with one rebalance a
   year has the highest Sharpe of everything tested here, Shield
   included. Six rebalances in 6.2 years, $48 of fees.
2. **Drift eats protection, not return.** The drawer variants end with
   barely less money than the robot (−$646 at 60/40) but carry almost
   the full Buy & Hold drawdown (80.5% vs 60.7%). The yearly rebalance
   bought pain reduction, not return.
3. **The Shield is the only strategy under 35% MaxDD — and it pays for
   it.** Defensive 1,758 of 2,275 days (77%), final equity less than
   half of the robot 60/40.

![Equity curves: robot, drawer, human and Shield](/research/assets/static_equity.svg)

![Pain vs reward: MaxDD against Sharpe for all nine strategies](/research/assets/static_scatter.svg)

## 4. Results — the human

The S3 operator holds the robot's exact plan until their own equity
drawdown crosses ~35% (median realized threshold 34.0–34.2%), then
sells everything into stablecoin. Medians of 30 seeds:

| Re-entry rule | MaxDD | Sharpe | Final | Damage vs own plan | Capitulations | Days out |
|---------------|:-----:|:------:|:-----:|:------------------:|:------------:|:--------:|
| Never returns | 60.4% | 0.562 | $53,768 | $16,404 ($2.3k–$19.0k) | 3 | 1,837 |
| Back on new ATH | 65.7% | 0.564 | $52,376 | $15,206 ($8.6k–$24.9k) | 5 | 1,682 |
| Back after 1 year | 60.4% | 0.582 | $53,768 | $12,473 ($6.4k–$19.0k) | 4 | 1,838 |

Read that slowly:

- **Every human broke the plan.** 30 seeds, three re-entry rules — not
  one simulated person held the 60/40 through the pain. Median 3–5
  capitulations per lifetime.
- **They were out of the market ~81% of the window** (1,682–1,838 of
  2,275 days) — and *still* lived through a 60–66% drawdown before
  breaking.
- **Breaking the plan cost $12.5k–$16.4k** against the same plan held
  robotically. The "buy the new ATH" re-entry is the worst on MaxDD
  (65.7%) because it systematically re-enters at tops.

![Equity lost by capitulating vs holding the same plan with discipline](/research/assets/static_capitulation.svg)

## 5. The gate scorecard

The pass criteria from the original test plan, verbatim:

| Gate | Requirement | Result | Verdict |
|------|-------------|--------|:-------:|
| MaxDD | Shield < all statics | 34.2% vs 60.7–81.1% | ✅ PASS |
| Calmar | Shield > best static | 0.659 vs 0.643 | ✅ PASS |
| Sharpe | Shield ≥ best static | 0.493 vs 0.621 | ❌ FAIL |
| Final equity | within 80–120% of best static | 45% of best | ❌ FAIL |

**2 of 4.** The Shield dominates on every metric that measures pain and
loses on every metric that measures terminal wealth in this window.

## 6. Honest reading

1. **The protection is real and it is the best in class.** MaxDD 34.2%
   against 60.7–81.1% for every static variant, and the highest Calmar
   of all nine strategies — the best return per unit of pain actually
   sat through. That is the product's promise, and this test confirms
   it.

2. **The return cost is real and now quantified.** In a 6.2-year window
   containing two enormous bull markets, constant exposure was
   rewarded. The Shield sat defensive 77% of days, trailed Buy & Hold
   on 2,268 of 2,275 days, and ended ~$36k behind the robot 60/40.
   Anyone who could hold a 61% drawdown without flinching should, by
   this data, prefer the robot. The test says so plainly.

3. **The robot does not exist.** Zero of 30 simulated humans held the
   plan. They capitulated 3–5 times, gave up $12.5k–$16.4k of equity
   each, spent ~81% of the window in stablecoin — and still suffered a
   60–66% drawdown. The honest comparison is therefore not "Shield vs
   robot 60/40" but "Shield vs what a person actually does with a
   60/40": $30,121 at 34% MaxDD vs ~$52–54k at 60–66% MaxDD plus three
   broken promises to oneself.

4. **What this means.** The Shield is not a return-maximizer and this
   test refuses to pretend otherwise. It is a pain manager — and the
   premium paid for the pain management in this window was about $36k
   on a $30k outcome. Whether that trade is worth it is a personal
   risk-tolerance question; the data now prices it exactly.

## 7. Test details

- **Basket:** ADA, BNB, ETH, XRP, SOL (equal weight)
- **Window:** 2020-04-10 to 2026-07-04 (2,275 days, 6.2 years)
- **Start capital:** $1,000 · **DCA:** $100 every 30 days (perfect)
- **Fee:** 0.1% per trade · **Stablecoin yield:** 0
- **S1 rebalance:** every 365 days to target; dust under $1 ignored
- **S3:** base plan = S1 60/40; capitulation threshold 35% ± 5 pp
  (per seed); re-entry: never / new basket ATH / 365 days; plan resumes
  after re-entry, repeatable
- **Shield:** production `default_config`, same-day execution (the
  operating requirement documented in the Human Factor series)
- **Seeds:** 30 per S3 variant; deterministic strategies run once

## 8. Reproducibility

All strategies run on the same 6.2 years of daily closes with the
unmodified production engine for the Shield leg. Test scripts, chart
generators, and raw result data live in the engine's internal research
tooling; every reported median is across 30 seeds.

---

*This is the second of five planned crown tests for the v14 Deleverage
Shield. Test 1 (Human Factor) is published
[here](/research/dca-stress). Verdict here: 2/4 gates — the Shield
dominates protection and pain-adjusted return, loses the return gates
to a robot that does not exist, and beats the human version of its own
competitor on every axis except terminal wealth. Next: Test 3,
liquidity execution.*

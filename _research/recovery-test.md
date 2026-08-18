# Locked Out? What Happens After the Shield Goes Defensive

**Date:** 2026-08-17
**Engine:** v14 Deleverage Shield — the same code that runs in production, unchanged
**Status:** Gates 1/4 — Shield re-enters fast (median 2 days to 50% exposure)
but captures only 19% of the Buy & Hold recovery at 12 months · 9 defensive
episodes across 6.2 years · zero cycles where Shield equity exceeds B&H after 12m

---

## Read this in 60 seconds

- The biggest psychological fear about the Shield: it kicks you out of
  the market and you miss the recovery.
- This test measures exactly that: every time the Shield went defensive,
  how fast did it re-enter, and how much of the subsequent B&H recovery
  did it capture?
- Speed is fine: median 2 days to reach 50% exposure. Nobody was
  "locked out" for long.
- Participation is not: median 12-month recovery capture is 19% of B&H,
  worst is 8%. The Shield re-enters, but at reduced exposure — it
  captures a fraction of the upside.
- Zero of nine cycles: Shield equity never exceeds B&H equity 12 months
  after a defensive episode.

*Vocabulary used below:* **MaxDD (maximum drawdown)** — how far the
portfolio falls from its highest point. **Recovery participation** —
what fraction of the B&H equity gain the Shield captured in the same
period. **Defensive episode** — a contiguous period where the Shield's
held exposure stays below 40% (the redeploy threshold).

## 1. Objective

Tests 1 and 2 established what the Shield does *during* stress: it
cuts drawdown at a measurable cost to terminal wealth. Test 4 asks the
complementary question — what happens *after* the stress passes?

This is the biggest psychological fear about any defensive system:
that it kicks you out and you miss the recovery. The fear is rational.
A system that protects you from a 60% crash but then sits at 20%
exposure while the market triples is not a product anyone would use.

The test is straightforward: find every defensive episode in 6.2 years
of history, measure what happens after each one, and score against four
pass thresholds.

## 2. Design

Same inputs as Crown Test 2 (Static vs Dynamic): basket ADA, BNB, ETH,
XRP, SOL (equal-weight risky sleeve), 2020-04-10 to 2026-07-04 (6.2
years, two bear cycles), $1,000 start, $100 every 30 days perfect DCA,
0.1% fee per trade, stablecoin earns zero.

Two instruments run in parallel with identical accounting:

| Instrument | Behavior |
|------------|----------|
| **Shield v14** | production config, threshold rebalancing, DCA parked in stablecoin when defensive |
| **Buy & Hold** | 100% invested at all times, same DCA schedule and fees |

A **defensive episode** is a contiguous period where the Shield's held
exposure stays below 40% (the redeploy threshold). For each episode
exit — the bar where exposure crosses back above 40% — we measure:

- **Days to 50% re-exposure:** how fast the Shield gets back to a
  meaningful position
- **Recovery participation at 1m / 3m / 6m / 12m:** Shield equity gain
  divided by B&H equity gain over the same forward window
- **Does Shield equity exceed B&H equity after 12 months?**

## 3. Results

The Shield spent 1,758 of 2,275 days (77.3%) in defensive mode. Nine
distinct defensive episodes were identified:

| # | Exit date | Duration | Days to 50% | 1m | 3m | 6m | 12m | S > B&H |
|:-:|:---------:|:--------:|:-----------:|:--:|:--:|:--:|:---:|:-------:|
| 1 | 2020-11-17 | 73d | 3 | 33% | 26% | 24% | 19% | no |
| 2 | 2021-01-04 | 27d | 1 | 25% | 26% | 33% | 23% | no |
| 3 | 2021-08-15 | 87d | 0 | 19% | 15% | — | — | no |
| 4 | 2021-10-15 | 32d | 5 | 15% | — | — | — | no |
| 5 | 2024-11-18 | 1,091d | 0 | 19% | 9% | 19% | 8% | no |
| 6 | 2025-01-05 | 16d | 11 | — | — | — | — | no |
| 7 | 2025-01-15 | 6d | 1 | — | — | — | — | no |
| 8 | 2025-07-17 | 163d | 2 | 6% | — | — | — | no |
| 9 | 2026-07-04 | 263d | — | — | — | — | — | no |

Three facts stand out:

1. **Re-entry is fast.** Median 2 days to reach 50% exposure, with a
   range of 0–11 days. The Shield does not "lock you out." It responds
   to improving conditions almost immediately.
2. **Participation is low.** Among cycles with 12-month data, the
   median recovery capture is 19% of B&H — far below the 70% threshold.
   The Shield re-enters, but at reduced exposure, and captures a
   fraction of the upside.
3. **Shield never catches up.** Zero of nine cycles end with Shield
   equity above B&H equity at 12 months. The protection gap from the
   defensive period is never fully closed.

![Recovery participation: how much of the B&H recovery the Shield captured](/research/assets/recovery_participation.svg)

![Timeline of all nine defensive episodes and their recovery](/research/assets/recovery_timeline.svg)

## 4. The gate scorecard

The pass criteria from the original test plan, verbatim:

| Gate | Requirement | Result | Verdict |
|------|-------------|--------|:-------:|
| Median 12m participation | >= 70% of B&H | 19% | ❌ FAIL |
| Median days to 50% exposure | < 60 days | 2 | ✅ PASS |
| Worst single recovery | >= 40% of B&H | 8% | ❌ FAIL |
| Shield > B&H after 12m | >= 1 cycle | 0 | ❌ FAIL |

**1 of 4.** The only passing gate is the speed of re-entry — and that
passes by a wide margin (2 vs 60). The participation gates fail by a
wide margin too.

## 5. Honest reading

1. **The Shield does not "lock you out" — technically.** Median re-entry
   is 2 days. If the only question is "does the Shield get back in
   quickly?", the answer is yes, decisively.

2. **But re-entering fast is not the same as recovering fast.** The
   Shield comes back to 50% exposure in 2 days, but then stays at
   reduced exposure for months. The median 12-month participation of
   19% means the Shield captures roughly one-fifth of what B&H earns
   in the recovery. The speed of re-entry is real; the recovery is not.

3. **This is the same story as Crown Test 2, told from a different
   angle.** The Shield is defensive 77% of days. When 77% of your life
   is spent at reduced exposure, you are going to miss most of the
   upside — not because you are slow to re-enter, but because you are
   structurally under-invested for most of the window.

4. **The protection is real; the cost is real.** The Shield cut MaxDD
   from 81.5% to 34.2% (Test 2). That protection costs about $36k on
   a $30k outcome in terminal wealth, and it costs 81% of the recovery
   upside. Whether that trade is worth it is a personal risk-tolerance
   question; the data now prices it from every angle.

## 6. Test details

- **Basket:** ADA, BNB, ETH, XRP, SOL (equal weight)
- **Window:** 2020-04-10 to 2026-07-04 (2,275 days, 6.2 years)
- **Start capital:** $1,000 · **DCA:** $100 every 30 days (perfect)
- **Fee:** 0.1% per trade · **Stablecoin yield:** 0
- **Shield:** production `default_config`, same-day execution
- **Defensive threshold:** held exposure < 40% (redeploy_thresh)
- **Recovery horizons:** 30 / 91 / 182 / 365 days after episode exit
- **Participation:** Shield equity gain / B&H equity gain over same
  forward window; undefined when B&H loses money

## 7. Reproducibility

Both instruments run on the same 6.2 years of daily closes with the
unmodified production engine for the Shield leg. Test scripts, chart
generators, and raw result data live in the engine's internal research
tooling.

---

*This is the fourth of five planned crown tests for the v14 Deleverage
Shield. Test 1 (Human Factor) is published
[here](/research/dca-stress). Test 2 (Static vs Dynamic) is published
[here](/research/static-vs-dynamic). Verdict here: 1/4 gates — the
Shield re-enters fast but captures only a fraction of the recovery.
Next: Test 3, liquidity execution.*

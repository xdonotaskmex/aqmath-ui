# Locked Out? What Happens After the Shield Goes Defensive

**Date:** 2026-08-18
**Engine:** v14 Deleverage Shield on the production KKT stack — ERC risk-parity
weights (180d lookback, 180d re-opt, 60/40 risky/USDC), same code that runs
in production, unchanged
**Status:** Gates 1/4 — Shield re-enters fast (median 1 day to 50% exposure)
but captures only 32% of the Buy & Hold recovery at 12 months · 11 defensive
episodes across 6.2 years · zero cycles where Shield equity exceeds B&H after 12m

---

## Read this in 60 seconds

- The biggest psychological fear about the Shield: it kicks you out of
  the market and you miss the recovery.
- This test measures exactly that: every time the Shield went defensive,
  how fast did it re-enter, and how much of the subsequent B&H recovery
  did it capture?
- Speed is fine: median 1 day to reach 50% exposure. Nobody was
  "locked out" for long.
- Participation is not: median 12-month recovery capture is 32% of B&H,
  worst is 28%. The Shield re-enters, but at reduced exposure — it
  captures a fraction of the upside.
- Zero of seven cycles with 12m data: Shield equity never exceeds B&H
  equity 12 months after a defensive episode.

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

Same basket as Crown Test 2 (ADA, BNB, ETH, XRP, SOL) but with the
**production KKT risk-parity stack** instead of equal weights. Weights
are computed via ERC on the trailing 180-day log-return covariance,
capped at 40%/10% per token, with a structural 60% risky / 40% USDC
split. Weights are frozen and re-optimised every 180 days, drifting
with prices between re-opts — exactly what runs on the server.

Window: 2020-04-10 to 2026-07-04 (6.2 years, two bear cycles), $1,000
start, $100 every 30 days perfect DCA, 0.1% fee per trade, stablecoin
earns zero. 12 KKT re-optimisations over the period.

Two instruments run in parallel with identical accounting:

| Instrument | Behavior |
|------------|----------|
| **Shield v14** | production KKT config, threshold rebalancing, DCA parked in stablecoin when defensive |
| **Buy & Hold** | 100% invested in the same KKT portfolio at all times, same DCA schedule and fees |

A **defensive episode** is a contiguous period where the Shield's held
exposure stays below 40% (the redeploy threshold). For each episode
exit — the bar where exposure crosses back above 40% — we measure:

- **Days to 50% re-exposure:** how fast the Shield gets back to a
  meaningful position
- **Recovery participation at 1m / 3m / 6m / 12m:** Shield equity gain
  divided by B&H equity gain over the same forward window
- **Does Shield equity exceed B&H equity after 12 months?**

## 3. Results

The Shield spent 1,844 of 2,275 days (81.1%) in defensive mode. Eleven
distinct defensive episodes were identified:

| # | Exit date | Duration | Days to 50% | 1m | 3m | 6m | 12m | S > B&H |
|:-:|:---------:|:--------:|:-----------:|:--:|:--:|:--:|:---:|:-------:|
| 1 | 2021-01-06 | 34d | 1 | 37% | 26% | 35% | 29% | no |
| 2 | 2021-01-16 | 6d | 1 | 39% | 25% | 38% | 29% | no |
| 3 | 2021-01-30 | 9d | 2 | 48% | 24% | 35% | 33% | no |
| 4 | 2021-04-07 | 45d | 2 | 22% | — | 29% | 41% | no |
| 5 | 2021-08-22 | 95d | 0 | — | 24% | 307% | — | no |
| 6 | 2021-11-02 | 50d | 3 | — | — | — | — | no |
| 7 | 2023-12-24 | 760d | 51 | — | 28% | 36% | 28% | no |
| 8 | 2024-02-13 | 41d | 0 | 25% | 37% | 40% | 32% | no |
| 9 | 2024-11-14 | 240d | 1 | 22% | 38% | 172% | 59% | no |
| 10 | 2025-01-16 | 37d | 0 | — | — | — | — | no |
| 11 | 2026-07-04 | 527d | — | — | — | — | — | no |

Three facts stand out:

1. **Re-entry is fast.** Median 1 day to reach 50% exposure, with a
   range of 0–51 days. The Shield does not "lock you out." It responds
   to improving conditions almost immediately — except for the monster
   760-day episode (#7) that spans the entire LUNA/FTX/2022 bear.
2. **Participation is low.** Among cycles with 12-month data, the
   median recovery capture is 32% of B&H — far below the 70% threshold.
   The Shield re-enters, but at reduced exposure, and captures a
   fraction of the upside.
3. **Shield never catches up.** Zero of seven cycles with 12m data end
   with Shield equity above B&H equity at 12 months. The protection
   gap from the defensive period is never fully closed.

![Recovery participation: how much of the B&H recovery the Shield captured (KKT production stack)](/research/assets/recovery_participation.svg)

![Timeline of all eleven defensive episodes and their recovery (KKT production stack)](/research/assets/recovery_timeline.svg)

## 4. The gate scorecard

The pass criteria from the original test plan, verbatim:

| Gate | Requirement | Result | Verdict |
|------|-------------|--------|:-------:|
| Median 12m participation | >= 70% of B&H | 32% | ❌ FAIL |
| Median days to 50% exposure | < 60 days | 1 | ✅ PASS |
| Worst single recovery | >= 40% of B&H | 28% | ❌ FAIL |
| Shield > B&H after 12m | >= 1 cycle | 0 | ❌ FAIL |

**1 of 4.** The only passing gate is the speed of re-entry — and that
passes by a wide margin (1 vs 60). The participation gates fail by a
wide margin too.

## 5. Honest reading

1. **The Shield does not "lock you out" — technically.** Median re-entry
   is 1 day. If the only question is "does the Shield get back in
   quickly?", the answer is yes, decisively.

2. **But re-entering fast is not the same as recovering fast.** The
   Shield comes back to 50% exposure in 1 day, but then stays at
   reduced exposure for months. The median 12-month participation of
   32% means the Shield captures roughly one-third of what B&H earns
   in the recovery. The speed of re-entry is real; the recovery is not.

3. **This is the same story as Crown Test 2, told from a different
   angle.** The Shield is defensive 81% of days on the KKT portfolio.
   When 81% of your life is spent at reduced exposure, you are going
   to miss most of the upside — not because you are slow to re-enter,
   but because you are structurally under-invested for most of the
   window.

4. **The protection is real; the cost is real.** The Shield cut MaxDD
   from 81.5% to 34.2% (Test 2). That protection costs about $36k on
   a $30k outcome in terminal wealth, and it costs 68% of the recovery
   upside. Whether that trade is worth it is a personal risk-tolerance
   question; the data now prices it from every angle.

## 6. Test details

- **Basket:** ADA, BNB, ETH, XRP, SOL (KKT risk-parity weights)
- **Weights:** ERC on 180d log-return covariance, capped 40%/10% per
  token, 60% risky / 40% USDC structural, re-optimised every 180 days
- **Window:** 2020-04-10 to 2026-07-04 (2,275 days, 6.2 years)
- **Start capital:** $1,000 · **DCA:** $100 every 30 days (perfect)
- **Fee:** 0.1% per trade · **Stablecoin yield:** 0
- **Shield:** production `default_config`, same-day execution on full
  portfolio equity (risky + parked USDC)
- **Defensive threshold:** held exposure < 40% (redeploy_thresh)
- **Recovery horizons:** 30 / 91 / 182 / 365 days after episode exit
- **Participation:** Shield equity gain / B&H equity gain over same
  forward window; undefined when B&H loses money

## 7. Reproducibility

Both instruments run on the same 6.2 years of daily closes with the
unmodified production engine for the Shield leg. The portfolio is
constructed with the real KKT risk-parity optimizer (ERC + KKT
projection), not equal weights — this is exactly what runs on the
server. Test scripts, chart generators, and raw result data live in
the engine's internal research tooling.

---

*This is the fourth of five planned crown tests for the v14 Deleverage
Shield. Test 1 (Human Factor) is published
[here](/research/dca-stress). Test 2 (Static vs Dynamic) is published
[here](/research/static-vs-dynamic). Verdict here: 1/4 gates — the
Shield re-enters fast but captures only a fraction of the recovery.
Next: Test 3, liquidity execution.*

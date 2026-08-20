# AQMath Priorities — What to Work On Next

**Last updated:** 2026-08-20
**Owner:** Momir Demirov (sole developer)
**Stack:** 10 FastAPI services on Railway, static HTML/CSS/JS on GitHub Pages

---

## How to Read This Document

- **P0** — drop everything, this blocks users or revenue
- **P1** — do this week, directly impacts credibility or growth
- **P2** — do this month, improves quality but nothing is broken
- **P3** — queue for later, nice-to-have improvements

Each item lists: what, why urgent, estimated effort, blocker (if any),
and which repo(s) are affected.

---

## P0 — CRITICAL (do NOW)

### 1. Crown Test 5 — Strategy Benchmark

**What:** Implement 5 competitor strategies (200d MA, 50/200 crossover,
Momentum 12-1, Dual Momentum GEM, CPPI) and run head-to-head against
Shield v14 on identical baskets.

**Why urgent:** This is THE marketing asset. Without it, every claim
"better than alternatives" is unverified. Every Substack post, every
Reddit thread, every Twitter pitch needs this data. It's the single
highest-leverage piece of content the project can produce.

**Effort:** 3-4 days
**Blocker:** None — all infrastructure exists (`backtest.py`, `deleverage.py`)
**Repo:** `aqmath-engine` (scratch/), `backtesting-`
**Output:** Research page + Substack article + Reddit post

**Steps:**
1. Implement each strategy as a pure function in `scratch/strategy_benchmark.py`
2. Batch runner on 3 baskets (v14 default, MEXC-only, mixed)
3. Generate equity curve overlay, drawdown overlay, ranking table
4. Write up results in `_research/strategy-benchmark.md`
5. Build research page (`build_research.py`)
6. Publish Substack article with key charts

---

### 2. One-Tap Alignment — Backend Hardening

**What:** The UI is complete (signal card, confirm/skip/adjust, exec-time
prompt) but the backend endpoints need production hardening — error
handling, edge cases, idempotency guarantees.

**Why urgent:** Beta users are seeing the signal card. If confirm/adjust
fails silently or double-applies deltas, trust is destroyed instantly.
This is the primary user-facing feature.

**Effort:** 1-2 days
**Blocker:** None
**Repos:** `aqmath-engine` (portfolio_service.py), `-aqmath-beta-auth`

**Steps:**
1. Add idempotency keys to confirm/adjust endpoints
2. Handle edge case: signal already confirmed (return cached result)
3. Validate delta application (holdings can't go negative)
4. Add retry logic for holdings sync after confirm
5. Test with actual beta user flow

---

### 3. Paper Trading Forward Log — Public Dashboard

**What:** The v14/v15/v16 forward logs run daily but the results are
only visible as HTML fragments in the Results tab. Create a shareable,
screenshot-ready summary (total return, MaxDD, Sharpe, vs B&H) that
can be linked from Substack/Reddit/Twitter.

**Why urgent:** Live track record is the strongest proof point. Right
now it's buried in the app — nobody can see it without a beta key.

**Effort:** 1 day
**Blocker:** None
**Repo:** `backtesting-` (new endpoint), `aqmath-ui` (Results tab update)

**Output:** `/forward-summary` endpoint returning JSON + HTML card

---

## P1 — HIGH (do THIS WEEK)

### 4. Crown Test 3 — Liquidity Execution

**What:** Test slippage impact on 3 liquidity tiers (high/medium/low
volume) using MEXC data. Model conservative slippage (0.5-3%) and
measure Sharpe/MaxDD degradation.

**Why important:** Proves the system works for small-cap tokens, not
just BTC/ETH. Essential for credibility with the DeFi/altcoin audience.

**Effort:** 2-3 days
**Blocker:** MEXC data must be sufficiently populated in data-pipeline
**Repo:** `aqmath-engine` (scratch/), `backtesting-`

---

### 5. v17 Circuit Breaker — UI + Telemetry Integration

**What:** v17 (single-day -8% → 15% floor, 5d cooldown) exists
server-side only. Add user-visible status indicator and log v17
events to the daily telemetry so users can see when the circuit
breaker activated.

**Why important:** Users in a crash need to SEE the protection working.
An invisible shield creates anxiety. "The system cut my exposure 15%
and I didn't know" is a trust-killer.

**Effort:** 2 days
**Blocker:** None
**Repos:** `aqmath-engine` (portfolio_service.py), `aqmath-ui` (shield card)

---

### 6. Substack Content Blitz (3 articles)

**What:** Publish 3 articles in 2 weeks using existing research:

| # | Title (working) | Source Material | Status |
|---|-----------------|-----------------|--------|
| 1 | "I Tested My Risk Engine Against 5 Trading Strategies — Here's Who Won" | Crown Test 5 (P0-1) | 🔴 Needs Test 5 |
| 2 | "Why Your Crypto Portfolio Draws Down 40% More Than You Think" | Crown Test 4 (recovery) + Test 2 (static vs dynamic) | ✅ Ready to write |
| 3 | "The Hidden Cost of Being Late: How Execution Delay Destroys Risk Protection" | Existing Substack draft (substack-dca-stress-hr.md) | ✅ Draft exists, needs English version |

**Why important:** Substack is the primary long-form channel. Each
article is also fodder for Twitter threads and Reddit posts.

**Effort:** 2-3 hours per article
**Platform:** https://substack.com/@aqmathxyz

---

### 7. E2E Playwright Tests — Beta Key Flow

**What:** Automated test for: enter beta key → activate → see shield
card → save portfolio → see signal card. Currently only 5 visual
snapshot tests exist.

**Why important:** Every UI change risks breaking the activation flow.
Without E2E tests, regressions ship to production.

**Effort:** 1-2 days
**Repo:** `aqmath-ui` (tests/)

---

## P2 — MEDIUM (do THIS MONTH)

### 8. 3-Layer Caching Plan

**What:** Implement the approved caching architecture (see
`aqmath-engine/CACHING_PLAN.md`): L1 in-process TTL, L2 PostgreSQL
materialized views, L3 static JSON snapshots.

**Why:** Reduces Railway costs, improves response times, prepares for
scale. Not urgent because current performance is acceptable.

**Effort:** 3 days
**Repo:** `aqmath-engine`, `data-pipeline`

---

### 9. Signal History View

**What:** Show past signals with outcomes (confirmed, skipped, adjusted)
in a scrollable list. Users should see their signal track record.

**Why:** Completes the One-Tap Alignment loop. Without history, users
can't evaluate whether following signals helped.

**Effort:** 2 days
**Repos:** `aqmath-ui` (new card), `aqmath-engine` (endpoint)

---

### 10. Expanded Playwright Tests

**What:** Add tests for: mobile breakpoints (480/768/920px), dark mode
consistency, portfolio sync flow, DCA distribution flow, One-Tap signal
confirm/skip/adjust.

**Why:** Visual regression coverage is thin. Mobile is 40%+ of traffic.

**Effort:** 2 days
**Repo:** `aqmath-ui` (tests/)

---

### 11. Conversion Funnel Tracking

**What:** Implement the approved A/B test plan (see
`aqmath-ui/_research/conversion-funnel-ab-plan.md`). Privacy-first
counters only — no cookies, no PII, Simple Analytics only.

**Why:** Currently no data on where users drop off. Can't optimize
what you can't measure.

**Effort:** 2 days
**Repo:** `aqmath-ui`, `-aqmath-beta-auth`

---

## P3 — LOW (queue for LATER)

### 12. Staging Environment

**What:** Duplicate Railway deployment for pre-production testing.

**Why not urgent:** Costs double. Current CI/CD with smoke tests +
one-click rollback is sufficient for solo dev.

**Effort:** 1 day
**When:** When beta user count exceeds 5

---

### 13. Execution Gap Analytics Dashboard

**What:** Aggregate execution time data into charts showing: average
execution delay, same-day vs late rate, per-regime breakdown.

**Why not urgent:** Depends on users actually reporting execution times.
Data pool is currently too small for meaningful analytics.

**Effort:** 2 days
**When:** After 100+ execution time reports collected

---

### 14. Signal Performance Attribution

**What:** Did following signals actually help? Compare equity curves
of users who confirmed vs skipped vs adjusted.

**Why not urgent:** Requires significant user base + time series.
Premature with current beta size.

**Effort:** 3-4 days
**When:** After Crown Test 5 provides theoretical backing

---

### 15. Internationalization Expansion

**What:** Add German (DE) translations alongside EN + ZH-CN.

**Why not urgent:** Current audience is EN-primary. German market is
relevant for compliance/impressum reasons but not for growth.

**Effort:** 1 day
**Repo:** `aqmath-ui` (locales/)

---

## Summary Matrix

| Priority | Item | Effort | Impact | Can Wait? |
|----------|------|--------|--------|-----------|
| **P0** | Crown Test 5 (Strategy Benchmark) | 3-4d | 🔥🔥🔥🔥🔥 | No — blocks all marketing |
| **P0** | One-Tap backend hardening | 1-2d | 🔥🔥🔥🔥 | No — beta users see it |
| **P0** | Forward log public summary | 1d | 🔥🔥🔥🔥 | No — proof of track record |
| **P1** | Crown Test 3 (Liquidity) | 2-3d | 🔥🔥🔥🔥 | 1 week |
| **P1** | v17 UI integration | 2d | 🔥🔥🔥 | 1 week |
| **P1** | Substack articles (3) | 6-8h total | 🔥🔥🔥🔥 | 1 week |
| **P1** | E2E beta key test | 1-2d | 🔥🔥🔥 | 1 week |
| **P2** | 3-layer caching | 3d | 🔥🔥 | 2-4 weeks |
| **P2** | Signal history view | 2d | 🔥🔥🔥 | 2 weeks |
| **P2** | Expanded Playwright | 2d | 🔥🔥 | 2-4 weeks |
| **P2** | Conversion funnel | 2d | 🔥🔥 | 2-4 weeks |
| **P3** | Staging environment | 1d | 🔥 | Whenever |
| **P3** | Execution gap analytics | 2d | 🔥 | When data exists |
| **P3** | Signal attribution | 3-4d | 🔥🔥 | When users exist |
| **P3** | i18n German | 1d | 🔥 | Whenever |

---

## Recommended Work Order (Next 2 Weeks)

```
Week 1:
  Day 1-4: Crown Test 5 (P0-1) — blocks marketing
  Day 3:   One-Tap backend hardening (P0-2) — parallel
  Day 4:   Forward log summary (P0-3)
  Day 5:   Substack article #3 (exec delay — draft exists)

Week 2:
  Day 1-3: Crown Test 3 (P1-4)
  Day 3-4: v17 UI integration (P1-5)
  Day 4:   Substack article #2 (recovery + static vs dynamic)
  Day 5:   Substack article #1 (strategy benchmark — from Test 5 results)
```

# Three Price Feeds, One Strategy — does the signal depend on who tells you the price?

**Date:** 2026-08-09
**Engine:** v14 Deleverage Shield — production `evaluate_shield` / `backtest_modulator` imported unmodified; daily-close series pulled independently from three public price feeds
**Status:** 📊 RESEARCH — data-source sensitivity study, no parameter changed, no basket promoted

---

## 1. Objective

Every study published so far ([OOS](/research/oos-v14-new-tokens),
[Monte Carlo](/research/mc-risk), [Regime Autopsy](/research/regime-autopsy),
[Robustness](/research/robustness)) treated the price series as ground truth.
It is not. The live pipeline trusts **one** daily-close feed — a free-tier
aggregator — for every shield signal, every DCA routing and every KKT
re-optimisation. The question this study asks: *if we had trusted a different
feed, would the user have gotten different signals?*

Three feeds were pulled independently for the eight tokens in the frozen v14
plan: the aggregator the production collector uses (CoinGecko), and two
exchange-native feeds (Coinbase Exchange candles, Kraken OHLC).

## 2. Coverage — already a finding

Listing status on 2026-08-09:

| Token | Aggregator (production) | Coinbase | Kraken |
|-------|:---:|:---:|:---:|
| ATH   | ✓ | ✓ | ✓ |
| DAG   | ✓ | ✗ | ✓ |
| EWT   | ✓ | ✗ | ✓ |
| PAXG  | ✓ | ✓ | ✓ |
| PEAQ  | ✓ | ✗ | ✓ |
| PYTH  | ✓ | ✓ | ✓ |
| TIA   | ✓ | ✓ | ✓ |
| TICS  | ✓ | ✗ | ✗ |

Only **4 of 8** plan tokens are listed on all three feeds. **TICS is
single-source**: its daily close exists nowhere in this comparison but the
production aggregator. Any bad print there is undetectable by construction.

One more coverage fact with operational weight: the aggregator's free tier
(what the production collector uses — browser User-Agent, no key) is now
capped at **365 days** of history; deeper requests answer HTTP 401. That caps
this study's window and would cap any fresh deployment's backfill.

## 3. How much do the feeds disagree?

Pairwise absolute relative difference of same-day prices, over overlapping
dates. (One convention fix first: the aggregator's "daily" point is the
UTC-00:00 snapshot, i.e. the *previous* day's close — verified by the
2025-10-10 crash printing under 10-10 on both exchanges and under 10-11
there. All series were relabelled to the exchange convention before
comparison.)

| Pair | Token | n | Median | p95 | Max |
|------|-------|--:|-------:|----:|----:|
| Coinbase vs Kraken | PAXG | 458 | 0.04% | 0.22% | 0.80% |
| Coinbase vs Kraken | PYTH | 535 | 0.14% | 0.48% | 1.18% |
| Coinbase vs Kraken | TIA | 720 | 0.09% | 0.38% | 3.34% |
| Coinbase vs Kraken | ATH | 514 | 0.21% | 0.85% | 3.52% |
| Aggregator vs exchange | PAXG | 364 | 0.04% | 0.26% | 1.64% |
| Aggregator vs exchange | PYTH | 364 | 0.15% | 17.5% | 28.2% |
| Aggregator vs exchange | ATH | 364 | 0.17% | 13.8% | 28.9% |
| Aggregator vs exchange | TIA | 364 | 0.09% | 59.3% | 76.1% |
| Aggregator vs Kraken | PEAQ | 364 | 0.27% | 23.6% | 44.9% |
| Aggregator vs Kraken | EWT | 364 | 1.87% | 33.0% | 56.3% |
| Aggregator vs Kraken | DAG | 270 | 3.53% | 40.2% | 50.4% |

**The exchanges agree with each other.** Venue-to-venue divergence on the
same day is noise: median 0.04–0.21%, p95 under 0.9%. Price discovery is not
the issue.

**The aggregator mostly agrees — until it doesn't.** Median divergence is
equally small, but the tail is enormous: p95 between 13% and 59%, worst
single-day gaps up to 76%. The disagreement is not a wide distribution; it is
a handful of extreme prints. Section 4 shows where they come from.

## 4. Anatomy of the bad prints

Suspect single-day moves (|return| > 30%) over the 364-day window, counted
per feed and token. For the aggregator, a jump is **uncorroborated** when no
exchange shows a >15% move on the same or a neighbouring day — i.e. it is a
bad print, not a market event.

| Feed | Token | Jumps | Uncorroborated |
|------|-------|------:|---------------:|
| Aggregator | TIA | 17 | 15 |
| Aggregator | TICS | 12 | 12 |
| Aggregator | DAG | 9 | 7 |
| Aggregator | EWT | 6 | 6 |
| Aggregator | PEAQ | 3 | 1 |
| Aggregator | ATH | 1 | 0 |
| Aggregator | PYTH | 1 | 0 |
| Kraken | (6 tokens) | 11 | — |
| Coinbase | (3 tokens) | 5 | — |

The production feed printed **49 one-day moves above 30% in a single year, 41
of them corroborated by no exchange** — prints like +107% and −52% on TIA in
consecutive weeks while both exchanges traded flat. The exchanges' jumps, by
contrast, are nearly all shared events (the October 2025 liquidation cascade
appears on every feed that lists the token). The contamination concentrates
in exactly the thin-liquidity tokens a small-cap plan must hold.

For context on why this reaches the strategy unfiltered: the pipeline
validator *flags* moves above 50% but does not reject them, and moves of
30–50% are not checked at all.

## 5. Replay — same shield, three feeds

The real v14 shield (`evaluate_shield`, production constants, 10 bps fees,
threshold rebalancing) was replayed once per feed plus a **consensus** arm
(per-token median across the three feeds), on the 4-token sub-basket listed
everywhere (weights: the frozen plan renormalised — ATH 20.1%, PAXG 52.6%,
PYTH 14.4%, TIA 12.9%). Window: 364 days, 2025-08-09 → 2026-08-07.
$10,000 start + $300/30d DCA.

| Feed | Final | MaxDD | Sharpe | Calmar | Fees | Rebalances |
|------|------:|------:|-------:|-------:|-----:|-----------:|
| Aggregator (production) | $16,481 | 14.4% | 1.31 | 1.48 | $37 | 25 |
| Coinbase | $16,580 | 14.1% | 1.35 | 1.57 | $33 | 22 |
| Kraken | $16,601 | 14.4% | 1.34 | 1.55 | $35 | 23 |
| Consensus (median of 3) | $16,600 | 14.3% | 1.34 | 1.55 | $35 | 23 |

Buy & Hold on the same window: +28.3–28.4%.

**The bottom line is feed-robust in this window.** Final values sit inside a
0.7% band, max drawdown inside 0.3 pp. Two structural reasons: the sub-basket
is dominated by PAXG (52.6% — the cleanest series in the study, 0 jumps on
every feed), and contaminated prints are mean-reverting (a +107% print is
followed by a −52% print), so their net effect on level largely cancels.

The basket-level return of the production feed deviated from the consensus by
more than 2 pp on **0 of 363 days** — the contamination is real but, at these
weights, it stays below the basket surface.

## 6. Where the feed DOES change the signal

Outcome equivalence is not mechanism equivalence. Two channels show movement:

**Timing.** Shield exposure paths differ by more than 5 percentage points on
6.9% of days (vs Coinbase) and 5.0% (vs Kraken); versus the consensus, 4.7%.
Exchange-vs-exchange: 1.4%, and zero days above 10 pp. The production feed
makes the shield *trade on different days* roughly once a fortnight — a bad
print spikes the drawdown window, the shield de-risks a day early or
re-enters a day late. In this window the net result almost fully cancelled;
there is no guarantee it cancels in the next one.

**The macro input.** The KKT loop re-optimises on realised volatilities and
covariances computed from the same daily series. Per-feed annualised vol of
the sub-basket tokens:

| Token | Aggregator | Coinbase | Kraken | Spread |
|-------|-----------:|---------:|-------:|-------:|
| PAXG | 29.3% | 29.5% | 29.6% | 0.3 pp |
| ATH | 118.9% | 114.5% | 115.5% | 4.4 pp |
| PYTH | 153.5% | 141.5% | 140.9% | 12.6 pp |
| TIA | 292.9% | 106.1% | 105.4% | **187.5 pp** |

The production feed estimates TIA's risk at **2.8× the exchange estimate** —
purely from bad prints. The frozen weights locked 2026-08-08 are untouched by
this (they are frozen), but the next macro re-optimisation reads those
contaminated vols: thin tokens get systematically over-penalised, and the
"clean" answer depends on which feed you ask. This is the channel where feed
choice stops being noise and becomes a hidden parameter.

## 7. Caveats

- **Window:** 364 days (2025-08-09 → 2026-08-07), capped by the aggregator's
  free-tier 365-day history limit. No bear-market leg is covered.
- **Sub-basket:** only the 4 of 8 plan tokens listed on all three feeds. The
  replay is gold-heavy by construction; the contaminated single-source tokens
  (TICS, DAG, EWT, PEAQ) could not be replayed across feeds at all. Their
  contamination counts in §4 are the evidence for them instead.
- **Jump threshold:** 30% is a heuristic; genuine thin-token moves can exceed
  it. The uncorroborated count (requiring silence on BOTH exchanges ±1 day)
  is the conservative figure used for attribution.
- **No lookahead anywhere:** every feed arm runs the identical production
  code path, same DCA, same fees, same constants.

## 8. Implications

1. **Venue disagreement is not the risk.** Two independent exchanges agree to
   within ~0.1% on a typical day. The production feed agrees with them in the
   median — the risk lives entirely in its tail.
2. **The shield's bottom line survived one year of that tail** at the current
   (gold-heavy) weights — with 0/363 days of >2 pp basket-level deviation.
3. **The two exposed channels are timing and the macro vol input**, both
   driven by single-feed bad prints on thin tokens.
4. Candidate hardening (not implemented — shield parameters are frozen and
   this study changes nothing in production): a plausibility clamp on
   single-day moves, or a cross-feed median where a second source exists —
   Kraken alone covers 7 of the 8 plan tokens.

The honest summary: *the signal does not depend on who tells you the price in
the median case — but one of the three feeds occasionally lies, the lie is
concentrated in exactly the tokens the plan must hold, and the next macro
re-optimisation will read those lies as volatility.*

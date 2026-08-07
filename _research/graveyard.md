# Graveyard Gauntlet — who saves the basket when tokens die?

**Date:** 2026-08-07
**Engine:** v14 Dual-Speed E2E — identical wiring to the live paper trading service (180-day KKT risk-parity MACRO loop with the ADV-K2 liveness screen + v14 Deleverage Shield)
**Status:** 📊 RESEARCH — worst-case stress basket, no basket promoted

---

## 1. Objective

Every earlier study asked how the Shield behaves *in* crashes. This one asks
a nastier question: what happens when the basket itself contains tokens that
**die** — exchange tokens and lending tokens that went to zero in 2022?

Basket G is built as a worst case: **BTC, ETH, PAXG** plus three corpses —
**CEL** (Celsius, bankrupt July 2022), **LUNC** (Terra Classic, May 2022
collapse), **FTT** (FTX, November 2022 collapse). The window runs
2020-03 → 2026-08, long enough to hold each token *before* its death,
through it, and for years after.

The system has three layers that could plausibly protect it:

1. **The optimizer** — the KKT risk-parity re-optimisation can refuse to
   allocate to a deteriorating token before it dies.
2. **The Shield** — the drawdown modulator can de-risk the whole basket
   during the death.
3. **The [liveness screen](/research/liveness-screen)** — the ADV-K2
   cap-zero screen can zero tokens whose trailing dollar volume has died.

The study runs the basket twice — with the production screen and with the
screen switched off — and attributes the protection honestly. The honest
answer surprised us, and we publish it as measured.

## 2. The system survives the graveyard

Buy & hold on basket G is a disaster by construction: three of six tokens go
to (near) zero, and the raw basket draws down **62%** across the window.
The strategy's experience of the same basket is a different animal.

| Death event | Strategy equity at death | 30 days later | Change |
|---|---:|---:|---:|
| LUNC collapses (2022-05-12) | $6,542 | $6,483 | −0.9% |
| Celsius bankrupt (2022-07-14) | $6,684 | $7,522 | +12.5% |
| FTX collapses (2022-11-08) | $6,925 | $6,833 | −1.3% |

No single death costs the strategy more than ~1.5% of equity; the CEL date
is even positive because the Shield had already de-risked and the survivors
caught the bounce. Over the two named death regimes the cut versus buy &
hold is ~36-38 percentage points of drawdown:

| Regime | Strategy MDD | Buy & Hold MDD | Cut |
|---|---:|---:|---:|
| G1 LUNA+CEL deaths (2022-04 → 2022-08) | 13.3% | 48.9% | +35.6 pp |
| G2 FTT death (2022-10 → 2023-02) | 11.1% | 48.7% | +37.6 pp |

![Graveyard Gauntlet: equity through three token deaths, with screen event timeline](oos_assets/graveyard_gauntlet.svg)

## 3. Who did the work — the honest attribution

Here is the part a marketing page would skip: **the liveness screen did not
save the basket during the deaths.** With the screen off, the death-regime
drawdowns are 13.4% and 11.2% — statistically the same as the screened run's
13.3% and 11.1%. The attribution decomposes cleanly:

**Before the deaths: the optimizer.** The risk-parity re-optimisation had
already excluded LUNC from the frozen weights from late 2020 — a token with
thin volume and pathological volatility simply does not win weight in the
KKT solution. LUNC's May-2022 collapse therefore hit an (almost) empty
position in *both* runs.

**During the deaths: the Shield.** The risky exposure path shows the
modulator doing its job in real time: entering the LUNA contagion at 0.28
exposure, it was down to **0.11 within a week** of the crash; entering the
FTX collapse at 0.27, it was at **0.05 five days later**. That de-risking is
identical in both runs, which is exactly why the screen on/off comparison is
flat during the deaths.

**After the deaths: the screen.** The ADV-K2 screen's real job turns out to
be hygiene, not rescue: from 2023 onward it fires seven zeroing events that
stop zombie tokens from re-entering the frozen weights (the optimizer will
happily re-allocate to a cheap, low-correlation corpse). It also fired early
once — zeroing CEL in September 2020 on dead volume, 21 months before the
bankruptcy.

**The FTT lesson.** FTT was liquid right up to the day FTX died — its
dollar volume was far above the screen's threshold, so no liquidity screen
can ever catch a *solvency* collapse. Both runs carried FTT into the FTX
collapse, and the Shield absorbed it (11.1% regime MDD against 48.7%). This
is a structural limit of volume-based screening, and we state it plainly:
the screen guards against tokens that die *slowly*, not against counterparties
that die overnight.

## 4. The price of insurance

Honesty requires the other side of the ledger. On this single realized path,
the screened run finishes **below** the unscreened one ($12,155 vs $13,402,
full-window MDD 17.9% vs 18.3%): the early CEL zeroing skips part of CEL's
2021 rally, and the post-2023 zombie cleanup skips LUNC's 2026 rally. The
screen is insurance, and on this one path the premium was not repaid in
return — it was paid in avoided risk that the equity curve cannot show.

We do not read this as an argument against the screen. One realized path is
not a distribution: for every LUNC-2026 rally there are many paths where the
zombie keeps dying and the re-entry loses money. But a study that reports
only the rescue and not the premium would be selling, not measuring. The
screen's measured role is narrow and real: it keeps dead tokens out of the
optimizer's future, and it cannot — and does not claim to — predict which
living token dies next.

## 5. Caveats

- **One realized path.** The graveyard is a single historical sample. The
  attribution (optimizer / Shield / screen) is robust within it, but the
  *size* of the insurance premium is path-dependent.
- **Yahoo price data for LUNC/FTT.** LUNC carries the pre-redenomination
  price level, so the May-2022 burn appears as a ~total crash — which is
  also what holders actually lost. FTT trades at cents on Yahoo after the
  collapse; both are the right stress inputs, but they are not
  exchange-grade series.
- **Thin CEL volume.** CEL's dollar volume comes from a small exchange
  universe; the screen's 2020 CEL zeroing is directionally correct but the
  exact ADV level is approximate.
- **Not a production basket.** Basket G is a stress construct; no promoted
  basket holds dead tokens. The study stresses the *mechanisms*, not a
  product allocation.
- **Weights are internal.** Per-token frozen weights are deliberately not
  published; the charts show equity, exposure and event dates only.

## 6. Verdict

Put three dead tokens in the basket and the system still refuses to die:
~18% full-window max drawdown against 62% for buy & hold, and no single
death costs more than ~1.5% of equity. The protection is real — but the
attribution is not what a naive pitch would claim. The optimizer dodges the
slow deaths before they happen, the Shield absorbs the fast ones within
days, and the liveness screen cleans up the corpses afterwards. Each layer
does a different job; none of them pretends to predict an overnight
solvency collapse. That division of labour, measured and published with its
premiums, is the actual robustness story.

*Simulated on historical daily closes with fees; nothing here is financial
advice.*

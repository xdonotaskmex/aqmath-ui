# I Deliberately Broke My Own System — Here's What Snapped

*I tested what happens when a risk engine has to absorb human imperfection: late deposits, forgotten months, signals that sit for days. The verdict: you can be sloppy with your deposits. You cannot be sloppy with your signals.*

---

Every backtest I've ever published carried one dirty assumption: a perfect schedule. $100 every 30 days, on time, every time, for six and a half years without exception.

Nobody trades like that. People forget. Payday slips. One month it's $120, the next it's $80, once you skip the whole thing because you were at the beach. So the real question started bothering me: **if my protection collapses the moment the schedule gets human, then the whole thing is a lab toy.**

So I built a stress test. Not against the market — against myself. I deliberately simulated the worst human versions of me and watched where it breaks.

## The setup, in short

- Basket: ADA, BNB, ETH, XRP, SOL
- Window: April 2020 – July 2026, so 6.2 years of real market, two bear cycles included
- $1,000 start, DCA of $100 every 30 days
- 30 independent simulations per scenario, all on the same production config, zero parameters changed

The pass/fail bar was simple: drawdown protection (how deep the portfolio sinks from its peak) must not weaken by more than 3 percentage points, and the Sharpe must not fall by more than 0.10.

## Test 1: what if your deposits are amateur hour

Five scenarios: perfect schedule, 0–5 day delays, amounts ±20%, skipping every fourth month, and all of it combined at once — the most realistic worst case I could think of.

The result? Practically nothing. The worst degradation of the protection was **0.5 percentage points** — even when I combined delays, varying amounts, and skipped months. The equity curve of the perfect schedule and the totally chaotic schedule look almost identical.

Sounds like a win. And then a reader in the comments explained why this test could never fail in the first place.

## The critique that was right

Quoting it, because it deserves to stand verbatim:

> The reason almost nothing moved is that the risk engine reads portfolio volatility and drawdown, not the deposit schedule — so messing with when the money arrives was never going to touch it. You proved the two are decoupled, which is worth knowing, but it means the test realistically couldn't fail.

He was right. I tested everything around the engine, but not the thing the engine actually reacts to. A test that cannot fail confirms robustness — but it cannot discover weakness.

He had a second point that turned out brutally important: **lag is not noise.** If you're always late by the same amount, that's not randomness that averages out — that's a direction. Random delays cancel out across 30 simulations. Consistent lateness does not.

So I built a version of the test that can actually fail.

## Test 2: what if you're late executing the signals

Here I stopped touching the deposits (DCA is perfect in every scenario now) and started touching the one thing that hurts: the moment the engine says "cut risk now" and you do it later.

Four error scenarios: random delay of 0–3 days, a constant delay of exactly 3 days, an "I fell asleep" model (the operator inactive about 29% of the time in ~4-day episodes), and the meanest one — delays only during the worst weeks, when volatility spikes.

And that's where the first real failure arrived.

Random delay? Passed. Asleep 29% of the time? Passed. But **a constant 3-day delay on every signal** — that broke the Sharpe gate. Over $5,000 of damage on a final equity of ~$30k, CAGR dropping from 22.5% to 19%.

What surprised me most: the variance. With random delays the damage scatters — on some simulations being late actually *helped*. With the constant lag the variance is **zero**. Every one of the 30 simulations ate exactly the same damage. Lag has a direction, and no amount of averaging will hide it. Had I only tested random delays, I would have published another test that cannot fail.

And one more thing: even perfectly uniform errors concentrate in the worst weeks. When I restricted errors to only the volatility-spike days (10% of all days in the window), 40% of the total damage landed there — a fourfold concentration. The damage falls exactly where you need the system most.

## Test 2b: same test, but on the production portfolio

So far I was testing on a 100% risky basket. Production looks different: risk-parity weights, 40% structurally parked in a stablecoin, weights frozen and re-optimized every 180 days.

I re-ran the same scenarios on that configuration. The verdict got harsher: **0 out of 4 scenarios pass.**

On the production setup, even a random 0–3 day delay breaks the drawdown gate. The constant 3-day lag adds more than 11 percentage points to the maximum drawdown — the protection, the one thing the whole system exists to deliver, is exactly what snaps.

Why? The protection on a 60/40 portfolio works gentler and slower. When execution is late, the portfolio simply rides deeper into the crash at full exposure before the risk reduction ever lands.

The most interesting detail: the scenario with errors only in the worst weeks did barely ~$1,000 of total equity damage — and yet +11 percentage points of drawdown. Errors timed to the worst days destroy the protection almost without touching the final amount. That's the sneakiest way this can go wrong, because on paper it looks harmless.

## What I learned

One thing survived all three versions of the test: **falling asleep is cheaper than being late.** If you miss a day or two, the signal is still there — when you come back, you execute the newest instruction and the system heals itself. Constant lateness has no healing mechanism; every single day starts with a stale instruction.

And the practical rule — the only policy that passes every gate on the production setup: **when a signal arrives, execute it the same day.** Not "in a day or two when I get to it". Same day. Skipping a day is far cheaper than the habit of being late.

And the lesson about testing itself, maybe the most important one: if your test cannot fail, you're not testing robustness — you're testing confidence. A real test is one that can humiliate you. This one humiliated me on the second attempt. Better in simulation than on real money.

---

*Reproducibility details: 30 seeds per scenario, 0.1% fee per trade, all parameters at production defaults, engine unchanged. Every number in this article is the median of 30 simulations.*

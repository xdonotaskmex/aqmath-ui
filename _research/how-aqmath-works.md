# How AQMath Works — What the Calculations Mean and What You Decide

**Version:** v3.0
**Audience:** every BLACK user, shown as a must-read before first use
**Status:** 📖 USER GUIDE — the single source of truth for the in-app explainer

---

## 1. What AQMath is (and is not)

AQMath is **software for mathematical calculation**. It computes figures from
the assets, amounts and parameters you enter. It is **not** a trading bot, it
never connects to any exchange, it holds no funds, and it never places an
order. AQMath records, it does not decide: **you** make every decision and
carry out any action yourself, on your own account, at your own discretion.
Nothing happens without your manual action.

The figures are arithmetic results, not advice, not an instruction and not a
recommendation. There is no guarantee of any outcome, and losses are possible
in every market regime. The numbers AQMath shows come from mathematical risk
models examined in backtests; backtests are simulated history, not a promise
about the future.

## 2. The two loops

### The MACRO loop — KKT risk parity (slow, frozen)

When you save your portfolio for the **first time**, the engine computes
**KKT risk-parity weights** for your token set: each token receives a share of
capital proportional to how much *risk* (not price movement) it contributes,
subject to structural limits (per-token caps, at most 60% of capital in risky
assets, the rest treated as stable reserve).

These weights are then **frozen**. They are not recomputed when you press a
button and not recomputed when prices move. The only thing that changes them
is the macro loop: every **180 days** the engine re-optimises once and freezes
the new weights. You are notified when this happens.

### The daily loop — Proteus (v18) Deleverage Shield (fast, frozen configuration)

Once per day, after market close, the engine runs the **Proteus (v18) Deleverage
Shield** over your frozen weights. The shield is a regime modulator: it reads
the drawdown and downside volatility of your basket and continuously computes
a target exposure between fully invested and defensive (more reserve, less
risk). Its drawdown threshold is scaled by your basket's own trailing
volatility, so one configuration adapts to calm and wild baskets alike. The
configuration is **frozen at Proteus (v18)** — examined out-of-sample on the
exact production path and no longer tuned. Portfolios with too little history
to calibrate the adaptive threshold fall back to its fixed-threshold
predecessor, Aegis (v14), until they have warmed up.

## 3. What a calculated difference means

After each daily run the engine compares the shield-adjusted theoretical
weights with the holdings you declared. If the difference for a token is
material, you receive a **calculation notice** that states it as a figure:

- **BTC: calculated difference −0.5 BTC ≈ −31,200 USD** — your declared
  holding is above its theoretical weight by roughly this amount.
- **SOL: calculated difference +120 SOL ≈ +18,400 USD** — your declared
  holding is below its theoretical weight by roughly this amount.

The amounts are computed from the prices and the portfolio value at run time.
They describe the **size and sign of a mathematical difference** and nothing
more: they contain no instruction and are not a recommendation. Whether you
do anything about a figure, and how, is entirely your own decision; fees and
slippage are yours to consider.

Notifications are deliberately rare. You only receive a message when:

1. the Deleverage Shield status turns **ACTIVE** (the computed target
   exposure is reduced),
2. the Deleverage Shield status turns back **OFF**,
3. a **macro re-optimisation** freezes new weights (every 180 days),
4. a **material calculated difference** is found,
5. the daily run **fails** — you are told the calculation did not run.

No message on ordinary days means the calculation found nothing material.

## 4. Your data

To personalise the calculation you declare which tokens you hold and in what
amounts. These holdings are stored on our servers tied to the hash of your
activation key, and are used **only** to compute your personal figures. You
can update them any time, and deleting your key deletes your holdings, your
consent records and your notification subscription. Full details are in the
Privacy Policy.

## 5. Notifications

Notifications are delivered through our **own first-party push server** — no
third-party provider sees your figures. You install the free ntfy app, add our
server address and subscribe to your personal topic — no login or password is
required, because the random 32-character topic name itself is your private
address and is read-only. Turning notifications off closes the topic
immediately; the calculations are still computed and logged in the app.

## 6. The honest summary

- AQMath calculates **the mathematical difference between your declared
  holdings and the theoretical model weights**. Nothing more.
- **You** decide what, if anything, to do with it — on your own account.
- Weights are frozen at entry and re-optimised every 180 days; the shield
  recalculates the target exposure daily; both run without your intervention.
- There is **no guarantee**. The shield reduces drawdowns in backtests;
  markets can still lose value, including rapidly.

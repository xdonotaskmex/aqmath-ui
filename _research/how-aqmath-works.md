# How AQMath Works — What the Signals Mean and What You Execute

**Version:** v3
**Audience:** every BLACK user, shown as a must-read before first use
**Status:** 📖 USER GUIDE — the single source of truth for the in-app explainer

---

## 1. What AQMath is (and is not)

AQMath is an **analytical tool that produces trading signals**. It is **not** a
trading bot, it never connects to any exchange, and it never executes a trade.
**You** place every order yourself, on your own exchange account, at your own
discretion. You can ignore any signal at any time — nothing happens without
your manual action.

There is no guarantee of profit, and losses are possible in every market
regime. The numbers AQMath shows come from mathematical risk models validated
in backtests; backtests are simulated history, not a promise about the future.

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

### The daily loop — Deleverage Shield v14 (fast, frozen parameters)

Once per day, after market close, the engine runs the **v14 Deleverage
Shield** over your frozen weights. The shield is a regime modulator: it reads
the drawdown and downside volatility of your basket and continuously scales
your target exposure between fully invested and defensive (more reserve, less
risk). Its parameters are **frozen at v14** — they were validated out-of-sample
and are no longer tuned.

## 3. What a signal means

After each daily run the engine compares the shield-adjusted target weights
with the holdings you declared. If the difference for a token is material, you
receive a signal of the form:

- **SELL 0.5 BTC ≈ 31,200 USD** — your position is above target; the model
  suggests reducing it by roughly this amount.
- **BUY 120 SOL ≈ 18,400 USD** — your position is below target; the model
  suggests adding roughly this amount.

The amounts are computed from the prices and the portfolio value at run time.
They are guidance about **size and direction**, not limit orders: you decide
how and when to execute, and slippage or fees are yours to manage.

Notifications are deliberately rare. You only receive a message when:

1. the Deleverage Shield turns **ACTIVE** (defensive mode engaged),
2. the Deleverage Shield turns back **OFF**,
3. a **macro re-optimisation** freezes new weights (every 180 days),
4. a **material BUY/SELL** rebalance is indicated,
5. the daily run **fails** — you are told the calculation did not run.

No message on ordinary days means the model sees nothing worth changing.

## 4. Your data

To personalise the calculation you declare which tokens you hold and in what
amounts. These holdings are stored on our servers tied to the hash of your
activation key, and are used **only** to compute your personal signals. You
can update them any time, and deleting your key deletes your holdings, your
consent records and your notification subscription. Full details are in the
Privacy Policy.

## 5. Notifications

Notifications are delivered through our **own first-party push server** — no
third-party provider sees your signals. You install the free ntfy app, add our
server address and subscribe to your personal topic — no login or password is
required, because the random 32-character topic name itself is your private
address and is read-only. Turning notifications off closes the topic
immediately; signals are still computed and logged in the app.

## 6. The honest summary

- AQMath tells you **what a disciplined risk model would trade today**.
- **You** trade it — manually, on your own exchange, if you choose to.
- Weights are frozen at entry and re-optimised every 180 days; the shield
  modulates exposure daily; both run without your intervention.
- There is **no guarantee**. The shield cuts drawdowns in backtests; markets
  can still lose value, including rapidly.

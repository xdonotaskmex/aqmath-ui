# Claims vs Code Audit — Baseline

**Last verified:** 2026-08-17  
**Auditor:** Automated cross-reference of all UI/docs claims against backend code

> **Internal doc — not published.** It lives in `_internal/` because Jekyll serves
> anything at the repo root on the public site (verified: `/CLAIMS_AUDIT.md` used to
> return this file verbatim). The `aqmath-ui` repo is public, so this file also
> deliberately records **no private-repo internals**: no formulas that are not already
> on the site, no constant values beyond the ones the UI publishes, and no
> `file.py:line` maps into the private services. Pointers stay at service/module
> level — open the private repo locally for exact values.

---

## Summary

| Priority | Count | Status |
|----------|-------|--------|
| 🔴 Critical (factual errors) | 3 | ✅ Fixed |
| 🟠 Significant (missing disclosure) | 1 | ✅ Fixed (beta chat) |
| 🟡 Precision (nuance missing) | 6 | ✅ Fixed |
| 🟢 Minor (imprecise wording) | 3 | ✅ Fixed |

---

## 🔴 Critical Fixes (Applied)

### 1. "3 market data sources" → "4"
- **Was:** Landing page terminal: "3 market data sources × 180-day history"
- **Now:** "4 market data sources" (CoinGecko, Kraken, Coinbase, MEXC)
- **Code:** the data pipeline service (four collector services feed it)
- **Files:** `_src/index.html:160`, `locales/en.json cleanP`, `locales/zh-CN.json cleanP`

### 2. Cleaning pipeline order
- **Was:** Docs listed "Dedup → Outlier → Gap Interpolation → Multi-Source Merge"
- **Now:** "Dedup → Outlier → **Multi-Source Merge** → **Gap Interpolation**"
- **Code:** the pipeline cleaner (per-symbol cleaning sequence)
- **Files:** `_src/index.html:1892-1893`, `locales/{en,zh-CN}.json clean3/clean4`

### 3. "exit fast · re-enter slow" → symmetric ramp
- **Was:** Backtest flow diagram and docs SVG labeled "exit fast" / "exit fast · re-enter slow"
- **Now:** "symmetric ramp (0.30)" — v14 has `DL_EXIT_SPEED = DL_ENTRY_SPEED = 0.30`
- **Code:** engine shield module (exit and entry speed constants are equal)
- **Files:** `_src/index.html:1179,2204`

---

## 🟠 Beta Chat Disclosure (Applied)

### Problem
Beta chat was fully implemented (backend `/chat` CRUD, UI FAB + panel, 20s polling) but documented nowhere — not in docs, privacy policy, FAQ, or feature list.

### What was added
| Location | Addition |
|----------|----------|
| `docs.html` §9.3 | New "Beta Chat" subsection with full description |
| `docs.html` Backend Receives list | `backend11` — chat messages (stored, deletable) |
| `privacy.html` §9 (DE + EN) | Beta chat clause with GDPR legal basis |
| Landing FAQ | q12/a12 — "What is the beta chat?" |
| Beta features list | `betaF9` — "Shared beta chat — pseudonymous, 20-message rolling buffer" |

### Code reference
- Backend: beta-auth service (`/chat` GET/POST/DELETE, ring buffer, pseudonymous authors)
- UI: `_src/index.html` (chat panel markup), `app.js` (chatFab, polling, unread badge)

---

## 🟡 Precision Fixes (Applied)

### 1. "no hard floor" → 5% buffer context
- **Was:** "There is no hard floor: in a deep, volatile crash exposure can approach zero."
- **Now:** "The formula has no hard floor... A 5% structural buffer (risk budget capped at 95%) ensures a minimum stablecoin allocation always remains."
- **Code:** engine shield config (risk-budget cap — the resulting 5% buffer is published in the docs)

### 2. Black dynamic caps vs DCA flat 20%
- **Was:** "The Black engine replaces the flat cap with volatility-adaptive limits"
- **Now:** Clarified that `/optimize` endpoint uses dynamic caps; DCA engine still uses flat 20% hard cap for all tiers
- **Code:** DCA engine (flat per-token hard cap) + the engine's risk-parity cap helper (dynamic caps)

### 3. "0 bytes persisted" → opt-in caveat
- **Was:** "0 bytes persisted — portfolio processed in-memory"
- **Now:** "0 bytes persisted by default — portfolio processed in-memory (opt-in signal service excepted)"
- **Code:** beta-auth service (`PUT /portfolio` persists holdings — the endpoint the public app calls)

### 4. Architecture diagram — Binance label
- **Was:** "Binance (live prices)" shown as engine external API
- **Now:** "Binance (frontend spot prices)" — engine reads only from DB, no external API calls
- **Code:** engine service — it only reads from the internal price DB, it makes no external API calls

### 5. "OHLC" → "daily close"
- **Was:** "CoinGecko (OHLC history)" / "Data Pipeline (OHLC)"
- **Now:** "CoinGecko (daily close history)" / "Data Pipeline (daily close)"
- **Code:** the pipeline cleaner stores one daily close per bucket (no high/low columns)

### 6. Portfolio vol → covariance-based
- **Was:** "weighted aggregate of each token's individual volatility"
- **Now:** "computed from the covariance matrix of token returns: σ = √(w'Σw)"
- **Code:** the engine's risk-parity module (full covariance matrix; the formula is published in the docs)

---

## 🟢 Minor Fixes (Applied)

### 1. "no tracking" → "privacy-first analytics"
- **Was:** "no cookies · no tracking · simple analytics"
- **Now:** "no cookies · privacy-first analytics (Simple Analytics)"
- **Note:** Simple Analytics IS a form of tracking (privacy-first, but still tracking)

### 2. "live" → "simulated"
- **Was:** "The engine loop, live"
- **Now:** "The engine loop, simulated"
- **Note:** The terminal animation rotates through 5 pre-defined backtest result sets

### 3. "moving average" → "50-day simple average of closes"
- **Was:** "Skips tokens currently trading above their moving average"
- **Now:** "Skips tokens currently trading above their 50-day simple average of closes"
- **Code:** the DCA engine's trend filter compares against an arithmetic mean of closes, not a trading-style SMA

---

## ✅ Verified Correct (No Changes Needed)

| Claim | Where it is implemented (service level — exact constants live in the private repos) |
|-------|---------------|
| 365-day access from activation | beta-auth: key-expiry constant |
| 30-min sliding idle session | beta-auth: session-idle constant |
| 10 beta slots | beta-auth: slot-capacity constant |
| 8% deadband threshold | engine: shield rebalance-threshold constant |
| 40% redeploy threshold | engine: shield redeploy-threshold constant |
| 20% hard cap per token (DCA) | DCA engine: per-token hard cap |
| 60% risk budget (DCA) | DCA engine: total risk budget |
| $20 minimum per token | DCA engine: minimum buy constant |
| $50 small DCA threshold | DCA engine: small-DCA constant |
| 40% max alloc (Black, low-vol) | engine: allocation cap for the lowest-volatility token |
| 6h optimization cooldown | engine: optimization-cooldown constant |
| 30-day volatility window | engine: volatility-window constant |
| 01:00 UTC daily cleaning | data pipeline: scheduler job |
| Shield metrics (23.1% / 55.9% MaxDD, Sharpe 1.63 / 1.37, Calmar 2.00 / 1.23) | engine production-path harness (published figures) |
| Rate limiting 120/60s | engine + beta-auth: rate-limit constants |
| JWT HS256 | beta-auth: token algorithm setting |
| Circuit breaker trips when Shield defensive | DCA engine: circuit-breaker check |
| Trend filter: skip if above 50-day mean | DCA engine: trend filter |
| Safety factor formula | DCA engine: volatility helper (formula intentionally not repeated here — it is not published on the site) |

---

## Files Modified

| File | Changes |
|------|---------|
| `_src/index.html` | 3→4 sources, pipeline reorder, exit fast→symmetric, OHLC→daily close, Binance label, 0 bytes caveat, no tracking→privacy-first, live→simulated, backend11, chat section 9.3, FAQ q12, betaF9 |
| `locales/en.json` | clean3/4 swap, cleanP (4 sources), shield2 (5% buffer), l3P (50-day avg), l5ProP (Black vs DCA caps), pvP (covariance), termTitle (simulated), termB3 (opt-in), backend11, chat keys, q12/a12, betaF9 |
| `locales/zh-CN.json` | Same keys in Chinese |
| `privacy.html` | Beta chat clause in §9 (DE + EN) |

---

## Maintenance Notes

1. **All UI pages are GENERATED** from `_src/index.html` via `tools/build_pages.py`. Never edit `index.html`, `app.html`, `docs.html` directly.
2. **i18n strings** live in `locales/en.json` and `locales/zh-CN.json`. HTML elements use `data-i18n` or `data-i18n-html` attributes.
3. **When changing marketing copy**, cross-reference it against the backend services' own config modules (the private repos), never against memory.
4. **Backtest metrics** — the published headline is the **production-path study** (Proteus v18 vs Buy & Hold): large-cap MaxDD **23.1% vs 55.9%**, Sharpe **1.63 vs 1.37**, Calmar **2.00 vs 1.23**; alt basket MaxDD **29.4% vs 59.8%**, Calmar **1.29 vs 1.23**, Sharpe **1.10 vs 1.18 (a loss — stated on purpose)**. It appears in **more than 3 places**: docs §8.5, docs §8.6, the landing shield section, the hero terminal animation (`app-boot.js`, hardcoded JS strings, *not* i18n keys), the `/backtest` meta description + JSON-LD in `tools/build_pages.py`, and each of those in `en.json` **and** `zh-CN.json` **and** as a baked fallback in `_src/index.html`. Update all of them if the harness is re-run.
   - **Retired 2026-09-08: the continuous 8.7-year replay** (B&H 83.8% MaxDD, shield 35.0%, Sharpe 0.93 vs 0.75, CAGR 32.9%, final $493.8k, 3,184 days over ADA/BNB/ETH/XRP/XLM). Two independent reasons: (a) that frame measures something production never does — production cold-replays a bounded 180-day window daily; (b) **its headline figures no longer reproduce.** The study ran a *retired* v14 preset (not the current default config) and its survivorship harness is broken (the dead-token CSV is not registered in the shared token map, so it raises on import). Do not re-quote those numbers, and do not sweep engine constants to make them reappear.
   - **Two published sub-claims were wrong, not just stale, and are now corrected against us:**
     - *Sealed out-of-sample second half.* The page said the modulator kept "a higher Sharpe (0.48 vs 0.37)". Measured: **0.48 is Buy & Hold's Sharpe and ~0.37–0.38 is the shield's** — the attribution was inverted, and the pair came from the *dead-token* basket while the "~63% → ~24%" MaxDD in the same sentence came from the *survivors* basket. One sentence, two baskets, backwards. On **every** window measured the shield's sealed-half Sharpe is **lower** than Buy & Hold's, which is consistent: the sealed half is 2022–2026, where B&H out-earns the shield. The MaxDD claim does reproduce (**63.2% → 25.3%**) and is kept; the Sharpe is now published the right way round (**0.24 vs 0.30**) with an explicit note that an earlier version had it reversed.
     - *Survivorship stress.* The page said Buy & Hold worsened "by up to ~18 points" when the dead token was added. Measured: **63.2% → 70.7%, i.e. +7.5 points.** The shield's own drawdown did not degrade (24.7% → 20.8%) and it still cut ~50 points versus Buy & Hold on that window, so the *conclusion* survives; the magnitude did not.
   - Both corrections were reproduced by a dedicated harness in the private engine repo (`scratch/`), which mirrors the original study's scoring exactly — same retired preset, same embargo, same intersection alignment — and scores Sharpe from the contribution-free modulated-return series rather than from the DCA-contaminated equity curve. That distinction matters: the two Sharpe definitions disagree by ~0.4 on the same run.
5. **Which engine is live** — ⚠️ **the engine service's shield-profile feature flag is switched on in production, so Proteus (v18) IS the production engine.** It routes BOTH profiles (MAJORS and ALTS) to v18 once a basket has enough return history to calibrate an adaptive threshold; Aegis (v14) runs only as the warm-up fallback below that. The flag is read once at service start, so it takes effect only after a redeploy — if it is ever changed, confirm the deploy is newer than the change. *The flag's name and its exact trigger level live in the private engine repo and are deliberately not recorded here — see `_internal/README.md`.*
   - **Corrected 2026-09-08.** The site had claimed the opposite since 2026-09-02, and the claim lived in **13 places, not the 2 originally recorded here**: `shield.nextgen`, `shield.body`, `doc.s8.nextgen`, `bt.intro`, `bt.enginesNotice`, `rv.enginesNotice`, `rv.genAfter`, `rv.intro1a`, `rv.intro2`, `v18.genAfter`, `v18.intro1`, `v18.snapFoot`, `v18.footTag` — each in `en.json` **and** `zh-CN.json` **and** as a baked fallback in `_src/index.html`, plus the `v18.html` meta description hardcoded in `tools/build_pages.py`. Lesson: an engine-status claim is not "2 places", it is *(keys) × (2 locales + 1 baked fallback) + build metadata*. Grep the locale keys, not the prose.
   - **Not verifiable from outside.** `/optimize` returns an already-frozen plan verbatim for any portfolio that has one, and never runs the shield, so it cannot reveal which engine produced a real user's plan. The daily signal loop does run the flag-gated shield but never records or persists the engine version, and no user-facing endpoint exposes it. The v18 telemetry tab is served by the separate backtesting service and runs v18 regardless of the flag, so it proves nothing about production. **If observability of the live engine ever matters it has to be added inside the private engine repo — the files and lines are deliberately not mapped here.**
   - The v18-vs-v14 numbers quoted on the site (MAJORS MaxDD 25.7%→23.1%, ALTS 36.8%→29.4%, each with a higher Sharpe and Calmar) come from that same production-path harness that note 4 now leads with — since the 2026-09-08 re-scope they are **one study, not two**, and §8.5/§8.6 say so.
   - ⚠️ **OPEN, pre-launch:** the **OOS-182, MC-3000, graveyard and liveness** studies were produced by **v14**. They are labelled as v14's wherever they appear, but have **not** been re-measured on the engine users actually get. The 8.7-year headline is no longer an open item — it was retired and replaced rather than re-measured. Re-running the remaining four on v18 is the outstanding task.
   - The underlying evidence and scripts stay in the private engine repo.
6. **Discipline Meter docs** (§3.3, `doc.s3.discTitle/discP1-3` + nav `doc.nav.discipline`) must match the implementation behind `GET /portfolio/discipline` (12h deadline, 100% within 1h decaying to 0%, confirmed/missed/skipped, rolling last-10, ideal-vs-actual equity on a $10k baseline) and `#disciplineCard` in `_src/index.html` (self-set goal 50–100%, default 80%; reminders opt-in and silent). Any reward tied to the discipline rate is **deliberately not documented** — it is meant to surface only once earned.
   - ⚠️ Known gap: `#disciplineCard` itself is **hardcoded English with no `data-i18n`**, and part of its text is rendered from `app-notify.js`. Translating it needs JS-side i18n, not just attributes. Tracked as a planned task.
7. **Local-only audit failures**: `tools/audit_pages.py` skips the git-ignored Playwright artifact dirs (`playwright-report/`, `test-results/`, `blob-report/`, `_logs/`). They exist on a dev machine but never in a CI checkout, so auditing them only produced false failures.
8. **What is actually public** (verified live on 2026-09-02, after two internal docs turned out to be readable on the branded domain): GitHub Pages runs Jekyll with no `.nojekyll` and no `_config.yml`, so **every path whose segments do not start with `_` is served verbatim on `aqmath.xyz`** — `.md` and `.py` included, in any directory. `README.md`, `tools/*.py` and `tests/*` are therefore public and must stay free of private-repo internals. Everything else lives in `_internal/`. Rules and the allow/deny list: `_internal/README.md`.

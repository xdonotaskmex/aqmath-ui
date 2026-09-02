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
| Shield metrics (35.0% MaxDD, 0.93 Sharpe, 32.9% CAGR) | engine shield module header (published figures) |
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
4. **Backtest metrics** (83.8% MaxDD B&H, 35.0% MaxDD Shield, 0.93 Sharpe, 32.9% CAGR) appear in 3 places: docs §8.5, landing shield section, backtest page. Update all 3 if preset changes.
5. **v18 "next-gen under test" claim** (added 2026-09-02) appears in 2 places: the landing shield section (`shield.nextgen`) and docs §8.6 (`doc.s8.nextgen`). Both quote the *production-path* replay result (rolling 180d window, the same macro loop, persisted shield state): MAJORS MaxDD 25.7%→23.1%, ALTS 36.8%→29.4%, each with a higher Sharpe and Calmar. **v14 is still the deployed engine** — the profile dispatcher sits behind a feature flag that defaults to OFF in the engine config. These are v18-vs-v14 numbers from that one harness; never mix them with the 8.7-year figures in note 4. If v18 goes live or is retired, update/remove both places. The underlying evidence and scripts stay in the private engine repo.
6. **Discipline Meter docs** (§3.3, `doc.s3.discTitle/discP1-3` + nav `doc.nav.discipline`) must match the implementation behind `GET /portfolio/discipline` (12h deadline, 100% within 1h decaying to 0%, confirmed/missed/skipped, rolling last-10, ideal-vs-actual equity on a $10k baseline) and `#disciplineCard` in `_src/index.html` (self-set goal 50–100%, default 80%; reminders opt-in and silent). Any reward tied to the discipline rate is **deliberately not documented** — it is meant to surface only once earned.
   - ⚠️ Known gap: `#disciplineCard` itself is **hardcoded English with no `data-i18n`**, and part of its text is rendered from `app-notify.js`. Translating it needs JS-side i18n, not just attributes. Tracked as a planned task.
7. **Local-only audit failures**: `tools/audit_pages.py` skips the git-ignored Playwright artifact dirs (`playwright-report/`, `test-results/`, `blob-report/`, `_logs/`). They exist on a dev machine but never in a CI checkout, so auditing them only produced false failures.
8. **What is actually public** (verified live on 2026-09-02, after two internal docs turned out to be readable on the branded domain): GitHub Pages runs Jekyll with no `.nojekyll` and no `_config.yml`, so **every path whose segments do not start with `_` is served verbatim on `aqmath.xyz`** — `.md` and `.py` included, in any directory. `README.md`, `tools/*.py` and `tests/*` are therefore public and must stay free of private-repo internals. Everything else lives in `_internal/`. Rules and the allow/deny list: `_internal/README.md`.

# Claims vs Code Audit — Baseline

**Last verified:** 2026-08-17  
**Auditor:** Automated cross-reference of all UI/docs claims against backend code

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
- **Code:** `data-pipeline/main.py` docstring confirms 4 collectors; `mexc-collector/` exists
- **Files:** `_src/index.html:160`, `locales/en.json cleanP`, `locales/zh-CN.json cleanP`

### 2. Cleaning pipeline order
- **Was:** Docs listed "Dedup → Outlier → Gap Interpolation → Multi-Source Merge"
- **Now:** "Dedup → Outlier → **Multi-Source Merge** → **Gap Interpolation**"
- **Code:** `data-pipeline/cleaner.py:494-534` (`clean_symbol` method): dedup → outlier → merge → gap fill
- **Files:** `_src/index.html:1892-1893`, `locales/{en,zh-CN}.json clean3/clean4`

### 3. "exit fast · re-enter slow" → symmetric ramp
- **Was:** Backtest flow diagram and docs SVG labeled "exit fast" / "exit fast · re-enter slow"
- **Now:** "symmetric ramp (0.30)" — v14 has `DL_EXIT_SPEED = DL_ENTRY_SPEED = 0.30`
- **Code:** `aqmath-engine/deleverage.py:77-78`
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
- Backend: `-aqmath-beta-auth/main.py:729-787` (GET/POST/DELETE /chat, ring buffer, pseudonymous authors)
- UI: `_src/index.html:871-892`, `app.js:2411-2480` (chatFab, polling, unread badge)

---

## 🟡 Precision Fixes (Applied)

### 1. "no hard floor" → 5% buffer context
- **Was:** "There is no hard floor: in a deep, volatile crash exposure can approach zero."
- **Now:** "The formula has no hard floor... A 5% structural buffer (risk budget capped at 95%) ensures a minimum stablecoin allocation always remains."
- **Code:** `deleverage.py:81` — `DL_RISK_BUDGET = 0.95`

### 2. Black dynamic caps vs DCA flat 20%
- **Was:** "The Black engine replaces the flat cap with volatility-adaptive limits"
- **Now:** Clarified that `/optimize` endpoint uses dynamic caps; DCA engine still uses flat 20% hard cap for all tiers
- **Code:** `dca-engine/dca.py:219-306` (flat 20% `HARD_CAP_PER_TOKEN`); `aqmath-engine/risk_parity.py:144` (dynamic `calculate_max_target`)

### 3. "0 bytes persisted" → opt-in caveat
- **Was:** "0 bytes persisted — portfolio processed in-memory"
- **Now:** "0 bytes persisted by default — portfolio processed in-memory (opt-in signal service excepted)"
- **Code:** `-aqmath-beta-auth/main.py:619-655` (PUT /portfolio stores holdings)

### 4. Architecture diagram — Binance label
- **Was:** "Binance (live prices)" shown as engine external API
- **Now:** "Binance (frontend spot prices)" — engine reads only from DB, no external API calls
- **Code:** `aqmath-engine/main.py` — engine only reads from internal price DB

### 5. "OHLC" → "daily close"
- **Was:** "CoinGecko (OHLC history)" / "Data Pipeline (OHLC)"
- **Now:** "CoinGecko (daily close history)" / "Data Pipeline (daily close)"
- **Code:** `data-pipeline/cleaner.py:484-486` — `open_price = median_entry["price"]`, high/low are NULL

### 6. Portfolio vol → covariance-based
- **Was:** "weighted aggregate of each token's individual volatility"
- **Now:** "computed from the covariance matrix of token returns: σ = √(w'Σw)"
- **Code:** `aqmath-engine/risk_parity.py` — uses full covariance matrix Σ

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
- **Code:** `dca-engine/volatility.py:45-56` — `is_above_average()` uses arithmetic mean, not SMA in the trading sense

---

## ✅ Verified Correct (No Changes Needed)

| Claim | Code Reference |
|-------|---------------|
| 365-day access from activation | `TOKEN_EXPIRY_DAYS = 365` in `-aqmath-beta-auth/main.py:62` |
| 30-min sliding idle session | `SESSION_IDLE_MINUTES = 30` in `-aqmath-beta-auth/main.py:78` |
| 10 beta slots | `BETA_SLOTS_TOTAL = 10` in `-aqmath-beta-auth/main.py:72` |
| 8% deadband threshold | `DL_REBAL_THRESH = 0.08` in `deleverage.py:79` |
| 40% redeploy threshold | `DL_REDEPLOY_THRESH = 0.40` in `deleverage.py:80` |
| 20% hard cap per token (DCA) | `HARD_CAP_PER_TOKEN = 0.20` in `dca-engine/config.py:16` |
| 60% risk budget (DCA) | `RISK_BUDGET_TOTAL = 0.60` in `dca-engine/config.py:17` |
| $20 minimum per token | `MIN_TOKEN_BUY = 20` in `dca-engine/config.py:13` |
| $50 small DCA threshold | `SMALL_DCA_THRESHOLD = 50.0` in `dca-engine/config.py:12` |
| 40% max alloc (Black, low-vol) | `MAX_ALLOC_CAP = 40.0` in `aqmath-engine/config.py:31` |
| 6h optimization cooldown | `OPTIMIZATION_COOLDOWN = 21600` in `aqmath-engine/config.py:35` |
| 30-day volatility window | `VOLATILITY_DAYS = 30` in `aqmath-engine/config.py:35` |
| 01:00 UTC daily cleaning | `scheduler.add_job(..., hour=1, minute=0)` in `data-pipeline/main.py:137` |
| Shield metrics (35.0% MaxDD, 0.93 Sharpe, 32.9% CAGR) | Match `deleverage.py` header comments |
| Rate limiting 120/60s | `RATE_LIMIT_MAX = 120`, `RATE_LIMIT_WINDOW = 60` in engine + beta-auth |
| JWT HS256 | `JWT_ALGORITHM = "HS256"` in beta-auth |
| Circuit breaker trips when Shield defensive | `check_circuit_breaker()` in `dca.py:198-216` |
| Trend filter: skip if above 50-day mean | `is_above_average(prices, 50)` in `dca.py:539-542` |
| Safety factor formula | `max(0.2, 1.0 - (vol * 5.0))` in `volatility.py:59-68` |

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
3. **When changing marketing copy**, cross-reference against backend code constants (config.py files, deleverage.py thresholds, dca.py limits).
4. **Backtest metrics** (83.8% MaxDD B&H, 35.0% MaxDD Shield, 0.93 Sharpe, 32.9% CAGR) appear in 3 places: docs §8.5, landing shield section, backtest page. Update all 3 if preset changes.

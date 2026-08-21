# AQMath Project Status — Master Reference for AI Agents

**Last updated:** 2026-08-21
**Purpose:** single-file state of the entire AQMath system — what is done, what
is in progress, and what remains. An AI agent reading this file should NOT need
to scan the full workspace to understand current priorities.

---

## 1. System Architecture (10 services)

```
                          ┌─────────────────┐
                          │   aqmath-ui     │  GitHub Pages (aqmath.xyz)
                          │  static HTML/JS │  ← Caddy on Railway (backup)
                          └────────┬────────┘
                                   │ fetch
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
   │ -aqmath-beta-auth│ │  aqmath-engine   │ │     dca-engine       │
   │  auth + portfolio│ │  ERC/KKT/Shield  │ │  DCA + Binance proxy │
   │  :8000 / :443    │ │  :8005 / :443    │ │  :8006 / :443        │
   └────────┬─────────┘ └────────┬─────────┘ └──────────┬───────────┘
            │                    │                       │
            │             ┌──────┴──────┐                │
            │             ▼             │                ▼
            │   ┌──────────────┐  ┌────┴────────────────────┐
            │   │ data-pipeline│  │    backtesting-          │
            │   │  cleaner+DB  │  │  paper trading v14/15/16/17│
            │   │  :8004       │  │  :8005 (separate svc)    │
            │   └──────┬───────┘  └──────────────────────────┘
            │          │
     ┌──────┴──────────────────────────────┐
     │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
     │  │coingecko │ │ kraken   │ │ coinbase │ │  mexc    │
     │  │:8001     │ │ :8002    │ │ :8003    │ │ :8005    │
     │  └──────────┘ └──────────┘ └──────────┘ └──────────┘
     │        collectors (cron → data-pipeline)
     └───────────────────────────────────────┘
```

All backend services: FastAPI (Python), PostgreSQL, deployed on Railway.
Frontend: static HTML/CSS/JS, deployed on GitHub Pages + Cloudflare WAF.

### Production URLs (behind Cloudflare)
| Service | URL |
|---------|-----|
| Frontend | `https://aqmath.xyz` |
| Beta Auth | `https://api-auth.aqmath.xyz` |
| Engine | `https://api-engine.aqmath.xyz` |
| DCA Engine | `https://api-dca.aqmath.xyz` |
| Paper Trading | `https://api-backtest.aqmath.xyz` |

---

## 2. Feature Status Matrix

### ✅ DONE (production live)

| Feature | Services | Date | Notes |
|---------|----------|------|-------|
| Risk Parity ERC+KKT optimization | engine | 2025-Q4 | 180d lookback, per-token caps, 60/40 risky/stable |
| Deleverage Shield v14 | engine | 2026-03 | Continuous regime modulator, threshold rebalancing |
| DCA distribution with 6-layer defense | dca-engine | 2025-Q4 | Circuit breaker, safety factor, trend filter, hard cap |
| Data cleaning pipeline | data-pipeline | 2025-Q4 | 4-source merge, outlier removal, gap fill |
| 4 collectors (CoinGecko/Kraken/Coinbase/MEXC) | collectors | 2026-01 | Daily cron, anti-detection, YTD bulk |
| Beta key auth (JWT, IP binding, sessions) | beta-auth | 2026-02 | 10 slots, 365d access, hash-only storage |
| Portfolio sync + frozen KKT weights | beta-auth + engine | 2026-03 | KKT-once freeze, macro re-opt 180d |
| Daily signal cron (per-user) | engine portfolio_service | 2026-04 | 01:00 UTC, ntfy notifications |
| ntfy push notifications | engine + beta-auth | 2026-04 | First-party ntfy server, private topics |
| Backtest UI (full + walk-forward) | ui + engine | 2025-Q4 | Fee model, emergency brake annotations |
| Paper trading v14 forward log | backtesting- | 2026-06 | Dual-speed engine, daily 01:30 UTC |
| Paper trading v15 CORR experiment | backtesting- | 2026-08-05 | Corr-regime exposure, parallel to v14 |
| Paper trading v16 trough-tranche | backtesting- | 2026-08-12 | Episode state machine, tranched re-entry |
| Cloudflare WAF + DDoS protection | ops | 2026-07-29 | Free tier, managed rules, bot fight |
| Railway CI/CD + one-click rollback | all repos | 2026-07-29 | GraphQL API deploy, smoke tests |
| SEO overhaul | ui | 2026-08-17 | IndexNow, JSON-LD, meta descriptions, sitemap |
| Claims vs code audit | ui | 2026-08-17 | 13 fixes applied (3 critical, 6 precision, 3 minor) |
| Holdings table visual cleanup | ui | 2026-08-17 | Grouped columns, sticky Token, dimmed secondary |
| Auto portfolio history chart | ui | 2026-08-17 | 90d Binance fetch on portfolio change |
| Pro modal layout fix | ui | 2026-08-17 | Links nowrap, reduced padding |
| Beta chat (20-msg ring buffer) | beta-auth + ui | 2026-08 | Pseudonymous, 200 char limit, daily sweep |
| One-Tap Alignment (signal card) | ui + engine | 2026-08 | Confirm/skip/adjust signals, exec time prompt |
| Execution-time prompt modal | ui | 2026-08 | Brand-styled overlay, quick presets + custom datetime |
| Shield status hidden classes | ui | 2026-08 | `.signal-card.hidden`, `.signal-actions.hidden` |
| v17 Circuit Breaker C4 (server-side) | engine scratch | 2026-08 | Single-day -8% → 15% floor, 5d cooldown |
| Recovery test (Test 4) | engine scratch | 2026-08-18 | 1/4 gates pass (v14), 2/4 (v17) |
| Discipline & Execution Validation Module | all 3 repos | 2026-08-21 | 12h expiry, discipline meter, ideal/actual equity, admin telemetry |
| Entry/APY wipe bug fix (2nd occurrence) | engine | 2026-08-21 | apply-all endpoint now carries entry/APY through |

### 🔄 IN PROGRESS

| Feature | Status | Next Step |
|---------|--------|-----------|
| Execution timestamp recording | UI overlay done, `_promptExecutionTime()` implemented | Server-side `/portfolio/signals/exec-time` POST endpoint needed |

### 🔴 NOT STARTED (planned)

| Feature | Priority | Est. Effort | Blocker |
|---------|----------|-------------|---------|
| Crown Test 3 — Liquidity execution | ⭐⭐⭐⭐ | 2-3 days | MEXC data + slippage model |
| Crown Test 5 — Strategy benchmark | ⭐⭐⭐⭐⭐ | 3-4 days | 5 competitor strategies to implement |
| Caching Plan (3-layer TTL) | Medium | 3 days | Draft approved, implementation pending |
| Staging environment | Low | 1 day | Decision: duplicate Railway cost |
| v17 UI/telemetry integration | Medium | 2 days | Server-side only currently |
| Playwright E2E tests (expanded) | Medium | 2 days | Only 5 visual snapshot tests exist |

---

## 3. Test Status — 5 Crown Tests

| # | Test | Status | Result | Published |
|---|------|--------|--------|-----------|
| 1 | Human Factor (DCA jitter) | ✅ DONE | 5/5 PASS | `/research/dca-stress` |
| 2 | Static vs Dynamic (60/40) | ✅ DONE | 2/4 (MaxDD+Calmar pass, Sharpe+equity fail) | `/research/static-vs-dynamic` |
| 3 | Liquidity Execution | 🔴 NOT STARTED | — | — |
| 4 | Post-Shield Recovery | ✅ DONE | 1/4 v14, 2/4 v17 (re-entry fast, participation low) | `/research/recovery-test` |
| 5 | Strategy Benchmark | 🔴 NOT STARTED | — | — |

### Unit Tests (CI)

| Repo | Test File(s) | CI Gate |
|------|-------------|---------|
| dca-engine | `test_min_token_buy.py` (8 tests) | `python test_min_token_buy.py` |
| data-pipeline | `test_deleverage.py`, `test_ttlcache.py` | Smoke import only (CSV dep) |
| aqmath-engine | `test_portfolio_service.py` (870 lines), `test_ttlcache.py` | Smoke import |
| aqmath-ui | `tests/visual.spec.cjs` (5 pages) | `stamp_version --check` + `audit_pages.py` |
| backtesting- | N/A | Smoke import + credential scan |
| beta-auth | N/A | Smoke import (fail-fast env) |
| collectors | N/A | Smoke import |

---

## 4. Build Pipeline (aqmath-ui)

**CRITICAL ORDER** — skipping a step causes CI failures:

```
1. python tools/minify_css.py       # styles.css → styles.min.css
2. python tools/stamp_version.py    # stamps version.txt + all HTML/JS with git SHA
3. python tools/build_pages.py      # _src/index.html → 5 entry pages (stamp required)
4. python tools/build_research.py   # _research/*.md → research/*.html
```

Verify: `python tools/stamp_version.py --check` (exit 0 = all stamps match)
Audit: `python tools/audit_pages.py` (checks all generated pages)

---

## 5. Recent Changes (2026-08-17 to 2026-08-20)

### UI Visual Cleanup (commit c28f7be)
- Holdings table: removed Target% column (14 cols), grouped headers (VALUATION | ALLOCATION | PERFORMANCE | ACTIONS)
- Sticky Token column on horizontal scroll
- Dimmed secondary columns (APY%, Yield Gap, Average) at 60% opacity
- Table padding so tokens aren't touching card border
- History chart: 200px → 280px, layout padding, summary stats pills
- Auto-populate history from Binance on portfolio change (debounced 2.5s, 30s cooldown)
- Pro modal: fixed links wrapping (reduced padding, smaller font, nowrap flex)

### Discipline & Execution Validation Module (2026-08-21)
- 12h signal expiry: `signal_price`, `notified_at`, `expires_at` columns on `signal_confirmations`
- Lazy expiry: `_expire_stale_signals()` on every signal API call, `_expire_all_stale()` admin sweep
- Discipline rate: confirmed/(confirmed+missed+skipped), ≥80% = 10% renewal discount
- `signal_discipline_snapshots` table: daily snapshots via `_update_discipline_snapshot()`
- `GET /portfolio/discipline` — per-user discipline rate
- `GET /portfolio/discipline/history` — ideal vs actual equity curves (PnL model)
- `GET /admin/discipline` — per-user discipline rates (X-Admin-Secret guarded)
- `POST /admin/discipline/apply-discount` — renewal discount recording
- UI: countdown timer on signal cards, discipline meter card (double-width)
- UI: ideal/actual equity overlay on history chart
- Beta-auth: key expiry tracking (`expires_at`, `days_until_renewal`), `expiring_soon` count
- Bug fix: `apply-all` endpoint now carries entry/APY (same pattern as `_apply_signal_delta`)

### One-Tap Alignment (completed)

### SEO (commit d827c50 + a98634d)
- Caddyfile: 404 block for non-existent paths
- Redirect chain fix (canonical URLs)
- Per-page JSON-LD structured data
- Meta descriptions on all pages
- Title shortening
- Orphan page fix
- Sitemap update (all lastmod → 2026-08-17)
- IndexNow key file + bulk URL submission (200 OK)

### Stamp Version Fix (commit 604b4e7)
- Full rebuild pipeline run (minify → stamp → build → research)
- All 38 files now have correct asset stamp `v=8c56f56cc9`

---

## 6. Key File Map (where to find things)

### Frontend (aqmath-ui)
| What | File |
|------|------|
| Landing/App template | `_src/index.html` (source for build_pages.py) |
| Main app logic | `app.js` (holdings table, DCA, optimize, chart) |
| Signal/notify UI | `app-notify.js` (shield card, one-tap signals, ntfy) |
| Backtest logic | `app-backtest.js` |
| Widget (Binance ticker) | `app-widgets.js` |
| Boot (auth, update banner) | `app-boot.js` |
| Styles (source) | `styles.css` → `styles.min.css` (generated) |
| i18n | `locales/en.json`, `locales/zh-CN.json` |
| Build tools | `tools/*.py` (minify, stamp, build, audit) |
| Playwright tests | `tests/visual.spec.cjs` |
| Ops docs | `ops/` (Cloudflare, Railway, environments, DDoS runbook) |
| Research source | `_research/*.md` → `research/*.html` |

### Engine (aqmath-engine)
| What | File |
|------|------|
| FastAPI app + optimize | `main.py` |
| Deleverage Shield v14 | `deleverage.py` |
| Portfolio service (cron) | `portfolio_service.py` |
| Backtest + walk-forward | `backtest.py` |
| Price/cooldown management | `quantum_engine.py` |
| Risk parity helpers | `risk_parity.py` |
| Config (all constants) | `config.py` |
| Tests | `test_portfolio_service.py`, `test_ttlcache.py` |
| Stress test results | `SHIELD_STRESS_TESTS.md` |
| Research scripts | `scratch/` |

### DCA Engine (dca-engine)
| What | File |
|------|------|
| FastAPI app + Binance proxy | `main.py` |
| DCA distribution logic | `dca.py` |
| Volatility/trend helpers | `volatility.py` (note: also exists in engine) |
| Config | `config.py` |
| Tests | `test_min_token_buy.py`, `test_ttlcache.py` |

### Beta Auth (-aqmath-beta-auth)
| What | File |
|------|------|
| FastAPI app + auth | `main.py` |
| DB layer (activations, holdings, consent, chat) | `db.py` |
| Load test | `loadtest.py` |

### Paper Trading (backtesting-)
| What | File |
|------|------|
| v14 main forward log | `paper_trading.py` |
| v15 CORR experiment | `paper_trading_v15.py` |
| v16 trough-tranche | `paper_trading_v16.py` |
| v17 circuit breaker | `paper_trading_v17.py` |
| HTML fragment builders | `forward_section.py`, `forward_section_v15.py`, `forward_section_v16.py` |
| Seed states | `paper_trading_seed*.json` |

---

## 7. Environment & Ports

| Service | Local Port | Production Port | Railway Service Name |
|---------|-----------|-----------------|---------------------|
| beta-auth | 8000 | 443 (via CF) | api-auth |
| data-pipeline | 8004 | 443 (via CF) | data-pipeline |
| aqmath-engine | 8005 | 443 (via CF) | api-engine |
| dca-engine | 8006 | 443 (via CF) | api-dca |
| backtesting- | 8005 (separate) | 443 (via CF) | api-backtest |
| coingecko-collector | 8001 | — | coingecko-collector |
| kraken-collector | 8002 | — | kraken-collector |
| coinbase-collector | 8003 | — | coinbase-collector |
| mexc-collector | 8005 | — | mexc-collector |
| aqmath-ui (local) | 8090 | GitHub Pages | — |

---

## 8. Git Workflow

- All repos: push to `main` triggers CI
- CI: smoke tests → deploy via Railway GraphQL API
- Rollback: GitHub Actions → One-Click Rollback workflow
- Git binary: `C:\Users\user\AppData\Local\GitHubDesktop\app-3.5.12\resources\app\git\cmd\git.exe`
- PowerShell: use `;` not `&&`

---

## 9. Collector Cron Schedule (UTC)

| Time | Collector |
|------|-----------|
| 00:05 | CoinGecko |
| 00:10 | Kraken |
| 00:15 | Coinbase |
| 00:20 | MEXC |
| 01:00 | data-pipeline cleaning |
| 01:30 | backtesting- daily loop |
| (engine portfolio cron, configurable, default 00:45) |

---

## 10. Documentation Inventory

### Per-Repo READMEs
| Repo | Status | Last Updated |
|------|--------|-------------|
| aqmath-ui/README.md | ✅ Current | 2026-08-20 |
| aqmath-engine/README.md | ✅ Current | 2026-08-20 |
| dca-engine/README.md | ✅ Current | 2026-08-20 |
| data-pipeline/README.md | ✅ Current | 2026-08-20 |
| -aqmath-beta-auth/README.md | ✅ Current | 2026-08-20 |
| backtesting-/README.md | ✅ Current | 2026-08-20 |
| mexc-collector/README.md | ✅ Current | 2026-08-20 |
| kraken-collector/README.md | ✅ Current | 2026-08-20 |
| coingecko-collector/README.md | ✅ Current | 2026-08-20 |
| coinbase-collector/README.md | ✅ Current | 2026-08-20 |

### Research / Test Docs
| File | Topic | Status |
|------|-------|--------|
| aqmath-engine/SHIELD_STRESS_TESTS.md | 5 crown tests plan + results | ✅ Updated 2026-08-20 |
| aqmath-engine/CHANGELOG_AUDIT.md | v10.6 changelog + v15/v16 forward tests | ✅ Current |
| aqmath-engine/CACHING_PLAN.md | 3-layer TTL cache plan | 📋 DRAFT (approved, not implemented) |
| aqmath-engine/E2E_TIAQ_RESULTS.md | E2E TIAQ results | ✅ Current |
| aqmath-engine/OOS_V14_NEW_TOKENS_RESULTS.md | Out-of-sample v14 | ✅ Current |
| aqmath-engine/DELEVERAGE_V105_TEST_RESULTS.md | Deleverage v1.05 tests | ✅ Current |
| aqmath-ui/CLAIMS_AUDIT.md | Claims vs code verification | ✅ Updated 2026-08-17 |
| aqmath-ui/ONE_TAP_SIGNAL.md | One-Tap Alignment + Discipline Module | ✅ Updated 2026-08-21 |
| aqmath-ui/PRIORITIES.md | Dev priorities (P0-P3) | ✅ Created 2026-08-20 |
| aqmath-ui/MARKETING.md | Marketing plan (Substack/Twitter/Reddit) | ✅ Created 2026-08-20 |
| aqmath-ui/COMMIT_WORKFLOW.md | Commit rules, CI checks, security gates | ✅ Created 2026-08-20 |
| aqmath-ui/BUG_PNL_ENTRY_WIPE.md | P&L/entry-price wipe bug + fix (2 occurrences) | ✅ Updated 2026-08-21 |
| aqmath-ui/_research/recovery-test.md | Crown Test 4 results | ✅ 2026-08-18 |
| aqmath-ui/_research/static-vs-dynamic.md | Crown Test 2 results | ✅ 2026-08-12 |
| aqmath-ui/_research/dca-stress.md | Crown Test 1 results | ✅ Current |
| aqmath-ui/_research/how-aqmath-works.md | User guide (must-read) | ✅ Current |
| aqmath-ui/ops/CLOUDFLARE_SETUP.md | CF WAF setup guide | ✅ Current |
| aqmath-ui/ops/RAILWAY_CI_SETUP.md | CI/CD setup guide | ✅ Current |
| aqmath-ui/ops/ENVIRONMENTS.md | Dev vs prod matrix | ✅ Current |
| aqmath-ui/ops/RUNBOOK_DDOS.md | DDoS incident runbook | ✅ Current |

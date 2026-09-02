# AQMath Project Status — Master Reference for AI Agents

**Last updated:** 2026-09-02
**Purpose:** single-file state of the entire AQMath system — what is done, what
is in progress, and what remains. An AI agent reading this file should NOT need
to scan the full workspace to understand current priorities.

> **Internal doc — not published.** Kept in `_internal/` because Jekyll serves
> everything at the repo root on the public site (verified: this file used to be
> readable at `aqmath.xyz/PROJECT_STATUS.md`), and this repo is public while the
> service repos are private. So this file records **what exists, what was decided
> and where to look**, but deliberately NOT: unpublished formulas or constant
> values, the internal mechanics of unreleased shield engines, database schema,
> admin endpoints, module-level file maps of the private services, or unpublished
> business rules. Section 6 maps *this* repo file by file (it is public anyway)
> and the private services at responsibility level only. For exact numbers or
> module names, open the private service repo locally.

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
            │   │  cleaner+DB  │  │  paper trading logs      │
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
| Daily signal run (per-user) | engine | 2026-04 | Daily after the UTC close, ntfy notifications |
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
| Circuit-breaker experiment (server-side only) | engine scratch | 2026-08 | Unreleased — trigger levels deliberately not written down here |
| Recovery test (Test 4) | engine scratch | 2026-08 | Published on `/research/recovery-test`; the unreleased variant's edge stays private |
| Discipline & Execution Validation Module | all 3 repos | 2026-08-21 | 12h expiry, discipline meter, ideal/actual equity, operator telemetry |
| Entry/APY wipe bug fix (2nd occurrence) | engine | 2026-08-21 | apply-all endpoint now carries entry/APY through |
| Deleverage Shield profile dispatcher | engine | 2026-09-02 | Routes a basket profile to the validated shield engine; short-history fallback to v14 |
| Shield engine validation (walk-forward + production path) | engine | 2026-09-02 | v18 beats v14 on both profiles through the exact `/optimize` path |
| Production wiring behind a feature flag | engine | 2026-09-02 | Flag defaults OFF — deploy is behaviour-neutral, 77/77 tests pass |
| Landing/docs refresh + animated SVG | ui | 2026-09-02 | v18 "next-gen under test" note (EN+zh), docs §3.3 Discipline Meter, CSS draw-in/pulse |
| Internal docs moved off the public surface | ui | 2026-09-02 | 7 root `.md` files → `_internal/` + IP scrub (see §5) |

### 🔄 IN PROGRESS

| Feature | Status | Next Step |
|---------|--------|-----------|
| Execution timestamp recording | UI overlay done, `_promptExecutionTime()` implemented | Server-side `/portfolio/signals/exec-time` POST endpoint needed |

### 🔴 NOT STARTED (planned)

| Feature | Priority | Est. Effort | Blocker |
|---------|----------|-------------|---------|
| v18 live cutover (enable the validated shield in production) | ⭐⭐⭐⭐ | 0.5 day + soak | Needs forward-test evidence: v18 is backtest-validated only, not paper-traded live |
| v18 paper-trading forward section | ⭐⭐⭐⭐ | 1-2 days | The paper-trading service has no v18 forward loop yet |
| Discipline Meter i18n (in-app card) | Medium | 0.5 day | Card strings are hardcoded EN, some rendered from `app-notify.js` — needs JS-side i18n, not just `data-i18n` |
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
| 4 | Post-Shield Recovery | ✅ DONE | 1/4 v14, 2/4 for the unreleased variant (re-entry fast, participation low) | `/research/recovery-test` |
| 5 | Strategy Benchmark | 🔴 NOT STARTED | — | — |

### Unit Tests (CI)

| Repo | CI Gate |
|------|---------|
| dca-engine | 8 unit tests run in CI |
| data-pipeline | Smoke import only (CSV dep); unit tests exist but are not gated |
| aqmath-engine | Smoke import; the large portfolio-service suite runs locally |
| aqmath-ui | `stamp_version --check` + `audit_pages.py` + 3 secret scans; Playwright visual specs (5 pages) run locally |
| backtesting- | Smoke import + credential scan |
| beta-auth | Smoke import (fail-fast env) |
| collectors | Smoke import |

Test file names and counts per private repo live in those repos — not here.

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

## 5. Recent Changes (2026-08-17 to 2026-09-02)

### Deleverage Shield profiles → v18 (2026-09-02)
- Question: should the two basket profiles (large-cap majors vs altcoins) run different shield engines instead of the universal v14?
- Method: rolling walk-forward on the **production macro loop only** (never equal-weight), flow-adjusted returns, and identical DCA settings across every engine compared
- One comparison bug was found and fixed on the way: the first harness let the older engines inherit a different DCA schedule than v18, which made the first ranking meaningless
- The full-history ranking (one engine for majors, v18 for alts) was then **overturned** by re-validating through the *exact production path* — a bounded rolling window, cold replay, persisted shield state, realistic turnover. The candidate that won on continuous history is the worst shield on the bounded window, because its signal needs longer history than production supplies
- Final decision: **both profiles → v18**, which beat v14 on drawdown, Sharpe and Calmar on both baskets. Its internal adaptivity is what the two-engine split was meant to achieve
- Wiring: the dispatcher is a signature-identical drop-in for the existing shield entry point, selected at all three call sites behind a feature flag that **defaults OFF**, so production still runs the frozen v14
- Evidence, scripts and exact numbers stay in the private engine repo (scratch harnesses + result JSONs); only the published v18-vs-v14 drawdown figures appear on the site

### UI refresh (2026-09-02)
- Landing shield section: amber "NEXT-GEN UNDER TEST" note for v18 (results only — no formulas/constants, IP-safe), reusing the existing `.rv-v15-notice`/`.rv-v15-tag` styling
- Docs §3.3 **Discipline Meter** (new) + sidebar nav entry: human-in-the-loop, 12h deadline with 1h→100% decay, confirmed/missed/skipped, rolling last-10, ideal-vs-actual equity on a $10k baseline, self-set 50–100% goal, opt-in silent reminders. Any reward tied to the rate stays undocumented on purpose
- Docs §8.6: v18 production-path validation note (same numbers as the landing, both EN + zh-CN)
- Animated SVG, pure CSS so `build_pages.py`'s div-depth stripper stays safe: `pathLength="1"` + `lp-sh-draw` draws both drawdown charts in (landing + docs §8.5), `lp-hero-pulse` breathes the 5 hero token rings; everything gated on `prefers-reduced-motion: no-preference`
- `tools/audit_pages.py`: `SKIP_DIRS` now excludes the git-ignored Playwright artifact dirs, which made every local audit run fail on files CI never sees
- Pipeline re-run in order (minify → stamp → build): all pages pinned to `v=5971a29949`; `stamp --check`, `build_pages --check`, `check_i18n` (589 keys in parity), `audit_pages` and the 3 CI secret scans all green

### Internal docs moved off the public surface (2026-09-02)
- Found while checking the deploy impact of the docs work: GitHub Pages runs Jekyll with **no `.nojekyll` and no `_config.yml`**, so every root-level file was served verbatim on the branded domain. `https://aqmath.xyz/CLAIMS_AUDIT.md` and `/PROJECT_STATUS.md` both returned full contents (verified with a live fetch); `/_logs/…` returned 404, which is what proved underscore dirs are excluded
- This repo is public while all seven service repos are private, so those files were publishing private internals: unreleased engine constants, the safety-factor formula, database schema, operator endpoints and an unpublished business rule
- Fix, two layers: (1) `git mv` the 7 internal docs into `_internal/` — `README.md` is now the only Markdown file at the root; (2) scrub them, because `_internal/` hides a file from the **website**, not from GitHub
- Scrub rule now written into `_internal/README.md`: service names and already-published numbers stay; private file paths, private function names, schema, operator endpoints, unpublished constants/formulas, unreleased engine versions and unpublished business rules go
- `app-notify.js` keeps a stale comment naming one of the moved docs — left alone on purpose, editing an asset would have re-stamped and re-cache-busted every page for a comment
- `tools/audit_pages.py`: `_internal` added to `SKIP_DIRS`; `README.md` gained the root-file warning and corrected the `npm run build`/`verify` descriptions (they never included `build_research.py`/`audit_pages.py`)

### Published-surface audit — second, worse finding (2026-09-02)
- The underscore rule is not limited to directories: Jekyll excludes **any path segment starting with `_`**, which means every *other* directory in the repo was published too. Verified live with HTTP status codes: `/ops/CLOUDFLARE_SETUP.md`, `/ops/ENVIRONMENTS.md`, `/tools/refresh_forward_log.py`, `/tools/recover_portfolio.py`, `/tools/error-dashboard.html` and `/tests/static-server.cjs` all returned **200** on `aqmath.xyz`
- `_internal/ops/CLOUDFLARE_SETUP.md` was the worst: it published the four **Railway origin hostnames** (`*.up.railway.app`), the Cloudflare custom-rule expressions, the two operator endpoint paths, and an explicit note that the origins were still publicly reachable — i.e. a ready-made WAF-bypass guide, on the branded domain
- `_internal/ops/ENVIRONMENTS.md` published the whole per-service environment-variable inventory (which secret each service needs, which are shared, and the rate-limit constants); `tools/error-dashboard.html` published the operator console and the internal telemetry paths it calls
- Fixed: `git mv ops _internal/ops` and `git mv tools/{error-dashboard.html,recover_portfolio.py} _internal/tools/`; then scrubbed all four ops docs to *procedure only* (no hostnames, no rule expressions, no thresholds, no env inventory) and repointed `recover_portfolio.py` from the origin URL to the public `api-engine.aqmath.xyz`
- Re-scanned the remaining published surface for `up.railway.app`, `/admin/`, `/internal/`, `X-Admin`, `ADMIN_SECRET`, `ADMIN_KEY` → the only hits left are the CI grep *patterns* in `ci.yml` (intentionally public) and `/internal/error-report` in `app.js` (the browser calls it, so it must be public)
- 🔴 **Still open, needs the Railway dashboard (cannot be fixed from this repo):** the `*.up.railway.app` public domains on the four API services are active, so the Cloudflare WAF can be bypassed by calling the origin directly. Close it per service (Settings → Networking → remove the public domain, or restrict to Cloudflare IP ranges), then confirm `api-*.aqmath.xyz` still works and the origin no longer answers. The hostnames were also in this repo's git history — assume they are known
- `tools/*.py` stays published on purpose: CI and the npm scripts invoke `python tools/<name>.py`. They must contain build logic only

### UI Visual Cleanup (commit c28f7be)
- Holdings table: removed Target% column (14 cols), grouped headers (VALUATION | ALLOCATION | PERFORMANCE | ACTIONS)
- Sticky Token column on horizontal scroll
- Dimmed secondary columns (APY%, Yield Gap, Average) at 60% opacity
- Table padding so tokens aren't touching card border
- History chart: 200px → 280px, layout padding, summary stats pills
- Auto-populate history from Binance on portfolio change (debounced 2.5s, 30s cooldown)
- Pro modal: fixed links wrapping (reduced padding, smaller font, nowrap flex)

### Discipline & Execution Validation Module (2026-08-21)
- Signals now expire: each carries its signal price, notification time and a 12h deadline; stale signals are resolved lazily on every signal API call plus a server-side sweep
- Discipline rate = confirmed / (confirmed + missed + skipped), with daily snapshots kept for the history view
- User-facing endpoints: per-user discipline rate, and ideal-vs-actual equity curves (the "what hesitation cost" model)
- Operator-side reporting and the renewal incentive exist too — endpoints, schema and the incentive rule are **deliberately not written down here** (this repo is public); see the private beta-auth service
- UI: countdown timer on signal cards, discipline meter card, ideal/actual equity overlay on the history chart
- Beta-auth: key expiry tracking and an "expiring soon" count
- Bug fix: the apply-all endpoint now carries entry/APY through (same pattern as the single-signal delta apply)

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

### Frontend (aqmath-ui — this repo, public)
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
| Ops docs | `_internal/ops/` (Cloudflare, Railway, environments, DDoS runbook) |
| Operator tooling | `_internal/tools/` (error dashboard, portfolio recovery script) |
| Research source | `_research/*.md` → `research/*.html` |
| Internal docs | `_internal/*.md` (this directory) |

### Backend services (all private)

| Service | Owns |
|---------|------|
| aqmath-engine | Optimization API (risk parity + constraints), the Deleverage Shield, the daily per-user signal run, backtesting and walk-forward harnesses, research scripts |
| dca-engine | DCA distribution logic, volatility/trend helpers, the Binance price proxy |
| -aqmath-beta-auth | Beta key activation, JWT sessions, portfolio storage, consent, beta chat |
| backtesting- | Paper-trading forward logs (one loop per shield generation) and their HTML fragments |
| data-pipeline | Multi-source price merge, cleaning, gap fill, the analytical price DB |
| collectors | Raw price ingestion from each exchange feed |

**Module-level file maps for these services are deliberately not written here.**
They are a map of the private codebases and this repo is public; anyone working
on a service has it checked out locally, where its own README and file layout are
the authoritative source.

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
- Git: GitHub Desktop's bundled git (not on PATH by default) — the absolute path
  is machine-specific and intentionally not recorded here
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
Every repo (this one plus the nine private service repos) has a `README.md` kept
current; they are the authoritative source for each service's own layout.

### Research / Test Docs
| File | Topic | Status |
|------|-------|--------|
| aqmath-ui/_internal/README.md | Why `_internal/` exists + what may be written here | ✅ Created 2026-09-02 |
| aqmath-ui/_internal/CLAIMS_AUDIT.md | Claims vs code verification | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/PROJECT_STATUS.md | This file | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/ONE_TAP_SIGNAL.md | One-Tap Alignment + Discipline Module | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/PRIORITIES.md | Dev priorities (P0-P3) | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/MARKETING.md | Marketing plan (Substack/Twitter/Reddit) | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/COMMIT_WORKFLOW.md | Commit rules, CI checks, security gates | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/BUG_PNL_ENTRY_WIPE.md | P&L/entry-price wipe bug + fix (3 occurrences) | ✅ Updated 2026-09-02 |
| aqmath-ui/_research/recovery-test.md | Crown Test 4 results | ✅ 2026-08-18 |
| aqmath-ui/_research/static-vs-dynamic.md | Crown Test 2 results | ✅ 2026-08-12 |
| aqmath-ui/_research/dca-stress.md | Crown Test 1 results | ✅ Current |
| aqmath-ui/_research/how-aqmath-works.md | User guide (must-read) | ✅ Current |
| aqmath-ui/_internal/ops/CLOUDFLARE_SETUP.md | CF WAF setup procedure + open origin-exposure item | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/ops/RAILWAY_CI_SETUP.md | CI/CD setup procedure | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/ops/ENVIRONMENTS.md | Dev vs prod workflow | ✅ Updated 2026-09-02 |
| aqmath-ui/_internal/ops/RUNBOOK_DDOS.md | DDoS incident runbook | ✅ Updated 2026-09-02 |

The private engine repo additionally holds the shield stress-test results, the
changelog audit, the approved caching plan and the E2E / out-of-sample result
write-ups. Their filenames are not listed here — see that repo.

> Everything in `_internal/` (including `ops/` and `tools/`) is excluded from the
> published site by the underscore rule. What is still published and must stay
> free of internals: `README.md`, `tools/*.py` (CI calls them by that path) and
> `tests/*`.

# `_internal/` — internal documents (NOT published)

Everything in this directory is **working documentation for the developer and AI
agents**, not part of the public site.

## Why this directory exists

`aqmath.xyz` is served by GitHub Pages with Jekyll, and this repository is
**public**. Jekyll publishes every root-level file verbatim:

| URL | Before the move | After the move |
|-----|-----------------|----------------|
| `https://aqmath.xyz/CLAIMS_AUDIT.md` | 200 — full file contents | 404 |
| `https://aqmath.xyz/PROJECT_STATUS.md` | 200 — full file contents | 404 |
| `https://aqmath.xyz/ops/CLOUDFLARE_SETUP.md` | 200 — origin hostnames + WAF rules | 404 |
| `https://aqmath.xyz/tools/error-dashboard.html` | 200 — operator console | 404 |
| `https://aqmath.xyz/_internal/CLAIMS_AUDIT.md` | — | 404 |

Jekyll skips **any path segment that starts with `_`** — files as well as
directories. That is why `_src/`, `_research/`, `_logs/` and `_commit_msg.txt`
were never published, and why moving something into `_internal/` removes it from
the branded domain while keeping it in git history.

Everything else in the repo is public on the site, including directories that do
not look like site content: `ops/`, `tools/` and `tests/` were all served
verbatim (checked live with HTTP status codes).

**Rules:**
1. `README.md` is the only Markdown file allowed at the repository root.
2. Anything not meant for the public site goes in `_internal/` — including
   operator tooling (`_internal/tools/`) and ops docs (`_internal/ops/`).
3. Before adding a top-level directory, ask: *should this be readable on
   `aqmath.xyz`?* If the answer is no, prefix it with `_`.

The exception is `tools/` itself: CI and the npm scripts call
`python tools/<name>.py`, so the build pipeline stays where it is. Those files
are therefore public — they must contain nothing but build logic.

## Second rule: the repo is still public

Moving a file here hides it from the website, **not** from GitHub. So these
documents must not contain internals of the private services. What is allowed
and what is not:

| Allowed | Not allowed |
|---------|-------------|
| Service names (`aqmath-engine`, `beta-auth`) — already in `README.md` | File paths inside private repos (`portfolio_service.py`) |
| User-facing endpoints the public JS already calls (`/portfolio/signals`) | Operator/admin endpoints and their auth header names |
| Numbers already published on the site (drawdowns, caps, windows) | Unpublished constants, formulas or trigger levels |
| What was decided and why | Database schema (tables, columns, SQL) |
| UI function names (they ship in this repo's JS) | Private function names, harness/script names |
| Outcome-level descriptions of unreleased work | Unpublished business rules (discount gates, internal pricing) |
| The public `api-*.aqmath.xyz` hosts | Railway origin hostnames (`*.up.railway.app`) — they bypass the WAF |
| How to configure something (procedure) | The configured values (WAF rule expressions, rate-limit thresholds, env-var inventories) |

When a detail is needed but not writable, the docs say so explicitly instead of
leaving a gap that a future edit might "helpfully" fill.

## Inventory

| File | What it is |
|------|-----------|
| `PROJECT_STATUS.md` | Chronological record of what was built, decided and verified |
| `CLAIMS_AUDIT.md` | Every public claim cross-checked against the implementation |
| `COMMIT_WORKFLOW.md` | Commit rules, build pipeline order, CI gates, security backlog |
| `ONE_TAP_SIGNAL.md` | One-Tap Alignment + Discipline Meter: UI contract and behaviour |
| `BUG_PNL_ENTRY_WIPE.md` | Post-mortem: entry/APY wiped by full-replacement writes |
| `PRIORITIES.md` | P0–P3 backlog |
| `MARKETING.md` | Business plan: channels, editorial calendar, positioning |
| `ops/CLOUDFLARE_SETUP.md` | WAF/DNS setup procedure + the open origin-exposure item |
| `ops/RAILWAY_CI_SETUP.md` | Railway CI deploy + one-click rollback procedure |
| `ops/ENVIRONMENTS.md` | Local vs production environment workflow |
| `ops/RUNBOOK_DDOS.md` | Incident runbook |
| `tools/error-dashboard.html` | Operator console (local file, needs the operator secret) |
| `tools/recover_portfolio.py` | Support script: rebuild a user's portfolio from the API |

`MARKETING.md` and `PRIORITIES.md` are pure business/planning documents with no
reason to live in a public repository — if they should be genuinely private,
they belong in a private repo, not here.

## Adding a document

1. Put it in `_internal/`, never at the root.
2. Start it with the "Internal doc — not published" banner (copy one from a
   neighbour) so the next reader knows the scrubbing rules apply.
3. Check it against the table above before committing.
4. No rebuild is needed for Markdown-only changes: `tools/audit_pages.py` only
   audits `*.html` and lists `_internal` in `SKIP_DIRS`, and `stamp_version.py`
   works from an explicit asset list.

# AQMath Commit & Deploy Workflow — Rules, Checks & Security Gates

**Last updated:** 2026-09-02
**Applies to:** All repositories
**Audience:** Developer + AI agents working on the codebase

> **Internal doc — not published.** It lives in `_internal/` because Jekyll serves
> anything at the repo root on the public site. The `aqmath-ui` repo is public, so
> the hardening backlog below is written as **work items**, not as a live list of
> open weaknesses — a public "here is what is not protected" table is itself an
> attack-surface disclosure. Secret *names* and grep patterns are fine (they are
> already published in `.github/workflows/ci.yml`); secret *values* never appear.

---

## 1. The Golden Rules

1. **NEVER commit secrets** — no API keys, no JWT secrets, no database
   URLs, no beta keys, no collector secrets. Not even "temporarily."
2. **NEVER commit `.env` files** — all repos have `.env` in `.gitignore`.
   Use `.env.example` with placeholder values.
3. **Build before commit (aqmath-ui)** — the 4-step pipeline is mandatory.
   CI will reject pushes with stale stamps.
4. **Smoke test before push (backend)** — `python -c "import main"` at
   minimum. CI will reject pushes that fail import.
5. **No direct production database access** — all changes go through CI
   → Railway deploy. No SSH, no psql directly.
6. **No internal docs at the repo root (aqmath-ui)** — the site is built with
   Jekyll, which serves every root-level file verbatim on `aqmath.xyz`
   (`/CLAIMS_AUDIT.md` was publicly readable). Internal notes belong in
   `_internal/` — underscore-prefixed directories are excluded from the
   published site. Before adding any root-level file, ask: *should this be
   readable on the public domain?*

---

## 2. Pre-Commit Checklist (EVERY repo)

Before every `git commit`, verify:

```
[ ] No .env files staged (git status — should NOT show .env)
[ ] No hardcoded secrets (grep for patterns below)
[ ] No temporary debug code (print statements with tokens, commented-out credentials)
[ ] No large binary files accidentally added
[ ] Code compiles/imports cleanly (smoke test)
```

### Secret Patterns to Grep For

```bash
# Run this before EVERY commit across all repos:
grep -rInE "(JWT_SECRET|COLLECTOR_SECRET|DATABASE_URL|ADMIN_SECRET|IP_HASH_PEPPER|RAILWAY_TOKEN)\s*=\s*['\"][A-Za-z0-9_+/=-]{16,}" --include='*.py' --include='*.js' --include='*.json' --include='*.toml' --include='*.yml' .

# Also check for real beta keys (AQMBETA- followed by real alphanumeric, not XXXX):
grep -rInE "AQMBETA-[A-Z0-9]{4}-[A-Z0-9]{4}" --include='*.py' --include='*.js' --include='*.json' .

# Also check for AWS/GitHub/Stripe keys:
grep -rInE "(AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|sk_live_[a-zA-Z0-9]{24}|rk_live_[a-zA-Z0-9]{24})" .
```

**If any of these match → DO NOT COMMIT. Fix first.**

---

## 3. Build Pipeline (aqmath-ui ONLY)

The UI repo has a **mandatory 4-step build** before every commit. Skipping
a step causes CI failure (`stamp_version.py --check` exits non-zero).

### Critical Order

```
Step 1: python tools/minify_css.py       # styles.css → styles.min.css
Step 2: python tools/stamp_version.py    # stamps git SHA into all HTML/JS
Step 3: python tools/build_pages.py      # _src/index.html → 5 entry pages
Step 4: python tools/build_research.py   # _research/*.md → research/*.html
```

### Verification (mandatory after build)

```
Step 5: python tools/stamp_version.py --check   # exit 0 = stamps match
Step 6: python tools/audit_pages.py             # checks all pages valid
```

### When to Run

| Changed Files | Steps Needed |
|---------------|-------------|
| CSS only (`styles.css`) | 1 → 2 → 3 → 5 |
| HTML source (`_src/index.html`) | 2 → 3 → 5 |
| Research source (`_research/*.md`) | 2 → 4 → 5 |
| JS files (`app*.js`) | 2 → 3 → 5 |
| Any combination | 1 → 2 → 3 → 4 → 5 → 6 |
| MD docs only (README, etc.) | None needed |

### Common CI Failure: Stale Stamps

**Symptom:** CI fails with `stamp_version.py --check` showing mismatched SHAs.
**Cause:** You modified HTML/JS/CSS but forgot to run `stamp_version.py`.
**Fix:** Run the full pipeline (steps 1-4), verify (step 5), commit the stamped files.

---

## 4. CI Checks Per Repository

### aqmath-ui

| Check | Tool | Blocks Deploy? |
|-------|------|----------------|
| Version stamps current | `stamp_version.py --check` | YES — CI fails |
| Page audit passes | `audit_pages.py` | YES — CI fails |
| i18n key parity | `check_i18n.py` | Local gate (`npm run verify`) — **not yet in CI**, see §7.6 |
| Secret scans (credentials, beta keys, cloud keys) | `grep -rInE` (see §2) | YES — CI fails |
| Forward log snapshot | Scheduled workflow (Mon/Thu 04:00 UTC) | Auto-commit |

### All Backend Services (engine, dca, data-pipeline, backtesting-, collectors)

| Check | Tool | Blocks Deploy? |
|-------|------|----------------|
| Smoke import | `python -c "import main, ..."` | YES — CI fails |
| Unit tests | `python test_*.py` (where exists) | YES — CI fails |
| Credential scan | `grep -rInE` for hardcoded secrets | Partial — see §7.1 |
| Deploy to Railway | Railway GraphQL API | ONLY if `RAILWAY_CI_ENABLED=true` |

### Deploy Gate

All backend repos have deploy **DISABLED by default**. To enable:
```
Repository Settings → Variables → Add: RAILWAY_CI_ENABLED = true
```

Deploy runs ONLY when:
- `test` job passes (smoke import + unit tests)
- Push is to `main` branch (not PR)
- `RAILWAY_CI_ENABLED` variable is set to `true`

---

## 5. L3 Deep Security Review

The project has a built-in L3 security scan (Qoder `security-scan` skill).
It performs a comprehensive code review for security vulnerabilities.

### When to Run L3

| Trigger | How |
|---------|-----|
| Before merging large feature | `/security-scan` in Qoder |
| Before opening to public | `/security-scan` on all backend repos |
| After auth/crypto changes | `/security-scan` on affected repo |
| Monthly (recommended) | `/security-scan` on all 10 repos |
| After dependency updates | `/security-scan` on affected repo |

### What L3 Checks

- SQL injection vectors
- Authentication bypass possibilities
- CORS misconfigurations
- Secret exposure in logs or error messages
- Rate limiting gaps
- Input validation failures
- Path traversal risks
- JWT handling issues

### L3 Does NOT Check (manual review needed)

- Business logic correctness
- Race conditions between services
- Railway environment variable misconfiguration
- Third-party API key rotation
- SSL certificate expiry

---

## 6. Security Architecture (Current State)

### What's Protected

| Layer | Protection | Implementation |
|-------|-----------|----------------|
| Secrets in code | `.gitignore` blocks `.env` | All backend repos |
| Hardcoded credentials | CI grep scan | aqmath-ui + part of the backend (see §7.1) |
| JWT tokens | Min 32 char secret, HS256 | All auth-enabled services |
| API keys | Environment variables only | Railway dashboard |
| Beta keys | SHA-256 hash only in DB | beta-auth (never stores raw) |
| IP addresses | SHA-256 hash with pepper | beta-auth (never stores raw) |
| CORS | Explicit allowlist | All services (never `*`) |
| Rate limiting | 120 req/min per IP | All public services |
| HTTP security | HSTS, X-Content-Type, CSP | All services |
| Documentation | Disabled Swagger/ReDoc | All FastAPI services |

### Hardening Backlog

Remaining work items, tracked as tasks (deliberately described without the
current exposure state — see the banner at the top):

| Item | Fix (see §7) |
|------|--------------|
| Credential scan coverage | Roll the scan out to every backend repo (§7.1) |
| Pre-commit hook | Add the optional hook so checks are not manual (§7.5) |
| `.env.example` validation | Add a pattern check for real-looking values |
| GitHub secret scanning + push protection | Enable in repo settings (§7.3) |
| Branch protection | Enable on `main` in every repo (§7.4) |
| i18n parity in CI | Add `check_i18n.py` to the UI workflow (§7.6) |

---

## 7. Proposed Security Improvements (Action Items)

### 7.1 Add Credential Scan to ALL Backend Repos

`aqmath-ui` and `backtesting-` already run all three scans. Roll the same block
out to every remaining CI:

```yaml
# Add to the test job in every backend repo's ci.yml:
- name: No credentials in the repo
  run: >
    if grep -rInE "(JWT_SECRET|COLLECTOR_SECRET|DATABASE_URL|ADMIN_SECRET|IP_HASH_PEPPER)\s*=\s*['\"][A-Za-z0-9_+/=-]{16,}"
    --include='*.py' --include='*.json' --include='*.toml' --include='*.yml' .; then
    echo "::error::Hardcoded credentials detected — remove before committing";
    exit 1; fi

- name: No real beta keys in the repo
  run: >
    if grep -rInE "AQMBETA-[A-Z0-9]{4}-[A-Z0-9]{4}"
    --include='*.py' --include='*.js' --include='*.json' --include='*.md' .
    | grep -v "AQMBETA-XXXX-XXXX" | grep -v "AQMBETA-TEST"; then
    echo "::error::Real beta keys detected — replace with placeholder";
    exit 1; fi

- name: No cloud provider keys
  run: >
    if grep -rInE "(AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|sk_live_[a-zA-Z0-9]{24})"
    --include='*.py' --include='*.js' --include='*.json' --include='*.yml' --include='*.env*' .; then
    echo "::error::Cloud provider key detected — this is a CRITICAL security incident";
    exit 1; fi
```

**Repos to update:**
- [ ] `aqmath-engine/.github/workflows/ci.yml`
- [ ] `dca-engine/.github/workflows/ci.yml`
- [ ] `data-pipeline/.github/workflows/ci.yml`
- [ ] `-aqmath-beta-auth/.github/workflows/ci.yml`
- [ ] `coingecko-collector/.github/workflows/ci.yml`
- [ ] `kraken-collector/.github/workflows/ci.yml`
- [ ] `coinbase-collector/.github/workflows/ci.yml`
- [ ] `mexc-collector/.github/workflows/ci.yml`

### 7.2 Credential Scan in aqmath-ui ✅ DONE

The UI repo is static (no backend secrets) but could accidentally commit:
- Beta keys in test code
- API tokens in JS files
- `.env` files

All three scans are live in `.github/workflows/ci.yml` (credentials, real beta
keys with the `AQMBETA-XXXX-XXXX` placeholder allowed, cloud provider keys).
Kept here as the reference snippet for the other repos:

```yaml
# Add to aqmath-ui ci.yml after existing checks:
- name: No secrets in frontend code
  run: >
    if grep -rInE "(AQMBETA-[A-Z0-9]{4}-[A-Z0-9]{4}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})"
    --include='*.js' --include='*.html' --include='*.json' .
    | grep -v "AQMBETA-XXXX-XXXX" | grep -v "node_modules"; then
    echo "::error::Secret pattern detected in frontend code";
    exit 1; fi
```

### 7.3 GitHub Secret Scanning (Recommended)

Enable in every repo:
```
Settings → Security → Secret scanning → Enable
Settings → Security → Push protection → Enable
```

This blocks pushes containing recognized secret patterns (AWS, GitHub,
Stripe, etc.) BEFORE they land in the repo.

### 7.4 Branch Protection Rules (Recommended)

Enable on `main` branch of every repo:
```
Settings → Branches → Add rule:
  - Branch name pattern: main
  - Require pull request before merging: YES
  - Require approvals: 1 (or 0 for solo dev — still requires PR)
  - Require status checks: YES
  - Require branches to be up to date: YES
  - Include administrators: YES (even the owner must go through CI)
  - Do not allow force pushes: YES
  - Do not allow deletions: YES
```

### 7.5 Optional Pre-Commit Hook

For local protection before code ever reaches CI:

```bash
# .git/hooks/pre-commit (or use pre-commit framework)
#!/bin/sh
# Block commit if .env is staged
if git diff --cached --name-only | grep -qE '^\.env$'; then
  echo "ERROR: .env file staged — remove it before committing"
  exit 1
fi

# Block commit if hardcoded secrets detected
if git diff --cached --diff-filter=ACM | grep -qE "(JWT_SECRET|COLLECTOR_SECRET|DATABASE_URL)\s*=\s*['\"][A-Za-z0-9_+/=-]{16,}"; then
  echo "ERROR: Hardcoded secret detected in staged changes"
  exit 1
fi
```

### 7.6 Add i18n Parity to CI

`tools/check_i18n.py` currently only runs locally via `npm run verify`, so a
missing zh-CN key can ship. Add it to the UI workflow next to the stamp check:

```yaml
- name: i18n keys must be in parity
  run: python tools/check_i18n.py
```

It fails when `en.json` and `zh-CN.json` diverge or when a `data-i18n` key used
in `_src/index.html` does not resolve — exactly the class of bug that produces
raw keys on the Chinese site.

---

## 8. Commit Message Convention

Format: `<type>: <short description>`

| Type | When |
|------|------|
| `feat:` | New feature or endpoint |
| `fix:` | Bug fix |
| `docs:` | Documentation only (README, MD files) |
| `refactor:` | Code restructure, no behavior change |
| `test:` | Adding or updating tests |
| `ci:` | CI/CD workflow changes |
| `chore:` | Build pipeline, dependency updates |
| `security:` | Security-related changes |

Examples:
```
docs: add PRIORITIES.md and MARKETING.md
feat: add One-Tap Alignment signal endpoints
fix: correct delta application for negative holdings
ci: add credential scan to all backend repos
security: rotate JWT_SECRET after potential exposure
```

---

## 9. Deploy Workflow (End-to-End)

```
Developer makes changes
        │
        ├── 1. Pre-commit checks (grep for secrets, build if UI)
        │
        ├── 2. git add → git commit → git push
        │
        ├── 3. GitHub Actions CI triggers automatically
        │       ├── Smoke import / unit tests
        │       ├── Stamp check (UI only)
        │       ├── Credential scan (where enabled)
        │       └── Page audit (UI only)
        │
        ├── 4. If CI passes + RAILWAY_CI_ENABLED=true:
        │       └── Deploy job → Railway GraphQL API
        │           └── Railway pulls new image from GitHub
        │
        ├── 5. Railway health check
        │       └── If service fails to start → auto-rollback
        │
        └── 6. If deploy fails:
                └── One-Click Rollback workflow (manual trigger)
                    └── Restores previous known-good deployment
```

---

## 10. Emergency Procedures

### Accidental Secret Commit

If a secret reaches GitHub (even briefly):

1. **IMMEDIATELY rotate the secret** — assume it's compromised
2. Remove from code (replace with env variable)
3. Force-push to remove from history: `git rebase -i` to squash, then `git push --force`
4. **WARNING:** GitHub retains blobs. If the secret was public, consider it
   permanently leaked regardless of history rewrite.
5. Update Railway environment variable with new value
6. Restart affected services

### Secret Rotation Checklist

| Secret | Where to Rotate | Shared With |
|--------|----------------|-------------|
| JWT_SECRET | Railway → each service's env | engine, data-pipeline, beta-auth, dca, backtesting |
| COLLECTOR_SECRET | Railway → data-pipeline + all 4 collectors | 5 services total |
| ADMIN_SECRET | Railway → beta-auth env | beta-auth only |
| IP_HASH_PEPPER | Railway → beta-auth env | beta-auth only |
| DATABASE_URL | Railway → Postgres env | All services with DB access |
| RAILWAY_TOKEN | GitHub → repo secrets | CI deploy jobs |
| NTFY tokens | Railway → engine env | engine only |
| Beta keys | beta-auth DB → SEED_ACTIVATIONS | beta-auth only |

---

## 11. Quick Reference Card

### Before Every Commit

```
1. grep for secrets (patterns in §2)
2. If UI: run build pipeline (§3)
3. Smoke test: python -c "import main"
4. git status — verify no .env, no unexpected files
5. Commit with conventional message (§8)
6. Push — CI handles the rest
```

### If CI Fails

| Error | Fix |
|-------|-----|
| `stamp_version.py --check` failed | Run full build pipeline (§3) |
| `audit_pages.py` failed | Check generated HTML for issues |
| Smoke import failed | Check Python syntax, missing dependencies |
| Unit test failed | Run tests locally, fix failures |
| Credential scan failed | Remove hardcoded secret, use env variable |
| Deploy failed | Check Railway logs, use One-Click Rollback |

### Key Commands

```bash
# UI build pipeline (critical order)
python tools/minify_css.py && python tools/stamp_version.py && python tools/build_pages.py && python tools/build_research.py

# UI verification
python tools/stamp_version.py --check && python tools/audit_pages.py

# Backend smoke test
python -c "import main, config"

# Secret scan (all repos)
grep -rInE "(JWT_SECRET|COLLECTOR_SECRET|DATABASE_URL|ADMIN_SECRET)\s*=\s*['\"][A-Za-z0-9_+/=-]{16,}" --include='*.py' --include='*.json' --include='*.toml' .

# L3 security scan (Qoder)
/security-scan
```

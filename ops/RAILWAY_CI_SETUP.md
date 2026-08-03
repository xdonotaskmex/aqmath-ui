# Railway CI + One-Click Rollback — postavljanje

Svaki backend repo (beta-auth, engine, dca-engine, data-pipeline,
backtesting/paper-trading, 3 collectora — 8 Railway servisa + Postgres
bez deploya + aqmath-ui na Pages) ima dva workflowa:
- `.github/workflows/ci.yml` — test/smoke pa deploy (samo na main push)
- `.github/workflows/rollback.yml` — jedan klik vraća prethodni deploy

## 1. Railway token (jednom)

**Koristi se workspace token** (scope "DoNotAskMe's Projects"):
Railway → projekt → **Settings → Tokens → New Token** → kopiraj token
(prikazuje se samo jednom, UUID oblika, vrijedi za SVE servise u projektu).

Zašto ne account token i ne CLI: workspace/account tokeni ne podržavaju
`railway whoami`, a Railway CLI na Linux runnerima pouzdano ne čita
takve tokene (provjereno 2026-07-29). Zato CI deploy uopće ne koristi
CLI, nego Railway **GraphQL API** (`environmentTriggersDeploy` mutation,
`curl` + `jq` u `.github/workflows/ci.yml`) — Railway sam builda i
deploya zadnji commit s maina.

## 2. GitHub secrets + variables (po svakom repu)

GitHub repo → Settings → **Secrets and variables → Actions**:

**Secrets → New repository secret:**
- `RAILWAY_TOKEN` = workspace token iz koraka 1 (isti token za svih 8 repova)

**Variables → New repository variable** (4 varijabile):
- `RAILWAY_CI_ENABLED` = `true` (uključuje deploy job; bez toga se preskače)
- `RAILWAY_PROJECT_ID` — Project Settings → General → Project ID (smije biti i secret)
- `RAILWAY_SERVICE_ID` — Service → Settings → General → Service ID (smije biti i secret)
- `RAILWAY_ENVIRONMENT_ID` — Environment → klik na environment → ID u URL-u (smije biti i secret)

## 3. Ugasi Railway auto-deploy (KLJUČNO)

Da ništa ne stiže u produkciju mimo CI-a, za **svaki od 8 servisa**:

1. railway.com → Dashboard → otvori projekt servisa
2. Klikni na servis → tab **Settings**
3. Sekcija **Deploy** (prikazuje povezani GitHub repo i branch)
4. Klikni **Disable** pored autodeploy statusa

Servisi: api-auth (-aqmath-beta-auth), api-engine (aqmath-engine),
api-dca (dca-engine), data-pipeline, api-backtest (backtesting-),
coinbase-collector, coingecko-collector, kraken-collector.

Od tog trena deploy ide ISKLJUČIVO iz GitHub Actions (nakon zelenih testova).
Dok je auto-deploy još uključen, svaki push radi dupli deploy
(Railway auto + GitHub Actions) — bezopasno, ali nepotrebno.

Ručni deploy bez CI-a (hitni slučaj): Command Palette (Ctrl+K) →
**Deploy Latest Commit**.

## 4. Kako radi rollback (jedan klik)

1. GitHub repo → tab **Actions** → lijevo **One-Click Rollback**
2. Desno **Run workflow** → odaberi koliko deploya unatrag (default 1) → Run
3. Workflow preko Railway API-ja nađe zadnji uspješni deploy i pozove
   `deploymentRollback` (fallback: redeploy tog deploya)
4. Railway dashboard → Deployments — vidiš novi rollback deploy kako se diže

Bez SSH-a, bez git reverta, bez ponovnog builda — Railway vraća
postojeću sliku prethodnog deploya.

## 5. Što CI provjerava

| Repo | Gate |
|---|---|
| dca-engine | `python test_min_token_buy.py` (8 unit testova) |
| data-pipeline | smoke import main/cleaner/validator/config |
| aqmath-engine | smoke import main + engine moduli |
| -aqmath-beta-auth | smoke import main (fail-fast env provjera, JWT_SECRET ≥ 32 znaka) |
| 3 collectora | smoke import main/collector/config |
| backtesting- | smoke import main + trading moduli + credential scan |
| aqmath-ui | `stamp_version.py --check` + `audit_pages.py` |

`data-pipeline/test_deleverage.py` je lokalni harness (Desktop CSV-ovi,
import iz aqmath-engine) i ne može u CI — navedeno u komentaru workflowa.

## 6. Staging (faza 2, odgođeno po odluci)

Kad se odluči plaćati duplicirani Railway: environment `staging` po
projektu + drugi Postgres (schema se preslika s `pg_dump | psql`),
CI deploy najprije na staging pa smoke protiv staging URL-a, tek onda
manual approval za produkciju (GitHub Environment protection rules).

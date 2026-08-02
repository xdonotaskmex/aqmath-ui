# Railway CI + One-Click Rollback — postavljanje

Svaki backend repo (beta-auth, engine, dca-engine, data-pipeline,
backtesting/paper-trading, 3 collectora — 8 Railway servisa + Postgres
bez deploya + aqmath-ui na Pages) ima dva workflowa:
- `.github/workflows/ci.yml` — test/smoke pa deploy (samo na main push)
- `.github/workflows/rollback.yml` — jedan klik vraća prethodni deploy

## 1. Railway token (jednom)

1. Railway dashboard → klik na avatar → **Account Settings → Tokens**
2. **Create Token** → naziv `github-ci` → scope: deploy prava na projekte
3. Kopiraj token (prikazuje se samo jednom)

## 2. GitHub secrets + variables (po svakom repu)

GitHub repo → Settings → **Secrets and variables → Actions**:

**Secrets → New repository secret:**
- `RAILWAY_TOKEN` = token iz koraka 1

**Variables → New repository variable** (3 varijable, nađeš ih u Railway dashboardu):
- `RAILWAY_PROJECT_ID` — Project Settings → General → Project ID
- `RAILWAY_SERVICE_ID` — Service → Settings → General → Service ID
- `RAILWAY_ENVIRONMENT_ID` — Environment → klik na environment → ID u URL-u

## 3. Ugasi Railway auto-deploy (KLJUČNO)

Da ništa ne stiže u produkciju mimo CI-a:
Railway → Service → Settings → Deployments →
isključi **Automatic deployments from GitHub** (za svaki servis).

Od tog trena deploy ide ISKLJUČIVO iz GitHub Actions (nakon zelenih testova).

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

# Railway CI + One-Click Rollback — postavljanje

Svaki backend repo (beta-auth, engine, dca-engine, data-pipeline,
backtesting/paper-trading, 3 collectora — 8 Railway servisa + Postgres
bez deploya + aqmath-ui na Pages) ima dva workflowa:
- `.github/workflows/ci.yml` — test/smoke pa deploy (samo na main push)
- `.github/workflows/rollback.yml` — jedan klik vraća prethodni deploy

> **Interni dokument — ne objavljuje se.** Živi u `_internal/` jer Jekyll
> poslužuje sve izvan direktorija s donjom crtom direktno na `aqmath.xyz`
> (ovo je bilo javno čitljivo na `/ops/RAILWAY_CI_SETUP.md`). Repo je javan, pa
> ovdje nema: imena Railway workspacea, service/environment ID-ova, popisa
> modula koje svaki privatni servis importira u smoke testu, niti stvarnih
> vrijednosti secreta. ID-ovi žive u GitHub Secrets/Variables svakog repo-a.

## 1. Railway token (jednom)

**Koristi se workspace token** (scope: vlasnički Railway workspace):
Railway → projekt → **Settings → Tokens → New Token** → kopiraj token
(prikazuje se samo jednom, UUID oblika, vrijedi za SVE servise u projektu).

Zašto ne account token i ne CLI: workspace/account tokeni ne podržavaju
`railway whoami`, a Railway CLI s njima pouzdano ne radi ni `link`/`up`
("Unauthorized" ili tihi exit 0 — provjereno 2026-07-29). Zato CI deploy
uopće ne koristi CLI, nego Railway **GraphQL API** — mutation
`serviceInstanceDeployV2(serviceId, environmentId, commitSha)` pozvana
`curl`-om + `jq`-om u `.github/workflows/ci.yml` (commitSha = `github.sha`).
To je isti poziv koji CLI interno koristi; Railway builda i diže točno
taj commit. **Ne koristiti** `environmentTriggersDeploy` — vraća `true`,
ali za servise s GitHub source-om NE kreira deploy (samo mijenja flag).

## 2. GitHub secrets + variables (po svakom repu)

GitHub repo → Settings → **Secrets and variables → Actions**:

**Secrets → New repository secret:**
- `RAILWAY_TOKEN` = workspace token iz koraka 1 (isti token za sve backend repove)

**Variables → New repository variable** (3 varijable; `RAILWAY_CI_ENABLED`
može biti i org shared varijabla da vrijedi za sve repove odjednom):
- `RAILWAY_CI_ENABLED` = `true` (uključuje deploy job; bez toga se preskače)
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
| dca-engine | unit testovi |
| data-pipeline | smoke import |
| aqmath-engine | smoke import |
| -aqmath-beta-auth | smoke import (fail-fast env provjera, JWT secret ≥ 32 znaka) |
| 3 collectora | smoke import |
| backtesting- | smoke import + credential scan |
| aqmath-ui | `stamp_version.py --check` + `audit_pages.py` + 3 secret scana |

Točan popis modula koji se importiraju u svakom smoke testu vidi se u
`.github/workflows/ci.yml` dotičnog privatnog repo-a.

Jedan data-pipeline harness je lokalni (Desktop CSV-ovi + import iz privatnog
engine repo-a) i ne može u CI — to je navedeno u komentaru tog workflowa.

## 6. Staging (faza 2, odgođeno po odluci)

Kad se odluči plaćati duplicirani Railway: environment `staging` po
projektu + drugi Postgres (schema se preslika s `pg_dump | psql`),
CI deploy najprije na staging pa smoke protiv staging URL-a, tek onda
manual approval za produkciju (GitHub Environment protection rules).

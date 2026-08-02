# ENVIRONMENTS — produkcija vs lokalni dev

Jedno pravilo: **nijedan secret ne živi u kodu ni u gitu.** Sve je
`os.getenv()` + Railway varijable (produkcija) ili `.env` / shell varijable
(lokalno). Servisi bez ključnih varijabli odbijaju start (fail-fast).

## Matrica po servisu

| Servis | Varijabla | Produkcija (Railway) | Lokalni dev |
|---|---|---|---|
| **-aqmath-beta-auth** | JWT_SECRET | 64-zn. hex, dijeli s data-pipeline | `python -c "import secrets;print(secrets.token_hex(32))"` |
| | DATABASE_URL | Railway Postgres | lokalni Postgres ili ostavi prazno za import test |
| | BETA_KEYS / UNLIMITED_KEYS / SEED_ACTIVATIONS | prave ključeve | `AQMBETA-TEST-1234` |
| | IP_HASH_PEPPER, ADMIN_SECRET | pravi secrets | bilo koji string |
| | RL_BASE_SEC / RL_MAX_SEC / RL_RESET_HOURS | 2 / 900 / 24 | isto |
| | CORS_ORIGINS | `https://aqmath.xyz` | default već uključuje `http://localhost:8090` |
| **aqmath-engine** | DATABASE_URL, JWT_SECRET | Railway Postgres + dijeljeni secret | dummy za smoke |
| | REVOKED_KIDS, REQUIRE_KID | po potrebi | prazno |
| **data-pipeline** | DATABASE_URL, JWT_SECRET | isto kao engine | dummy |
| | BETA_AUTH_URL | produkcijski beta-auth URL | `http://localhost:8000` |
| | COLLECTOR_SECRET | dijeli s kolektrorima | `dev-secret` |
| **coinbase / coingecko / kraken-collector** | DATA_PIPELINE_URL | produkcijski pipeline URL | `http://localhost:8004` |
| | COLLECTOR_SECRET | isti kao data-pipeline | `dev-secret` |
| **dca-engine** | CORS_ORIGINS | `https://aqmath.xyz` | default uključuje localhost:8090 |
| **aqmath-ui** | — | GitHub Pages (nema servera) | `python -m http.server 8090` iz roota repoa |

## Lokalno pokretanje (primjer)

```powershell
# backend servis
$env:JWT_SECRET = python -c "import secrets;print(secrets.token_hex(32))"
$env:DATABASE_URL = 'postgresql://user:pass@localhost:5432/aqmath'
uvicorn main:app --port 8000 --reload

# frontend protiv lokalnog backenda: app.js URL-ovi pokazuju na produkciju,
# pa se za lokalni E2E koristi produkcijski backend (CORS dopušta localhost:8090)
python -m http.server 8090
```

## Fail-fast ponašanje

- `-aqmath-beta-auth` diže `RuntimeError` ako JWT_SECRET nedostaje ili ima < 32 znaka
- Ostali servisi imaju safe defaultove za ne-kritične varijable; DATABASE_URL
  se provjerava pri prvom DB pozivu (engine/pipeline ne rade bez baze)

## Staging (faza 2 — odgođeno)

Po odluci: trenutno NEMA staging environmenta (bez dupliciranja Railway
računa). Kad se odobri: environment `staging` po projektu, zaseban Postgres
s istom shemom (`pg_dump` produkcijske sheme → restore), isti set varijabli
kao produkcija s `_STAGING` vrijednostima, i CI koji prvo pušta na staging.
Detalji: `ops/RAILWAY_CI_SETUP.md` sekcija 6.

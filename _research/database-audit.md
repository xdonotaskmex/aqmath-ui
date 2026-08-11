# 🗄️ AQMath — Potpuni Database Audit

**Datum:** 2026-08-09 · **Zadnja revizija: 2026-08-11** (nakon security remedijacije — statusi svih akcija ažurirani)
**Opseg:** Svih 9 repozitorija — sve SQL sheme, query patterni, data flow, caching, pool management
**DB Engine:** PostgreSQL (single Railway instance, shared `DATABASE_URL`)

---

## 1. Arhitektonski Pregled

AQMath koristi **jednu PostgreSQL instancu** koju dijeli više servisa. Svaki servis vlasnik je svojih tablica i nikada ne dira tuđe — boundary je čist i dokumentiran.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     POSTGRESQL (Railway)                              │
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ data-pipeline    │  │ -aqmath-beta-auth│  │ aqmath-engine     │  │
│  │ (WRITE heavy)    │  │ (READ/WRITE)     │  │ (READ/WRITE)      │  │
│  │                  │  │                  │  │                   │  │
│  │ raw_coingecko    │  │ beta_activations │  │ portfolios        │  │
│  │ raw_kraken       │  │ auth_attempts    │  │ portfolio_daily_  │  │
│  │ raw_coinbase     │  │ sessions         │  │   log             │  │
│  │ crypto_prices    │  │ user_holdings    │  │                   │  │
│  │                  │  │ consent_log      │  │ ALSO READS:       │  │
│  │                  │  │ read_acks        │  │ crypto_prices     │  │
│  │                  │  │ ntfy_subscrip.   │  │                   │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────┘  │
│                                                                       │
│  Servisi BEZ direktnog DB pristupa:                                   │
│  ┌──────────────────┐  ┌──────────────────────────────────────────┐  │
│  │ dca-engine       │  │ Collectors (coingecko, kraken, coinbase) │  │
│  │ (HTTP to data-   │  │ (HTTP POST /api/raw to data-pipeline)    │  │
│  │  pipeline)       │  │                                          │  │
│  └──────────────────┘  └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Instance & Connection Management

### 2.1 Single DB Instance

| Svojstvo | Vrijednost |
|---|---|
| **Broj instanci** | **1** PostgreSQL (Railway managed) |
| **Connection string** | `DATABASE_URL` (env var, shared by all services) |
| **Connection pool library** | `asyncpg` (svugdje) |
| **Pool type** | `asyncpg.create_pool()` |

### 2.2 Pool Configuration po Servisu

| Servis | Pool Min | Pool Max | Ukupno konekcija (1 worker) |
|---|---|---|---|
| **-aqmath-beta-auth** | 2 (env `DB_POOL_MIN`) | 12 (env `DB_POOL_MAX`) | 2–12 |
| **aqmath-beta-auth** (stripped) | 1 | 5 | ~~1–5~~ ⚰️ **decommissioned 2026-08-11** |
| **aqmath-engine** | 2 (env `DB_POOL_MIN`) | 10 (env `DB_POOL_MAX`) | 2–10 |
| **data-pipeline** | 2 | 10 | 2–10 |
| **dca-engine** | — | — | **0** (HTTP-only) |
| **collectors** (3×) | — | — | **0** (HTTP-only) |

**Ukupni connection cap:** U najgorem slučaju (auth 12 + engine 10 + pipeline 10 = **32 konekcije** po workeru). S Railway-jevim default capom od 100 konekcija, ovo je sigurno s marginom. *(Nakon gašenja stripped autha stvarni cap je još niži.)*

### 2.3 Schema Initialization

Svaki servis inicijalizira svoje tablice u `lifespan` handleru:

- **-aqmath-beta-auth:** `CREATE TABLE IF NOT EXISTS` s **advisory lock** (`pg_advisory_lock`) za race-safe init preko multiple uvicorn workera. Ovo je jedini servis koji koristi advisory lock pattern — svi drugi su ranjivi na race condition kod cold starta s više workera (praktično benigno jer `IF NOT EXISTS` štiti od duplicate create, ali može izazvati constraint violation error u logovima).
- **aqmath-engine:** `portfolio_service.ensure_schema()` kreira `portfolios` i `portfolio_daily_log`, plus `ALTER TABLE ADD COLUMN IF NOT EXISTS settings` za forward compat.
- **data-pipeline:** `DataCleaner.init_db()` kreira `crypto_prices` + 3 raw tablice.
- **aqmath-beta-auth (stripped):** `CREATE TABLE IF NOT EXISTS` bez advisory locka.

---

## 3. Kompletni Data Dictionary

### 3.1 Raw Data Tables (vlasnik: data-pipeline)

#### `raw_coingecko`

| Kolona | Tip | Opis |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | Auto-increment |
| `symbol` | `VARCHAR(20) NOT NULL` | Ticker (npr. BTC) |
| `coin_id` | `VARCHAR(100)` | CoinGecko coin_id |
| `timestamp` | `TIMESTAMPTZ NOT NULL` | Vrijeme prikupljanja |
| `price` | `NUMERIC NOT NULL` | Cijena u USD |
| `volume` | `NUMERIC` | Volume |
| `market_cap` | `NUMERIC` | Market cap |
| `collected_at` | `TIMESTAMPTZ DEFAULT NOW()` | Kada je zapis ingestiran |

**Constraints:** `UNIQUE(symbol, timestamp)` — dedup na razini (symbol, timestamp).

#### `raw_kraken`

Identična struktura kao `raw_coingecko`. Vlastita tablica — source-agnostički model.

#### `raw_coinbase`

Identična struktura. **Napomena:** `ON CONFLICT` ne uključuje `market_cap` (Coinbase API ga nema) — benigna razlika.

### 3.2 Clean Data Table (vlasnik: data-pipeline)

#### `crypto_prices`

| Kolona | Tip | Opis |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | Auto-increment |
| `symbol` | `VARCHAR(20) NOT NULL` | Ticker |
| `date` | `DATE NOT NULL` | Dan (daily close) |
| `open_price` | `NUMERIC NOT NULL` | Open cijena |
| `close_price` | `NUMERIC NOT NULL` | Close cijena (glavna) |
| `high_price` | `NUMERIC` | High (uvijek NULL trenutno) |
| `low_price` | `NUMERIC` | Low (uvijek NULL trenutno) |
| `volume` | `NUMERIC` | Prosječni volume izvora |
| `source` | `VARCHAR(20) NOT NULL DEFAULT 'merged'` | `'merged'` ili `'interpolated'` ili source name |
| `data_points` | `INTEGER DEFAULT 1` | Broj izvora za taj dan (1–3) |
| `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` | Zadnji upsert |

**Constraints:** `UNIQUE(symbol, date)` — jedan red po simbolu po danu.
**Upsert:** `ON CONFLICT (symbol, date) DO UPDATE` — idempotentno, zadnji write wins.

### 3.3 Auth Tables (vlasnik: -aqmath-beta-auth)

#### `beta_activations`

| Kolona | Tip | Opis |
|---|---|---|
| `key_hash` | `TEXT PRIMARY KEY` | SHA-256(beta_key) |
| `ip_hash` | `TEXT` | HMAC-SHA256(IP + PEPPER), NULL dok se ne aktivira |
| `first_activated_at` | `TIMESTAMPTZ NOT NULL` | Početak 365-dnevnog prozora |
| `last_seen_at` | `TIMESTAMPTZ` | Zadnji login |
| `activation_count` | `INT NOT NULL DEFAULT 0` | Broj aktivacija |
| `revoked` | `BOOLEAN NOT NULL DEFAULT FALSE` | Revoked flag |

**Security:** Raw beta key nikad nije u DB — samo SHA-256 hash. Raw IP nikad nije u DB — samo HMAC-SHA256 s pepperom.

#### `auth_attempts`

| Kolona | Tip | Opis |
|---|---|---|
| `ip_hash` | `TEXT PRIMARY KEY` | HMAC-SHA256(IP + PEPPER) |
| `fail_count` | `INT NOT NULL DEFAULT 0` | Broj neuspjelih pokušaja |
| `locked_until` | `TIMESTAMPTZ` | Do kad je IP zaključan |
| `last_attempt_at` | `TIMESTAMPTZ` | Zadnji pokušaj |

**Rate limit algoritam:** Eksponencijalni backoff: `base_sec * 2^(fail_count-1)`, capped na `max_sec`. Reset nakon `reset_hours` bez pokušaja.

#### `sessions`

| Kolona | Tip | Opis |
|---|---|---|
| `session_id` | `TEXT PRIMARY KEY` | `secrets.token_urlsafe(24)` |
| `key_hash` | `TEXT NOT NULL` | Vezano uz beta_activations |
| `ip_hash` | `TEXT` | Hashirani IP |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Kada je session kreiran |
| `last_seen_at` | `TIMESTAMPTZ NOT NULL` | Zadnja aktivnost |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | Kada session istječe |

**Indexi:** `idx_sessions_key_hash` (za brzi lookup), `idx_sessions_expires_at` (za cleanup sweep).
**Session model:** Sliding idle — svaki `/auth/refresh` pomiče `expires_at` unaprijed. Jedan live session po key_hash (prethodni se brišu kod logina). Cleanup svakih 10 minuta (`DELETE WHERE expires_at <= now()`).

#### `user_holdings`

| Kolona | Tip | Opis |
|---|---|---|
| `key_hash` | `TEXT NOT NULL` | Vezano uz beta_activations |
| `token` | `TEXT NOT NULL` | Ticker |
| `amount` | `NUMERIC NOT NULL` | Količina tokena |
| `entry` | `NUMERIC` | Ulazna cijena (UI bookkeeping, NULL = nije uneseno) |
| `apy` | `NUMERIC` | Staking APY (UI bookkeeping, NULL = nije uneseno) |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | Zadnji update |

**Primary Key:** `(key_hash, token)`.
**Operacije:** `replace_holdings()` — atomarno briše sve postojeće pa inserta nove (single transaction). Vraća `first_time` flag za engine.

#### `consent_log`

| Kolona | Tip | Opis |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | Auto-increment |
| `key_hash` | `TEXT NOT NULL` | Vezano uz beta_activations |
| `consent_type` | `TEXT NOT NULL` | `notifications`, `terms`, `privacy`, `holdings` |
| `text_version_hash` | `TEXT NOT NULL` | SHA-256 verzije teksta |
| `accepted_at` | `TIMESTAMPTZ NOT NULL` | Kada je pristanak dan |

**Index:** `idx_consent_key` na `key_hash`.
**Model:** Append-only audit log. Svaka promjena verzije = novi red.

#### `read_acks`

| Kolona | Tip | Opis |
|---|---|---|
| `key_hash` | `TEXT PRIMARY KEY` | Vezano uz beta_activations |
| `text_version_hash` | `TEXT NOT NULL` | SHA-256 verzije must-read teksta |
| `acked_at` | `TIMESTAMPTZ NOT NULL` | Kada je korisnik potvrdio |

**Model:** Jedan red po korisniku, overwrite na novu verziju.

#### `ntfy_subscriptions`

| Kolona | Tip | Opis |
|---|---|---|
| `key_hash` | `TEXT PRIMARY KEY` | Vezano uz beta_activations |
| `topic` | `TEXT NOT NULL UNIQUE` | 32-char random topic name |
| `token_hash` | `TEXT NOT NULL` | SHA-256(read-only ntfy tokena) |
| `enabled` | `BOOLEAN NOT NULL DEFAULT TRUE` | Toggle |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

**Security:** Plaintext ntfy token se prikazuje **samo jednom** kod kreiranja. U DB ide samo SHA-256 hash.

### 3.4 Portfolio Automation Tables (vlasnik: aqmath-engine)

#### `portfolios`

| Kolona | Tip | Opis |
|---|---|---|
| `key_hash` | `TEXT PRIMARY KEY` | Vezano uz beta-auth `beta_activations.key_hash` |
| `tokens` | `JSONB NOT NULL` | `[{token, amount}, ...]` — zamrznuti token set |
| `weights` | `JSONB NOT NULL` | `[{sym, weight}, ...]` — KKT risk-parity težine u postocima |
| `frozen_at` | `TIMESTAMPTZ NOT NULL` | Kad su weights zamrznuti (update-a se na macro re-opt) |
| `next_reopt_at` | `TIMESTAMPTZ NOT NULL` | Sljedeći 180-dnevni macro re-opt |
| `shield_state` | `JSONB` | v14 Deleverage Shield stanje (persistira se između runova) |
| `last_run_at` | `TIMESTAMPTZ` | Zadnji uspješan daily run |
| `last_signal` | `JSONB` | Zadnji signal (za UI prikaz) |
| `settings` | `JSONB` | `{deleverage, dca_amount, dca_interval, dca_anchor, parked_usdc}` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Prvi put syncano (nikad se ne overwrite-a) |

**Design odluka:** `frozen_at` se **namjerno** overwrite-a na svaki macro re-opt (označava početak trenutnog 180-dnevnog ciklusa). `created_at` je `DEFAULT now()` i nikad se ne dira — to je pravi "kad je korisnik prvi put syncao".

#### `portfolio_daily_log`

| Kolona | Tip | Opis |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | Auto-increment |
| `key_hash` | `TEXT NOT NULL` | Vezano uz portfolios |
| `run_date` | `DATE NOT NULL` | Dan daily runa |
| `shield_active` | `BOOLEAN` | Je li shield bio aktivan |
| `exposure_frac` | `NUMERIC` | Exposure fraction (0.0–1.0) |
| `signals` | `JSONB` | Generirani signali |
| `status` | `TEXT NOT NULL` | `ok`, `error`, `skip`, `running` |
| `detail` | `TEXT` | Error poruka (max 500 chars) |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Constraints:** `UNIQUE(key_hash, run_date)` — idempotentan daily run, jedan red po korisniku po danu.

### 3.5 Stripped-Down Auth Tables (vlasnik: aqmath-beta-auth) ⚰️ DECOMMISSIONED 2026-08-11

Samo `beta_activations` i `auth_attempts` — identične strukture, bez sessions/holdings/consent/acks/ntfy. **Ovaj repo je outdated fork — kanonska verzija je `-aqmath-beta-auth`.** Railway service i GitHub repo obrisani 2026-08-11 (security remedijacija, Medium 3) — lokalni klon ostaje samo za povijest; više ne drži konekcije ni tablice.

---

## 4. Data Flow — Kompletni Put Podataka

```
COLLECTOR LAYER                    DATA-PIPELINE                    ENGINE LAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────┐
│ CoinGecko    │───┐
│ Collector    │   │  POST /api/raw
└──────────────┘   │  X-Collector-Secret
                   ├────────────────────┐
┌──────────────┐   │                   │
│ Kraken       │───┘                   ▼
│ Collector    │            ┌──────────────────┐
└──────────────┘            │  data-pipeline   │
                            │                  │
┌──────────────┐            │  raw_coingecko   │──┐
│ Coinbase     │───POST────▶│  raw_kraken      │  │  nightly
│ Collector    │  /api/raw  │  raw_coinbase    │  │  01:00 UTC
└──────────────┘            │                  │  │  clean_all()
                            └──────────────────┘  │
                                                   ▼
                                        ┌──────────────────┐
                                        │  CLEANING PIPELINE│
                                        │                  │
                                        │ 1. fetch_raw     │
                                        │ 2. deduplicate   │  per source
                                        │ 3. remove_outliers│ (4.5σ, 7d window)
                                        │ 4. merge_sources │  median cross-source
                                        │ 5. fill_gaps     │  ≤2 day interpolation
                                        │ 6. validate      │
                                        │ 7. upsert        │──▶ crypto_prices
                                        └──────────────────┘
                                                   │
                          ┌────────────────────────┼──────────────────────┐
                          │                        │                      │
                          ▼                        ▼                      ▼
                   ┌─────────────┐         ┌─────────────┐        ┌─────────────┐
                   │ aqmath-engine│         │ dca-engine  │        │ data-pipeline│
                   │             │         │             │        │ /api/prices  │
                   │ DIRECT DB   │         │ HTTP to     │        │ (JWT-gated)  │
                   │ asyncpg pool│         │ data-pipeline│        │              │
                   │             │         │ /api/prices  │        │              │
                   │ SELECT FROM │         │ (service JWT)│        │              │
                   │ crypto_     │         │             │        │              │
                   │ prices      │         │ + TTLCache   │        │              │
                   └─────────────┘         └─────────────┘        └─────────────┘

PORTFOLIO AUTOMATION (aqmath-engine cron):

   aqmath-engine ──GET /internal/users──▶ -aqmath-beta-auth (X-Admin-Secret)
         │                                         │
         │ ◀──────── key_hashes ──────────────────┘
         │
         │  Za svaki key_hash:
         ├── GET /internal/user?key_hash=... ──▶ holdings + ntfy topic
         ├── SELECT FROM portfolios WHERE key_hash = ...
         ├── SELECT FROM crypto_prices (za sve tokene)
         ├── run_deleverage() → novi shield_state + target weights
         ├── UPDATE portfolios SET shield_state, last_signal
         ├── INSERT INTO portfolio_daily_log (idempotentno)
         └── POST ntfy (ako je shield state promijenjen ili DCA due)
```

---

## 5. Query Patterns & Performance

### 5.1 Najčešći Queryi (read path)

| Query | Servis | Frekvencija | Pattern | Index? |
|---|---|---|---|---|
| `SELECT close_price FROM crypto_prices WHERE symbol=$1 ORDER BY date ASC` | engine | Svaki /optimize, /history | Full scan po symbolu | ❌ Nema index na `(symbol, date)` |
| `SELECT close_price FROM crypto_prices WHERE symbol=$1 ORDER BY date DESC LIMIT 1` | engine | Svaki /prices/{sym} | Latest price | ❌ Isto — sort je na `date` bez indexa |
| `SELECT symbol, COUNT(*), MIN(date), MAX(date) FROM crypto_prices GROUP BY symbol` | engine, pipeline | Svaki app load (/symbols) | Full table GROUP BY | ❌ Nema index, ali cache-an 6h |
| `SELECT * FROM beta_activations WHERE key_hash = $1` | auth | Svaka auth operacija | PK lookup | ✅ PRIMARY KEY |
| `SELECT key_hash FROM portfolios WHERE key_hash = $1` | engine | Svaki /portfolio/* | PK lookup | ✅ PRIMARY KEY |
| `INSERT INTO portfolio_daily_log ... ON CONFLICT (key_hash, run_date) DO NOTHING` | engine cron | Jednom dnevno po useru | Idempotency gate | ✅ UNIQUE constraint |

### 5.2 Caching Slojevi

Svaki read-intensive servis ima **in-process TTLCache** (daily-rollover TTL):

| Cache | Servis | TTL | Singleflight? | Opis |
|---|---|---|---|---|
| `_PRICES_CACHE` | data-pipeline | Daily rollover (01:10 UTC) | ✅ `lock_for()` | Puni niz close cijena po symbolu |
| `_HISTORY_CACHE` (engine-history) | aqmath-engine | Daily rollover / fixed TTL | ✅ `lock_for()` | Puni niz close cijena po symbolu |
| `_latest_price_cache` (engine-prices) | aqmath-engine | 3600s (env) | ✅ `lock_for()` | Zadnja cijena po symbolu |
| `_OPT_CACHE` (engine-optimize) | aqmath-engine | Daily rollover | ❌ | KKT baze rezultati po basketu |
| `_HISTORY_CACHE` (dca-history) | dca-engine | Daily rollover | ✅ `lock_for()` | HTTP-fetchani price history |
| `_binance_*_cache` | dca-engine | 30–3600s | ❌ | Binance proxy (rate limit protection) |
| `_symbols_cache` (engine) | aqmath-engine | 21600s (6h) | ❌ | /symbols GROUP BY rezultat |
| `_symbols_cache` (pipeline) | data-pipeline | 21600s (6h) | ❌ | /api/symbols GROUP BY rezultat |
| `_slots_cache` | beta-auth | 15s | ❌ | COUNT(*) slotova |

**TTLCache design pattern (konzistentan kroz sve servise):**
- `lock_for(key)` — asyncio.Lock per key → N concurrent miss-ova = 1 upstream fetch
- Samo uspješni rezultati se cachiraju (errori nikad)
- Bounded size (`max_keys`), s evictionom najstarijeg entryja
- Daily rollover = TTL do 01:10 UTC sljedećeg dana (nakon što pipeline završi)

### 5.3 Write Patterns

| Operacija | Servis | Pattern | Frekvencija |
|---|---|---|---|
| Raw ingest | Collectors → pipeline | Batch INSERT (1 record po requestu, `ON CONFLICT DO UPDATE`) | Dnevno, ~8–20 tokena × 3 collector-a |
| Clean upsert | data-pipeline | Batch UPSERT (`ON CONFLICT (symbol, date) DO UPDATE`) | Nightly 01:00 UTC |
| Portfolio save | aqmath-engine | `INSERT ... ON CONFLICT DO UPDATE` | Na prvi sync, pa na macro re-opt (180d) |
| Daily log insert | aqmath-engine | `INSERT ... ON CONFLICT` s retry-friendly WHERE klauzom | Jednom dnevno po useru |
| Session create/update | beta-auth | `DELETE` + `INSERT` (create), `UPDATE ... WHERE expires_at > $2` (slide) | Na login/refresh |
| Holdings replace | beta-auth | `DELETE` + batch `INSERT` u transakciji | Na svaki portfolio save |

---

## 6. Schema Design Analiza

### 6.1 Snage (Strengths)

#### S1 — Clean Separation of Concerns
Tablični ownership je kristalno jasan. Engine ne dira auth tablice. Auth ne dira price tablice. Pipeline je jedini writer u `crypto_prices`. **Nijedan servis ne radi cross-domain JOIN.**

#### S2 — Idempotentni Writeovi
Svaki write je `INSERT ... ON CONFLICT DO UPDATE` ili ima eksplicitni idempotency gate (`portfolio_daily_log` s UNIQUE + retry-aware `claim_daily_run`). **Sistem je siguran za retry i recovery bez duplih notifikacija.**

#### S3 — Hash-Only Storage za Osjetljive Podatke
- Beta ključevi: samo SHA-256 u `beta_activations.key_hash`
- IP adrese: samo HMAC-SHA256(IP + PEPPER) u `beta_activations.ip_hash`
- Ntfy tokeni: samo SHA-256 u `ntfy_subscriptions.token_hash`

**Database dump ne sadrži nijedan plaintext secret.** Čak i ako PostgreSQL disk procuri, napadač ne može rekonstruirati ključeve.

#### S4 — Advisory Lock za Schema Init
`-aqmath-beta-auth` koristi `pg_advisory_lock(hashtext('beta-auth-schema-init'))` za race-safe schema kreaciju preko multiple uvicorn workera. Ovo je **jedini ispravan način** da se izbjegne `pg_type_typname_nsp_index` duplicate key error kod cold starta.

#### S5 — Forward-Compatible Schema Evolution
`ALTER TABLE ADD COLUMN IF NOT EXISTS` se koristi za dodavanje kolona bez downtimea:
- `user_holdings.entry` i `user_holdings.apy` — dodane naknadno
- `portfolios.settings` — dodano naknadno

#### S6 — Retry-Safe Daily Run Gate
`claim_daily_run()` u `portfolio_daily_log` tabeli je sofisticiran idempotency gate:
```sql
INSERT INTO portfolio_daily_log (key_hash, run_date, status)
VALUES ($1, $2, 'running')
ON CONFLICT (key_hash, run_date) DO UPDATE
   SET status = 'running', detail = '', created_at = now()
 WHERE portfolio_daily_log.status IN ('error', 'skip')
    OR (portfolio_daily_log.status = 'running'
        AND portfolio_daily_log.created_at < now() - INTERVAL '30 minutes')
```
- `ok` redovi su **trajno zaključani** (nikad se ne overwrite-aju)
- `error` i `skip` redovi su **re-claimable** (retry istog dana)
- `running` redovi stariji od 30 min su **re-claimable** (recovery od killed processa)

#### S7 — GDPR-Compliant Revocation
`revoke_key()` u jednoj transakciji:
1. `UPDATE beta_activations SET revoked = TRUE`
2. `DELETE FROM sessions`
3. `DELETE FROM user_holdings`
4. `DELETE FROM consent_log`
5. `DELETE FROM read_acks`
6. `DELETE FROM ntfy_subscriptions`

Potpuno brisanje svih korisničkih podataka — "right to erasure" spreman.

#### S8 — Numeric za Financijske Podatke
`amount NUMERIC` i `price NUMERIC` — bez floating-point artefakata u financijskim kalkulacijama. Python strana koristi `decimal.Decimal` za parsiranje.

### 6.2 Slabosti i Preporuke

#### W1 — Missing Index na crypto_prices (symbol, date) ✅ POPRAVLJENO (2026-08-09)
**Problem:** Svaki `/optimize`, `/history/{symbol}`, `/api/prices` radi:
```sql
SELECT close_price FROM crypto_prices WHERE symbol = $1 ORDER BY date ASC
```
PostgreSQL mora raditi **full table scan** ili barem scan svih redova za taj symbol, sortiranih po `date`. S rastućom količinom podataka (30+ tokena × 365+ dana × više izvora), performanse će degradirati.

**Fix (primijenjen):** Index dodan u `CREATE_CLEAN_TABLE_SQL` u `data-pipeline/cleaner.py`:
```sql
CREATE INDEX IF NOT EXISTS idx_crypto_prices_symbol_date
    ON crypto_prices (symbol, date);
```
Idempotentan (`IF NOT EXISTS`) — produkcijska baza dobiva index automatski na sljedećem deployu data-pipelinea, bez migration skripte.

**Impact:** Oba vruća read patha (history `ORDER BY date ASC` i latest price `ORDER BY date DESC LIMIT 1`) postaju index scan po `(symbol, date)` umjesto scan + sort cijelog skupa redova. Caching i dalje štiti pod loadom, ali cold-cache miss više ne plaća sort.

#### W2 — Missing Foreign Key Constraints ℹ️ INFO
**Problem:** `portfolio_daily_log.key_hash`, `portfolios.key_hash`, `user_holdings.key_hash` — nijedan nema FK constraint prema `beta_activations.key_hash`. Ovo je svjesni izbor (servisi su na različitim Railway appovima, dijele samo connection string), ali znači da **ništa ne garantira referencijalni integritet** na DB razini.

**Impact:** Orphan redovi u `portfolios` za revoked/deleted ključeve. Trenutno benigno jer daily cron iterira samo aktivne ključeve iz auth servisa.

**Preporuka:** Za beta — prihvatljivo. Za production — razmisliti o `FOREIGN KEY ... ON DELETE CASCADE` ili cleanup CRONu.

#### W3 — No Index on portfolio_daily_log (key_hash, run_date DESC) ℹ️ LOW
`recent_runs()` query:
```sql
SELECT ... FROM portfolio_daily_log WHERE key_hash = $1 ORDER BY run_date DESC LIMIT $2
```
UNIQUE constraint na `(key_hash, run_date)` služi kao de facto index, ali sort direction (`DESC`) može biti suboptimalan.

#### W4 — JSONB bez Schema Validacije ℹ️ LOW
`portfolios.weights`, `portfolios.shield_state`, `portfolios.last_signal`, `portfolios.settings` — svi JSONB. Python kod validira strukturu prije write-a, ali **DB razina nema nikakvu garanciju** da su podaci ispravnog oblika.

**Preporuka:** Za production, dodati `CHECK` constraint s `jsonb_typeof` ili koristiti PostgreSQL check constraint za kritična polja.

#### W5 — COUNT(*) bez Cache-a na /api/slots (stripped auth) ✅ RIJEŠENO (2026-08-11)
`aqmath-beta-auth` (stripped) nema in-memory cache za `/api/slots`:
```python
used = await db.count_active(cutoff)  # direktan COUNT(*) svaki put
```
Kanonska verzija (`-aqmath-beta-auth`) ima 15s TTL cache. Svaki landing page posjetitelj pogađa ovaj endpoint.

**Status:** Nalaz zastario — stripped auth je decommissioned (Railway + GitHub obrisani), pa problematični endpoint više ne postoji. Kanonski servis s 15s cacheom je jedini live.

---

## 7. Data Integrity & Pipeline Robustnost

### 7.1 Cleaning Pipeline — Potpuni Flow

```
fetch_raw_data(sym)
  ├── raw_coingecko ──▶ DISTINCT ON (DATE(timestamp)) ... ORDER BY timestamp DESC
  ├── raw_kraken    ──▶ DISTINCT ON ...
  └── raw_coinbase  ──▶ DISTINCT ON ...
         │
         ▼
  ┌─────────────────┐
  │  PER SOURCE:     │
  │  1. deduplicate  │  (keep last per date)
  │  2. remove_      │  (4.5σ, 7-day rolling window)
  │     outliers     │
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐
  │  CROSS-SOURCE:   │
  │  3. merge_sources│  MEDIAN (not average!) across sources
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐
  │  4. fill_gaps    │  linear interpolation, ≤2 days
  │  5. validate     │  gap detection, extreme jumps, duplicates
  │  6. upsert       │  ON CONFLICT (symbol, date) DO UPDATE
  └─────────────────┘
```

### 7.2 Merge Strategija — Median vs Average

Pipelin koristi **median** (ne prosjek!) za cross-source merge:
```python
sorted_entries = sorted(entries, key=lambda x: x["price"])
mid = len(sorted_entries) // 2
median_entry = sorted_entries[mid]
```
Ovo je **otpornije na outliere** od prosjeka — jedan source s lošim podatkom ne može značajno pomaknuti cijenu.

### 7.3 Outlier Detection — Rolling Window

```python
window = data[start:end]  # ±7 dana
mean = sum(window) / len(window)
variance = sum((x - mean) ** 2 for x in window) / len(window)
std = math.sqrt(variance)
if abs(price - mean) > 4.5 * std: → remove
```

4.5σ threshold je **vrlo konzervativan** — uklanja samo ekstremne outliere (1 u ~300,000 data pointova za normalnu distribuciju).

### 7.4 Validator Rules

| Test | Threshold |
|---|---|
| Minimum history | 180 dana |
| Gap detection | >2 dana (flag, ne error) |
| Zero/negative price | Error |
| Duplicate dates | Warning |
| Extreme daily change | >50% — warning |

---

## 8. Pool Management Best Practices

### 8.1 Pool Inicijalizacija

Svaki servis inicijalizira pool u `lifespan` startup fazi. Ako `DATABASE_URL` nije postavljen ili je JWT_SECRET prekratak (<32 chars), servis odbija startati **prije** nego što primi ijedan request. Ovo je health-check friendly (Railway vidi crash loop i ne šalje traffic).

### 8.2 Transaction Management

| Pattern | Gdje se koristi |
|---|---|
| `async with conn.transaction()` | `replace_holdings`, `revoke_key`, `create_session` |
| Single-statement implicit transaction | Većina simple querya |
| Advisory lock | `_init_schema` u `-aqmath-beta-auth` |

### 8.3 Connection Leak Prevention

- Svaki `pool.acquire()` je u `async with` bloku — connection se garantirano vraća u pool.
- Nema manual `conn.close()` poziva — sve je delegirano context manageru.

---

## 9. Collector-to-Pipeline Ingestion

### 9.1 Auth Model

Collectori ne nose JWT. Umjesto toga, pipeline koristi **static secret** (`X-Collector-Secret` header):

```python
COLLECTOR_SECRETS = set(s.strip() for s in os.getenv("COLLECTOR_SECRETS", "").split(","))
if not any(hmac.compare_digest(provided, s) for s in COLLECTOR_SECRETS):
    raise HTTPException(401)
```

- `COLLECTOR_SECRETS` (comma-separated): **preferirani** oblik — jedan secret po collector-u
- `COLLECTOR_SECRET` (single): **legacy fallback** — jedan shared secret

`hmac.compare_digest` je timing-safe — onemogućava timing attack na dužinu/vrijednost secreta.

**Update 2026-08-11 (security remedijacija):** isti secret sada štiti i **read path** — kolektori šalju `X-Collector-Secret` i na GET `/api/symbols` (kraken, coinbase, coingecko, mexc), a pipeline endpointi (`/api/symbols`, `/symbols`, `/stats`, `/api/volatility`) više ne odgovaraju anonimnim pozivima (dual-auth: beta JWT ili collector secret). Pipeline ujedno nema javnu domenu — dostupan je samo preko `*.railway.internal`.

### 9.2 Ingestion Data Format

Flat array, source per record:
```json
[
  {"symbol": "BTC", "timestamp": "2026-08-09T00:00:00Z", "price": 67210.34, "volume": 123.45, "source": "coingecko"},
  {"symbol": "ETH", "timestamp": "2026-08-09T00:00:00Z", "price": 3210.50, "volume": 456.78, "source": "kraken"}
]
```

Svaki record ide u svoju raw tablicu (`raw_coingecko`, `raw_kraken`, `raw_coinbase`). Nepoznati source se preskače s warningom.

### 9.3 Hard Limits

| Limit | Vrijednost | Opis |
|---|---|---|
| `MAX_RAW_RECORDS` | 50000 (env) | Max records po ingestion batchu |
| Batch size | 1 record po requestu (u praksi) | Collector šalje jedan po jedan |

---

## 10. Security Considerations

### 10.1 Database Credential Security

| Aspekt | Status |
|---|---|
| `DATABASE_URL` u env varu | ✅ Standardna Railway praksa |
| Hardcodirani credentials | ✅ Nema — `config.py` uzima samo iz `os.getenv()` |
| Connection string validacija | ✅ `if not DATABASE_URL: raise RuntimeError` na startupu |
| SSL/TLS | ✅ Railway internal network — connection je unutar VPC-a |

### 10.2 SQL Injection

**Svi queryi koriste parameterizirane upite** (`$1`, `$2`, ...). Nema string concatenationa za user input. Jedini dinamički SQL je table name u `get_raw_symbols()`:
```python
" FROM " + table  # table je hardcodiran iz VALID_RAW_TABLES dictionarya
```
Ovo je sigurno jer `table` dolazi iz fiksnog dictionarya, ne iz user inputa.

### 10.3 Hash Security

| Hash | Algoritam | Key Space | Kolizijska Otpornost |
|---|---|---|---|
| Beta key | SHA-256 | 256-bit | \( 2^{128} \) (birthday bound) |
| IP + pepper | HMAC-SHA256 | 256-bit + pepper entropy | Ne može se rainbow-table-at bez peppera |
| Ntfy token | SHA-256 | 256-bit | Token je 32-char random (`token_urlsafe(24)`) |

---

## 11. Data Volume Procijena

### 11.1 Po danu (s 30 tokena)

| Tablica | Redova/dan |
|---|---|
| `raw_coingecko` | ~30 (1 dnevni close po tokenu × CG) |
| `raw_kraken` | ~30 |
| `raw_coinbase` | ~30 |
| `crypto_prices` | ~30 (merged) |
| **Ukupno raw** | ~90 redova/dan |

### 11.2 Godišnje

| Tablica | Redova/godina |
|---|---|
| raw_* × 3 | ~32,850 |
| crypto_prices | ~10,950 |
| portfolio_daily_log | ~3,650 po aktivnom useru |
| auth tablice | ~20–200 (broj usera × mali overhead) |

**Ukupna veličina baze nakon 1 godine s 50 aktivnih usera:** ~50–100 MB. PostgreSQL na Railwayu ovo podnosi bez ikakvog napora.

---

## 12. Dvostruki Auth Repozitoriji — Database Dif

| Tablica | `-aqmath-beta-auth` (kanonski) | `aqmath-beta-auth` (stripped) |
|---|---|---|
| `beta_activations` | ✅ | ✅ (identično) |
| `auth_attempts` | ✅ | ✅ (identično) |
| `sessions` | ✅ + 2 indexa + cleanup sweep | ❌ |
| `user_holdings` | ✅ + `entry`/`apy` kolone | ❌ |
| `consent_log` | ✅ + index | ❌ |
| `read_acks` | ✅ | ❌ |
| `ntfy_subscriptions` | ✅ | ❌ |
| Schema init lock | ✅ `pg_advisory_lock` | ❌ |
| Pool max | 12 (env) | 5 (hardcoded) |
| RL_MAX_SEC default | 900 (15 min) | 3600 (1 sat) |
| SESSION_IDLE_MINUTES | 30 (sliding) | ❌ (no sessions) |

**Zaključak:** `aqmath-beta-auth` je **starija, nepotpuna verzija**. Ne podržava sliding sessions, portfolio storage, ntfy notifikacije, GDPR consent log, ni must-read ack. ~~Treba ga arhivirati/obrisati.~~ ✅ **DONE 2026-08-11** — Railway service obrisan, GitHub repo obrisan; ostaje samo kanonski `-aqmath-beta-auth`.

---

## 13. Sažetak — Brojke

| Metrika | Vrijednost |
|---|---|
| **PostgreSQL instanci** | **1** (Railway managed) |
| **Ukupno tablica** | **14** (3 raw + 1 clean + 7 auth + 2 portfolio + 1 stripped duplicate set) |
| **Servisnih vlasnika tablica** | **3** (data-pipeline, beta-auth, engine) |
| **Servisa bez direktnog DB pristupa** | **4** (dca-engine + 3 collector-a) |
| **Connection poolova** | **3** (auth, engine, pipeline) |
| **Max konkurentnih konekcija** | **32** (12+10+10, 1 worker each) |
| **Caching layera (TTLCache)** | **9** in-process caches |
| **Hash-only stored secrets** | **3 tipa** (beta keys, IPs, ntfy tokens) |
| **Idempotentnih writeova** | **Svi** (UPSERT / ON CONFLICT) |
| **Missing indexa** | **0** ✅ (`idx_crypto_prices_symbol_date` dodan 2026-08-09) |
| **Missing FK constraints** | **3** (svjesni izbor za beta) |
| **SQL injection rizik** | **0** (svi parametrizirani) |

---

## 14. Verdict

**Database arhitektura je čvrsta za beta fazu.** Jedna PostgreSQL instanca je više nego dovoljna za predviđeni load (50–200 korisnika). Hash-only storage za osjetljive podatke je best practice. Idempotentni writeovi i retry-safe daily run gate su produkcijski obrasci.

**Prioritetne akcije za production:**
1. ~~Dodati index na `crypto_prices(symbol, date)`~~ ✅ **DONE** (2026-08-09, u `data-pipeline/cleaner.py`) — verificirano 2026-08-11: `CREATE INDEX IF NOT EXISTS` je samostalna naredba u `CREATE_CLEAN_TABLE_SQL` i izvršava se pri svakom startupu u `init_db()`, pa je produkcijska tablica dobila index na deployu.
2. ~~**Arhivirati `aqmath-beta-auth`** — konsolidirati na kanonsku verziju~~ ✅ **DONE 2026-08-11** — Railway service i GitHub repo obrisani (još agresivnije od archivea).
3. **Dodati `CHECK` constraint na JSONB polja** — schema validacija na DB razini. ⏳ **OPEN — jedina preostala akcija iz ovog audita** (low priority: Python sloj već validira prije writea; za produkciju iznad ~100 korisnika).
4. ~~Connection pooling monitoring~~ ✅ **DONE** (2026-08-09) — `GET /metrics` endpoint dodan u `data-pipeline`, `aqmath-engine` i `-aqmath-beta-auth` (gated by `METRICS_TOKEN` env var, header `X-Metrics-Token`; unset token → 503). Vraća `db_pool{size, idle, in_use, min, max, utilization}` + uptime.

**Stanje nakon revizije 2026-08-11:** 3 od 4 prioritetne akcije gotove. W2 (FK constraints) ostaje svjestan tradeoff za beta fazu; W3/W4 su low-priority preporuke bez roka.

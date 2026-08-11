# 🔐 AQMath — Potpuni Security & Architecture Audit

**Datum:** 2026-08-09
**Opseg:** Svih 9 repozitorija
**Metodologija:** Puni code review svakog servisa, CI pipelinea, Dockerfileova, konfiguracije i međuservisne komunikacije

---

## 📐 Arhitektonski Slojevi (Layers): **8**

Cijeli AQMath projekt strukturiran je u 8 precizno odvojenih arhitektonskih slojeva:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 8   INFRASTRUKTURA                                   │
│            Railway PaaS, PostgreSQL, GitHub Actions CI/CD   │
├─────────────────────────────────────────────────────────────┤
│  LAYER 7   PREZENTACIJA                                     │
│            aqmath-ui (GitHub Pages + Caddy static server)   │
├─────────────────────────────────────────────────────────────┤
│  LAYER 6   DCA RUTIRANJE                                    │
│            dca-engine (:8006) — distribucija, Binance proxy │
├─────────────────────────────────────────────────────────────┤
│  LAYER 5   OPTIMIZACIJSKI ENGINE                            │
│            aqmath-engine (:8005) — ERC, KKT, Deleverage     │
├─────────────────────────────────────────────────────────────┤
│  LAYER 4   AUTENTIFIKACIJA                                  │
│            aqmath-beta-auth (:8000) — JWT, session, IP bind │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3   OBRADA PODATAKA                                 │
│            data-pipeline (:8004) — clean, merge, validate   │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2   PRIKUPLJANJE PODATAKA                           │
│            coinbase-collector (:8003)                       │
│            coingecko-collector (:8001)                      │
│            kraken-collector (:8002)                         │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1   VANJSKI API IZVORI                               │
│            Coinbase Exchange, CoinGecko, Kraken, Binance    │
└─────────────────────────────────────────────────────────────┘
```

**Broj mikroservisa:** 7 (3 collector + pipeline + engine + dca + auth)
**Broj repozitorija:** 9
**Ukupno Python koda:** ~6,200 linija
**Baza podataka:** 2 PostgreSQL instance (pipeline/engine dijele jednu; beta-auth ima vlastitu)

---

## 🏗️ Detaljni Pregled po Layeru

### LAYER 1 — Vanjski API Izvori

| Izvor | Tip | Rate Limit | Pokrivenost |
|---|---|---|---|
| **Coinbase Exchange** | Public REST, `api.exchange.coinbase.com` | ~2,500 calls/dan | 55 tokena (BTC–PAXG). Dnevni candle granularity (86400s) |
| **CoinGecko** | Free tier, `api.coingecko.com/api/v3` | ~500 calls/dan | Svi tokeni + 5 ekskluzivnih (ATH, DAG, EWT, PEAQ, TICS). `/market_chart` endpoint |
| **Kraken** | Public REST, `api.kraken.com/0/public` | ~2,000 calls/dan | 53 tokena (BTC–PAXG). OHLC s daily intervalom (1440 min) |
| **Binance** | Public REST, `api.binance.com/api/v3` | Besplatni tier, cached | Live pricing widgeti. `ticker/price`, `ticker/24hr`, `klines` |

### LAYER 2 — Data Collection (3 Collector Servisa)

Svaki collector je **nezavisni FastAPI mikroservis** deployan na Railway. **Nemaju direktan DB pristup** — sve šalju u data-pipeline preko `POST /api/raw` s `X-Collector-Secret` autentifikacijskim headerom.

#### Zajedničke karakteristike sva tri collectora:
- `hmac.compare_digest` za `X-Collector-Secret` validaciju (timing-safe usporedba)
- Browser-like User-Agent headeri (Chrome 125, Windows)
- Jitterani delayevi između requestova (random uniform, ne fiksni intervali)
- Eksponencijalni backoff na HTTP 429 s automatskim cooldown resetom
- Dnevni API budget tracking (pauzira skupljanje kad se približi limitu)
- Randomizirani redoslijed simbola tijekom bulk collecta
- Duže pauze svakih N simbola (bulk pacing)
- Seed simboli za bootstrap kad je pipeline baza prazna
- Startup validacija: `COLLECTOR_SECRET` **mora** biti postavljen (fail-fast)

#### CoinGecko Collector (`:8001`)
- **Daily cron:** 00:05 UTC (prvi — najosjetljiviji na rate limit)
- **Rate limiting:** 8–15s delay, 60s base backoff → 300s max (5 min)
- **Circuit breaker:** 8 uzastopnih 429 → abort cijelog runa (čuva kvotu)
- **429 poisoning detection:** HTTP 404 tijekom 429 streaka tretira se kao rate-limit poisoning → fallback na 429 handler
- **Fallback:** Ako 365-day fetch vrati prazno → retry sa 90, pa 30 dana
- **Custom coin map:** Pinani CoinGecko ID-jevi za tokene čiji ticker kolizionira (MKR, VET, HBAR, WLD)
- **Ekskluzivni tokeni:** ATH, DAG, EWT, PEAQ, TICS (samo na CoinGecko)
- **Bootstrap skripta:** `bootstrap_exclusive.py` — jednokratni bulk import za CG-only tokene

#### Kraken Collector (`:8002`)
- **Daily cron:** 00:10 UTC (drugi)
- **Rate limiting:** 2–5s delay, 30s base backoff → 180s max (3 min)
- **OHLC endpoint:** 720 candleova po requestu (max), automatska paginacija unatrag
- **Error handling:** Prepoznaje "Unknown asset pair" → graceful skip
- **BTC mapping:** Kraken koristi `XBT` umjesto `BTC` → `XBTUSD`

#### Coinbase Collector (`:8003`)
- **Daily cron:** 00:15 UTC (treći, s odmakom)
- **Rate limiting:** 2.5–6s delay, 30s base backoff → 180s max
- **Candle granularity:** 86400s (dnevni), max 300 candleova po requestu
- **Bulk paginacija:** Chunk-po-chunk unatrag kroz 365 dana s deduplikacijom

### LAYER 3 — Data Processing (data-pipeline)

**Centralni data processing servis** — jedini servis s **direktnim DB pristupom** na clean podatke. Port `:8004`.

#### PostgreSQL Schema
- `raw_coingecko`, `raw_kraken`, `raw_coinbase` — raw ingestion tablice, `UNIQUE(symbol, timestamp)`
- `crypto_prices` — clean podaci, `UNIQUE(symbol, date)`
- Sve insert operacije koriste `ON CONFLICT ... DO UPDATE` (idempotentne)

#### Cleaning Pipeline (izvršava se noću u 01:00 UTC)
```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌────────┐    ┌──────────┐    ┌───────┐
│ Fetch    │───→│ Dedup    │───→│ Outlier   │───→│ Cross-   │───→│ Gap    │───→│ Validate │───→│ Store │
│ raw data │    │ per src  │    │ removal   │    │ source   │    │ fill   │    │          │    │ clean │
│(3 source)│    │          │    │(4.5σ,7d)  │    │ merge    │    │(≤2d)  │    │          │    │ data  │
└──────────┘    └──────────┘    └───────────┘    └──────────┘    └────────┘    └──────────┘    └───────┘
```

**Ključni koraci:**
1. **Fetch raw** — čita iz sve tri raw tablice po symbolu (`DISTINCT ON DATE(timestamp)`)
2. **Dedup per source** — last write wins po datumu unutar svakog sourcea
3. **Outlier removal per source** — 4.5σ rolling window (7 dana). **Kritično: outlier removal se izvodi po sourceu PRIJE mergea** — outlier s jednog sourcea ne kontaminira druge
4. **Cross-source median merge** — **medijan** cijena po datumu (ne prosjek!). Ako 3 sourcea: uzima srednju. Ako 2: uzima višu (median of 2 = higher). Ako 1: taj source je jedina istina
5. **Gap fill** — linearna interpolacija za rupe ≤2 dana (MAX_GAP_FILL_DAYS)
6. **Validate** — flagga >50% dnevne skokove (warning), detektira gapove >2 dana (warning), provjerava duplikate (warning), minimum 180 dana povijesti (warning)
7. **Store** — upsert u `crypto_prices` s `ON CONFLICT (symbol, date) DO UPDATE`

#### API Endpointi
| Endpoint | Auth | Opis |
|---|---|---|
| `POST /api/raw` | `X-Collector-Secret` (COLLECTOR_SECRETS) | Raw ingestion iz collectora |
| `GET /api/prices` | JWT (Bearer) | Clean close price history |
| `GET /api/volatility` | JWT (Bearer) | Trailing volatility |
| `GET /api/symbols` | JWT (Bearer) | Popis tokena s clean podacima |
| `GET /api/stats` | JWT (Bearer) | Pipeline statistika |
| `POST /api/clean` | Internal (JWT) | Ručno trigeriranje čišćenja |

#### Optimizacije
- **TTLCache** (`_PRICES_CACHE`): Puna price serija cacheirana po symbolu s daily-rollover TTL-om. /api/prices, /api/volatility i svi downstream servisi dijele jedan DB fetch po symbolu dnevno
- **Singleflight**: `lock_for()` kolapsira konkurentne missove za isti symbol u jedan DB query
- **Parallel cleaning**: `asyncio.Semaphore(5)` — max 5 simbola paralelno tijekom noćnog čišćenja
- **Cache invalidation**: `invalidate_price_cache()` se poziva nakon svakog cleaning runa

#### Validator
- `validate_prices()` — provjerava non-positive cijene, detektira rupe >2 dana, flagga >50% dnevne skokove, detektira duplikate
- `validate_raw_record()` — validira svaki raw record prije inserta (mora imati symbol, timestamp, price > 0)
- **Važno:** Validator **ne odbija** podatke s >50% skokovima — samo warning. Odbija samo fatalne greške (non-positive cijene)

### LAYER 4 — Autentifikacija (aqmath-beta-auth)

**Dva repozitorija postoje za isti servis:**

| Repozitorij | Linija | Opis |
|---|---|---|
| `aqmath-beta-auth` | 301 | Starija/stripped-down verzija: basic JWT, IP binding, rate limiting |
| `-aqmath-beta-auth` | 838 | **Puna produkcijska verzija:** sve iznad + portfolio storage, sliding sessions, GDPR consent, ntfy notifications, internal user endpoint, admin revoke/reset |

> ⚠️ **Nalaz M3:** Dvije verzije istog servisa u odvojenim repozitorijima. `-aqmath-beta-auth` (838 linija) je kanonska produkcijska verzija. Preporuka: arhivirati stariji repozitorij.

**Arhitektura autentifikacije (puna verzija):**

#### Key Management
- **Beta ključevi:** `AQMBETA-XXXX-XXXX` format
- **Unlimited ključevi:** bez expirya, bez IP bindinga, bypassaju lock
- **Hashiranje:** SAMO SHA-256 hash ključa se drži u memoriji i bazi. Raw plaintext key nikad ne dotiče DB
- **IP hashiranje:** HMAC-SHA256(`IP` + `IP_HASH_PEPPER`). Bez peppera nije moguće rekonstruirati IP iz hasha

#### Session Management
- **Sliding idle window:** 30 minuta neaktivnosti (konfigurabilno: `SESSION_IDLE_MINUTES`)
- **Server time only:** Sve provjere idu prema server vremenu. Client clock ne može oživjeti mrtvi session
- **DB guard:** `UPDATE sessions SET expires_at = $3 WHERE session_id = $1 AND expires_at > $2` — ako je session već istekao, refresh je nemoćan
- **Session cleanup:** Background task svakih 10 minuta briše expired sessione
- **Jedan session po ključu:** Novi login briše stari session (DELETE + INSERT u transakciji)

#### Rate Limiting (failed attempts)
- **Eksponencijalni backoff:** 2s → 4s → 8s → 16s → ... → 900s max (15 min)
- **Reset:** 24 sata bez pokušaja → brojač se resetira
- **Samo za INVALID ključeve:** Validni ključ nikad nije kolateralno blokiran zato što netko drugi iza istog NAT-a bruteforca
- **Per-replica blanket rate limit:** 120 req/min po IP-u, 10,000 max IP-ova u memoriji

#### Token struktura
```json
{
  "beta": true,
  "kid": "<sha256(key)>",
  "iat": "<issued-at>",
  "exp": "<expires-at>",
  "sid": "<session-id>"
}
```
- `kid` = SHA-256 hash beta ključa → koristi se za revokaciju (`REVOKED_KIDS`)
- `sid` = `secrets.token_urlsafe(24)` → session ID za sliding idle window

#### GDPR & Data Purging
- **Revoke:** `POST /admin/revoke` → briše aktivaciju, session, holdings, consents, read-acks, i ntfy subskripciju u **jednoj transakciji**
- **Ntfy token:** Plaintext token se prikazuje točno jednom; u bazi samo SHA-256 hash. Nema načina za recovery
- **Svi consenti:** Append-only audit log (`consent_log` tablica)

#### Portfolio Storage
- **user_holdings tablica:** `(key_hash, token, amount, entry, apy)`
- **Prvi save:** `first_time=true` → UI trigerira KKT weight computation na engineu
- **Validation:** Token regex `^[A-Z0-9]{1,20}$`, amount ∈ (0, 1e18], max 50 holdings
- **Entry/APY:** Opcionalni UI bookkeeping — engine ih ignorira

#### ntfy Notification Integration
- **Self-hosted ntfy** server s admin sidecarom
- **Per-user topic:** `secrets.token_urlsafe(24)` → 32-char neizgovorljivi topic name
- **Read-only token:** Korisnik dobije plaintext token jednom; hashiran u bazi
- **Topic lifecycle:** Delete → recreate na re-enable (clean slate)

#### Internal Endpointi (za engine cron)
- `GET /internal/users` — lista svih `key_hash`-eva s aktivnim holdingsima (X-Admin-Secret auth)
- `GET /internal/user?key_hash=...` — holdings + ntfy info za daily-close signal run

#### Admin Endpointi
- `POST /admin/reset-binding` — skida IP binding (roaming / support)
- `POST /admin/revoke` — opoziva ključ + briše sve podatke (GDPR)

### LAYER 5 — Optimization Engine (aqmath-engine)

**Srce cijelog sustava.** Port `:8005`. 988 linija FastAPI-ja.

#### API Endpointi
| Endpoint | Auth | Opis |
|---|---|---|
| `POST /optimize` | JWT | Puni optimization pipeline: ERC + KKT + Deleverage |
| `POST /backtest` | JWT | Full-history backtest s modulatorom |
| `GET /prices/batch` | JWT | Batch price lookup (do 50 tokena) |
| `GET /symbols` | JWT | Popis tokena s dovoljno povijesti |
| `POST /portfolio/sync` | Internal (X-Admin-Secret) | Daily-close signal run za sve usere |
| `POST /portfolio/run` | Internal (X-Admin-Secret) | Single-user signal run |

#### Optimization Pipeline
```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐
│ DB:      │───→│ ERC      │───→│ KKT Risk │───→│ Deleverage   │
│ prices   │    │ Analysis │    │ Parity   │    │ Shield v14   │
└──────────┘    └──────────┘    └──────────┘    └──────────────┘
```

#### Deleverage Shield (v14.0 — Continuous Regime Modulator)

**Signal formula:**
```
dd      = (all-time basket peak - P_now) / peak
dd_sig  = clamp(dd / 0.15, 0, 1)
vol_sig = clamp((dsVol - 0.30) / (0.90 - 0.30), 0, 1)
risk    = clamp(0.70 × dd_sig + 0.30 × vol_sig, 0, 1)
target  = 1 - risk                          ← kontinuiran, BEZ hard floora
```

**Asimetrična rampa (histereza / anti-chop):**
- **Izlaz (de-risk):** `exp = prev + (target - prev) × 0.30` — brzo
- **Ulaz (re-entry):** `exp = prev + (target - prev) × 0.30` — sporo (isti speed, ali target raste polako jer dd sporo zacjeljuje)

**Threshold rebalancing (v14):**
- Trade se izvršava samo kad `|target_exposure - held_exposure| > 8%`
- Signal (`ramp_frac`) nastavlja evoluirati kontinuirano svaki dan
- **~64% manje rebalansa** u odnosu na svakodnevno trgovanje
- ~64% niži feejevi, identičan signal

**Ključni dizajn odabiri:**
- **Nema correlation gatea** — empirijski dokazano da korelacija nije regime signal na 5-token basketu (median 20d avg pairwise corr = 0.27, nikad > 0.74)
- **Nema timera** — re-entry je prirodan: dd se smanjuje kako equity krivulja zacjeljuje
- **Nema hard floora** — exposure može ići do 0%, ali ne postoji "safety net" koji bi lažno trigerirao izlaz

#### Validacija
- **Test suite** ugrađen u `deleverage.py` (6 testova): calm uptrend, deep crash, histereza, no-data fallback, pure pass-through, synthetic crash-recovery
- **Full-sample backtest** (8.7 godina): Sharpe 0.93 vs B&H 0.75, MaxDD 35.0% vs 83.8%, CAGR 32.9%
- **Walk-forward validiran** na 6 anchored foldova (2017–2026, 5 token kombosa)

#### Sigurnosne mjere
- **Input caps:** `max_length=15` na token listi, `ge/le` na svim numeričkim poljima
- **KKT cache:** `TTLCache` s daily-rollover TTL-om — isti basket unutar jednog dana vraća cached rezultat (smanjuje CPU load)
- **Price cache:** Latest close (3600s TTL) + history (daily-rollover TTL)
- **Cooldown:** `OPTIMIZATION_COOLDOWN` default 60s — jedan user ne može spamati /optimize
- **Optimization timeout:** 60s, nakon čega se prekida i vraća 504
- **Self-minted service JWT:** Za interne pozive (`/portfolio/*`)

### LAYER 6 — DCA Routing (dca-engine)

**Javni DCA distribucijski servis.** Port `:8006`. **Nema direktan DB pristup** — sve povijesne cijene dohvaća iz data-pipelinea preko HTTP-a.

#### API Endpointi
| Endpoint | Auth | Opis |
|---|---|---|
| `POST /dca` | **Public** (no auth) | DCA distribucija s layered defense |
| `POST /optimize` | JWT | Proxy → aqmath-engine |
| `GET /api/volatility` | JWT | Proxy → data-pipeline |
| `GET /api/available-tokens` | JWT | Proxy → data-pipeline |
| `GET /api/binance/price` | **Public** | Live spot cijena (30s cache) |
| `GET /api/binance/ticker` | **Public** | 24hr statistika, svi simboli (60s cache) |
| `GET /api/binance/klines` | **Public** | Dnevni candleovi (3600s cache) |

#### DCA Algoritam — Layered Defense (6 razina)

```
┌────────────────────┐
│ 1. Circuit Breaker │ ← Shield status: blokira DCA dok je Shield defanzivan
├────────────────────┤
│ 2. Safety Factor   │ ← Smanjuje buy size na osnovu volatilnosti (0.2–1.0)
├────────────────────┤
│ 3. Trend Filter    │ ← Skipa tokene ispod 50-dnevnog SMA
├────────────────────┤
│ 4. Iterative Prop  │ ← Proporcionalna alokacija s $20 min buy pragom
├────────────────────┤
│ 5. Hard Cap        │ ← 20% max po risky tokenu (SAMO na nove kupnje)
├────────────────────┤
│ 6. Risk Budget     │ ← 60% max u risky asseta; višak → stablecoin redirect
└────────────────────┘
```

**Ključne karakteristike:**
- **Circuit Breaker** je slaved na Deleverage Shield — ne koristi vlastite thresholdove. Ako je Shield defanzivan (exposure < 40%), DCA stoji
- **Small DCA handling:** Ako je iznos < $50, cijeli iznos ide u jedan najpodcijenjeniji token (izbjegava fee fragmentation)
- **Min buy prag:** $20 po tokenu po ciklusu — tokeni koji bi dobili manje se preskaču, njihov udio se redistribuira
- **Safe-haven exemption:** Stablecoini preskaču sve filtere — uvijek se kupuju ako su ispod targeta
- **Proporcionalna alokacija:** Iterativno popunjava najpodcijenjenije tokene, uklanja one koji dosegnu target, redistribuira ostatak
- **Hard capovi poštuju postojeće pozicije:** Samo NOVE kupnje se kapitaju — ne dira se postojeći portfolio

#### Server-to-Server Auth
- Self-minted 1h JWT (`kid: "dca-engine-service"`) za data-pipeline pozive
- Ne treba user token — servis koristi zajednički `JWT_SECRET` za mintanje vlastitog tokena
- Automatski se refreshira 5 min prije isteka

#### Cache Arhitektura
- **Price history:** `TTLCache` (max 400 ključeva, daily-rollover TTL). Cached fetch za veći window zadovoljava manje windowe kroz slicing
- **Singleflight:** `lock_for()` za konkurentne missove — anti-thundering-herd
- **Binance ticker:** 60s TTL (svi widget posjetitelji dijele jedan upstream poziv po prozoru)
- **Binance klines:** 3600s TTL (dnevni candleovi se jedva miču intraday)

### LAYER 7 — Prezentacija (aqmath-ui)

Statički site serviran kroz **dva deployment kanala:**

| Kanal | Opis |
|---|---|
| **GitHub Pages** (`aqmath.xyz`) | Primarni hosting. Besplatan, CDN-backed, auto-deploy na push u main |
| **Railway + Caddy** | Sekundarni deploy. Dodaje security header koje GitHub Pages ne može postaviti |

#### Build Pipeline
```
minify_css.py → stamp_version.py → build_pages.py → (build_research.py) → stamp_version.py --check → audit_pages.py
```

**CI gate (aqmath-ui):**
- `stamp_version.py --check` — svi `?v=` stampovi moraju biti current
- `audit_pages.py` — provjerava: unique body content, točno jedan `<h1>`, kanonski URL-ovi, sitemap sync, bez broken internih linkova

#### Caddy Sigurnosni Headeri
```
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
```

**Cache policy:**
- HTML: `no-cache` (uvijek revalidiraj — 304 je jeftin, a stari `?v=` stamp je skup)
- `version.txt`: `no-store` (nikad ne keširaj — freshness check ovisi o tome)
- Stamped JS/CSS: `max-age=31536000, immutable` (novi build = novi `?v=`, dakle novi cache entry)
- Fontovi: `max-age=604800` (7 dana — dovoljno dugo da su irelevantni, dovoljno kratko da su popravljivi)

#### JavaScript Arhitektura
- **app.js** — glavna logika (backtest forma, widgeti, state management)
- **app-boot.js** — eksternalizirani inline handleri (CSP-safe: nema `on*=` atributa ni inline `<script>`)
- **app-widgets.js** — landing page widgeti (Binance tickeri, DCA kalkulator)
- **app-backtest.js** — backtest UI logika (walk-forward grid validacija)
- **Svi API pozivi** idu prema: `dca-engine` (:8006) za DCA, `aqmath-engine` (:8005) za optimize/backtest, `beta-auth` (:8000) za login

#### Testovi
- **Playwright** vizualni regression testovi (5 ključnih stranica)
- `npm run test` — headless Chromium
- `npm run test:update` — ažurira screenshot snapshotove

### LAYER 8 — Infrastruktura

#### Railway PaaS
- **Deployment:** Docker containeri iz GitHub-connected repozitorija
- **Restart policy:** `ON_FAILURE` s max 5 retrya
- **Healthcheck:** `GET /` na svim servisima (osim collectora koji nemaju eksplicitni path, ali Railway koristi TCP probe)
- **Engine healthcheck timeout:** 300s (zbog mogućih dugih cold startova s DB konekcijom)
- **Scaling:** `WEB_CONCURRENCY` env var za uvicorn workers (samo engine)

#### PostgreSQL
- **Railway managed plugin**
- **Pipeline + Engine dijele jednu bazu** — crypto_prices, raw_* tablice
- **Beta-auth ima vlastitu bazu** — beta_activations, auth_attempts, sessions, user_holdings, consent_log, read_acks, ntfy_subscriptions
- **Pool sizing:** `DB_POOL_MIN=2`, `DB_POOL_MAX=12` (env-tunable)

#### GitHub CI/CD
| Repozitorij | CI Test | Deploy Trigger |
|---|---|---|
| aqmath-engine | Smoke import (main, quantum_engine, risk_parity, deleverage, volatility) | `RAILWAY_CI_ENABLED=true` |
| data-pipeline | Smoke import (main, cleaner, validator, config) | `RAILWAY_CI_ENABLED=true` |
| dca-engine | Unit test (test_min_token_buy.py) | `RAILWAY_CI_ENABLED=true` |
| coinbase-collector | *(nema CI workflow)* | Manual |
| coingecko-collector | *(nema CI workflow)* | Manual |
| kraken-collector | *(nema CI workflow)* | Manual |
| aqmath-ui | Stamp check + page audit | GitHub Pages auto-deploy |
| aqmath-beta-auth | *(nema CI workflow)* | Manual |

**Deploy metodologija:** Railway GraphQL API (`serviceInstanceDeployV2` mutation) — isti poziv koji Railway CLI interno koristi. CI deploy je **disabled by default** (`RAILWAY_CI_ENABLED != 'true'`).

---

## 🔒 Sigurnosni Audit

### ✅ STRENGTHS — Što je napravljeno izvrsno

| # | Kategorija | Nalaz |
|---|---|---|
| **S1** | Secret Management | **Zero plaintext secrets u bazi.** Samo SHA-256(key) i HMAC-SHA256(IP+PEPPER). Raw keyevi i IP-jevi nikad ne dotiču DB ni logove |
| **S2** | Crypto | **Timing-safe usporedbe posvuda.** `hmac.compare_digest` za: auth, collector secret, admin secret, IP hash usporedbu |
| **S3** | Crypto | **JWT ≥32 znaka validacija pri startupu.** HS256 derivira 256-bitni MAC → secret kraći od 32 znaka slabi potpis. Servis **krešira** ako nije zadovoljeno |
| **S4** | Rate Limiting | **Rate limiting na svim ingress točkama.** 120 req/min per IP, bounded na 10,000 IP-ova. Health probe `/` izuzet. Per-replica, in-memory |
| **S5** | HTTP Headers | **Security headeri na svakom responseu.** HSTS 2y, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CSP locked down, `Referrer-Policy: no-referrer` |
| **S6** | Attack Surface | **Swagger/OpenAPI disabled u produkciji.** `docs_url=None, redoc_url=None, openapi_url=None` — ruta mapa nije javno vidljiva |
| **S7** | Access Control | **Token revocation bez redeploya.** `REVOKED_KIDS` env var + `REQUIRE_KID` kill-switch za legacy tokene. Dovoljno je dodati `kid` u env var |
| **S8** | Input Validation | **Hard input caps na svim endpointima.** Pydantic `Field(max_length=...)`, `ge/le` constraintovi, regex validacija tokena |
| **S9** | Network | **Trusted proxy IP rezolucija.** Broji `TRUSTED_PROXY_HOPS` s **desna** X-Forwarded-For — ne vjeruje lijevom (spoofabilnom) entryju |
| **S10** | Access Control | **Per-collector distinct secrets.** `COLLECTOR_SECRETS` (zarez-separirani, set). Leak jednog collectora ne otvara ingestion za druge |
| **S11** | Session Mgmt | **Sliding idle sessions sa server-side enforcementom.** 30 min timeout. DB guard: `expires_at > $2` — client clock ne može oživjeti mrtvi session |
| **S12** | Privacy | **GDPR-compliant data purging.** Revoke briše holdings, consents, read-acks, ntfy subskripciju u jednoj transakciji |
| **S13** | Resilience | **Circuit breaker na collectorima.** CoinGecko: 8 uzastopnih 429 → abort. Coinbase/Kraken: agresivni mode s cooldownom |
| **S14** | Database | **Advisory lock za schema init.** `pg_advisory_lock` sprječava race condition kod multi-worker uvicorn startupa |
| **S15** | CI/CD | **CI smoke testovi na svaki push.** Import validation — svi moduli se moraju učitati bez errora |
| **S16** | UI Security | **Caddy frame-ancestors DENY.** Anti-clickjacking s HTTP razine. GitHub Pages ne podržava ovaj header |
| **S17** | Privacy | **Ntfy token hash-only storage.** Plaintext token se prikazuje točno jednom — u bazi samo SHA-256 hash. Nema recoveryja |
| **S18** | Resilience | **Singleflight cache pattern.** `TTLCache.lock_for()` kolapsira konkurentne missove — anti-thundering-herd |
| **S19** | Error Handling | **Generic error messages na public endpointima.** `/dca` vraća "Internal error — please retry", detalji ostaju u logovima |
| **S20** | Dependency Mgmt | **Pinned dependency verzije.** `fastapi==0.141.1`, `uvicorn==0.52.1` itd. — sprječava supply chain iznenađenja |

### ⚠️ POTENTIAL ISSUES

#### 🟡 MEDIUM Priority

**M1 — Shared JWT_SECRET across all services**
- **Opis:** Svih 7 mikroservisa dijeli isti `JWT_SECRET`. Kompromitacija jednog servisa → attacker može mintati valjane JWT-ove za **sve** servise
- **Impact:** Ako bi bilo koji servis bio kompromitiran (npr. public `/dca` endpoint s RCE-om), attacker dobiva ključ kojim može pristupiti engineu, pipelineu, beta-authu...
- **Trenutni mitigation:** Svi servisi su unutar Railway VPC-a, svi koriste iste sigurnosne obrasce, svi su Python 3.11 s istim dependencyjima
- **Ovo je svjesni design tradeoff** — jednostavnost nad izolacijom. Za beta fazu s <100 korisnika je prihvatljivo
- **Preporuka za production hardening:** Service-specific JWT s `aud` claimom, ili mTLS između servisa, ili različiti secreti po servisu s JWT chainingom

**M2 — Internal HTTP (no TLS between services)**
- **Opis:** Servisi komuniciraju preko HTTP-a unutar Railway networka. `SERVICE_URL` env varovi pokazuju na `http://...`. JWT-ovi i collector secreti putuju u plaintextu preko interne mreže
- **Impact:** Ako bi Railway-jev network isolation bio probijen (VPC breach, insider, side-channel), svi authentication tokeni bi bili vidljivi u prometu
- **Trenutni mitigation:** Railway osigurava VPC-level izolaciju. Internal promet ne izlazi na javni internet
- **Prihvatljivo za beta.** Za stroži production: mTLS, WireGuard mesh, ili barem HTTPS s internim CA

**M3 — Dva divergentna beta-auth repozitorija**
- **Opis:** `aqmath-beta-auth/` (301 linija) i `-aqmath-beta-auth/` (838 linija) su različite verzije istog servisa
- **`-aqmath-beta-auth` je očito kanonska produkcijska verzija** — ima portfolio storage, sliding sessions, GDPR consent, ntfy, internal user endpoint
- **Rizik:** Deploy krive verzije, divergencija featurea, confusion oko toga koji je "pravi"
- **Preporuka:** Arhivirati `aqmath-beta-auth/` (staviti README s linkom na pravi repo) i zadržati samo `-aqmath-beta-auth/` kao kanonski

#### 🟢 LOW Priority

**L1 — In-memory rate limiting nije distribuiran**
- Rate limit state je u procesnoj memoriji. S 2 worker-a (uobicorn) to je 2×120 = 240 req/min po IP-u
- Dokumentirano kao "meant to bound cost, not stop a distributed attack"
- **Preporuka:** Za production s više replika: Redis-based rate limiter (npr. `slowapi` s Redis backendom)

**L2 — COLLECTOR_SECRET legacy varijabla**
- `config.py` podržava i `COLLECTOR_SECRET` (singular, shared) i `COLLECTOR_SECRETS` (plural, per-collector)
- Backward-compat path koji bi trebao biti uklonjen
- **Preporuka:** Migrirati na `COLLECTOR_SECRETS`-only, ukloniti legacy path, dokumentirati tranziciju

**L3 — Hardkodirani CORS origins u beta-auth**
- `aqmath-beta-auth` (puna verzija) ima hardkodiranu CORS listu dok engine/dca/pipeline koriste env var
- Neusklađen pristup — ručna sinkronizacija potrebna
- **Preporuka:** Standardizirati na `CORS_ORIGINS` env var (kao u engineu)

**L4 — Nema automated dependency scanninga**
- Nema Dependabot, Snyk, ili sličnog alata u CI pipelineu
- Python dependencyji su pinani (što je odlično), ali nema automatskog upozorenja na poznate CVE
- **Preporuka:** Dodati Dependabot za pip (`pip` ekosustav) na sve Python repozitorije

**L5 — Collectori nemaju CI workflow**
- Coinbase, CoinGecko i Kraken collectori nemaju `.github/workflows/ci.yml`
- Nema smoke testa na push — greška u importu bi se otkrila tek na deployu
- **Preporuka:** Dodati minimalni smoke import CI na sva tri collectora (identičan pattern kao pipeline)

**L6 — Dva beta-auth repozitorija nemaju CI workflow**
- Ni jedan ni drugi nemaju CI gate
- **Preporuka:** Nakon odabira kanonske verzije, dodati CI s import validationom

#### 🔵 INFO

| # | Nalaz |
|---|---|
| **I1** | FastAPI/uvicorn/httpx verzije su precizno pinane (`==`) — odlično za reproducibilnost. Jedini rizik: zaboravljene nadogradnje na security patch verzije |
| **I2** | `ROLLING_WINDOW_DAYS=7` za outlier detekciju je kratak prozor. Thin-market tokeni (ATH, DAG, EWT, PEAQ, TICS) s malo volumea mogu imati false-positive outliere. Ovo je poznati tradeoff dokumentiran u feed-sensitivity istraživanju |
| **I3** | 5 od 8 frozen plan tokena su single-source u produkciji. Median merge s 1 sourceom = taj source je jedina istina. Dokumentirano, ali treba biti svjestan |
| **I4** | Backtest koristi numpy-free pure Python — izbjegava CVE surface, ali je ~15× sporiji od numpy implementacije. Za beta s <100 korisnika: prihvatljivo |
| **I5** | CI deploy je disabled by default (`RAILWAY_CI_ENABLED != 'true'`) — dobro za kontrolu, loše za automatizaciju. Treba donijeti odluku želi li se CI/CD auto-deploy |
| **I6** | Passwordless auth model (samo beta key) — nema passworda za krađu, nema password reset flowa za zloupotrebu. Beta key = nešto što imaš. Jednostavno i sigurno za beta |
| **I7** | Svi Dockerfileovi su `python:3.11-slim` (isti base image) — smanjuje supply chain surface u odnosu na različite image po servisu |
| **I8** | `test_deleverage.py` i `test_ttlcache.py` u data-pipeline repozitoriju su lokalni dev harnessi (ne mogu runnati u CI) — dokumentirano u CI komentaru |

---

## 📊 Sažeta Statistika

| Metrika | Vrijednost |
|---|---|
| **Ukupno repozitorija** | 9 |
| **Ukupno mikroservisa** | 7 |
| **Arhitektonskih layera** | **8** |
| **Python linija koda** | ~6,200 |
| **JavaScript linija koda** | ~3,500 |
| **PostgreSQL instanci** | 2 |
| **Vanjskih API dependencyja** | 4 |
| **CI pipelinea** | 4 (od 9 repozitorija) |
| **JWT-secured endpointa** | 12+ |
| **Public endpointa** | 5 (`/dca`, 3× Binance proxy, `/api/slots`) |
| **Sigurnosnih strengthova** | 20 potvrđenih |
| **Medium priority nalaza** | 3 |
| **Low priority nalaza** | 6 |

---

## 🎯 Final Assessment

**Arhitektura: 9/10**
- Jasno odvojeni slojevi s preciznim granicama odgovornosti
- Svaki servis ima točno jednu svrhu i ne prelazi je
- Nema cirkularnih dependencyja — data flow je striktno jednosmjeran: collect → clean → compute → distribute → display
- Jedina mana: dva beta-auth repozitorija unose zabunu

**Security Posture: 8/10**
- Iznadprosječan za beta projekt. Zero plaintext secrets, timing-safe usporedbe, rate limiting, security headeri, session management, GDPR-compliant purging — sve je na mjestu
- Tri medium nalaza (shared JWT secret, internal HTTP, dva auth repozitorija) su svjesni tradeoffovi, ne propusti
- Nijedan nalaz nije blocker za produkcijsku betu

**Preporuka za produkcijski hardening (kad korisnici prijeđu ~100):**
1. Riješiti M3 (odabrati kanonski beta-auth repo)
2. Uvesti mTLS ili `aud` claim za međuservisnu auth (M1, M2)
3. Dodati CI workflowove na collectore i beta-auth (L5, L6)
4. Dodati Dependabot za Python dependencyje (L4)
5. Standardizirati CORS origins na env-driven pristup (L3)

**Sustav je siguran za produkcijsku betu u trenutnom stanju.**

---

## 🔧 Remediation Log — 2026-08-11

Naknadni scan je identificirao nove nalaze; svi su obrađeni istog dana.

### High nalazi — POPRAVLJENO

| Nalaz | Fix |
|---|---|
| `data-pipeline` javni `/api/symbols`, `/stats`, `/api/volatility`, `/symbols` | Novi `verify_beta_token_or_collector` dual-auth dependency (beta JWT ILI `X-Collector-Secret`); `/api/volatility` i `/stats` samo beta JWT. Kolektori (kraken, coinbase, coingecko) šalju `X-Collector-Secret` na `/api/symbols` poziv. |
| `aqmath-engine` javni `/prices/*`, `/history/{symbol}`, `/symbols` | Sva 4 endpointa iza `Depends(verify_beta_token)`. UI `fetchPrices()` (app.js) sada šalje Bearer header — poziv je ionako Pro-only. |
| `-aqmath-beta-auth` `/internal/*` na javnom URL-u | Engine već koristi `BETA_AUTH_INTERNAL_URL` env var → postaviti na `http://aqmath-beta-auth.railway.internal` (Railway internal domena, nedostupna s interneta). **ADMIN_SECRET rotiran** i upisan na beta-auth servis; engine treba isti secret u `BETA_AUTH_SECRET` env varu. |

### Medium nalazi — obrađeno

| Nalaz | Fix |
|---|---|
| `REQUIRE_KID=false` | Postavljeno `REQUIRE_KID=true` na sva 3 servisa (env, napravio owner). Kanonski auth uvijek izdaje `kid`, pa flip ne lomi aktivne tokene. |
| `dca-engine` binance proxy bez validacije | `_BINANCE_SYMBOL_RE` (`^[A-Z0-9]{2,20}$`) + `_KLINE_INTERVALS` allowlist (`1m,5m,15m,1h,4h,1d`) prije svakog forwarda; symbol se normalizira u uppercase. |
| `dca-engine` `/api/volatility` i `/api/available-tokens` proxy bez headera | Oba prosljeđuju callerov Bearer token pipeline-u (koji je sada beta-gated); `/api/available-tokens` je sada i sam beta-gated. |
| Stripped `aqmath-beta-auth` (slabiji duplikat) | Railway service **obrisan** (owner); README dobio DEPRECATED banner. Repo ostaje samo za povijest. |
| JWT u localStorage | Accepted risk, dokumentirano. Kanonski auth izdaje 30-min sliding tokene (ne 365-dnevne); CSP + `escapeHtml()` higijena već na mjestu. |

### Low nalazi — obrađeno

| Nalaz | Fix |
|---|---|
| Hardkodirani Railway URL-ovi u scratch skriptama | `upload_xmr.py`, `upload_paxg.py`, `data_source.py` → env var s praznim defaultom; `test_svg_update.py`, `test_rebal_forensics.py` → `BACKTESTING_URL` env var. |
| `_archive/aqmath-beta-auth-old` | Ne postoji ni u jednom workspaceu — nalaz iz starog klona; N/A. |
| Collector `/status`, `/pairs`, `/coins` | Ostaju javni (low-impact recon) — accepted risk. |
| Dva auth repoa | Riješeno decommissionom stripped verzije. |

### Preostale owner akcije (Railway dashboard)

1. **`BETA_AUTH_SECRET` na aqmath-engine** = novi `ADMIN_SECRET` iz beta-auth servisa (bez toga dnevni cron pada s 401)
2. **`BETA_AUTH_INTERNAL_URL` na aqmath-engine** = `http://aqmath-beta-auth.railway.internal`
3. GitHub: arhivirati `aqmath-beta-auth` repo (Settings → Archive)
4. `mexc-collector/main.py` (izvan workspacea): ručno dodati `headers={"X-Collector-Secret": COLLECTOR_SECRET}` na GET `/api/symbols` poziv — ista promjena kao kod ostala 3 kolektora

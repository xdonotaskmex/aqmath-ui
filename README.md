# AQMath UI

Frontend (staticka web stranica) za **AQMath** — kvantitativni rebalanser kripto portfelja s **Risk Parity** matematikom i **Deleverage Shield** zaštitom od pada. **Non-custodial** — portfelj ostaje u pregledniku, bez povezivanja novčanika i bez potrebe za računom.

## Pregled

- **Vrsta:** statička web stranica (HTML/CSS/JS)
- **Primarno posluživanje:** GitHub Pages (aqmath.xyz)
- **Opcijski Railway deploy:** Caddy poslužitelj (isti statički fajlovi)
- **Jezici:** engleski (en) + kineski (zh-CN)
- **Analitika:** Simple Analytics (privatnost)
- **SEO:** IndexNow, JSON-LD structured data, meta descriptions, sitemap.xml
- **WAF:** Cloudflare (Free tier — managed rules, bot fight, DDoS protection)

## Stranice

| Stranica | Putanja | Opis |
|----------|---------|------|
| Landing | `/` | Uvodna stranica s hero sekcijom |
| App | `/app` | Glavna aplikacija (portfelj, optimizacija, DCA) |
| Backtest | `/backtest` | Backtesting sučelje |
| Results | `/results` | Rezultati i istraživanja |
| Docs | `/docs` | Dokumentacija |
| About | `/about` | O projektu |
| Privacy | `/privacy` | Politika privatnosti |
| Terms | `/terms` | Uvjeti korištenja |
| Impressum | `/impressum` | Impressum |
| Widerruf | `/widerruf` | Pravo na odustanak |
| 404 | `/404.html` | Stranica nije pronađena |

## Ključne datoteke

| Datoteka | Opis |
|----------|------|
| `index.html` | Landing stranica (generirana iz `_src/index.html`) |
| `app.html` | Glavna aplikacija |
| `app.js` | Glavna aplikacijska logika (holdings, DCA, optimize, chart) |
| `app-boot.js` | Boot logika (auth provjere, update banner) |
| `app-backtest.js` | Backtest logika |
| `app-widgets.js` | Widgeti (Binance cijene, ticker) |
| `app-notify.js` | Signal-only automatizacija (One-Tap Alignment, ntfy, shield card) |
| `styles.css` | Stilovi (izvor) |
| `styles.min.css` | Minificirani stilovi (generirani) |
| `locales/en.json` | Engleski prijevodi |
| `locales/zh-CN.json` | Kineski prijevodi |
| `Caddyfile` | Caddy konfiguracija (Railway) + 404 block |
| `CNAME` | GitHub Pages custom domena |
| `_internal/` | Interni dokumenti (status, audit, workflow) — **nisu dio javne stranice** |

> ⚠️ **Interni dokumenti idu u `_internal/`.** GitHub Pages koristi Jekyll, koji
> poslužuje svaku datoteku u korijenu repo-a na `aqmath.xyz` (npr. `/CLAIMS_AUDIT.md`
> je bio javno čitljiv). Jekyll preskače direktorije s donjom crtom (`_src/`,
> `_research/`, `_internal/`), pa takve datoteke vraćaju 404. Repo je javan, pa
> interni dokumenti uz to **ne smiju** sadržavati interne detalje privatnih
> servisa (konstante, formule, shemu baze, admin endpointe).

## Arhitektura

```
Preglednik  -->  aqmath-ui (statika)  -->  dca-engine (/dca, /api/binance/*)
                                              aqmath-engine (/optimize, /backtest)
                                              aqmath-beta-auth (auth)
```

## Build sustav

Stranice se generiraju iz izvora u `_src/` pomoću Python alata.

**KRITIČNI REDOSLIJED** — preskakanje koraka uzrokuje CI greške:

```bash
# Puni build (4 koraka, točan redoslijed je obavezan)
python tools/minify_css.py       # 1. styles.css → styles.min.css
python tools/stamp_version.py    # 2. stampaj verziju u version.txt + sve HTML/JS
python tools/build_pages.py      # 3. generiraj HTML stranice iz _src/
python tools/build_research.py   # 4. generiraj research stranice iz _research/

# Verifikacija (provjera stampi + i18n + audit)
python tools/stamp_version.py --check   # exit 0 = sve stampi točne
python tools/audit_pages.py             # provjeri sve generirane stranice
npm run verify                          # i18n provjera
```

### npm skripte

```bash
npm run build     # minify + stamp + build_pages (3 koraka)
npm run verify    # verifikacija (i18n + stamp --check)
npm run serve     # lokalni preview server
```

> `npm run build` ne uključuje `build_research.py` — pokreni ga ručno kad mijenjaš
> `_research/*.md`. `npm run verify` ne uključuje `audit_pages.py` — pokreni ga ručno.

### Alati (`tools/`)

| Alat | Opis |
|------|------|
| `build_pages.py` | Generira HTML stranice iz `_src/` |
| `build_research.py` | Generira istraživačke stranice |
| `minify_css.py` | Minificira CSS |
| `stamp_version.py` | Stampa verziju u `version.txt` |
| `check_i18n.py` | Provjerava i18n prijevode |
| `fetch_fonts.py` | Preuzima self-hosted fontove |
| `audit_pages.py` | Audit stranica |
| `preview_server.py` | Lokalni preview server |
| `refresh_forward_log.py` | Osvježava forward log |

## Testiranje (Playwright)

Vizualni regresijski testovi za 5 ključnih stranica:

```bash
# Instaliraj Chromium
npm run setup

# Pokreni testove
npm test

# Ažuriraj snapshotove
npm run test:update

# UI način
npm run test:ui

# Prikaži izvještaj
npm run report
```

### Trenutni testovi

| Test | Stranica | Status |
|------|----------|--------|
| Landing snapshot | `/` | ✅ |
| App snapshot | `/app` | ✅ |
| Backtest snapshot | `/backtest` | ✅ |
| Results snapshot | `/results` | ✅ |
| Docs snapshot | `/docs` | ✅ |

### Planirani testovi

- [ ] E2E: beta key activation flow
- [ ] E2E: portfolio sync + shield card
- [ ] E2E: One-Tap Alignment (signal confirm/skip/adjust)
- [ ] E2E: DCA distribution flow
- [ ] Visual: mobile breakpoints (480px, 768px, 920px)
- [ ] Visual: dark mode consistency

## Instalacija i pokretanje

### Lokalno (statika)

```bash
# 1. Posluži statičke fajlove (bilo koji statički server)
python -m http.server 8090
# ili
npx serve .
```

### Lokalno (Playwright testovi)

```bash
npm install
npm run setup
npm run serve   # pokreće tests/static-server.cjs
npm test
```

### Docker (Railway)

```bash
docker build -t aqmath-ui .
docker run -p 8090:80 aqmath-ui
```

## Sigurnost

- **CSP** — stroga Content-Security-Policy (script-src samo self + jsdelivr + simpleanalytics)
- **Cache-Control** — no-cache, no-store, must-revalidate
- **Self-hosted fontovi** — nijedan zahtjev ne ide na Google
- **Non-custodial** — portfelj ostaje u pregledniku, bez povezivanja novčanika
- **Privatnost** — Simple Analytics (bez kolačića, bez praćenja)
- **Cloudflare WAF** — managed rules, bot fight mode, DDoS protection
- **Error telemetry** — browser error reporter → `/internal/error-report` (privacy-first, no PII)

## Deploy

### GitHub Pages

- Primarno posluživanje na `aqmath.xyz` (CNAME)
- CI automatski gradi i deploya

### Railway (opcijski)

- `railway.toml` + `Dockerfile` (Caddy) poslužuju iste statičke fajlove
- Nema funkcionalne razlike u odnosu na GitHub Pages

## Struktura projekta

```
aqmath-ui/
├── index.html          # Landing (generiran)
├── app.html            # Glavna aplikacija
├── backtest.html       # Backtest stranica
├── results.html        # Rezultati
├── docs.html           # Dokumentacija
├── about.html          # O projektu
├── privacy.html        # Privatnost
├── terms.html          # Uvjeti
├── impressum.html      # Impressum
├── widerruf.html       # Pravo na odustanak
├── 404.html            # 404 stranica
├── app.js              # Glavna aplikacijska logika (holdings, DCA, optimize)
├── app-boot.js         # Boot logika (auth, update banner)
├── app-backtest.js     # Backtest logika
├── app-widgets.js      # Widgeti (Binance ticker)
├── app-notify.js       # One-Tap Alignment, shield card, ntfy, holdings sync
├── styles.css          # Stilovi (izvor)
├── styles.min.css      # Minificirani stilovi (generirani)
├── _src/               # Izvori za generiranje (index.html je template)
├── _internal/          # Interni dokumenti + ops + operatori alati (Jekyll ih ne objavljuje)
├── locales/            # i18n prijevodi (en, zh-CN)
├── research/           # Istraživačke stranice (generirane)
├── _research/          # Istraživački izvori (MD → HTML)
├── tools/              # Build alati (Python) — javni, samo build logika
├── tests/              # Playwright testovi (visual snapshots)
├── fonts/              # Self-hosted fontovi
├── Caddyfile           # Caddy konfiguracija + 404 block
├── CNAME               # GitHub Pages domena
├── Dockerfile          # Docker image (Caddy)
├── railway.toml        # Railway konfiguracija
├── package.json        # Playwright testovi + npm skripte
├── README.md           # Ovaj dokument (jedini .md u korijenu)
└── sitemap.xml         # SEO sitemap
```

## Povezane usluge

Ovaj frontend je dio većeg sustava:

- **dca-engine** — DCA distribucija + Binance proxy
- **aqmath-engine** — optimizacija (ERC + KKT + Deleverage) + backtesting
- **aqmath-beta-auth** — beta JWT autentikacija
- **data-pipeline** — čiste cijene
- **mexc/coinbase/coingecko/kraken-collector** — prikupljanje sirovih podataka
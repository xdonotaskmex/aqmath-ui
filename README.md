# AQMath UI

Frontend (staticka web stranica) za **AQMath** — kvantitativni rebalanser kripto portfelja s **Risk Parity** matematikom i **Deleverage Shield** zaštitom od pada. **Non-custodial** — portfelj ostaje u pregledniku, bez povezivanja novčanika i bez potrebe za računom.

## Pregled

- **Vrsta:** statička web stranica (HTML/CSS/JS)
- **Primarno posluživanje:** GitHub Pages (aqmath.xyz)
- **Opcijski Railway deploy:** Caddy poslužitelj (isti statički fajlovi)
- **Jezici:** engleski (en) + kineski (zh-CN)
- **Analitika:** Simple Analytics (privatnost)

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
| `app.js` | Glavna aplikacijska logika |
| `app-boot.js` | Boot logika (auth provjere, update banner) |
| `app-backtest.js` | Backtest logika |
| `app-widgets.js` | Widgeti (Binance cijene, ticker) |
| `app-notify.js` | ntfy obavijesti |
| `styles.css` | Stilovi (izvor) |
| `styles.min.css` | Minificirani stilovi (generirani) |
| `locales/en.json` | Engleski prijevodi |
| `locales/zh-CN.json` | Kineski prijevodi |
| `Caddyfile` | Caddy konfiguracija (Railway) |
| `CNAME` | GitHub Pages custom domena |

## Arhitektura

```
Preglednik  -->  aqmath-ui (statika)  -->  dca-engine (/dca, /api/binance/*)
                                              aqmath-engine (/optimize, /backtest)
                                              aqmath-beta-auth (auth)
```

## Build sustav

Stranice se generiraju iz izvora u `_src/` pomoću Python alata:

```bash
# Puni build (minificiraj CSS + stampaj verziju + generiraj stranice)
npm run build

# Verifikacija (provjera i18n + verzija)
npm run verify
```

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
├── app.js              # Glavna aplikacijska logika
├── app-boot.js         # Boot logika
├── app-backtest.js     # Backtest logika
├── app-widgets.js      # Widgeti
├── app-notify.js       # ntfy obavijesti
├── styles.css          # Stilovi (izvor)
├── styles.min.css      # Minificirani stilovi
├── _src/               # Izvori za generiranje
├── locales/            # i18n prijevodi (en, zh-CN)
├── research/           # Istraživačke stranice
├── _research/          # Istraživački izvori (MD)
├── tools/              # Build alati (Python)
├── tests/              # Playwright testovi
├── ops/                # Ops dokumentacija
├── fonts/              # Self-hosted fontovi
├── Caddyfile           # Caddy konfiguracija
├── CNAME               # GitHub Pages domena
├── Dockerfile          # Docker image (Caddy)
├── railway.toml        # Railway konfiguracija
└── package.json        # Playwright testovi
```

## Povezane usluge

Ovaj frontend je dio većeg sustava:

- **dca-engine** — DCA distribucija + Binance proxy
- **aqmath-engine** — optimizacija (ERC + KKT + Deleverage) + backtesting
- **aqmath-beta-auth** — beta JWT autentikacija
- **data-pipeline** — čiste cijene
- **mexc/coinbase/coingecko/kraken-collector** — prikupljanje sirovih podataka
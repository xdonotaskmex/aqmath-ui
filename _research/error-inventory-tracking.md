# 🐞 Error Inventory & Tracking Plan — što korisnik može vidjeti

**Datum:** 2026-08-11
**Status:** PLAN (error capture još ne postoji u kodu)
**Povezano:** `conversion-funnel-ab-plan.md` (D5/D7 drop-off točke), `security-architecture-audit.md` — oba žive u privatnom repu `aqmath-engine/_audit/` (preseljeno 2026-09-02).

---

## 1. Trenutno stanje

| Sposobnost | Stanje |
|---|---|
| User-facing poruke | ✅ toast sustav u `app.js` (`showToast`: success/error/warning/notice) |
| Konzolni logovi | ✅ `console.warn/error` — vidljivi samo korisniku u DevTools |
| Globalni JS error capture | ❌ nema `window.onerror` ni `unhandledrejection` handlera |
| Slanje errora ikamo | ❌ nula — bug je vidljiv samo ako ga korisnik sam prijavi |
| Server-side logovi | ✅ Railway deploy logs (auth warningi za rate limit/invalid key, engine/pipeline errori) |

**Zaključak:** sustav danas **ne zna** kad korisnik vidi grešku. Ovaj plan to mijenja bez ugrožavanja privatnosti.

---

## 2. Inventory — svaka greška koju korisnik može vidjeti

### 2.1 Beta aktivacija (`activateBeta()` u app.js → `/auth/beta`)

| Uzrok | HTTP | Što korisnik vidi | Predloženi event |
|---|---|---|---|
| Krivi ključ (tipfeler) | 403 | Toast error: "Invalid beta key" | `key_fail_invalid` |
| Previše pokušaja | 429 | Toast warning: "Too many attempts. Please wait N min" | `key_fail_ratelimit` |
| Ključ opozvan | 403 | Toast error: "This beta key has been revoked." | `key_fail_revoked` |
| 365-dnevni rok istekao | 403 | Toast error: expired poruka | `key_fail_expired` |
| Ključ vezan za drugi uređaj (IP binding) | 403 | Toast error: in-use/binding poruka | `key_fail_binding` |
| Auth servis nedostupan / mreža | — | Toast error: "Couldn't reach the activation service…" | `key_fail_network` |
| Prazan unos | — | Toast warning: "Enter your beta key first." | (bez eventa — nije greška) |

### 2.2 Postojeća Pro sesija (`ensureAuthedFetch()` → engine/dca/pipeline)

| Uzrok | HTTP | Što korisnik vidi | Predloženi event |
|---|---|---|---|
| Token istekao (30-min sliding) | 401 expired | Toast warning: "Your beta session expired — please re-enter your key." + forma se vraća | `session_expired_reentry` |
| Token revoked/invalid | 401 | Toast warning: "Beta access needed — please re-enter your beta key." | `session_invalid` |
| Engine/pipeline 500 | 5xx | Toast s generičkom porukom (detalji ostaju u server logu) | `api_server_error_<service>` |
| Rate limit na servisu | 429 | Poruka "Too many requests — please slow down" | `api_ratelimit_<service>` |
| Mrežni prekid | — | Toast error, render pada na cache | `api_network_<service>` |

### 2.3 Grafovi i podaci (Pro)

| Uzrok | Što korisnik vidi | Predloženi event |
|---|---|---|
| `fetchPrices()` vrati null/401 | Graf bez history linije, cijene iz cachea/Binance fallbacka | `prices_fetch_fail` |
| Binance proxy 422/429 (invalid symbol, limit) | Widget bez podataka | `binance_proxy_fail` |
| DCA engine error ("Internal error during DCA distribution") | Toast error | `dca_engine_fail` |
| Optimize proxy error | Toast s engine porukom | `optimize_fail` |

### 2.4 Lokalne (JS) greške — danas potpuno nevidljive

| Tip | Primjer | Predloženi event |
|---|---|---|
| TypeError u renderu | null element u DOM-u nakon refactora | `js_error_typeerror_<page>` |
| ReferenceError | zaboravljeni export (poznati IIFE/window pattern) | `js_error_referenceerror_<page>` |
| Unhandled promise rejection | fetch bez catcha | `js_error_promise_<page>` |
| JSON parse | pokvaren localStorage payload | `js_error_parse_<page>` |

---

## 3. Mehanika error capturea (specifikacija za `tracking.js`)

```
window.addEventListener('error')          → normaliziraj → sa_event
window.addEventListener('unhandledrejection') → normaliziraj → sa_event
```

### 3.1 Normalizacija — što se smije poslati

Šalje se **isključivo kategorija**: `js_error_<tip>_<stranica>`, npr. `js_error_typeerror_app`.

**Nikad se ne šalje:**
- `error.message` niti stack trace (mogu sadržavati iznose portfolioa, simbole, ključeve)
- DOM snapshot, URL query parametri
- bilo koji identifikator

### 3.2 Zaštita od šuma

- **Dedupe:** ista kategorija max 1 event po sesiji (sessionStorage flag) — greška u render loopu ne smije generirati tisuće eventova.
- **Extension filter:** errori s `chrome-extension://` u stacku se ignoriraju (tuđi kod, nije naš bug).
- **Cap:** max 5 različitih error eventova po page loadu.

### 3.3 API greške

`ensureAuthedFetch()` i Pro feature handleri dobivaju jednu liniju: `track('api_server_error_engine')` itd. — postojeće toast poruke se ne mijenjaju; tracking je nevidljiv korisniku.

---

## 4. Privacy pravila (primjenjuju se na SVE iz ovog plana)

1. **Kategorija, ne sadržaj** — svaki event je unaprijed definiran string iz tablica gore; dinamički sadržaj nikad ne napušta browser.
2. **Bez korelacije** — Simple Analytics nema user ID; event se ne može vezati ni na koga.
3. **Opt-out postoji inherentno** — bez JS-a / s adblockerom tracking se ne događa; aplikacija radi i dalje punom funkcionalnošću.
4. **Bez promjene postojećih poruka** — korisnik vidi iste toast poruke kao danas; tracking ne mijenja UX.
5. **Server-side logovi** ostaju kakvi jesu (Railway logs, hashani IP-jevi u `auth_attempts`) — bez novih osobnih podataka.

---

## 5. Implementacijski checklist (za izvedbu)

- [ ] `tracking.js`: `track(name)` wrapper (no-op ako Simple Analytics nije učitan), dedupe logika, A/B sufiks iz `conversion-funnel-ab-plan.md`
- [ ] Globalni error handleri (sekcija 3.1–3.2)
- [ ] Učitavanje na svim stranicama (index, app, backtest, results, docs — uz postojeći SA script tag; CSP već allowlista SA domen)
- [ ] Event pozivi u `activateBeta()` (6 fail grana + success)
- [ ] Event pozivi u `ensureAuthedFetch()` (expired/invalid/5xx/429/network)
- [ ] Event pozivi u Pro handlerima (optimize, refresh history, fetchPrices, DCA)
- [ ] CTA eventi na `index.html`
- [ ] Verifikacija: događaji vidljivi u Simple Analytics dashboardu nakon deploya; nijedan request ne napušta browser osim prema `queue.simpleanalyticscdn.com`

---

## 6. Poznate rupe (accepted risk)

| Rupa | Zašto je prihvaćamo |
|---|---|
| Korisnici bez JS-a / s adblockerom su nevidljivi | To je cijena privacy-first pristupa — i dalje imamo page view baseline |
| Server-side greške pratimo samo Railway logovima, ne šaljemo ih u SA | Logovi su agregirani i ne sadrže osobne podatke; dovoljno za betu |
| Bez session replaya / bez screenshotova | Eksplicitno izvan filozofije |

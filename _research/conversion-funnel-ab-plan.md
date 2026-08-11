# 🎯 Conversion Funnel & A/B Test Plan

**Datum:** 2026-08-11
**Status:** PLAN (izvedba čeka odobrenje — kod još ne postoji)
**Vlasnik:** aqmath-ui + postojeći auth/engine servisi (jedan codebase pristup — bez novih servisa i vendora)

---

## 1. Filozofija (non-negotiable)

AQMath privacy filozofija vrijedi i za tracking:

| Princip | Primjena u ovom planu |
|---|---|
| Bez cookija | Simple Analytics je cookieless; A/B varijanta se pamti u `localStorage` (tehnička nužnost, ne profiliranje) |
| Bez identifikatora | Nijedan event ne nosi key_hash, IP, user ID ni session ID |
| Samo agregati | Mjerimo **brojače** (koliko puta se nešto dogodilo), nikad tko |
| Bez trećih strana | Jedini analytics vendor je Simple Analytics (već prisutan, CSP-allowlistan) |
| Podaci koje već imamo | Server-side funnel metrike se izvode iz **postojećih** tablica (`auth_attempts`, `beta_activations`) — bez novih tablica |

---

## 2. Funnel mapa — svaka točka gdje korisnik može otići

```
L1  Landing (index.html)
 │    └─ D1: bounce — otišao bez interakcije
 ▼
L2  CTA klik ("Get Beta Key" / "Open App")
 │    └─ D2: vidio CTA, nije kliknuo
 ▼
L3  app.html učitan
 │    └─ D3: otišao prije nego je vidio key formu
 ▼
L4  Beta key forma otvorena/fokusirana
 │    └─ D4: otišao bez unosa ključa (cijena/friction?)
 ▼
L5  Submit ("Activate Beta" kliknut)
 │    └─ D5: submitao ali auth pao:
 │         • invalid key (tipfeler)
 │         • rate limit lockout (odustao nakon čekanja?)
 │         • key revoked / expired (365d)
 │         • IP binding (drugi uređaj)
 │         • network error (auth servis nedostupan)
 ▼
L6  Aktivacija uspjela ("You're in")
 │    └─ D6: aktivirao ali nikad ne koristi Pro feature
 ▼
L7  Prvo Pro iskustvo (Engine OPTIMIZE / Refresh History / history graf)
 │    └─ D7: Pro feature pao s greškom (401 istekao token, engine 500...)
 ▼
L8  Retencija — povratak unutar 7/30 dana
```

**Ključna mjerna mjesta (drop-off točke):** D1, D2, D4, D5 (najbogatija — 5 različitih razloga), D6→L7, D7.

---

## 3. Tracking eventi (Simple Analytics `sa_event`)

Događaji su **anonimni brojači**. Implementacija: jedan `tracking.js` wrapper (vidi sekciju 6 — još ne postoji).

### 3.1 Funnel eventi (client-side)

| Event | Okidač | Drop-off koji mjeri |
|---|---|---|
| `landing_view` | page view (SA automatski) | — |
| `cta_clicked_<id>` | klik na CTA gumb na landingu | D2 |
| `app_loaded` | DOM ready na app.html | D3 |
| `keyform_focus` | prvi focus na `#iBetaKey` | D4 |
| `key_submit` | klik "Activate Beta" | D5 baseline |
| `key_success` | aktivacija OK (200) | konverzija L5→L6 |
| `key_fail_invalid` | 403 Invalid beta key | D5 |
| `key_fail_ratelimit` | 429 s retry_after | D5 |
| `key_fail_revoked` | 403 revoked | D5 |
| `key_fail_expired` | 403 expired | D5 |
| `key_fail_binding` | 403 IP binding mismatch | D5 |
| `key_fail_network` | fetch exception | D5 |
| `pro_first_<feature>` | prvi Pro poziv po featureu (optimize/refresh/history) jednom po sesiji | L7 |
| `session_expired_reentry` | 401 expired toast → korisnik ponovno vidi formu | D7 |

### 3.2 Server-side funnel metrike (bez novih tablica)

Već danas dostupno iz postojeće sheme:

```sql
-- 1) Pokušaji vs uspješne aktivacije (D5 razmjer)
SELECT COUNT(*) AS attempts,
       COUNT(*) FILTER (WHERE locked_until IS NOT NULL) AS lockouts
FROM auth_attempts;

-- 2) Novi vs povratanici (aproksimacija retencije, L8)
SELECT DATE(first_activated_at) AS day, COUNT(*) AS new_keys
FROM beta_activations GROUP BY 1 ORDER BY 1;

-- 3) Aktivni ključevi (last_seen u zadnjih 7/30 dana)
SELECT COUNT(*) FILTER (WHERE last_seen_at > now() - INTERVAL '7 days') AS w7,
       COUNT(*) FILTER (WHERE last_seen_at > now() - INTERVAL '30 days') AS w30
FROM beta_activations WHERE revoked = FALSE;
```

Opcionalno kasnije: agregatni admin endpoint `/api/funnel-stats` na auth servisu, gated s `X-Admin-Secret` (isti obrazac kao `/admin/reset-binding`). **Bez ijednog osobnog podatka u odgovoru.**

---

## 4. A/B test plan

### 4.1 Mehanika (bez profiliranja)

- Varijanta se dodjeljuje **deterministički**: `hash(navigator + datum) % 2` ili jednostavni `localStorage.ab_variant` postavljen pri prvom posjetu.
- Event nosi sufiks varijante: `key_submit_a` / `key_submit_b`.
- Nema cookies, nema fingerprintinga iznad jednog brojača; varijanta služi isključivo razdvajanju brojača.
- Svaki test traje min. 7 dana ili 200+ `key_submit` eventova (što prije), pa se odlučuje ručno.

### 4.2 Testovi po prioritetu (gdje korisnik najvjerojatnije odlazi)

| # | Hipoteza | Varijanta A (control) | Varijanta B | Mjeri se | Lokacija |
|---|---|---|---|---|---|
| AB1 | Friction unosa ključa koči konverziju (D4→D5) | Postojeći key form | Forma s explainerom "što je beta key i gdje ga dobivate" + primjer formata | `keyform_focus → key_submit` ratio | app.html `#betaSection` |
| AB2 | Landing CTA copy mijenja klik-rate (D2) | "Get Beta Key" | "Try AQMath Free for 1 Year" | `cta_clicked` / page views | index.html |
| AB3 | Poruka nakon neuspjelog unosa utječe na povratak (D5) | Generička greška | Greška + eksplicitna uputa "provjerite crtice i velika slova" + link na pomoć | `key_fail_invalid → key_submit` unutar 24h | app.js `activateBeta()` |

**Redoslijed:** AB1 → AB3 → AB2 (AB1 i AB3 targetiraju najveće pretpostavljene drop-offove D4/D5).

### 4.3 Odlučivanje

- Pobjednik = varijanta s višim funnel ratio-om uz ≥200 uzoraka po varijanti.
- Nakon odluke: pobjednička varijanta postaje default, event sufiksi se čiste.
- Rezultati se bilježe u `_research/ab-results.md` (jedan red po testu: datum, uzorak, ratio, odluka).

---

## 5. One codebase plan — gdje što živi

Bez novih servisa. Sve unutar postojećih repozitorija:

| Komada | Repo | Lokacija |
|---|---|---|
| `tracking.js` wrapper (sa_event + A/B varijanta + error eventi) | aqmath-ui | novi file, učitan na svim stranicama |
| Funnel event pozivi | aqmath-ui | `app.js` (`activateBeta`, `ensureAuthedFetch`, Pro feature handlers), `index.html` CTA-i |
| Error capture (detalji u `error-inventory-tracking.md`) | aqmath-ui | `tracking.js` |
| Server-side funnel SQL | -aqmath-beta-auth | postojeće tablice; opcionalni `/api/funnel-stats` admin endpoint |
| Rezultati testova | aqmath-ui | `_research/ab-results.md` |

**Bez promjena sheme baze. Bez novih env varijabli. Bez novih vendora.**

---

## 6. Status izvedbe

| Korak | Stanje |
|---|---|
| Simple Analytics na svim stranicama | ✅ već postoji |
| `tracking.js` wrapper | ❌ čeka izvedbu |
| Funnel eventi u kodu | ❌ čeka izvedbu |
| Error capture | ❌ čeka izvedbu (spec: `error-inventory-tracking.md`) |
| Server-side funnel SQL upiti | ⏳ dostupni ad-hoc, endpoint opcionalan |
| AB1–AB3 | ❌ čeka tracking infrastrukturu |

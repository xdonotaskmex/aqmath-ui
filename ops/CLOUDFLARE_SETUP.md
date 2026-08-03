# Cloudflare Setup — FREE tier WAF + DDoS za AQMath

Cilj: sav backend promet prolazi kroz Cloudflare PRIJE nego dotakne Railway.
Cijena: 0 EUR. Vrijeme: ~30 min + DNS propagacija (do 24 h, obično minuta).

## 1. Napravi Cloudflare račun i dodaj domenu

1. https://dash.cloudflare.com/sign-up → **Add a site** → `aqmath.xyz`
2. Odaberi **Free** plan
3. Cloudflare skenira postojeće DNS zapise — provjeri da su svi tu

## 2. DNS records (provjeri/uredi u Cloudflare tabu DNS > Records)

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | `xdonotaskmex.github.io` | DNS only (sivi oblak) |
| CNAME | `www` | `xdonotaskmex.github.io` | DNS only |
| TXT | `_github-pages-challenge-*` | (postojeći verification zapis) | DNS only |
| CNAME | `api-auth` | `aqmath-beta-auth-production.up.railway.app` | **Proxied (narančasti)** |
| CNAME | `api-engine` | `aqmath-engine-production.up.railway.app` | **Proxied** |
| CNAME | `api-dca` | `dca-engine-production.up.railway.app` | **Proxied** |
| CNAME | `api-backtest` | `backtesting-production-be57.up.railway.app` | **Proxied** |

GitHub Pages zapisi ostaju **DNS only** (Pages sam služi TLS).
API zapisi moraju biti **Proxied** — samo tako promet prolazi kroz WAF.

## 3. Nameserveri (ručni korak kod registrara)

Cloudflare ti daje dva nameservera (npr. `xxx.ns.cloudflare.com`).
Kod registrara gdje je kupljena aqmath.xyz zamijeni nameservere tim vrijednostima.
Status prati u Cloudflare dashboards (čekaj "Active").

## 4. Railway custom domene (za TLS)

Za svaki od 4 API servisa u Railway dashboardu:
1. Service → Settings → Networking → **Generate Domain** → upiši `api-auth.aqmath.xyz` (itd.)
2. Railway traži CNAME na `<service>.up.railway.app` — to već imaš iz koraka 2
3. Čekaj da TLS certifikat postane **Active** (par minuta)

## 5. WAF — Cloudflare Managed Rules (besplatno)

Security → WAF → **Managed rules**:
- Uključi **Cloudflare Managed Ruleset** (Log/Block po defaultu: SQLi, XSS, LFI, RCE obrasci)
- Security → Bots: uključi **Bot Fight Mode**

## 6. Rate limiting i auth zaštita (IP-based anomaly zaštita)

**Stanje na Free planu (provjereno 2026-07-29):**
- Rate limiting dopušta **samo 1 pravilo**, samo **Path** polje (Host tek od Pro
  plana), fiksni counting period 10 s i fiksnu mitigaciju 10 s.
- To jedno mjesto zauzima Cloudflareovo **zaključano tvorničko pravilo
  "Leaked credential check"** koje se ne može isključiti — vlastito rate-limit
  pravilo zato uopće nije moguće stvoriti (Create rule je zaključan na 1/1).
- Rješenje: auth zaštita se implementira kao **Custom rule** (Free dopušta 5).

**R1 — Auth zaštita (Custom rule, aktivna)**
- Security rules → Custom rules → Create rule
- Expression: `(http.request.uri.path contains "/auth/") or (http.request.uri.path contains "/admin")`
- Pokriva stvarne endpointe beta-auth servisa: `/auth/beta`, `/auth/refresh`,
  `/admin/reset-binding`, `/admin/revoke`; ti putevi ne postoje na drugim servisima
- Action: **Managed Challenge** (pravi browseri prolaze nevidljivo, botovi staju)
- Razlika vs rate limiting: challenge na svaki zahtjev, ne tek nakon N zahtjeva;
  za rijetke auth pozive (aktivacija/refresh ključa) to je prihvatljivo

**Pravi rate limiting (R2/R2b/R3) — NE MOGU na Free planu**: `http.host` je
 dostupan tek od Pro plana, a i limit od 1 (zauzetog) pravila ih isključuje.
 Njihovu ulogu preuzimaju Bot Fight Mode + Cloudflare Managed Ruleset +
 automatska DDoS zaštita. Ako jednog dana prijeđeš na Pro:

- Oslobodi slot: na Pro planu tvorničko pravilo se može isključiti
- **R1 — Auth**: path contains "/auth/" or "/admin", 5/10s/IP, Managed Challenge
- **R2 — Teški endpointi**: path contains "/optimize" or "/dca", 30/min/IP, Challenge 10 min
- **R2b — Paper-trading log**: host eq "api-backtest.aqmath.xyz", 60/min/IP, Challenge 10 min
- **R3 — Globalni baseline za API**: host starts_with "api-", 300/min/IP, Block 1 h

## 7. DDoS

Ne treba konfigurirati ništa — Cloudflare **Automated L3/L4/L7 DDoS protection**
je uvijek aktivan na svim planovima, uključujući Free.

## 8. Notifikacije

Notifications → **Create notification**:
- Alert: **HTTP DDoS Attack Event** → email
- Alert: **Advanced Security Events** (WAF/rate-limit akcije) → email

## 9. Prebacivanje frontenda na nove URL-ove — GOTOVO 2026-07-29

Sva 4 API endpointa verificirana kroz Cloudflare prije prebacivanja
(`api-auth/api-dca/api-engine` root + `/symbols`, `api-backtest/forward-log`):

1. U `aqmath-ui/app.js` zamijenjeno:
   - `BETA_AUTH_URL` → `https://api-auth.aqmath.xyz`
   - `API_URL` → `https://api-engine.aqmath.xyz`
   - `DCA_API_URL` → `https://api-dca.aqmath.xyz`
2. U `aqmath-ui/app-boot.js` zamijenjen fetch URL za forward-log:
   `https://backtesting-production-be57.up.railway.app` → `https://api-backtest.aqmath.xyz`
3. Isto i u `tools/refresh_forward_log.py` (ENDPOINT).
4. Pipeline + audit prošli; commit + push nakon L3 gate-a.
5. OTVORENO: stari `*.up.railway.app` URL-ovi su i dalje aktivni — po želji ih
   kasnije ugasi u Railway (Settings → Networking → remove public domain) da se
   WAF ne može zaobići.

## Napomena o limitima Free plana

Rate limiting: 1 pravilo, samo Path polje, 10 s prozori — i to je mjesto zauzeto
zaključanim tvorničkim pravilom, pa auth zaštita ide kroz Custom rule (korak 6).
Uz to: Bot Fight Mode + Cloudflare Managed Ruleset + automatska DDoS zaštita —
za ovaj budget to je puna zaštita koju 99% small SaaS-ova koristi.

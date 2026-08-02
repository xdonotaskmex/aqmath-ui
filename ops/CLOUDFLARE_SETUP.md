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

GitHub Pages zapisi ostaju **DNS only** (Pages sam služi TLS).
API zapisi moraju biti **Proxied** — samo tako promet prolazi kroz WAF.

## 3. Nameserveri (ručni korak kod registrara)

Cloudflare ti daje dva nameservera (npr. `xxx.ns.cloudflare.com`).
Kod registrara gdje je kupljena aqmath.xyz zamijeni nameservere tim vrijednostima.
Status prati u Cloudflare dashboards (čekaj "Active").

## 4. Railway custom domene (za TLS)

Za svaki od 3 API servisa u Railway dashboardu:
1. Service → Settings → Networking → **Generate Domain** → upiši `api-auth.aqmath.xyz` (itd.)
2. Railway traži CNAME na `<service>.up.railway.app` — to već imaš iz koraka 2
3. Čekaj da TLS certifikat postane **Active** (par minuta)

## 5. WAF — Cloudflare Managed Rules (besplatno)

Security → WAF → **Managed rules**:
- Uključi **Cloudflare Managed Ruleset** (Log/Block po defaultu: SQLi, XSS, LFI, RCE obrasci)
- Security → Bots: uključi **Bot Fight Mode**

## 6. Rate limiting (IP-based anomaly zaštita)

Security → WAF → **Rate limiting rules** — napravi ove 3 pravila:

**R1 — Auth zaštita (najstrože)**
- Matching: `(http.request.uri.path contains "/login") or (http.request.uri.path contains "/admin")`
- Rate: 10 requests per 1 minute per IP
- Mitigation: Challenge, duration 10 min

**R2 — Teški endpointi**
- Matching: `(http.request.uri.path contains "/optimize") or (http.request.uri.path contains "/dca")`
- Rate: 30 requests per 1 minute per IP
- Mitigation: Challenge, duration 10 min

**R3 — Globalni baseline za API**
- Matching: `(http.host starts_with "api-")`
- Rate: 300 requests per 1 minute per IP
- Mitigation: Block, duration 1 h

## 7. DDoS

Ne treba konfigurirati ništa — Cloudflare **Automated L3/L4/L7 DDoS protection**
je uvijek aktivan na svim planovima, uključujući Free.

## 8. Notifikacije

Notifications → **Create notification**:
- Alert: **HTTP DDoS Attack Event** → email
- Alert: **Advanced Security Events** (WAF/rate-limit akcije) → email

## 9. Prebacivanje frontenda na nove URL-ove (NAPRAVITI ZADNJE)

Tek kad su sva 3 TLS certifikata Active i kad `curl https://api-dca.aqmath.xyz/health`
radi kroz Cloudflare:

1. U `aqmath-ui/app.js` zamijeni:
   - `BETA_AUTH_URL` → `https://api-auth.aqmath.xyz`
   - `API_URL` → `https://api-engine.aqmath.xyz`
   - `DCA_API_URL` → `https://api-dca.aqmath.xyz`
2. Pipeline: `python tools/stamp_version.py; python tools/build_pages.py; python tools/audit_pages.py`
3. Commit + push (proći će L3 gate kao i svaki push)
4. Stari `*.up.railway.app` URL-ovi ostaju aktivni — po želji ih kasnije
   ugasi u Railway (Settings → Networking → remove public domain) da se
   WAF ne može zaobići.

## Napomena o limitima Free plana

Prava "adaptive" heuristika rate-limitinga je Pro feature. Free tier daje
statična pravila (gore) + automatsku DDoS heuristiku + managed rules —
za ovaj budget to je puna zaštita koju 99% small SaaS-ova koristi.

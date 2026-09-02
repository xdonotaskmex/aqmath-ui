# Cloudflare Setup — FREE tier WAF + DDoS za AQMath

Cilj: sav backend promet prolazi kroz Cloudflare PRIJE nego dotakne Railway.
Cijena: 0 EUR. Vrijeme: ~30 min + DNS propagacija (do 24 h, obično minuta).

> **Interni dokument — ne objavljuje se.** Živi u `_internal/` jer Jekyll
> poslužuje sve što nije u direktoriju s donjom crtom direktno na
> `aqmath.xyz` (ovo je bilo javno čitljivo na `/ops/CLOUDFLARE_SETUP.md`).
> Repo je javan, pa ovaj dokument **namjerno ne sadrži**: stvarne origin
> hostnameove backend servisa, inventar WAF pravila s njihovim izrazima,
> imena admin/internal endpointa, niti imena varijabli i konstanti iz
> privatnih servisa. Sve to se čita iz Railway/Cloudflare dashboardsa i iz
> privatnog repo-a — ovdje ostaje samo *postupak*.

---

## ⚠️ OTVORENI SIGURNOSNI ITEM (najvažnije u ovom dokumentu)

Backend servisi na Railwayu imaju **vlastiti javni `*.up.railway.app` domain**
koji je i dalje aktivan. Cloudflare WAF štiti samo promet koji ide preko
`api-*.aqmath.xyz`; direktan poziv na origin **zaobilazi WAF u potpunosti**.

Dok se to ne zatvori, javno objavljeni origin hostname = uputa za zaobilaženje
zaštite. Zato se hostnameovi ne smiju zapisivati u ovaj repo (niti u commit
poruke, niti u issue).

**Akcija (Railway dashboard, po svakom API servisu):**
Settings → Networking → ukloni javni domain, ili ograniči pristup na Cloudflare
IP rangeove. Nakon toga provjeri da `api-*.aqmath.xyz` i dalje radi, a da
direktan origin URL više ne odgovara.

---

## 1. Napravi Cloudflare račun i dodaj domenu

1. https://dash.cloudflare.com/sign-up → **Add a site** → `aqmath.xyz`
2. Odaberi **Free** plan
3. Cloudflare skenira postojeće DNS zapise — provjeri da su svi tu

## 2. DNS records (provjeri/uredi u Cloudflare tabu DNS > Records)

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | GitHub Pages hostname (vidi GitHub → Settings → Pages) | DNS only (sivi oblak) |
| CNAME | `www` | isto | DNS only |
| TXT | `_github-pages-challenge-*` | (postojeći verification zapis) | DNS only |
| CNAME | `api-auth` | origin hostname servisa (Railway → Settings → Networking) | **Proxied (narančasti)** |
| CNAME | `api-engine` | origin hostname servisa | **Proxied** |
| CNAME | `api-dca` | origin hostname servisa | **Proxied** |
| CNAME | `api-backtest` | origin hostname servisa | **Proxied** |

GitHub Pages zapisi ostaju **DNS only** (Pages sam služi TLS).
API zapisi moraju biti **Proxied** — samo tako promet prolazi kroz WAF.

Stvarne origin hostnameove namjerno ne prepisujemo ovdje; oni su u Railway
dashboardu i to je jedino mjesto gdje trebaju biti.

## 3. Nameserveri (ručni korak kod registrara)

Cloudflare ti daje dva nameservera (npr. `xxx.ns.cloudflare.com`).
Kod registrara gdje je kupljena aqmath.xyz zamijeni nameservere tim vrijednostima.
Status prati u Cloudflare dashboards (čekaj "Active").

## 4. Railway custom domene (za TLS)

Za svaki od 4 API servisa u Railway dashboardu:
1. Service → Settings → Networking → **Generate Domain** → upiši `api-auth.aqmath.xyz` (itd.)
2. Railway traži CNAME na origin hostname — to već imaš iz koraka 2
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

**Custom rule "Auth protection" (aktivna)**
- Security rules → Custom rules → Create rule
- Expression: URI Path **contains** `/admin`
- Action: **Managed Challenge** (pravi browseri prolaze nevidljivo, botovi staju)
- Pokriva sve operatorske putanje; frontend ih nikad ne zove, a štite ih i
  tajni ključevi u samom servisu

**ZAŠTO NE i `/auth/` u pravilu (lekcija od 2026-07-29):** frontend zove
auth endpointe preko `fetch()` — challenge se ne može riješiti unutar fetch
poziva i aktivacija ključa pada s "Couldn't reach the activation service".
`/auth/*` zato mora ostati otvoren na Cloudflareu; brute-force brani sam servis
(aplikacijski rate limit s eksponencijalnim backoffom — pragovi su varijable
okruženja u privatnom beta-auth servisu).

**Pravi rate limiting (teški endpointi, paper-trading log, globalni API
baseline) — NE MOGU na Free planu**: `http.host` je dostupan tek od Pro plana,
a i limit od 1 (zauzetog) pravila ih isključuje. Njihovu ulogu preuzimaju Bot
Fight Mode + Cloudflare Managed Ruleset + automatska DDoS zaštita, uz
aplikacijski rate limit u servisima. Ako jednog dana prijeđeš na Pro:

- Oslobodi slot: na Pro planu tvorničko pravilo se može isključiti
- Auth pravilo ostaje isto (challenge na operatorske putanje)
- Dodaj rate-limit pravila po hostu: teški izračuni (optimize/dca), paper-trading
  log, i globalni baseline za sve `api-*` hostove

Konkretne pragove drži u Cloudflare dashboardu, ne u ovom repo-u.

## 7. DDoS

Ne treba konfigurirati ništa — Cloudflare **Automated L3/L4/L7 DDoS protection**
je uvijek aktivan na svim planovima, uključujući Free.

## 8. Notifikacije

Notifications → **Create notification**:
- Alert: **HTTP DDoS Attack Event** → email
- Alert: **Advanced Security Events** (WAF/rate-limit akcije) → email

## 9. Prebacivanje frontenda na nove URL-ove — GOTOVO 2026-07-29

Sva 4 API endpointa verificirana kroz Cloudflare prije prebacivanja.

1. U `app.js`: `BETA_AUTH_URL`, `API_URL` i `DCA_API_URL` pokazuju na
   `https://api-auth.aqmath.xyz`, `https://api-engine.aqmath.xyz`,
   `https://api-dca.aqmath.xyz`
2. U `app-boot.js`: forward-log fetch ide na `https://api-backtest.aqmath.xyz`
3. Isto i u `tools/refresh_forward_log.py` (ENDPOINT)
4. Pipeline + audit prošli; commit + push nakon L3 gate-a
5. **OTVORENO:** origin URL-ovi su i dalje aktivni — vidi sigurnosni item na vrhu

Pravilo za ubuduće: nijedan fajl u ovom repo-u ne zove `*.up.railway.app`.
Promet ide isključivo preko `api-*.aqmath.xyz`, inače WAF ne radi.

## Napomena o limitima Free plana

Rate limiting: 1 pravilo, samo Path polje, 10 s prozori — i to je mjesto zauzeto
zaključanim tvorničkim pravilom, pa auth zaštita ide kroz Custom rule (korak 6).
Uz to: Bot Fight Mode + Cloudflare Managed Ruleset + automatska DDoS zaštita —
za ovaj budget to je puna zaštita koju 99% small SaaS-ova koristi. **Uz jedan
uvjet:** da origin nije javno dostupan (vidi item na vrhu).

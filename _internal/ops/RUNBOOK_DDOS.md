# RUNBOOK — DDoS / napad na aqmath.xyz

Kad Cloudflare pošalje notifikaciju (HTTP DDoS Attack Event) ili kad
posumnjaš na napad. Bez SSH-a, sve iz browsera.

> **Interni dokument — ne objavljuje se.** Živi u `_internal/` jer Jekyll
> poslužuje sve izvan direktorija s donjom crtom direktno na `aqmath.xyz`
> (ovo je bilo javno čitljivo na `/ops/RUNBOOK_DDOS.md`). Runbook je namjerno
> pisan kao *postupak u dashboardu* — bez origin hostnameova, bez inventara WAF
> pravila i bez pragova, tako da objavljen ne bi bio uputa za napad.

## 0. Prvih 60 sekundi — dijagnoza

1. Cloudflare dashboard → **Security → Events** — vidi što se blokira i s kojih IP-ja
2. **Analytics → Traffic** — abnormalni skok requestova?
3. Railway dashboard → metrike servisa (CPU, response time) — pada li backend?

## 1. AKCIJA: Under Attack mode (jedan klik)

Cloudflare dashboard → Overview → desno **Quick Actions → Under Attack Mode: ON**

- Svi posjetitelji dobiju JS challenge prije pristupa
- Botovi i većina napadačkih alata ne prolaze challenge
- Ugasi ga kad napad stane (inače svaki posjetitelj čeka ~3 s challenge)

## 2. AKCIJA: Blokiraj specifične IP-jeve / države

Ako Security Events pokazuje koncentraciju:
- **IP**: Security → IP Access Rules → Add (Block, pojedinačni IP ili /24 blok)
- **Država**: Security → WAF → Custom rule:
  `(ip.geoip.country in {"XX" "YY"})` → Block

## 3. AKCIJA: Maintenance preusmjeravanje (ako backend padne)

Ako Railway servisi ne dišu, a želiš posjetiteljima dati čist odgovor:
- Cloudflare → Rules → **Redirect Rules** → Create rule:
  - Matching: `(http.host eq "api-auth.aqmath.xyz") or (http.host eq "api-engine.aqmath.xyz") or (http.host eq "api-dca.aqmath.xyz")`
  - Action: Static redirect na `https://aqmath.xyz/` (ili status page)
- Kad se backend vrati — obriši pravilo

## 4. AKCIJA: Jedan klik rollback (ako je problem naš deploy, ne napad)

GitHub repo servisa → **Actions → One-Click Rollback → Run workflow**
(vidi `_internal/ops/RAILWAY_CI_SETUP.md`)

## 5. Nakon incidenta

- [ ] Zabilježi vrijeme, trajanje, vrstu napada (Security Events export)
- [ ] Provjeri Railway usage (DDoS promet kroz proxied Cloudflare NE troši
      Railway bandwidth — Cloudflare ga upija prije origin-a)
- [ ] Ako se napad ponavlja: pooštri rate-limit / auth pravila u WAF-u
      (stvarni pragovi žive u Cloudflare dashboardu, ne u ovom repo-u)
- [ ] Under Attack Mode natrag na OFF

## Notifikacije (postavljene po CLOUDFLARE_SETUP.md korak 8)

| Događaj | Dobivaš |
|---|---|
| HTTP DDoS napad detektiran | email |
| WAF / rate-limit akcije (burst) | email |

Ako email stiše previše: Notifications → prilagodi threshold po pravilu.

# ENVIRONMENTS — produkcija vs lokalni dev

Jedno pravilo: **nijedan secret ne živi u kodu ni u gitu.** Sve je
`os.getenv()` + Railway varijable (produkcija) ili `.env` / shell varijable
(lokalno). Servisi bez ključnih varijabli odbijaju start (fail-fast).

> **Interni dokument — ne objavljuje se.** Živi u `_internal/` jer Jekyll
> poslužuje sve izvan direktorija s donjom crtom direktno na `aqmath.xyz`
> (ovo je bilo javno čitljivo na `/ops/ENVIRONMENTS.md`). Repo je javan, pa
> ovdje **nema inventara varijabli po servisima**: popis koji secret koji servis
> traži, s kime ga dijeli i koje su mu produkcijske vrijednosti je mapa cijele
> sigurnosne arhitekture. Autoritativni izvor je `.env.example` svakog privatnog
> repo-a + Railway → Service → Variables.

---

## Kako saznati što servis treba (bez ovog dokumenta)

| Izvor | Što daje |
|---|---|
| `<repo>/.env.example` | popis varijabli tog servisa, s placeholder vrijednostima |
| Railway → Service → Variables | stvarne produkcijske vrijednosti (nikad ih ne prepisivati) |
| `<repo>/README.md` | koje su varijable obavezne i koje su dijeljene |
| fail-fast poruka pri startu | servis sam kaže što mu nedostaje |

Dijeljeni secreti postoje (npr. isti JWT secret koriste servisi koji međusobno
verificiraju tokene, isti collector secret koriste pipeline i kolektori). Tko s
kime dijeli koji secret vidi se u Railwayu — ovdje se to namjerno ne nabraja,
jer je to upravo ono što napadaču treba da procijeni blast radius jednog
procurjenog ključa.

## Lokalno pokretanje

```powershell
# backend servis: JWT secret generiraj, bazu usmjeri na lokalni Postgres
$env:JWT_SECRET = python -c "import secrets;print(secrets.token_hex(32))"
$env:DATABASE_URL = 'postgresql://user:pass@localhost:5432/aqmath'
uvicorn main:app --port 8000 --reload

# frontend: python -m http.server 8090 iz roota repoa
# app.js URL-ovi pokazuju na produkciju, pa se za lokalni E2E koristi
# produkcijski backend (CORS dopušta localhost:8090)
```

Za ostale varijable vrijedi isto pravilo: kopiraj `.env.example` u `.env`
(`.env` je u `.gitignore`) i popuni samo ono što ti za taj test treba.

## Fail-fast ponašanje

- beta-auth diže `RuntimeError` ako JWT secret nedostaje ili je prekratak
- Ostali servisi imaju safe defaultove za ne-kritične varijable; DATABASE_URL
  se provjerava pri prvom DB pozivu (engine/pipeline ne rade bez baze)

## Staging (faza 2 — odgođeno)

Po odluci: trenutno NEMA staging environmenta (bez dupliciranja Railway
računa). Kad se odobri: environment `staging` po projektu, zaseban Postgres
s istom shemom (`pg_dump` produkcijske sheme → restore), isti set varijabli
kao produkcija s `_STAGING` vrijednostima, i CI koji prvo pušta na staging.
Detalji: `_internal/ops/RAILWAY_CI_SETUP.md` sekcija 6.

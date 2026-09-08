# Frontend Migration: Beta → Black

**Date:** 2026-09-05
**Scope:** Frontend (UI) only — backend unchanged
**Version stamp:** `9e923bce2c` (first build with changes)

---

## Summary

The AQMath UI was updated to replace all user-visible "Beta" branding with "Black". The backend service (`beta-auth`) continues to operate with the same API paths, internal variable names, function names, CSS classes, and DOM IDs. Only the **text the user sees** was changed.

---

## What Changed (Frontend Only)

### 1. Key Format

| Before | After |
|--------|-------|
| `AQMBETA-XXXX-XXXX` | `AQBLACK-XXXXXXXXXXX` |

The input placeholder in `/app` was updated. The backend still accepts both formats during the transition period.

### 2. Landing Page — Access Tiers

**Before:** 3 cards
- FREE ACCESS (€0)
- BLACK ACCESS (0 spots left — old Beta card)
- BLACK Annual Access (€999/year · ~$1,090 USD)

**After:** 2 cards
- FREE ACCESS (€0)
- BLACK Annual Access (€999/year)

Changes:
- Removed the middle "BLACK ACCESS" card entirely (old Beta recruitment card)
- Grid changed from 3-column to 2-column (`grid-template-columns: repeat(2, 1fr)`)
- Removed USD conversion (`~$1,090 USD`) from price display — price is now `€999 / year` only
- Subtitle changed: "Annual access" → "Full engine access"

### 3. BLACK Annual Access — Feature List

Added features from the removed Beta card:
- DCA distribution with full safety pipeline
- Shared Black chat — pseudonymous, 20-message rolling buffer, deletable anytime
- 365-day term from activation — annual access only
- Send a message — we review and activate within 48h

Total features: 8 → 11

### 4. App Sidebar (`/app`)

| Element | Before | After |
|---------|--------|-------|
| Key label | Beta Key | Black Key |
| Activate button | Activate Beta | Activate Black |
| Key placeholder | `AQMBETA-XXXX-XXXX` | `AQBLACK-XXXXXXXXXXX` |
| Active state title | (already BLACK ACTIVE) | unchanged |
| Inactive state title | (already BLACK INACTIVE) | unchanged |

### 5. Toast Messages (app.js)

All 12 user-visible toast strings updated:

| Before | After |
|--------|-------|
| Your beta session expired | Your Black session expired |
| Please re-enter your beta key | Please re-enter your Black key |
| Beta access needed | Black access needed |
| Enter your beta key first | Enter your Black key first |
| That beta key didn't work | That Black key didn't work |
| You're in — beta access unlocked | You're in — Black access unlocked |
| [ Activate Beta ] (button fallback) | [ Activate Black ] |
| Beta access turned off | Black access turned off |
| Please log in with your beta key first | Please log in with your Black key first |

### 6. Chat

| Element | Before | After |
|---------|--------|-------|
| FAB title/aria-label | Beta chat | Black chat |
| Panel header | BETA CHAT | BLACK CHAT |

### 7. FAQ (Landing Page)

| Question | Before | After |
|----------|--------|-------|
| q3 | What's included in Beta vs Black? | What does Black access include? |
| q10 | Do beta keys track my IP address? | Do Black keys track my IP address? |
| q12 | What is the beta chat? | What is the Black chat? |

All corresponding answers updated to replace "beta" → "Black".

### 8. Documentation (`/docs`)

- Section 9.3: "Beta Chat" → "Black Chat"
- All references to "beta users", "beta members", "beta testers" → "Black users/members"
- "Beta chat messages" → "Black chat messages" (backend data inventory table)
- "Beta key identity" → "Black key identity" (privacy table)

### 9. JSON-LD Structured Data

- Offer name: "Beta Access" → "Free Access" (in `build_pages.py` generator)
- Offer name: "Black Access" (in `_src/index.html` inline JSON-LD)

### 10. Pricing References

Removed `~$1,090 USD` from all locations:
- BLACK Annual Access card price
- FAQ answer (q6: How do I apply?)
- Black Access modal text
- `beta.description` and `beta.note` locale keys (en.json, zh-CN.json)

---

## What Did NOT Change

The following remain **exactly as before** — internal names are still "beta":

### Internal Variable & Function Names (app.js, app-boot.js, app-notify.js)

```
BETA_AUTH_URL        — API base URL constant
getBetaToken()       — reads JWT from localStorage
isBetaActive()       — checks session validity
checkBetaUI()        — toggles sidebar visibility
activateBeta()       — handles key activation
deactivateBeta()     — handles deactivation
refreshBetaSession() — renews idle session
pipelineFetch()      — authenticated backend calls
betaSection          — DOM ID (inactive sidebar)
betaActive           — DOM ID (active sidebar)
betaChat             — DOM ID (chat panel)
iBetaKey             — DOM ID (key input)
btnBeta              — DOM ID (activate button)
```

### CSS Classes (styles.css)

```
.beta-card           — inactive sidebar card
.beta-active-card    — active sidebar card
.beta-active-row     — flex row inside sidebar
.beta-hint           — hint text below input
.beta-links          — social links row
.beta-link           — individual social link
.lp-plan-card.beta   — landing page card style
.lp-beta-*           — landing page recruitment section
```

### API Paths (beta-auth service)

```
POST /auth/beta      — key activation
POST /auth/refresh   — session renewal
GET  /api/slots      — slot counter (still returns dynamic value)
GET  /chat           — fetch messages
POST /chat           — send message
DELETE /chat          — clear user's messages
PUT  /portfolio      — sync holdings
GET  /ack            — check must-read version
POST /ack            — acknowledge must-read
```

### DOM IDs

```
#betaSection         — inactive sidebar panel
#betaActive          — active sidebar panel
#betaChat            — chat panel
#iBetaKey            — key input field
#btnBeta             — activate button
#slotCounter         — slot count display (still fetched dynamically)
#chatFab             — chat floating button
```

### i18n Key Names

The JSON key names in locale files still use `beta*` prefix:
```
plans.betaTitle, plans.betaSubtitle, plans.betaSlotsLabel
plans.betaF1–betaF9, plans.betaApplyCta
app.betaAccess, app.betaKeyLabel, app.activateBeta, app.betaHint
hero.proBeta
```

Only the **string values** were changed. The key names are internal references.

### Data-Action Attributes

```
data-action="activateBeta"   — triggers activateBeta()
data-action="deactivateBeta" — triggers deactivateBeta()
```

### LocalStorage Keys

```
aqmath_beta_token    — JWT session token
aqmath_beta_key      — raw activation key (hashed for storage)
```

---

## Build Pipeline

### Files Modified

| File | Change |
|------|--------|
| `_src/index.html` | User-visible text, key placeholder, FAQ, docs, chat header |
| `locales/en.json` | All user-visible string values |
| `locales/zh-CN.json` | All user-visible string values (Chinese) |
| `app.js` | Toast messages only (12 strings) |
| `tools/build_pages.py` | JSON-LD offer name: "Beta Access" → "Free Access" |

### Files NOT Modified

| File | Reason |
|------|--------|
| `app-boot.js` | Only references internal function names (unchanged) |
| `app-notify.js` | Only references internal function names (unchanged) |
| `app-tour.js` | Targets `#iBetaKey` DOM ID (unchanged) |
| `app-widgets.js` | No beta references |
| `app-backtest.js` | No beta references |
| `styles.css` | CSS class names unchanged |
| `tools/stamp_version.py` | No beta references |
| `tools/minify_css.py` | No beta references |

---

## Rebuild Command

After any edit to `_src/index.html` or `styles.css`:

```bash
python tools/minify_css.py
python tools/stamp_version.py
python tools/build_pages.py
```

All 6 entry pages are regenerated from `_src/index.html`. Never edit generated files directly.

---

## Notes

- The dynamic slot counter (`#slotCounter`) still fetches from `GET /api/slots` — if the backend returns a number > 0, it will display. The default hardcoded value in the source is `0`.
- The `aqmath_beta_token` localStorage key still exists. Renaming it would invalidate all active sessions — not done for backward compatibility.
- The backend `beta-auth` service name, deployment, and Railway config are unchanged.

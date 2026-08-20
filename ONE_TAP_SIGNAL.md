# One-Tap Alignment — Feature Documentation

**Status:** ✅ UI complete · 🔄 Backend endpoints in progress
**Date:** 2026-08-20
**Files:** `app-notify.js` (UI), `_src/index.html` (markup), `styles.css` (styling),
`portfolio_service.py` (backend), `-aqmath-beta-auth/main.py` (signal CRUD)

---

## 1. Overview

One-Tap Alignment lets beta users **confirm, adjust, or skip** pending trading
signals directly from the app — without leaving the page or opening a separate
workflow. It is the user-facing counterpart to the server-side daily signal loop
(`portfolio_service.py`).

### Flow

```
Engine daily cron (00:45 UTC)
    │
    ├── computes shield-modulated target weights
    ├── compares with user's declared holdings
    ├── generates BUY/SELL signals for material deltas
    └── stores in signal_confirmations table
                │
                ▼
User opens app → GET /portfolio/signals
                │
                ├── signal card appears (if pending signals exist)
                ├── each signal shows: side, symbol, amount, regime, age
                └── user can: confirm, adjust, skip, or skip-all
                            │
                            ▼
                    POST /portfolio/signals/confirm
                    POST /portfolio/signals/adjust
                    POST /portfolio/signals/skip
                            │
                            ├── delta applied to holdings (server-side)
                            ├── local portfolio synced back
                            └── execution-time prompt shown (optional)
                                        │
                                        ▼
                                POST /portfolio/signals/report-execution
                                (captures honest execution gap)
```

---

## 2. UI Components

### 2.1 Signal Card (`#signalCard`)

Terminal-style card (`.tc.signal-card`) shown above the Shield card when
pending signals exist. Hidden when empty.

**HTML** (`_src/index.html` line ~737):
```html
<div class="tc signal-card hidden" id="signalCard">
    <div class="tc-bar">
        <span class="tc-dot r"></span><span class="tc-dot y"></span><span class="tc-dot g"></span>
        <span class="tc-title" data-i18n="app.pendingSignals">--pending-signals</span>
        <span class="tc-right">
            <span class="signal-stats-badge hidden" id="signalStatsBadge"></span>
        </span>
    </div>
    <div class="tc-body">
        <div id="signalList"><!-- dynamic --></div>
        <div class="signal-actions hidden" id="signalBulkActions">
            <button class="btn ghost" data-action="skipAllSignals">[ skip all ]</button>
        </div>
        <div class="signal-empty hidden" id="signalEmpty">no pending signals</div>
    </div>
</div>
```

### 2.2 Signal Block (per signal)

Each pending signal renders as a `.sig-block` with:

| Element | Content | CSS Class |
|---------|---------|-----------|
| Side | BUY (green) or SELL (red) | `.sig-side.sig-buy` / `.sig-side.sig-sell` |
| Symbol | Token symbol (normalized) | `.sig-sym` |
| Amount | Units → USD equivalent | `.sig-amount` |
| Regime | SHOCK (red) or LOW VOL (green) | `.sig-regime.regime-shock` / `.regime-lowvol` |
| Age | "today" (green) or "pending Nd" (amber) | `.sig-days-ok` / `.sig-days-warn` |
| Actions | [ confirm & sync ] [ adjust ] [ skip ] | `.sig-actions` |
| Adjust form | Hidden by default, shown on [ adjust ] | `.sig-adjust-form.hidden` |

### 2.3 Signal Stats Badge (`#signalStatsBadge`)

Small badge in the card header showing per-regime pass rates:
```
SHOCK: 85% (pass) | LOW VOL: 92% (pass)
```
Fetched from `GET /portfolio/signal-stats`. Hidden when no stats available.

### 2.4 Execution-Time Prompt (`.exec-overlay`)

After confirming or adjusting a signal, a full-screen modal asks:
"When did you actually execute the trade on the exchange?"

**Quick presets:** just now · 5 min ago · 15 min ago · 30 min ago · 1 h ago
**Custom:** `<input type="datetime-local">` — converted to UTC ISO before sending
**Skip:** dismisses without reporting (optional field)

Auto-dismisses after 60 seconds. Backdrop click also dismisses.

**CSS** (`styles.css`):
- `.exec-overlay` — fixed fullscreen, blur backdrop, z-index 9999
- `.exec-box` — centered card, brand-styled
- `.exec-grid` — responsive button grid (auto-fit, minmax 88px)
- `.exec-custom` — flex row for datetime input + set button
- Mobile (< 480px): 2-column grid, full-width custom button

---

## 3. JavaScript API (`app-notify.js`)

### Functions

| Function | Trigger | Backend Endpoint |
|----------|---------|-----------------|
| `loadPendingSignals()` | `refreshNotifyUI()` on page load/auth change | `GET /portfolio/signals` |
| `confirmSignal(el, id)` | `[ confirm & sync ]` button | `POST /portfolio/signals/confirm` |
| `skipSignal(el, id)` | `[ skip ]` button | `POST /portfolio/signals/skip` |
| `skipAllSignals()` | `[ skip all ]` button | Sequential `POST /portfolio/signals/skip` |
| `adjustSignal(el, id)` | `[ save & sync ]` in adjust form | `POST /portfolio/signals/adjust` |
| `loadSignalStats()` | After signals loaded | `GET /portfolio/signal-stats` |
| `_promptExecutionTime(id)` | After confirm/adjust success | (UI only, no backend call) |
| `_reportExecTime(id, minAgo)` | Quick preset button | `POST /portfolio/signals/report-execution` |
| `_reportExecTimeCustom()` | Custom datetime input | `POST /portfolio/signals/report-execution` |
| `_syncHoldingsAfterSignal()` | After confirm/adjust | `GET /portfolio` (beta-auth) |
| `_rerenderSignalList()` | After any signal action | (UI only) |

### Signal Data Shape (from `/portfolio/signals`)

```json
{
  "signals": [
    {
      "signal_id": "uuid",
      "sym": "BTC",
      "side": "BUY",
      "units": 0.015,
      "usd": 920,
      "shield_regime": "LOW_VOL",
      "days_pending": 0,
      "same_day": true
    }
  ]
}
```

### Execution Time Report Shape

```json
{
  "signal_id": "uuid",
  "executed_at": "2026-08-20T14:30:00.000Z"
}
```

---

## 4. Backend Endpoints

### Implemented (beta-auth / engine)

| Endpoint | Method | Auth | Status |
|----------|--------|------|--------|
| `/portfolio/signals` | GET | Beta JWT | ✅ Returns pending signals |
| `/portfolio/signals/confirm` | POST | Beta JWT | ✅ Confirms + applies delta |
| `/portfolio/signals/skip` | POST | Beta JWT | ✅ Marks signal as skipped |
| `/portfolio/signals/adjust` | POST | Beta JWT | ✅ Adjusts units + applies delta |
| `/portfolio/signals/report-execution` | POST | Beta JWT | ✅ Stores execution timestamp |
| `/portfolio/signal-stats` | GET | Beta JWT | ✅ Per-regime pass rates |

### Database Table

`signal_confirmations` (engine PostgreSQL):
- `id` (UUID)
- `key_hash` (VARCHAR) — user identifier
- `signal_id` (UUID) — references the daily signal
- `action` (VARCHAR) — 'confirmed' | 'skipped' | 'adjusted'
- `actual_units` (FLOAT, nullable) — for adjusted signals
- `executed_at` (TIMESTAMP, nullable) — honest execution time
- `created_at` (TIMESTAMP)

---

## 5. CSS Classes Reference

### Signal Card
| Class | Purpose |
|-------|---------|
| `.signal-card` | Terminal-style card border (cyan tint) |
| `.signal-card.hidden` | `display: none` |
| `.sig-block` | Individual signal container, dashed border-bottom |
| `.sig-header` | Flex row: side + symbol + amount + regime + age |
| `.sig-side.sig-buy` | Green text |
| `.sig-side.sig-sell` | Red text |
| `.sig-regime.regime-shock` | Red background pill |
| `.sig-regime.regime-lowvol` | Green background pill |
| `.sig-days-warn` | Amber text (pending Nd) |
| `.sig-days-ok` | Green text (today) |
| `.sig-actions` | Flex row of action buttons |
| `.sig-adjust-form` | Hidden form with number input |
| `.signal-empty` | Centered "no pending signals" message with ✓ |
| `.signal-empty.hidden` | `display: none` |
| `.signal-actions.hidden` | `display: none` |
| `.signal-stats-badge` | Small badge in card header |

### Execution-Time Prompt
| Class | Purpose |
|-------|---------|
| `.exec-overlay` | Fixed fullscreen overlay, blur backdrop |
| `.exec-overlay.hidden` | `display: none` |
| `.exec-box` | Centered card (max-width 480px) |
| `.exec-grid` | Button grid (auto-fit, min 88px) |
| `.exec-custom` | Flex row for datetime input |
| `.exec-skip` | Centered skip button |

---

## 6. What's Done vs What Remains

### ✅ Done
- Signal card UI (HTML + CSS + JS rendering)
- Signal block rendering with regime badges and age indicator
- Confirm / Skip / Adjust / Skip-All actions
- Execution-time prompt modal (quick presets + custom datetime)
- Signal stats badge (per-regime pass rate display)
- Post-confirm holdings sync (server → local portfolio)
- Hidden classes for clean show/hide toggling
- Backend signal_confirmations table schema
- Backend CRUD endpoints for signals

### 🔄 Needs Attention
- Backend endpoint hardening (error handling, edge cases)
- Signal stats aggregation optimization
- Execution time analytics (dashboard, reporting)
- Integration testing (E2E flow from cron → signal → confirm → execution)

### 🔴 Not Started
- Signal history view (past signals with outcomes)
- Execution gap analysis (planned vs actual timing)
- Signal performance attribution (did following signals help?)
- Mobile-specific UX improvements (swipe to confirm, etc.)

---

## 7. Integration Points

| Component | Integration |
|-----------|-------------|
| `app.js` | `render()` builds holdings table; signal confirm changes amounts |
| `app-notify.js` | All signal logic lives here |
| `app-boot.js` | Calls `refreshNotifyUI()` on auth state change |
| `styles.css` | Signal card + exec overlay styles |
| `_src/index.html` | Signal card markup (line ~737) |
| `portfolio_service.py` | Daily cron generates signals |
| `-aqmath-beta-auth/main.py` | Signal CRUD endpoints |
| `engine/portfolio_service.py` | `signal_confirmations` table |

---

## 8. Testing Checklist

- [ ] Signal appears after daily cron generates it
- [ ] Confirm applies delta and syncs holdings
- [ ] Adjust changes units and syncs holdings
- [ ] Skip removes signal from list
- [ ] Skip-all removes all pending signals
- [ ] Execution time prompt appears after confirm/adjust
- [ ] Quick preset buttons report correct time
- [ ] Custom datetime converts to UTC correctly
- [ ] Signal stats badge shows correct pass rates
- [ ] Card hides when no pending signals
- [ ] Mobile layout: buttons wrap correctly
- [ ] Backdrop click dismisses exec prompt
- [ ] Auto-dismiss after 60 seconds works

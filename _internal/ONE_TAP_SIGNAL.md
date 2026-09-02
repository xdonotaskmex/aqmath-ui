# One-Tap Alignment — Feature Documentation

**Status:** ✅ Complete (UI + backend + discipline module)
**Date:** 2026-08-23 (last update)
**UI files (this repo):** `app-notify.js`, `app.js`, `_src/index.html`, `styles.css`
**Backend:** engine (signal generation) + beta-auth (signal storage/API)

> **Internal doc — not published.** It lives in `_internal/` because Jekyll serves
> anything at the repo root on the public site. The `aqmath-ui` repo is public, so
> this file describes the **UI contract and the user-visible behaviour** only: no
> database schema, no operator/admin endpoints, no private function names and no
> unpublished business rules. Service names are fine (they are already in
> `README.md`); anything below service level is not.

---

## 1. Overview

One-Tap Alignment lets beta users **confirm, adjust, or skip** pending trading
signals directly from the app — without leaving the page or opening a separate
workflow. It is the user-facing counterpart to the server-side daily signal loop
(engine).

### Flow

```
Engine daily run (after the UTC close)
    │
    ├── computes shield-modulated target weights
    ├── compares with user's declared holdings
    ├── generates BUY/SELL signals for material deltas
    └── stores them for the user
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

**HTML** (`_src/index.html`, app section):
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
| **Countdown** | **12h expiry timer from ntfy delivery** | **`.sig-countdown`** |
| Actions | [ confirm & sync ] [ adjust ] [ skip ] | `.sig-actions` |
| Adjust form | Hidden by default, shown on [ adjust ] | `.sig-adjust-form.hidden` |

#### Signal Expiry (12-hour window)

Each signal has a 12-hour reaction window starting from the notification
delivery time, with fallback to the creation time when notifications are
disabled. Expiry is resolved lazily on every signal-related API call.
Expired signals return HTTP 410 on confirm.

The countdown timer on each signal card shows the remaining time in
`HH:MM:SS` format, turning red in the last 30 minutes.

### 2.3 Signal Stats Badge (`#signalStatsBadge`)

Small badge in the card header showing per-regime pass rates:
```
SHOCK: 85% (pass) | LOW VOL: 92% (pass)
```
Fetched from `GET /portfolio/signal-stats`. Hidden when no stats available.

### 2.4 Discipline Meter Card (`#disciplineCard`)

Double-width terminal card showing the user's discipline rate:

```
┌─────────────────────────────────────────────┐
│ ◆ DISCIPLINE METER                          │
├─────────────────────────────────────────────┤
│ your same-day goal                [ 90% ▾ ] │
│ Rate: 62% ██████████░░░░░░░░░░              │
│ your goal: 90%                              │
│ ✓ Confirmed: 12  ✗ Missed: 2  ○ Skipped: 1 │
│ last 10 signals: 6 confirmed (60%)          │
│ ⚠ Pattern forming: 4 of last 10 SHOCK ...  │
│ ☐ active reminders (off by default)         │
│ 🎁 Reward unlocked (only once earned)       │
└─────────────────────────────────────────────┘
```

Fetched from `GET /portfolio/discipline`. Rate = confirmed / (confirmed +
missed + skipped). The meter bar is graded against the USER'S OWN goal
(`settings.discipline_target`, self-set via the dropdown, 50–100%): green at
or above the goal, amber within 30 points, red below.

Design principles ("escalate on the pattern, not on the event"):

- **User-set goal** — the friction they chose themselves feels different to
  an app deciding you've been bad. Saved via `POST /portfolio/settings`
  (`discipline_target`, 0.5–1.0). Default 0.8 applies until they pick.
- **Rolling window** — `recent`: last 10 resolved signals. Showing the
  number does most of the work ("most assume 90 and find out they're at 60").
- **Pattern trigger** — `pattern_alert`: ≥4 missed/skipped within the last
  10 resolved SHOCK signals. One miss is a normal day; a string is a habit.
- **Opt-in active reminders** — `escalation_opt_in` (OFF by default): the
  escalation ladder only pushes to users who turned it on themselves after
  seeing their rate, so it never punishes opening the app.
- **Surprise reward** — any reward tied to the rate is evaluated server-side
  and NEVER surfaced before it is earned. The gate itself is an unpublished
  business rule and is deliberately not documented here.

### 2.5 Portfolio History — Ideal vs Actual Equity

The history chart (`renderHistoryChart()` in `app.js`) overlays two
dashed lines from `GET /portfolio/discipline/history`:

- **Ideal** (green dashed): every signal confirmed at the signal price (zero slippage)
- **Actual** (amber dashed): confirmed at the confirmation price, missed/skipped = no trade

The gap between the two lines shows the cost of missed signals and
slippage. Fetched from `loadDisciplineHistory()` in `app-notify.js`.

### 2.6 Execution-Time Prompt (`.exec-overlay`)

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
| `loadDisciplineMeter()` | `refreshNotifyUI()` on page load | `GET /portfolio/discipline` |
| `loadDisciplineHistory()` | `refreshNotifyUI()` on page load | `GET /portfolio/discipline/history` |

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

### User-facing (called by this repo's JS)

| Endpoint | Method | Auth | Status |
|----------|--------|------|--------|
| `/portfolio/signals` | GET | Beta JWT | ✅ Returns pending signals |
| `/portfolio/signals/confirm` | POST | Beta JWT | ✅ Confirms + applies delta |
| `/portfolio/signals/skip` | POST | Beta JWT | ✅ Marks signal as skipped |
| `/portfolio/signals/adjust` | POST | Beta JWT | ✅ Adjusts units + applies delta |
| `/portfolio/signals/report-execution` | POST | Beta JWT | ✅ Stores execution timestamp |
| `/portfolio/signal-stats` | GET | Beta JWT | ✅ Per-regime pass rates |
| `/portfolio/discipline` | GET | Beta JWT | ✅ Per-user discipline rate |
| `/portfolio/discipline/history` | GET | Beta JWT | ✅ Ideal vs actual equity curves |
| `/portfolio/signals/apply-all` | POST | Beta JWT | ✅ Retroactive delta apply |

Operator-side reporting endpoints also exist; they are **deliberately not listed
here** (this repo is public). See the private beta-auth service.

### Persistence

Signals, their user actions (confirmed / skipped / adjusted), the optional
adjusted size and honest execution time, plus the prices needed to build the
ideal-vs-actual comparison, are stored server-side by the engine, with daily
count snapshots kept for the discipline history.

**Table names, columns and types are intentionally not written down here.**
Schema lives in the private engine repo.

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
- Backend persistence for signal actions
- Backend CRUD endpoints for signals
- **12h signal expiry** with countdown timer on each signal card
- **Discipline meter card** (double-width, graded against the user's own goal)
- **Ideal vs actual equity curves** overlaid on history chart
- **Operator telemetry** — per-user discipline reporting (server-side, not documented here)
- **Retroactive delta apply** (`/portfolio/signals/apply-all`)
- **Entry/APY preservation** in all signal write-back paths

### 🔄 Needs Attention
- Execution time analytics (dashboard, reporting)
- Integration testing (E2E flow from cron → signal → confirm → execution)

### 🔴 Not Started
- Execution gap analysis (planned vs actual timing)
- Mobile-specific UX improvements (swipe to confirm, etc.)

---

## 7. Integration Points

| Component | Integration |
|-----------|-------------|
| `app.js` | `render()` builds holdings table; signal confirm changes amounts |
| `app-notify.js` | All signal logic lives here |
| `app-boot.js` | Calls `refreshNotifyUI()` on auth state change |
| `styles.css` | Signal card + exec overlay styles |
| `_src/index.html` | Signal card markup (app section) |
| engine service | Daily run generates the signals; stores signal actions |
| beta-auth service | Signal CRUD endpoints the UI calls |

Backend internals (module names, function names, schema) stay in the private
repos and are not mapped here.

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

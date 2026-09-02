# BUG: P&L shows N/A — average prices wiped on every signal sync

**Discovered:** 2026-08-20
**Severity:** HIGH (user data loss — P&L column unusable)
**Status:** ✅ FIXED (2026-08-20, second fix 2026-08-21, server-side guard 2026-08-21)
**Affected services:** beta-auth, engine, aqmath-ui

> **Internal doc — not published.** It lives in `_internal/` because Jekyll serves
> anything at the repo root on the public site. The `aqmath-ui` repo is public, so
> this post-mortem stays at **behaviour level**: it records what broke, why, and
> the rule that now prevents the whole class — but no private function names, no
> internal service-to-service endpoints, no SQL and no code excerpts. UI-side
> function names are fine (they ship in this repo's public JS).

---

## Symptom

User enters average prices (entry) for tokens in the holdings table.
After a portfolio sync / signal application, the entry prices are gone
and the entire **P&L column shows N/A**. The user must re-enter every
average price, and they get wiped again on the next sync.

## Root cause — the wipe chain

The user's holdings are stored server-side as a **full replacement**: writing a
portfolio replaces every stored row rather than merging into it. Three writers
combined that with a "null means empty" reading of the payload:

```
UI enters entry/APY ──> stored server-side              ✅ OK
Engine daily signal run
    1. fetches the user's holdings (amounts only — entry/APY not carried)
    2. computes new amounts
    3. writes the portfolio back WITHOUT entry/APY
beta-auth write path
    missing field read as "no value" -> stored as NULL   ❌
    full replacement then drops the old rows             ❌
UI restoreHoldingsFromServer()
    server returns entry=null -> P&L = N/A               ❌
```

### The three specific defects

| # | Where | Defect |
|---|-------|--------|
| 1 | beta-auth, the internal write path used by the engine | Accepted the payload as-is and replaced all stored rows, so any field the caller omitted was destroyed — even though the code comment claimed existing values were preserved. |
| 2 | beta-auth, the internal read path used by the engine | Returned holdings as token + amount only, so entry/APY were never available to the engine in the first place. |
| 3 | engine, the signal-delta apply | Read holdings, kept only amounts, and wrote back token + amount rows — nothing carried entry/APY through even if they had been available. |

Because the UI is **server-first** for synced users (`restoreHoldingsFromServer()`
replaces the local portfolio with server data), the wiped server values
overwrite whatever the user had locally on the next page load.

## Fix (applied 2026-08-20)

### 1. beta-auth — preserve entry/APY on internal writes (the core fix)

The internal write path now reads the existing rows first and carries forward
any entry/APY the caller did not provide. This is defense-in-depth: **any**
future caller that omits entry/APY can never wipe them again.

### 2. beta-auth — the internal read path returns entry/APY

The engine's daily-run user fetch now includes entry and APY so the engine can
pass them through verbatim.

### 3. engine — the signal-delta apply carries entry/APY through

The delta apply keeps a per-token side map of (entry, apy) read from beta-auth
and includes them in the write-back payload unchanged.

### 4. UI — self-heal on restore (`restoreHoldingsFromServer()`)

Data already wiped before the fix cannot be recovered server-side. When the
server returns rows with missing entry/APY but the local portfolio still has
them, the UI now pushes the durable copy back up (`pushDurableHoldings()`)
to re-populate the server on the next load.

## Second occurrence (2026-08-21)

After the initial fix was deployed, the user reported the same symptom:
only 1 out of 9 tokens retained entry/APY; the other 8 showed "—".

### Second root cause — the retroactive apply-all path

The `/portfolio/signals/apply-all` endpoint (called on every page load via the
UI's `_applyUnappliedDeltas()`) was a **fourth writer** that the first fix did
not cover. It wrote corrected holdings back with token and amount only, relying
solely on beta-auth's carry-forward fallback. While that fallback *should* have
preserved the data, the pattern was inconsistent and fragile — any symbol
normalisation mismatch between the engine's write and the stored rows would
silently drop entry/APY.

### Second fix (2026-08-21)

Apply-all now reads entry/APY from beta-auth into the same per-token side map
and includes them in the write-back payload — identical to the pattern already
used by the signal-delta apply.

## Third occurrence (2026-08-21, after deploy) — server-side guard

The entry/APY wipe returned a third time even with both engine fixes shipped.
The audit found that the first two fixes only hardened the **engine** writers.
The remaining gap was on the **primary UI write path**: the user-facing
portfolio write had **no carry-forward** at all. Because the write is a full
replacement, any caller whose local table lacked entry/APY (stale localStorage
cache, a failed `restoreHoldingsFromServer`, a cross-device race, or a page
loaded during a redeploy window) sent a null for every token and blanked every
average price the user had typed.

### Third fix (2026-08-21) — make the user-facing write preserve, not delete

The user-facing portfolio write now carries forward entry/APY from the existing
rows whenever the incoming value is null/missing — the same guard the internal
write path already had. **A null field now means "keep what the server has",
never "delete it".**

This closes the whole wipe **class**, not just one caller: every current and
future writer to the holdings store preserves entry/APY unless it explicitly
supplies a replacement value.

## The rule that came out of this

> Any write that replaces a whole record must carry forward fields the caller
> omitted. "Absent" is not "empty".

Every holdings writer — user-facing, internal, and retroactive — now follows it.

## Verification checklist

- [x] All holdings writers enumerated and reviewed (user-facing write, internal
      engine write, signal-delta apply, retroactive apply-all).
- [x] Engine writers carry entry/APY through (fixes #1 and #2).
- [x] User-facing write carries forward entry/APY on null (fix #3, 2026-08-21).
- [x] UI self-heals from the durable local copy when the server row is blank.
- [ ] After deploy: enter average prices → trigger a signal apply-all →
      reload → P&L column must still show values.
- [ ] Check one user in the error dashboard Beta Keys tab: `With portfolio`
      should stay true and entry values survive a delta.

## Notes

- `costBasis` / `totalTokens` remain localStorage-only by design (trade
  history); only `entry`/`apy` are durable server-side.
- The safe-haven USDC row usually has no entry — that is expected; USDC P&L
  is intentionally N/A.
- Exact module names, endpoint paths and the SQL behind the replacement write
  live in the private beta-auth and engine repos and are intentionally not
  reproduced here.

# BUG: P&L shows N/A — average prices wiped on every signal sync

**Discovered:** 2026-08-20
**Severity:** HIGH (user data loss — P&L column unusable)
**Status:** ✅ FIXED (2026-08-20, second fix 2026-08-21)
**Affected repos:** `-aqmath-beta-auth`, `aqmath-engine`, `aqmath-ui`

---

## Symptom

User enters average prices (entry) for tokens in the holdings table.
After a portfolio sync / signal application, the entry prices are gone
and the entire **P&L column shows N/A**. The user must re-enter every
average price, and they get wiped again on the next sync.

## Root cause — the wipe chain

Three components formed a silent data-loss loop:

```
UI enters entry/APY ──> beta-auth PUT /portfolio        ✅ stored OK
Engine daily signal ──> _apply_signal_delta()
    1. reads holdings from beta-auth /internal/user
       (returns token + amount ONLY — no entry/apy)
    2. computes new amounts
    3. writes back via beta-auth POST /internal/portfolio
       WITHOUT entry/apy fields
beta-auth internal_portfolio_write:
    parsed.append((tok, amt, None, None))   ← None, None
    db.replace_holdings()                   ← DELETE all rows + INSERT
                                            ← entry/APY are now NULL ❌
UI restoreHoldingsFromServer():
    server returns entry=null → P&L = N/A ❌
```

### The three specific defects

| # | Location | Defect |
|---|----------|--------|
| 1 | `-aqmath-beta-auth/main.py` `internal_portfolio_write()` | Appends `(tok, amt, None, None)` with a comment claiming "preserve existing if any" — but `db.replace_holdings()` does a full `DELETE FROM user_holdings` + `INSERT`, so the old entry/APY are destroyed, not preserved. |
| 2 | `-aqmath-beta-auth/main.py` `/internal/user` | Returns holdings as `{"token", "amount"}` only — entry/APY are not exposed to the engine at all. |
| 3 | `aqmath-engine/portfolio_service.py` `_apply_signal_delta()` | Reads holdings, keeps only amounts, and writes back `{"token", "amount"}` rows — nothing to carry entry/APY through even if they were available. |

Because the UI is **server-first** for synced users (`restoreHoldingsFromServer()`
replaces the local portfolio with server data), the wiped server values
overwrite whatever the user had locally on the next page load.

## Fix (applied 2026-08-20)

### 1. beta-auth — preserve entry/APY on internal writes (the core fix)

`internal_portfolio_write()` now reads the existing rows first and carries
forward any entry/APY the caller did not provide:

```python
existing = await db.get_holdings(key_hash)
old = {r["token"]: r for r in existing}
# ... per item ...
prev = old.get(tok)
if entry is None and prev is not None:
    entry = prev["entry"]
if apy is None and prev is not None:
    apy = prev["apy"]
```

This is defense-in-depth: **any** future caller that omits entry/APY can
never wipe them again.

### 2. beta-auth — `/internal/user` returns entry/APY

The engine's daily-run user fetch now includes `entry` and `apy` so the
engine can pass them through verbatim.

### 3. engine — `_apply_signal_delta()` carries entry/APY through

The delta apply now keeps a `meta` map of (entry, apy) per token read from
beta-auth and includes them in the write-back payload unchanged.

### 4. UI — self-heal on restore (`restoreHoldingsFromServer()`)

Data already wiped before the fix cannot be recovered server-side. When the
server returns rows with missing entry/APY but the local portfolio still has
them, the UI now pushes the durable copy back up (`pushDurableHoldings()`)
to re-populate the server on the next load.

## Second occurrence (2026-08-21)

After the initial fix was deployed, the user reported the same symptom:
only 1 out of 9 tokens retained entry/APY; the other 8 showed "—".

### Second root cause — `apply-all` endpoint

The `/portfolio/signals/apply-all` endpoint (called on every page load via
the UI's `_applyUnappliedDeltas()`) was writing corrected holdings back to
beta-auth with ONLY `token` and `amount` — dropping `entry` and `apy`
entirely:

```python
# BEFORE (broken) — apply-all wrote:
new_holdings = [{"token": tok, "amount": str(amt)}
                for tok, amt in holdings.items() if amt > 0]
# No entry/APY in the payload!
```

Unlike `_apply_signal_delta()` (which already carried entry/APY through via
a `meta` map), `apply-all` relied solely on beta-auth's carry-forward
fallback in `internal_portfolio_write()`. While the fallback *should* have
preserved the data, the pattern was inconsistent and fragile — any symbol
normalisation mismatch between the engine's write and beta-auth's stored
rows would silently drop the entry/APY.

### Second fix (2026-08-21)

`apply-all` now reads entry/APY from beta-auth (into a `meta` map) and
includes them in the write-back payload — identical to the pattern already
used by `_apply_signal_delta()`:

```python
# AFTER (fixed) — apply-all carries entry/APY:
meta = {}
for h in user.get("holdings", []):
    tok = m.SYMBOL_ALIASES.get(tok, tok)
    holdings[tok] = float(h["amount"])
    meta[tok] = (h.get("entry"), h.get("apy"))
# ... apply deltas ...
for tok, amt in holdings.items():
    if amt <= 0: continue
    row = {"token": tok, "amount": str(amt)}
    entry, apy = meta.get(tok, (None, None))
    if entry: row["entry"] = entry
    if apy:   row["apy"]   = apy
    new_holdings.append(row)
```

## Verification checklist

- [x] `replace_holdings` callers reviewed: `PUT /portfolio` (UI) sends
      entry/APY from `_durableHoldings()` — unaffected.
- [x] `internal_portfolio_write` is the only other writer — now preserves.
- [x] `_apply_signal_delta()` carries entry/APY through (fix #1).
- [x] `apply-all` carries entry/APY through (fix #2, 2026-08-21).
- [ ] After deploy: enter average prices → trigger a signal apply-all →
      reload → P&L column must still show values.
- [ ] Check one user in the error dashboard Beta Keys tab: `With portfolio`
      should stay true and entry values survive a delta.

## Notes

- `costBasis` / `totalTokens` remain localStorage-only by design (trade
  history), only `entry`/`apy` are durable server-side.
- The safe-haven USDC row usually has no entry — that is expected; USDC P&L
  is intentionally N/A.
- Both `_apply_signal_delta()` and `apply-all` now use the same `meta` map
  pattern — any future caller of `/internal/portfolio` should follow suit.

// ============================================================================
// app-notify.js — signal-only automation UI (Faza 2 of the automation plan)
//
//   1. Must-read "How AQMath works" explainer — shown after activation until
//      the user acknowledges it server-side (GET/POST /ack on beta-auth; the
//      ack lives in the DB, not in localStorage). Content is fetched from the
//      generated research page so it stays in sync with its single source
//      (_research/how-aqmath-works.md).
//   2. Shield card — syncs the local portfolio to beta-auth (PUT /portfolio);
//      on FIRST save the engine freezes KKT weights (POST /portfolio/init),
//      and the card shows the read-only daily status (GET /portfolio/status).
//   3. Notifications — consent checkbox + first-party ntfy subscription; the
//      topic + read-only token are shown ONCE.
//
// Depends on globals from app.js: BETA_AUTH_URL, API_URL, getBetaToken,
// pipelineFetch, portfolio, showToast — all loaded before this file (defer).
// Every handler is registered through the app-boot.js allowlist.
// ============================================================================

// ---------- must-read explainer ----------

let _howLoaded = false;
let _howAckRequired = false;

async function _loadHowContent() {
    if (_howLoaded) return;
    const box = document.getElementById('howAqmathBody');
    if (!box) return;
    try {
        const res = await fetch('/research/how-aqmath-works.html', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const main = doc.querySelector('main.legal-page');
        if (!main) throw new Error('explainer page malformed');
        // Network-sourced HTML: run it through the same first-party sanitizer
        // used for the forward-log fragments (defined in app-boot.js).
        box.innerHTML = (typeof sanitizeFirstPartyHtml === 'function')
            ? sanitizeFirstPartyHtml(main.innerHTML)
            : '';
        _howLoaded = true;
    } catch (e) {
        box.innerHTML = '<p>The explainer could not be loaded. Read it at '
            + '<a href="/research/how-aqmath-works">/research/how-aqmath-works</a> '
            + 'and then press &quot;I have read&quot;.</p>';
        console.warn('[AQMath] explainer load failed:', e.message);
    }
}

function showHowAqmath(required = false) {
    const modal = document.getElementById('howAqmathModal');
    if (!modal) return;
    _howAckRequired = required;
    modal.classList.remove('hidden');
    _loadHowContent();
}

function hideHowAqmath() {
    // The modal can only be closed via ackHowAqmath when it was opened as a
    // must-read; a voluntary re-open (? button) may be dismissed freely.
    if (_howAckRequired) return;
    const modal = document.getElementById('howAqmathModal');
    if (modal) modal.classList.add('hidden');
}

async function ackHowAqmath() {
    const btn = document.getElementById('btnHowAck');
    if (btn) { btn.disabled = true; btn.textContent = '[ saving... ]'; }
    try {
        const res = await fetch(BETA_AUTH_URL + '/ack', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'HTTP ' + res.status);
        }
        const modal = document.getElementById('howAqmathModal');
        if (modal) modal.classList.add('hidden');
        _howAckRequired = false;
        showToast('Acknowledged — thanks for reading.', 'success');
    } catch (e) {
        console.error('[AQMath] ack failed:', e.message);
        showToast('Could not record your acknowledgement — please try again.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '[ I have read ]'; }
    }
}

// Gate: after any (re)activation, ask beta-auth whether the CURRENT explainer
// version has been acknowledged; if not, open the modal in must-read mode.
async function ensureHowAqmathAck() {
    if (!isBetaActive()) return;
    try {
        const res = await fetch(BETA_AUTH_URL + '/ack', {
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) return;  // session issue is handled by the normal flows
        const data = await res.json();
        if (!data.acked) showHowAqmath(true);
    } catch (e) {
        console.warn('[AQMath] ack check failed:', e.message);
    }
}

// ---------- shield card: portfolio sync + status ----------

let _holdingsRestored = false;
let _shieldFrozen = false;
// Last CONFIRMED setup state from the server. Kept separate from _shieldFrozen
// so a transient network error cannot relabel the button back to "first sync".
let _shieldSynced = false;

// True once the engine confirms a frozen portfolio: from then on the frozen
// weights are the authoritative plan and [optimize] must not overwrite them.
function shieldTargetsFrozen() {
    return _shieldFrozen;
}

// Every write to _shieldFrozen goes through here so the Target% input's
// read-only state can never lag behind the plan. _applyFrozenTargets' render()
// is not enough: it only fires when a weight actually CHANGED, so a refresh that
// confirms the same plan would leave the field editable and let the user type a
// number the next refresh throws away.
function _setShieldFrozen(frozen) {
    _shieldFrozen = frozen;
    if (typeof syncTargetFieldLock === 'function') syncTargetFieldLock();
}

// Friendly names users type -> the collector ticker the engine stores weights
// under. MUST mirror aqmath-engine main.SYMBOL_ALIASES: frozen weights come
// back keyed by the canonical ticker (TIA), while the local row may still carry
// the name it was added with (CELESTIA) — without this map that row matches
// nothing and its Target% is zeroed even though the plan covers it.
const SYMBOL_ALIASES = {
    'PYTH NETWORK': 'PYTH', 'CELESTIA': 'TIA', 'CONSTELLATION': 'DAG',
    'ENERGY WEB': 'EWT', 'ENERGY-WEB': 'EWT', 'QUBETICS': 'TICS',
    'AETHIR': 'ATH',
};

function _applyFrozenTargets(weights) {
    // The frozen weights ARE the plan the daily signals are computed from, so
    // the holdings table shows exactly them. USDC absorbs the remainder (KKT
    // caps the risky sleeve well below 100%), and a row outside the frozen set
    // targets 0 — otherwise the total would read over 100%.
    if (!Array.isArray(weights) || weights.length === 0) return;
    const frozen = {};
    weights.forEach(w => {
        if (w && w.sym) frozen[String(w.sym).toUpperCase()] = Number(w.weight) || 0;
    });
    let risky = 0;
    let changed = false;
    (portfolio || []).forEach(t => {
        if (!t || !t.sym || t.safeHaven) return;
        // Alias-aware lookup: literal symbol first, then the canonical ticker
        // (CELESTIA row vs TIA weights).
        const up = t.sym.toUpperCase();
        const key = frozen[up] != null ? up : (SYMBOL_ALIASES[up] || up);
        const next = frozen[key] != null ? frozen[key] : 0;
        if (t.target !== next) { t.target = next; changed = true; }
        risky += next;
    });
    let usdc = (portfolio || []).find(t => t && t.safeHaven);
    // The safe-haven row is excluded from the engine sync (it is not part of
    // the risky sleeve), so a table restored from the server has no USDC row
    // and the remainder target had nowhere to land — the allocation view just
    // lost USDC. Recreate an empty row: the user re-enters the quantity, but
    // the plan stays whole and visible.
    if (!usdc) {
        usdc = { sym: 'USDC', coinId: 'usd-coin', amount: 0, price: 1, entry: 0,
                 apy: 0, target: 0, costBasis: 0, totalTokens: 0,
                 frozen: false, insufficientHistory: false, safeHaven: true };
        portfolio.push(usdc);
        changed = true;
    }
    const rest = Math.max(0, Number((100 - risky).toFixed(2)));
    if (usdc.target !== rest) { usdc.target = rest; changed = true; }
    if (changed) { saveState(); render(); }
}

// beta-auth is the DURABLE home of the synced holdings; the table itself lives
// in localStorage. Clearing browser data, a fresh browser profile or another
// machine therefore left the table empty while the shield card kept showing the
// frozen weights from the server — which reads as "the two sections disagree".
// Only MISSING rows are restored: an existing local row is never overwritten,
// so quantities edited but not yet synced survive.
async function restoreHoldingsFromServer() {
    if (!isBetaActive() || _holdingsRestored) return 0;
    _holdingsRestored = true;
    let holdings = [];
    try {
        const res = await fetch(BETA_AUTH_URL + '/portfolio', {
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) {
            // A rejected read is not a "restore done" — leaving the latch set
            // would keep the table empty for the rest of the page session even
            // after the session refreshes.
            _holdingsRestored = false;
            return 0;
        }
        holdings = (await res.json()).holdings || [];
    } catch (e) {
        console.warn('[AQMath] holdings restore failed:', e.message);
        _holdingsRestored = false;   // allow a retry on the next auth refresh
        return 0;
    }
    let added = 0;
    for (const h of holdings) {
        const sym = String(h.token || '').toUpperCase();
        const amount = Number(h.amount);
        if (!sym || !(amount > 0)) continue;
        if ((portfolio || []).some(t => t && t.sym === sym)) continue;
        // entry/apy come back only if the user's sync included them (older
        // saves stored neither); a stablecoin row is rebuilt as safe-haven at
        // its $1 peg so the allocation view matches the pre-restore table.
        const safeHaven = typeof isStablecoin === 'function' && isStablecoin(sym);
        portfolio.push({
            sym, coinId: sym.toLowerCase(), amount,
            price: safeHaven ? 1 : 0,
            entry: Number(h.entry) || 0, apy: Number(h.apy) || 0,
            target: 0, costBasis: 0, totalTokens: 0,
            frozen: false, insufficientHistory: false, safeHaven
        });
        added++;
    }
    if (added > 0) {
        saveState();
        render();
        showToast(`Restored ${added} synced ${added === 1 ? 'holding' : 'holdings'} `
            + 'from your account — press [ SYNC ALL ] to refresh prices. '
            + 'Entry prices and APY only come back if your last sync stored them.', 'notice');
    }
    return added;
}

function _localHoldings() {
    // The local portfolio rows are the source of the personal holdings.
    // Rows carry `amount` (not `amt`); the safe-haven USDC row is a reserve,
    // not part of the risky sleeve the engine freezes weights for.
    return (portfolio || [])
        .filter(t => t && t.sym && !t.safeHaven && Number(t.amount) > 0)
        .map(t => ({ token: String(t.sym).toUpperCase(), amount: String(t.amount) }));
}

// The DURABLE copy sent to beta-auth. Wider than _localHoldings on purpose:
//  * safe-haven rows included — /portfolio/init never sees them (it gets
//    _localHoldings), but a table restore must bring USDC back or the
//    allocation view silently loses it;
//  * entry price and APY included — beta-auth stores them as UI bookkeeping,
//    because they exist NOWHERE else. Without them a restore rebuilds the
//    table with entry=0 and the whole P&L column reads N/A even though the
//    user entered every price.
function _durableHoldings() {
    return (portfolio || [])
        .filter(t => t && t.sym && Number(t.amount) > 0)
        .map(t => ({
            token: String(t.sym).toUpperCase(),
            amount: String(t.amount),
            entry: Number(t.entry) > 0 ? String(t.entry) : null,
            apy: Number(t.apy) > 0 ? String(t.apy) : null,
        }));
}

// Auto-backup of the durable holdings right after a recorded trade. recordBuy /
// recordSell only touch localStorage; a browser that drops site data between
// sessions (or another device) therefore lost every trade made since the last
// manual [ update holdings ]. This pushes the same durable copy (amounts +
// entry + APY) to beta-auth immediately, so the restore on the next visit
// rebuilds the table INCLUDING the trade. Best effort: the local table already
// shows the trade, so a failed backup only earns a warning, never a rollback.
// Deliberately does NOT call /portfolio/init — frozen weights must not move on
// a trade; the daily signal loop reads the fresh holdings from beta-auth anyway.
async function pushDurableHoldings() {
    if (!isBetaActive()) return false;
    const holdings = _durableHoldings();
    if (!holdings.length) return false;
    try {
        const res = await fetch(BETA_AUTH_URL + '/portfolio', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getBetaToken()
            },
            body: JSON.stringify({ holdings })
        });
        return res.ok;
    } catch (e) {
        console.warn('[AQMath] holdings auto-backup failed:', e.message);
        return false;
    }
}

async function _shieldFetch(path, options = {}) {
    // Engine calls carry the beta JWT; reuse pipelineFetch's 401 handling.
    return pipelineFetch(API_URL + path, options);
}

function _renderShieldStatus(data) {
    const el = document.getElementById('shieldStatus');
    if (!el) return;
    if (!data || !data.initialized) {
        _setShieldFrozen(false);
        el.innerHTML = 'not initialized — sync your portfolio below';
        _setShieldSynced(false);
        return;
    }
    const active = data.shield_active
        ? '<span class="shield-on">ACTIVE (defensive)</span>'
        : '<span class="shield-off">OFF (normal)</span>';
    // The stored weights cover only the risky sleeve (KKT caps it well below
    // 100%); USDC absorbs the remainder. Printing only the risky rows made the
    // card look like the plan stops at 60% — show the safe-haven target too,
    // with exactly the same remainder math _applyFrozenTargets uses for the
    // table so the two views can never disagree.
    const wList = data.weights || [];
    const riskySum = wList.reduce((s, w) => s + (Number(w.weight) || 0), 0);
    const usdcRest = Math.max(0, Number((100 - riskySum).toFixed(2)));
    const riskyPart = wList
        .map(w => `${w.sym} ${(Number(w.weight) || 0).toFixed(1)}%`)
        .join(' · ');
    const weights = riskyPart
        + (usdcRest > 0 ? (riskyPart ? ' · ' : '') + `USDC ${usdcRest.toFixed(1)}%` : '');
    const last = data.last_signal || {};
    const parked = last.dca && last.dca.route === 'USDC' ? last.dca.parked_total : null;
    // Say WHEN the weights were locked: they deliberately do NOT follow the
    // live [optimize] targets in the holdings table, which are recomputed from
    // today's covariance on every click.
    //
    // "locked" is the day the user FIRST started the shield (first_synced_at),
    // not frozen_at: the macro loop overwrites frozen_at with the re-opt date, so
    // using it here told a long-time user they had joined last week. Fall back to
    // frozen_at only for a server that predates the field, where the two are
    // still identical anyway (no re-opt can have happened yet).
    const froze = (data.first_synced_at || data.frozen_at || '').slice(0, 10);
    // Shown only once the macro loop has actually moved the weights, so the card
    // stays quiet for everyone in their first cycle instead of printing two
    // identical dates.
    const reopt = (data.frozen_at || '').slice(0, 10);
    const recomputed = (reopt && froze && reopt !== froze)
        ? `<br>weights last recomputed: ${reopt}` : '';
    el.innerHTML =
        // Standing confirmation that the setup is DONE. Without it the card reads
        // like a settings form, so a returning user cannot tell whether the
        // engine ever accepted the sync.
        `<span class="shield-ok">✓ synced — daily-close signals run for you</span><br>`
        + `shield: ${active}<br>`
        + `frozen weights${froze ? ' (locked ' + froze + ')' : ''}: ${weights || '—'}`
        + recomputed + `<br>`
        + `macro re-opt: ${(data.next_reopt_at || '').slice(0, 10)}<br>`
        + `last run: ${_lastRunText(data)}`
        + (data.next_dca_on ? `<br>next DCA: ${data.next_dca_on}` : '')
        + (parked ? `<br>DCA parked in USDC: ~$${Number(parked).toLocaleString()}` : '');
    _setShieldSynced(true);
    _applyShieldSettings(data.settings);
    // Push the frozen plan into the holdings table so Target% and this card can
    // never disagree. Done last: it may re-render the table.
    _setShieldFrozen(true);
    _applyFrozenTargets(data.weights || []);
}

function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function _lastRunText(data) {
    // last_run_at is only written when a run SUCCEEDS, so on its own a failed
    // day is indistinguishable from a day the cron never reached. last_run is
    // the log row itself and carries the reason.
    const at = data.last_run_at ? data.last_run_at.slice(0, 10) : null;
    const run = data.last_run;
    const at_utc = (data.cron && data.cron.at_utc) ? data.cron.at_utc + ' UTC' : 'the daily close';
    if (run && run.status === 'error') {
        // Server-generated text: escaped, never trusted as markup.
        return `<span class="shield-on">${run.run_date} FAILED</span> — `
            + _escapeHtml(run.detail || 'reason not recorded')
            + `. it retries automatically`
            + (at ? `<br>last successful run: ${at}` : '');
    }
    if (at) return at;
    if (run && run.status === 'running') return `${run.run_date} in progress…`;
    return `— (first one at ${at_utc})`;
}

function _setShieldSynced(synced) {
    _shieldSynced = synced;
    // The button keeps working after the first sync (amounts change), but its
    // label must stop inviting a "first" sync — the freeze already happened and
    // re-clicking can never re-run it.
    const btn = document.getElementById('btnShieldSync');
    if (btn) btn.textContent = synced ? '[ update holdings ]' : '[ sync to shield ]';
    const hint = document.getElementById('shieldSyncHint');
    if (hint) {
        hint.textContent = synced
            ? 'your holdings are stored and your KKT weights are frozen. re-sync only after you change amounts — daily-close signals keep running either way, and you execute every trade yourself.'
            : 'saves your holdings & freezes your KKT weights on first sync. daily-close signals run automatically — you execute every trade yourself.';
    }
}

function _applyShieldSettings(settings) {
    // Fill the mode & DCA inputs from the server-side settings (they are the
    // source of truth — never localStorage).
    if (!settings) return;
    const chk = document.getElementById('chkDeleverage');
    const amt = document.getElementById('numDcaAmount');
    const itv = document.getElementById('numDcaInterval');
    if (chk) chk.checked = settings.deleverage !== false;
    // Mirror the value even when it is 0 ("DCA off"). The old `> 0` test meant a
    // user who turned DCA off still saw the previous amount in the field, so the
    // form contradicted the server — and the next "save mode & DCA" silently
    // switched DCA back on with that stale number. null/undefined is a different
    // case: the server said nothing, so the placeholder must stay.
    if (amt && settings.dca_amount != null) amt.value = Number(settings.dca_amount);
    if (itv && settings.dca_interval != null) itv.value = Number(settings.dca_interval);
}

async function saveShieldSettings() {
    if (!isBetaActive()) return showToast('Activate beta first.', 'warning');
    const chk = document.getElementById('chkDeleverage');
    const amt = document.getElementById('numDcaAmount');
    const itv = document.getElementById('numDcaInterval');
    const body = { deleverage: chk ? chk.checked : true };
    if (amt && amt.value !== '') body.dca_amount = Number(amt.value);
    if (itv && itv.value !== '') body.dca_interval = Number(itv.value);
    const btn = document.getElementById('btnShieldSettings');
    if (btn) { btn.disabled = true; btn.textContent = '[ saving... ]'; }
    try {
        const res = await _shieldFetch('/portfolio/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return showToast(data.detail || 'Could not save settings.', 'error');
        }
        _applyShieldSettings(data.settings);
        const hint = document.getElementById('dcaHint');
        if (hint && data.next_dca_on) {
            hint.textContent = 'next DCA signal: ' + data.next_dca_on
                + ' — you will be told whether it goes to USDC or into tokens.';
        }
        showToast(body.deleverage
            ? 'Saved — full mode: shield + USDC routing + DCA on schedule.'
            : 'Saved — shield OFF: plain drift-rebalance signals only.', 'success');
        refreshShieldStatus();
    } catch (e) {
        console.error('[AQMath] settings save failed:', e.message);
        showToast('Save failed: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '[ save mode & DCA ]'; }
    }
}

async function refreshShieldStatus() {
    if (!isBetaActive()) return;
    let data;
    try {
        const res = await _shieldFetch('/portfolio/status');
        if (!res.ok) {
            _setShieldMessage('status unavailable (HTTP ' + res.status + ') — refresh in a minute');
            return;
        }
        data = await res.json();
    } catch (e) {
        // The engine may be mid-redeploy; show WHY the card is blank instead
        // of leaving the misleading "not initialized" default (401s are
        // already toasted by pipelineFetch).
        _setShieldMessage('engine unreachable — refresh in a minute');
        return;
    }
    // Rendering is OUTSIDE the fetch try: a bug in the render path used to be
    // reported as "engine unreachable", which wiped a card that had just been
    // filled with good server data and hid the real error.
    _renderShieldStatus(data);
}

function _setShieldMessage(text) {
    _setShieldFrozen(false);
    const el = document.getElementById('shieldStatus');
    if (el) el.textContent = text;
}

async function syncShieldPortfolio() {
    if (!isBetaActive()) return showToast('Activate beta first.', 'warning');
    const holdings = _localHoldings();
    if (holdings.length < 2) {
        return showToast('Add at least 2 tokens with quantities to your portfolio first.', 'warning');
    }
    const btn = document.getElementById('btnShieldSync');
    if (btn) { btn.disabled = true; btn.textContent = '[ syncing... ]'; }
    try {
        // 1. Persist the holdings on beta-auth (personal data, GDPR-logged).
        // The durable copy carries safe-haven rows plus entry/APY; the engine
        // payload below stays risky-only so /portfolio/init keeps seeing the
        // exact frozen token set (a wider set would 409 against it).
        const res = await fetch(BETA_AUTH_URL + '/portfolio', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getBetaToken()
            },
            body: JSON.stringify({ holdings: _durableHoldings() })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'HTTP ' + res.status);
        }
        await res.json();

        // Always call /portfolio/init. beta-auth's `first_time` says whether IT
        // had holdings, which is not the same question as "does the engine have
        // frozen weights": if a first sync stored the holdings and then the init
        // call failed, first_time was false forever and the shield could never be
        // initialised again. /portfolio/init is idempotent — an unchanged token
        // set returns the existing plan as 'already_frozen'.
        const init = await _shieldFetch('/portfolio/init', {
            method: 'POST',
            body: JSON.stringify({ holdings })
        });
        if (!init.ok) {
            const err = await init.json().catch(() => ({}));
            throw new Error(err.detail || 'init failed');
        }
        const data = await init.json();
        showToast(data.status === 'frozen'
            ? 'KKT weights frozen — the daily signal loop is now active for you.'
            : 'Holdings updated — your frozen weights are unchanged.', 'success');
        // Re-read from the server rather than rendering the init response: the
        // card must show the same row the daily loop reads, settings included.
        await refreshShieldStatus();
    } catch (e) {
        console.error('[AQMath] shield sync failed:', e.message);
        showToast('Sync failed: ' + e.message, 'error');
    } finally {
        // _setShieldSynced owns the label: a successful sync has already switched
        // it to "[ update holdings ]", and hardcoding the old text here would undo
        // that. On failure it restores whatever the server last confirmed.
        if (btn) { btn.disabled = false; _setShieldSynced(_shieldSynced); }
    }
}

// ---------- notifications (first-party ntfy) ----------

function _copyText(el) {
    const src = document.getElementById(el.getAttribute('data-arg'));
    if (!src) return;
    const text = src.textContent.trim();
    const label = el.getAttribute('data-arg') || 'value';
    try {
        navigator.clipboard.writeText(text).then(
            () => showToast(label + ' copied.', 'success'),
            () => showToast('Copy failed — select the text manually.', 'warning'));
    } catch (e) {
        showToast('Copy failed — select the text manually.', 'warning');
    }
}

function _setNtfyStatus(connected, topic) {
    const statusEl = document.getElementById('ntfyStatus');
    if (!statusEl) return;
    statusEl.innerHTML = connected
        ? '<span class="ntfy-dot on"></span>✓ connected — you are receiving signals &middot; topic <span class="mono">' + topic + '</span>'
        : '<span class="ntfy-dot off"></span>not connected';
}

// The credentials panel stays visible for returning users too — server, topic
// and the subscribe steps remain needed; only the token itself is gone after
// the one-time display.
function _showNtfyPanel(opts) {
    const onBox = document.getElementById('ntfyOn');
    const offBox = document.getElementById('ntfyOff');
    const tokenEl = document.getElementById('ntfyToken');
    const tokenCopy = document.getElementById('btnNtfyTokenCopy');
    if (opts.server) document.getElementById('ntfyServer').textContent = opts.server;
    if (opts.topic) document.getElementById('ntfyTopic').textContent = opts.topic;
    if (opts.token) {
        tokenEl.textContent = opts.token;
        tokenEl.classList.remove('ntfy-mask');
        if (tokenCopy) tokenCopy.classList.remove('hidden');
    } else {
        tokenEl.textContent = 'shown once — not recoverable';
        tokenEl.classList.add('ntfy-mask');
        if (tokenCopy) tokenCopy.classList.add('hidden');
    }
    if (onBox) onBox.classList.remove('hidden');
    if (offBox) offBox.classList.add('hidden');
}

function _hideNtfyPanel() {
    const onBox = document.getElementById('ntfyOn');
    const offBox = document.getElementById('ntfyOff');
    if (onBox) onBox.classList.add('hidden');
    if (offBox) offBox.classList.remove('hidden');
}

async function refreshNtfyStatus() {
    const statusEl = document.getElementById('ntfyStatus');
    if (!statusEl || !isBetaActive()) return;
    try {
        const res = await fetch(BETA_AUTH_URL + '/notifications', {
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) {
            // Do not leave the static "not connected" default standing on a server
            // error: a user who already subscribed would think their setup was lost.
            statusEl.innerHTML = '<span class="ntfy-dot off"></span>status unavailable (HTTP '
                + res.status + ') — your subscription is unaffected';
            return;
        }
        const data = await res.json();
        if (data.enabled && data.active) {
            _setNtfyStatus(true, data.topic);
            // Only overwrite the cached server if we never received one (the
            // status endpoint does not return it).
            const serverEl = document.getElementById('ntfyServer');
            _showNtfyPanel({
                server: (serverEl && serverEl.textContent) ? null : data.server,
                topic: data.topic,
                token: null
            });
        } else {
            _setNtfyStatus(false);
            _hideNtfyPanel();
        }
    } catch (e) { /* silent */ }
}

async function enableNotifications() {
    const consent = document.getElementById('chkNtfyConsent');
    if (!consent || !consent.checked) {
        return showToast('Please tick the consent box first.', 'warning');
    }
    const btn = document.getElementById('btnNtfyEnable');
    if (btn) { btn.disabled = true; btn.textContent = '[ enabling... ]'; }
    try {
        const authH = { 'Authorization': 'Bearer ' + getBetaToken() };
        // 1. Log the GDPR consent receipt for this feature.
        const c = await fetch(BETA_AUTH_URL + '/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authH },
            body: JSON.stringify({ type: 'notifications', version: 'v1' })
        });
        if (!c.ok) throw new Error('consent failed');
        // 2. Create the private topic; the plaintext token returns ONCE.
        const res = await fetch(BETA_AUTH_URL + '/notifications/enable', {
            method: 'POST', headers: authH
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'HTTP ' + res.status);
        if (data.token) {
            _setNtfyStatus(true, data.topic);
            _showNtfyPanel({ server: data.server, topic: data.topic, token: data.token });
            showToast('Notifications enabled — save the token now, it is shown only once.', 'success');
        } else if (data.already_active) {
            await refreshNtfyStatus();
            showToast('Notifications are already enabled.', 'notice');
        }
    } catch (e) {
        console.error('[AQMath] notifications enable failed:', e.message);
        showToast('Could not enable notifications: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '[ enable notifications ]'; }
    }
}

function disableNotifications() {
    // Disabling revokes the read token irreversibly — confirm via styled toast.
    showToast(
        'Disable notifications? Your topic and token are deleted \u2014 if you enable again you get a NEW topic and token.',
        'warning',
        [
            { label: 'cancel' },
            { label: 'yes, disable', primary: false, onClick: _doDisableNotifications }
        ]
    );
}

async function _doDisableNotifications() {
    const btn = document.getElementById('btnNtfyDisable');
    if (btn) { btn.disabled = true; }
    try {
        const res = await fetch(BETA_AUTH_URL + '/notifications', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const serverEl = document.getElementById('ntfyServer');
        if (serverEl) serverEl.textContent = '';
        const tokenEl = document.getElementById('ntfyToken');
        if (tokenEl) tokenEl.textContent = '';
        _hideNtfyPanel();
        showToast('Notifications disabled \u2014 your token was revoked.', 'notice');
        await refreshNtfyStatus();
    } catch (e) {
        showToast('Could not disable notifications: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; }
    }
}

// ---------- One-Tap Alignment: pending signal card ----------

let _pendingSignals = [];

async function loadPendingSignals() {
    if (!isBetaActive()) return;
    const card = document.getElementById('signalCard');
    const list = document.getElementById('signalList');
    const bulk = document.getElementById('signalBulkActions');
    const empty = document.getElementById('signalEmpty');
    if (!card || !list) return;
    try {
        const res = await _shieldFetch('/portfolio/signals');
        if (!res.ok) { card.classList.add('hidden'); return; }
        const data = await res.json();
        _pendingSignals = data.signals || [];
    } catch (e) {
        console.warn('[AQMath] signal load failed:', e.message);
        card.classList.add('hidden');
        return;
    }
    if (!_pendingSignals.length) {
        card.classList.add('hidden');
        list.innerHTML = '';
        if (bulk) bulk.classList.add('hidden');
        if (empty) empty.classList.add('hidden');
        return;
    }
    card.classList.remove('hidden');
    list.innerHTML = _pendingSignals.map(s => _renderSignalBlock(s)).join('');
    if (bulk) bulk.classList.toggle('hidden', _pendingSignals.length < 2);
    if (empty) empty.classList.add('hidden');
    // Also load stats for the badge
    loadSignalStats();
}

function _renderSignalBlock(s) {
    const regime = s.shield_regime || 'LOW_VOL';
    const regimeClass = regime === 'SHOCK' ? 'regime-shock' : 'regime-lowvol';
    const regimeLabel = regime === 'SHOCK' ? 'SHOCK' : 'LOW VOL';
    const sideClass = s.side === 'BUY' ? 'sig-buy' : 'sig-sell';
    const daysWarn = s.days_pending > 0
        ? '<span class="sig-days-warn">pending ' + s.days_pending + 'd</span>'
        : '<span class="sig-days-ok">today</span>';
    const unitsStr = s.units >= 1 ? s.units.toLocaleString(undefined, {maximumFractionDigits: 2}) : s.units.toPrecision(4);
    const usdStr = '$' + Math.round(s.usd).toLocaleString();
    return '<div class="sig-block" data-signal-id="' + s.signal_id + '">'
        + '<div class="sig-header">'
        +   '<span class="sig-side ' + sideClass + '">' + s.side + '</span>'
        +   '<span class="sig-sym">' + s.sym + '</span>'
        +   '<span class="sig-amount">' + unitsStr + ' &rarr; ' + usdStr + '</span>'
        +   '<span class="sig-regime ' + regimeClass + '">' + regimeLabel + '</span>'
        +   daysWarn
        + '</div>'
        + '<div class="sig-actions">'
        +   '<button class="btn green" data-action="confirmSignal" data-arg="' + s.signal_id + '">[ confirm &amp; sync ]</button>'
        +   '<button class="btn amber" data-action="showAdjustForm" data-arg="' + s.signal_id + '">[ adjust ]</button>'
        +   '<button class="btn ghost" data-action="skipSignal" data-arg="' + s.signal_id + '">[ skip ]</button>'
        + '</div>'
        + '<div class="sig-adjust-form hidden" id="adj_' + s.signal_id + '">'
        +   '<input type="number" step="any" min="0" placeholder="actual units" class="sig-adjust-input" id="adjInput_' + s.signal_id + '">'
        +   '<button class="btn green" data-action="adjustSignal" data-arg="' + s.signal_id + '">[ save &amp; sync ]</button>'
        +   '<button class="btn ghost" data-action="hideAdjustForm" data-arg="' + s.signal_id + '">[ cancel ]</button>'
        + '</div>'
        + '</div>';
}

async function confirmSignal(el, signalId) {
    if (!signalId) return;
    if (el) el.disabled = true;
    try {
        const res = await _shieldFetch('/portfolio/signals/confirm', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({signal_id: signalId}),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Confirm failed (HTTP ' + res.status + ')', 'error');
            return;
        }
        const data = await res.json();
        const deltaMsg = data.delta_applied ? 'portfolio synced' : 'confirmed but sync failed — re-sync manually';
        const dayMsg = data.same_day ? 'same-day' : 'late';
        showToast('Signal confirmed (' + dayMsg + ') — ' + deltaMsg, 'success');
        // Optimistic: remove from local array immediately so card disappears
        _pendingSignals = _pendingSignals.filter(s => s.signal_id !== signalId);
        _rerenderSignalList();
        await _syncHoldingsAfterSignal();
        // Background sync — if server returns fresh data the card stays gone;
        // if the reload fails the optimistic update already hid the signal.
        loadPendingSignals();
    } catch (e) {
        showToast('Confirm failed: ' + e.message, 'error');
    } finally {
        if (el) el.disabled = false;
    }
}

async function skipSignal(el, signalId) {
    if (!signalId) return;
    if (el) el.disabled = true;
    try {
        const res = await _shieldFetch('/portfolio/signals/skip', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({signal_id: signalId}),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Skip failed (HTTP ' + res.status + ')', 'error');
            return;
        }
        showToast('Signal skipped', 'notice');
        // Optimistic: remove from local array immediately
        _pendingSignals = _pendingSignals.filter(s => s.signal_id !== signalId);
        _rerenderSignalList();
        loadPendingSignals();
    } catch (e) {
        showToast('Skip failed: ' + e.message, 'error');
    } finally {
        if (el) el.disabled = false;
    }
}

async function skipAllSignals() {
    if (!_pendingSignals.length) return;
    for (const s of _pendingSignals) {
        try {
            await _shieldFetch('/portfolio/signals/skip', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({signal_id: s.signal_id}),
            });
        } catch (e) { /* continue with next */ }
    }
    showToast('All signals skipped', 'notice');
    // Optimistic: clear all locally
    _pendingSignals = [];
    _rerenderSignalList();
    loadPendingSignals();
}

function showAdjustForm(el, signalId) {
    if (!signalId) return;
    const form = document.getElementById('adj_' + signalId);
    if (form) form.classList.remove('hidden');
}

function hideAdjustForm(el, signalId) {
    if (!signalId) return;
    const form = document.getElementById('adj_' + signalId);
    if (form) form.classList.add('hidden');
}

async function adjustSignal(el, signalId) {
    if (!signalId) return;
    const input = document.getElementById('adjInput_' + signalId);
    const val = input ? parseFloat(input.value) : NaN;
    if (isNaN(val) || val < 0) {
        showToast('Enter a valid amount', 'error');
        return;
    }
    if (el) el.disabled = true;
    try {
        const res = await _shieldFetch('/portfolio/signals/adjust', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({signal_id: signalId, actual_units: val}),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Adjust failed (HTTP ' + res.status + ')', 'error');
            return;
        }
        const data = await res.json();
        const deltaMsg = data.delta_applied ? 'portfolio synced' : 'adjusted but sync failed — re-sync manually';
        showToast('Adjusted to ' + val + ' — ' + deltaMsg, 'success');
        // Optimistic: remove from local array immediately
        _pendingSignals = _pendingSignals.filter(s => s.signal_id !== signalId);
        _rerenderSignalList();
        await _syncHoldingsAfterSignal();
        loadPendingSignals();
    } catch (e) {
        showToast('Adjust failed: ' + e.message, 'error');
    } finally {
        if (el) el.disabled = false;
    }
}

// Re-render the signal list from the current _pendingSignals array.
// Hides the card when empty, shows it when there are signals.
function _rerenderSignalList() {
    const card = document.getElementById('signalCard');
    const list = document.getElementById('signalList');
    const bulk = document.getElementById('signalBulkActions');
    if (!card || !list) return;
    if (!_pendingSignals.length) {
        card.classList.add('hidden');
        list.innerHTML = '';
        if (bulk) bulk.classList.add('hidden');
    } else {
        card.classList.remove('hidden');
        list.innerHTML = _pendingSignals.map(s => _renderSignalBlock(s)).join('');
        if (bulk) bulk.classList.toggle('hidden', _pendingSignals.length < 2);
    }
}

// After a signal's delta-apply changed holdings on the server, pull the
// updated amounts back into the local portfolio array and re-render.
// Unlike restoreHoldingsFromServer() this UPDATES existing rows (amounts
// change after SELL/BUY) and is NOT latched — it runs on every call.
async function _syncHoldingsAfterSignal() {
    try {
        const res = await fetch(BETA_AUTH_URL + '/portfolio', {
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) return;
        const data = await res.json();
        const holdings = data.holdings || [];
        let changed = false;
        for (const h of holdings) {
            const sym = String(h.token || '').toUpperCase();
            const amount = Number(h.amount);
            if (!sym || !(amount >= 0)) continue;
            const row = (portfolio || []).find(t => t && t.sym === sym);
            if (row && Math.abs((row.amount || 0) - amount) > 1e-10) {
                row.amount = amount;
                changed = true;
            }
        }
        if (changed) {
            saveState();
            render();
        }
    } catch (e) {
        console.warn('[AQMath] holdings sync after signal failed:', e.message);
    }
}

async function loadSignalStats() {
    const badge = document.getElementById('signalStatsBadge');
    if (!badge) return;
    try {
        const res = await _shieldFetch('/portfolio/signal-stats');
        if (!res.ok) return;
        const data = await res.json();
        const stats = data.stats || [];
        if (!stats.length) { badge.classList.add('hidden'); return; }
        const parts = stats.map(s => {
            const pct = Math.round(s.rate * 100);
            const pass = s.pass ? 'pass' : 'fail';
            return s.regime + ': ' + pct + '% (' + pass + ')';
        });
        badge.textContent = parts.join(' | ');
        badge.classList.remove('hidden');
    } catch (e) { /* silent */ }
}

// Called from checkBetaUI() (app.js) whenever the auth state changes.
async function refreshNotifyUI() {
    if (!isBetaActive()) return;
    // Sequential on purpose: restored rows must exist BEFORE the status handler
    // writes the frozen targets into them, otherwise they keep Target% 0.
    // Each step is isolated so one failure cannot silently cancel the others —
    // a throw in the restore step used to stop the shield card from loading at all.
    try {
        await restoreHoldingsFromServer();
    } catch (e) {
        console.error('[AQMath] holdings restore aborted:', e.message);
    }
    try {
        await refreshShieldStatus();
    } catch (e) {
        console.error('[AQMath] shield status aborted:', e.message);
    }
    try {
        await loadPendingSignals();
    } catch (e) {
        console.error('[AQMath] pending signals aborted:', e.message);
    }
    refreshNtfyStatus();
}

// Page-load gate: returning users with a stored token must also pass the
// must-read check (this file loads after app.js, so the boot call lives here).
if (isBetaActive()) ensureHowAqmathAck();

// Boot the shield card + notification state HERE, not from app.js.
// Both files are `defer`, so they run in document order: app.js's init already
// called checkBetaUI() while `refreshNotifyUI` was still undefined, and the
// `typeof === 'function'` guard silently skipped it. The result was that on
// every page load the card kept its static "not initialized" placeholder and
// the notification panel kept "not connected", no matter what the server said.
if (isBetaActive()) refreshNotifyUI();

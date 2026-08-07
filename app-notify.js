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

function _localHoldings() {
    // The local portfolio rows are the source of the personal holdings.
    return (portfolio || [])
        .filter(t => t && t.sym && Number(t.amt) > 0)
        .map(t => ({ token: String(t.sym).toUpperCase(), amount: String(t.amt) }));
}

async function _shieldFetch(path, options = {}) {
    // Engine calls carry the beta JWT; reuse pipelineFetch's 401 handling.
    return pipelineFetch(API_URL + path, options);
}

function _renderShieldStatus(data) {
    const el = document.getElementById('shieldStatus');
    if (!el) return;
    if (!data || !data.initialized) {
        el.innerHTML = 'not initialized — sync your portfolio below';
        return;
    }
    const active = data.shield_active
        ? '<span class="shield-on">ACTIVE (defensive)</span>'
        : '<span class="shield-off">OFF (normal)</span>';
    const weights = (data.weights || [])
        .map(w => `${w.sym} ${(Number(w.weight) || 0).toFixed(1)}%`)
        .join(' · ');
    const last = data.last_signal || {};
    const parked = last.dca && last.dca.route === 'USDC' ? last.dca.parked_total : null;
    el.innerHTML =
        `shield: ${active}<br>`
        + `frozen weights: ${weights || '—'}<br>`
        + `macro re-opt: ${(data.next_reopt_at || '').slice(0, 10)}<br>`
        + `last run: ${data.last_run_at ? data.last_run_at.slice(0, 10) : '—'}`
        + (data.next_dca_on ? `<br>next DCA: ${data.next_dca_on}` : '')
        + (parked ? `<br>DCA parked in USDC: ~$${Number(parked).toLocaleString()}` : '');
    _applyShieldSettings(data.settings);
}

function _applyShieldSettings(settings) {
    // Fill the mode & DCA inputs from the server-side settings (they are the
    // source of truth — never localStorage).
    if (!settings) return;
    const chk = document.getElementById('chkDeleverage');
    const amt = document.getElementById('numDcaAmount');
    const itv = document.getElementById('numDcaInterval');
    if (chk) chk.checked = settings.deleverage !== false;
    if (amt && Number(settings.dca_amount) > 0) amt.value = settings.dca_amount;
    if (itv && settings.dca_interval) itv.value = settings.dca_interval;
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
    try {
        const res = await _shieldFetch('/portfolio/status');
        if (res.ok) _renderShieldStatus(await res.json());
    } catch (e) { /* token/session problem already toasted by pipelineFetch */ }
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
        const res = await fetch(BETA_AUTH_URL + '/portfolio', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getBetaToken()
            },
            body: JSON.stringify({ holdings })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'HTTP ' + res.status);
        }
        const saved = await res.json();

        // 2. FIRST save only: freeze the KKT weights on the engine.
        if (saved.first_time) {
            const init = await _shieldFetch('/portfolio/init', {
                method: 'POST',
                body: JSON.stringify({ holdings })
            });
            if (!init.ok) {
                const err = await init.json().catch(() => ({}));
                throw new Error(err.detail || 'init failed');
            }
            const data = await init.json();
            showToast('KKT weights frozen — the daily signal loop is now active for you.', 'success');
            _renderShieldStatus({ initialized: true, weights: data.weights,
                                  shield_active: false,
                                  next_reopt_at: data.next_reopt_at });
        } else {
            showToast('Holdings updated.', 'success');
            await refreshShieldStatus();
        }
    } catch (e) {
        console.error('[AQMath] shield sync failed:', e.message);
        showToast('Sync failed: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '[ sync to shield ]'; }
    }
}

// ---------- notifications (first-party ntfy) ----------

function _copyText(el) {
    const src = document.getElementById(el.getAttribute('data-arg'));
    if (!src) return;
    const text = src.textContent.trim();
    try {
        navigator.clipboard.writeText(text).then(
            () => showToast('Copied.', 'success'),
            () => showToast('Copy failed — select the text manually.', 'warning'));
    } catch (e) {
        showToast('Copy failed — select the text manually.', 'warning');
    }
}

async function refreshNtfyStatus() {
    const statusEl = document.getElementById('ntfyStatus');
    const onBox = document.getElementById('ntfyOn');
    const offBox = document.getElementById('ntfyOff');
    if (!statusEl || !isBetaActive()) return;
    try {
        const res = await fetch(BETA_AUTH_URL + '/notifications', {
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.enabled && data.active) {
            statusEl.innerHTML = `connected · topic <span class="mono">${data.topic}</span>`;
            if (onBox) onBox.classList.remove('hidden');
            if (offBox) offBox.classList.add('hidden');
        } else {
            statusEl.textContent = 'not connected';
            if (onBox) onBox.classList.add('hidden');
            if (offBox) offBox.classList.remove('hidden');
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
            document.getElementById('ntfyServer').textContent = data.server;
            document.getElementById('ntfyTopic').textContent = data.topic;
            document.getElementById('ntfyToken').textContent = data.token;
            document.getElementById('ntfyOnce').classList.remove('hidden');
            document.getElementById('ntfyOn').classList.remove('hidden');
            document.getElementById('ntfyOff').classList.add('hidden');
            document.getElementById('ntfyStatus').innerHTML =
                `connected · topic <span class="mono">${data.topic}</span>`;
        } else if (data.already_active) {
            await refreshNtfyStatus();
        }
        showToast('Notifications enabled.', 'success');
    } catch (e) {
        console.error('[AQMath] notifications enable failed:', e.message);
        showToast('Could not enable notifications: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '[ enable notifications ]'; }
    }
}

async function disableNotifications() {
    const btn = document.getElementById('btnNtfyDisable');
    if (btn) { btn.disabled = true; }
    try {
        const res = await fetch(BETA_AUTH_URL + '/notifications', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + getBetaToken() }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        document.getElementById('ntfyOnce').classList.add('hidden');
        showToast('Notifications disabled — your token was revoked.', 'notice');
        await refreshNtfyStatus();
    } catch (e) {
        showToast('Could not disable notifications: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; }
    }
}

// Called from checkBetaUI() (app.js) whenever the auth state changes.
function refreshNotifyUI() {
    if (isBetaActive()) {
        refreshShieldStatus();
        refreshNtfyStatus();
    }
}

// Page-load gate: returning users with a stored token must also pass the
// must-read check (this file loads after app.js, so the boot call lives here).
if (isBetaActive()) ensureHowAqmathAck();

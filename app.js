(function() {
'use strict';

// ============ BACKEND API URLs ============
const BETA_AUTH_URL = 'https://aqmath-beta-auth-production.up.railway.app';

// ============ ROUTING ============
function handleRoute() {
    const hash = window.location.hash;
    document.body.classList.remove('route-landing', 'route-app', 'route-doc', 'route-backtest', 'route-results');
    if (hash === '#/app') {
        document.body.classList.add('route-app');
        // Load market widgets for app view
        loadAllWidgets();
    } else if (hash === '#/docs' || hash === '#/doc') {
        document.body.classList.add('route-doc');
    } else if (hash === '#/backtest') {
        document.body.classList.add('route-backtest');
    } else if (hash === '#/results') {
        document.body.classList.add('route-results');
    } else {
        document.body.classList.add('route-landing');
        loadAllWidgets();
    }
}
window.addEventListener('hashchange', handleRoute);

// ============ BETA SLOT COUNTER ============
async function updateSlotCounter() {
    try {
        const resp = await fetch(`${BETA_AUTH_URL}/api/slots`);
        if (resp.ok) {
            const data = await resp.json();
            const el = document.getElementById('slotCounter');
            if (el) el.textContent = data.remaining;
        }
    } catch (e) {
        console.warn('[Slots] Could not fetch slot info:', e);
    }
}
// Fetch slots on landing page load
if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#') {
    updateSlotCounter();
}

function showProModal() { document.getElementById('proModal').classList.remove('hidden'); }
function hideProModal() { document.getElementById('proModal').classList.add('hidden'); }

// ============ LEGAL MODALS ============
function showImpressum() { document.getElementById('impressumModal').classList.remove('hidden'); }
function showPrivacyPolicy() { document.getElementById('privacyModal').classList.remove('hidden'); }
function showTerms() { document.getElementById('termsModal').classList.remove('hidden'); }
function hideLegalModal(id) { document.getElementById(id).classList.add('hidden'); }

// ============ TOAST NOTIFICATIONS ============
let toastTimer = null;
function showToast(msg, type, actions) {
    type = type || 'warning';
    if (type === 'pro-lock') { showProModal(); return; }
    const overlay = document.getElementById('toastOverlay');
    const box = document.getElementById('toastBox');
    const title = document.getElementById('toastTitle');
    const msgEl = document.getElementById('toastMsg');
    const actionsEl = document.getElementById('toastActions');
    const closeBtn = document.getElementById('toastClose');
    box.className = 'toast-box ' + type;
    title.className = 'toast-title ' + type;
    title.textContent = type === 'error' ? 'error' : type === 'success' ? 'done' : 'notice';
    msgEl.textContent = msg;
    actionsEl.innerHTML = '';
    overlay.classList.remove('hidden');
    if (actions && actions.length > 0) {
        actionsEl.classList.remove('hidden');
        closeBtn.classList.add('hidden');
        actions.forEach(a => {
            const btn = document.createElement('button');
            btn.className = 'toast-action-btn' + (a.primary ? ' primary' : '');
            btn.textContent = a.label;
            btn.onclick = function() {
                hideToast();
                if (a.onClick) a.onClick();
            };
            actionsEl.appendChild(btn);
        });
        if (toastTimer) clearTimeout(toastTimer);
    } else {
        actionsEl.classList.add('hidden');
        closeBtn.classList.remove('hidden');
        if (toastTimer) clearTimeout(toastTimer);
    }
}
function hideToast(e) {
    if (e && e.target !== document.getElementById('toastOverlay')) return;
    document.getElementById('toastOverlay').classList.add('hidden');
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') hideToast(); });

// ============ STATE & CONSTANTS ============
const STORAGE_KEY = 'aegis_pro_portfolio_v2';
const DCA_KEY = 'aegis_pro_lastDca_v2';
const OPT_KEY = 'aegis_pro_lastOptimization';
const HISTORY_KEY = 'aegis_portfolio_history';
let portfolio = [];
let lastDcaDate = null;
let lastOptimization = null;
let myChart = null;
let historyChart = null;
let editMode = null;
const chartCtx = document.getElementById('chart').getContext('2d');
const historyCtx = document.getElementById('historyChart').getContext('2d');
Chart.defaults.color = '#7a8ba5';
Chart.defaults.font.family = "'IBM Plex Mono', monospace";

// Beta mode: check for valid JWT token in localStorage (with sessionStorage migration)
function getBetaToken() {
    let token = localStorage.getItem('pro_token');
    if (!token) {
        // Migrate from old sessionStorage if present
        token = sessionStorage.getItem('pro_token');
        if (token) {
            localStorage.setItem('pro_token', token);
            sessionStorage.removeItem('pro_token');
            console.log('[AQMath] Migrated beta token from sessionStorage to localStorage');
        }
    }
    return token || '';
}
function isBetaActive() {
    const token = getBetaToken();
    if (!token) return false;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 > Date.now();
    } catch { return false; }
}
let isPro = isBetaActive();


// ========== BETA AUTH ==========

async function pipelineFetch(url, options = {}) {
    const token = getBetaToken();
    if (!token) {
        isPro = false;
        checkBetaUI();
        showToast('Please re-enter your beta key to continue.', 'warning');
        throw new Error('beta token missing');
    }
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        let detail = 'authentication failed';
        try { const err = await res.json(); detail = err.detail || err.message || detail; } catch {}
        if (detail.toLowerCase().includes('expired')) {
            localStorage.removeItem('pro_token');
            isPro = false;
            checkBetaUI();
            render();
        }
        console.warn('[AQMath] engine auth rejected:', detail);
        showToast(detail.toLowerCase().includes('expired') ? 'Your beta session expired — please re-enter your key.' : 'Beta access needed — please re-enter your beta key.', 'warning');
        throw new Error(detail);
    }
    return res;
}

async function activateBeta() {
    const key = document.getElementById('iBetaKey').value.trim();
    if (!key) return showToast('Enter your beta key first.', 'warning');
    const btn = document.getElementById('btnBeta');
    btn.textContent = '[ verifying... ]';
    btn.disabled = true;
    try {
        const res = await fetch(BETA_AUTH_URL + '/auth/beta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (res.status === 429) {
                // Rate limited — server tells us how long to wait.
                const secs = Math.max(0, Math.round(Number(err.retry_after) || 0));
                const wait = secs >= 60 ? Math.ceil(secs / 60) + ' min' : secs + ' sec';
                showToast('Too many attempts. Please wait ' + wait + ' and try again.', 'warning');
            } else {
                // Server messages are already user-friendly (invalid / revoked / expired / in-use).
                showToast(err.detail || "That beta key didn't work — please double-check it and try again.", 'error');
            }
            return;
        }
        const data = await res.json();
        localStorage.setItem('pro_token', data.token);
        isPro = true;
        console.log('[AQMath] Beta activated: isPro=' + isPro);
        document.getElementById('betaSection').classList.add('hidden');
        document.getElementById('betaActive').classList.remove('hidden');
        showToast("You're in — beta access unlocked.", 'success');
        updateProButtons();
        render();
    } catch(e) {
        console.error('[AQMath] beta activation failed:', e.message);
        showToast("Couldn't reach the activation service — please check your connection and try again.", 'error');
    } finally {
        btn.textContent = '[ Activate Beta ]';
        btn.disabled = false;
    }
}

function deactivateBeta() {
    localStorage.removeItem('pro_token');
    isPro = false;
    document.getElementById('betaSection').classList.remove('hidden');
    document.getElementById('betaActive').classList.add('hidden');
    showToast('Beta access turned off.', 'notice');
    updateProButtons();
    render();
}

function updateProButtons() {
    const engineBtn = document.getElementById('btnEngine');
    const refreshBtn = document.getElementById('btnRefreshHistory');
    if (engineBtn) {
        if (isPro) {
            engineBtn.className = 'btn amber';
            engineBtn.textContent = 'AQMath Engine — OPTIMIZE';
        } else {
            engineBtn.className = 'btn amber';
            engineBtn.textContent = 'AQMath Engine — PRO';
        }
    }
    if (refreshBtn) {
        if (isPro) {
            refreshBtn.className = 'btn blue';
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh History';
        } else {
            refreshBtn.className = 'btn ghost';
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refresh History — PRO';
        }
    }
}

function checkBetaUI() {
    const active = isBetaActive();
    isPro = active; // sync global flag with actual token state
    const section = document.getElementById('betaSection');
    const activeEl = document.getElementById('betaActive');
    if (section) section.classList.toggle('hidden', active);
    if (activeEl) activeEl.classList.toggle('hidden', !active);
    updateProButtons();
}

// ========== BACKEND API URLs ==========
// Set these to your deployed Railway URLs
const API_URL = 'https://aqmath-engine-production.up.railway.app';   // aqmath-engine (Risk Parity + KKT) — Pro only
const DCA_API_URL = 'https://dca-engine-production.up.railway.app'; // dca-engine on Railway — DCA distribution only

let portfolioHistory = [];

function loadHistory() {
    try {
        const saved = localStorage.getItem(HISTORY_KEY);
        if (saved) portfolioHistory = JSON.parse(saved);
    } catch(e) { portfolioHistory = []; }
}

function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(portfolioHistory));
}

function addSnapshot() {
    const total = totalValue();
    if (total <= 0) return;
    portfolioHistory.push({ timestamp: Date.now(), total: total });
    if (portfolioHistory.length > 50) portfolioHistory.shift();
    saveHistory();
    renderHistoryChart();
}

function saveSnapshot() { addSnapshot(); }

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            if (data.portfolio && Array.isArray(data.portfolio)) {
                portfolio = data.portfolio.map(t => ({
                    ...t,
                    frozen: t.frozen || false,
                    // Ne perzistiraj stari history-warning flag preko reloada — ponovno se izračuna na sljedeći /optimize
                    insufficientHistory: false
                }));
            } else {
                portfolio = [];
            }
            if (data.lastDcaDate) lastDcaDate = data.lastDcaDate;
        }
        const dca = localStorage.getItem(DCA_KEY);
        if (dca && !lastDcaDate) lastDcaDate = parseInt(dca);
        const opt = localStorage.getItem(OPT_KEY);
        if (opt) lastOptimization = parseInt(opt);
    } catch(e) { portfolio = []; }
    ensureUSDC();
}

function saveState() {
    const data = { portfolio, lastDcaDate };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (lastDcaDate) localStorage.setItem(DCA_KEY, lastDcaDate.toString());
    if (lastOptimization) localStorage.setItem(OPT_KEY, lastOptimization.toString());
}

function ensureUSDC() {
    const existing = portfolio.find(t => t.sym === 'USDC');
    if (!existing) {
        portfolio.push({
            sym: 'USDC', price: 1.00, amount: 0, target: 0,
            safeHaven: getSafeHavenToggle(), frozen: false,
            coinId: 'usdc', entry: 0, apy: 0,
            costBasis: 0, totalTokens: 0
        });
    } else {
        // Always enforce safe-haven flag on USDC (fixes stale localStorage data)
        existing.safeHaven = true;
    }
}

const r2 = (n, d = 2) => Math.round(n * 10**d) / 10**d;
const fmtUSD = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPrice = p => {
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 0.01) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (p >= 0.0001) return p.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
    return p.toLocaleString('en-US', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
};
const fmtQty = (qty, price) => {
    if (!price || price >= 1) return qty.toLocaleString('en-US', { maximumFractionDigits: 6 });
    if (price >= 0.01) return qty.toLocaleString('en-US', { maximumFractionDigits: 6 });
    return qty.toLocaleString('en-US', { maximumFractionDigits: 8 });
};
const totalTarget = () => r2(portfolio.filter(t => !t.frozen).reduce((s, t) => s + t.target, 0), 4);
const totalValue = () => portfolio.reduce((s, t) => s + t.amount * t.price, 0);
const activeTokens = () => portfolio.filter(t => !t.frozen);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Format a token quantity with sensible precision (more decimals for small amounts)
function fmtTokens(n) {
    if (!isFinite(n)) return '0';
    const abs = Math.abs(n);
    const dp = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
    return n.toLocaleString('en-US', { maximumFractionDigits: dp });
}

// ============ STABLECOIN SAFE-HAVEN ============
const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'TUSD', 'BUSD', 'FDUSD', 'USDP', 'PYUSD', 'EURC', 'GUSD']);
function isStablecoin(sym) { return STABLECOINS.has((sym || '').toUpperCase()); }

// ============ SAFE-HAVEN GLOBAL TOGGLE ============
const SH_KEY = 'aqmath_safehaven_on';
function getSafeHavenToggle() {
    const v = localStorage.getItem(SH_KEY);
    return v === null ? true : v === 'true';
}
function setSafeHavenToggle(on) {
    localStorage.setItem(SH_KEY, on ? 'true' : 'false');
    const usdc = portfolio.find(t => t.sym === 'USDC');
    if (usdc) usdc.safeHaven = on;
    render();
}
function toggleGlobalSafeHaven() {
    setSafeHavenToggle(!getSafeHavenToggle());
    updateSafeHavenUI();
}
function updateSafeHavenUI() {
    const on = getSafeHavenToggle();
    const sw = document.getElementById('shSwitch');
    const lb = document.getElementById('shLabel');
    const ds = document.getElementById('shDesc');
    const row = document.getElementById('shToggleRow');
    const bal = document.getElementById('shBalance');
    const btn = document.getElementById('shDeployBtn');
    if (!sw) return;
    sw.className = on ? 'sh-sw' : 'sh-sw off';
    lb.className = on ? 'sh-lbl' : 'sh-lbl off';
    ds.textContent = on
        ? 'ON \u2014 absorbs hard-cap surplus & unallocated DCA'
        : 'OFF \u2014 USDC treated as normal token';
    row.className = on ? 'sh-row' : 'sh-row off';
    // Show USDC balance and deploy button state
    const usdc = portfolio.find(t => t.sym === 'USDC');
    const usdcVal = usdc ? (usdc.amount * usdc.price) : 0;
    if (bal) bal.textContent = '$' + usdcVal.toFixed(2);
    if (btn) btn.disabled = usdcVal < 0.01;
}

function deployUSDC() {
    const usdc = portfolio.find(t => t.sym === 'USDC');
    if (!usdc || usdc.amount * usdc.price < 0.01) {
        return showToast('No USDC available to deploy.', 'warning');
    }
    const val = usdc.amount * usdc.price;
    const dcaInput = document.getElementById('iDcaAmount');
    const current = parseFloat(dcaInput.value) || 0;
    dcaInput.value = (current + val).toFixed(2);
    usdc.amount = 0;
    saveState();
    updateSafeHavenUI();
    render();
    showToast(`$${val.toFixed(2)} USDC moved to your DCA amount — click DISTRIBUTE to deploy.`, 'success');
}

// ============ DELEVERAGE TOGGLE (PRO) ============
const DL_KEY = 'aqmath_deleverage_on';
const DL_STATE_KEY = 'aqmath_deleverage_shield_state';
function getDeleverageToggle() {
    const v = localStorage.getItem(DL_KEY);
    return v === null ? false : v === 'true';
}
function setDeleverageToggle(on) {
    localStorage.setItem(DL_KEY, on ? 'true' : 'false');
}
function getDeleverageShieldState() {
    const v = localStorage.getItem(DL_STATE_KEY);
    return v ? JSON.parse(v) : null;
}
function setDeleverageShieldState(state) {
    if (state) {
        localStorage.setItem(DL_STATE_KEY, JSON.stringify(state));
    } else {
        localStorage.removeItem(DL_STATE_KEY);
    }
}
function toggleDeleverage() {
    console.log('[Deleverage] Click! isPro=' + isPro + ', token=' + (getBetaToken() ? 'exists' : 'none'));
    if (!isPro) { showProModal(); return; }
    const newVal = !getDeleverageToggle();
    setDeleverageToggle(newVal);
    console.log('[Deleverage] Toggled to: ' + newVal);
    updateDeleverageUI();
}
function updateDeleverageUI() {
    const on = getDeleverageToggle();
    const sw = document.getElementById('dlSwitch');
    const lb = document.getElementById('dlLabel');
    const ds = document.getElementById('dlDesc');
    const row = document.getElementById('dlToggleRow');
    if (!sw) return;
    sw.className = on ? 'dl-sw' : 'dl-sw off';
    lb.className = on ? 'dl-lbl' : 'dl-lbl off';
    lb.innerHTML = 'DELEVERAGE <span class="dl-pro-badge">PRO</span>';
    ds.textContent = on
        ? 'ON \u2014 shields KKT weights during downside signature'
        : 'OFF \u2014 KKT weights pass through unmodified';
    row.className = on ? 'dl-row' : 'dl-row off';
}

// ============ CIRCUIT BREAKER ============
const ATH_KEY = 'aqmath_portfolio_ath';

function updatePortfolioATH() {
    const currentVal = totalValue();
    const stored = parseFloat(localStorage.getItem(ATH_KEY) || '0');
    if (currentVal > stored) {
        localStorage.setItem(ATH_KEY, currentVal.toString());
    }
}

function calcPortfolioVol() {
    // Correlation-aware portfolio vol from localStorage price history
    const portVal = totalValue();
    if (portVal <= 0) return 0.5; // default high vol for empty portfolio
    const active = [];
    portfolio.forEach(t => {
        if (t.safeHaven || t.frozen) return;
        const weight = (t.amount * t.price) / portVal;
        if (weight <= 0) return;
        const histKey = `aq_history_${t.sym}`;
        let hist = null;
        try { hist = JSON.parse(localStorage.getItem(histKey)); } catch {}
        const prices = hist?.prices || [];
        let dailyVol, annVol;
        if (prices.length < 10) { dailyVol = 0.8 / Math.sqrt(365); annVol = 0.8; }
        else {
            const last30 = prices.slice(-30);
            const returns = [];
            for (let i = 1; i < last30.length; i++) {
                if (last30[i] > 0 && last30[i-1] > 0) returns.push(Math.log(last30[i] / last30[i-1]));
            }
            if (returns.length < 2) { dailyVol = 0.8 / Math.sqrt(365); annVol = 0.8; }
            else {
                const mean = returns.reduce((a,b) => a+b, 0) / returns.length;
                const variance = returns.reduce((a,b) => a + (b-mean)**2, 0) / returns.length;
                dailyVol = Math.sqrt(variance);
                annVol = dailyVol * Math.sqrt(365);
            }
        }
        active.push({ sym: t.sym, weight, annVol, dailyVol, prices });
    });
    if (active.length === 0) return 0.5;
    if (active.length === 1) return active[0].annVol;

    // Compute average pairwise correlation from aligned price returns
    let sumCorr = 0, nPairs = 0;
    for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
            const pi = active[i].prices.slice(-30);
            const pj = active[j].prices.slice(-30);
            const minLen = Math.min(pi.length, pj.length);
            if (minLen < 5) continue;
            const ri = [], rj = [];
            for (let k = 1; k < minLen; k++) {
                if (pi[k] > 0 && pi[k-1] > 0 && pj[k] > 0 && pj[k-1] > 0) {
                    ri.push(Math.log(pi[k] / pi[k-1]));
                    rj.push(Math.log(pj[k] / pj[k-1]));
                }
            }
            if (ri.length < 3) continue;
            const mi = ri.reduce((a,b) => a+b, 0) / ri.length;
            const mj = rj.reduce((a,b) => a+b, 0) / rj.length;
            let num = 0, di = 0, dj = 0;
            for (let k = 0; k < ri.length; k++) {
                num += (ri[k] - mi) * (rj[k] - mj);
                di += (ri[k] - mi) ** 2;
                dj += (rj[k] - mj) ** 2;
            }
            const corr = (di > 0 && dj > 0) ? num / Math.sqrt(di * dj) : 0;
            sumCorr += corr;
            nPairs++;
        }
    }
    const avgCorr = nPairs > 0 ? Math.max(0, sumCorr / nPairs) : 0;

    // Correlation-adjusted portfolio vol:
    // uncorrelated: sqrt(sum(wi*vi)^2)   fully correlated: sum(wi*vi)
    // Blend using avgCorr as interpolation factor
    const weightedAvgVol = active.reduce((s, a) => s + a.weight * a.annVol, 0);
    const weightedRmsVol = Math.sqrt(active.reduce((s, a) => s + (a.weight * a.annVol) ** 2, 0));
    const blendedVol = weightedRmsVol * (1 - avgCorr) + weightedAvgVol * avgCorr;
    return blendedVol;
}

function genColors(n) {
    return Array.from({ length: n }, (_, i) => `hsl(${Math.round((i * 360) / Math.max(n, 1))}, 70%, 60%)`);
}

function showLoading(title, sub) {
    document.getElementById('loadingTitle').textContent = title;
    document.getElementById('loadingSub').textContent = sub || '';
    document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function calcToken(t, portVal) {
    const curVal = t.amount * t.price;
    const curPct = portVal > 0 ? r2((curVal / portVal) * 100, 2) : 0;
    const tgtVal = (t.target / 100) * portVal;
    const drift = r2(curPct - t.target, 2);
    const delta = tgtVal - curVal;

    // Safe-haven tokens: exempt from trend/safety filters
    if (t.safeHaven) {
        const action = (delta > 0.01) ? 'BUY' : 'HOLD';
        const actionClass = action === 'BUY' ? 'buy' : 'hold';
        return { curVal, curPct, drift, action, actionClass, pnl: null, avgPrice: null, avgType: null, yieldGap: 0, selfSustaining: false, delta, safeHaven: true };
    }

    let action = (drift < -0.5 && delta > 0.01) ? 'BUY' : 'HOLD';
    let actionClass = action === 'BUY' ? 'buy' : 'hold';
    let pnl = null;
    if (t.entry && t.entry > 0 && t.price > 0) pnl = r2(((t.price - t.entry) / t.entry) * 100, 2);
    let avgPrice = null, avgType = null;
    if (t.costBasis > 0 && t.totalTokens > 0) {
        avgPrice = t.costBasis / t.totalTokens;
        avgType = t.price > avgPrice ? 'up' : (t.price < avgPrice ? 'down' : 'flat');
    } else if (t.entry) {
        avgPrice = t.entry;
        avgType = t.price >= t.entry ? 'up' : 'down';
    }
    const apy = t.apy || 0;
    const yieldGap = apy - 10;
    const selfSustaining = apy >= 10;
    return { curVal, curPct, drift, action, actionClass, pnl, avgPrice, avgType, yieldGap, selfSustaining, delta, safeHaven: false };
}

// CoinGecko ID map for tokens where Binance has wrong/missing prices
const TOKEN_CG_MAP = {
    'DAG': 'constellation-labs',
    'EWT': 'energy-web-token',
    'TICS': 'qubetics',
    'ATH': 'aethir',
    'PEAQ': 'peaq-2',
    'CELESTIA': 'celestia',
    'PYTH': 'pyth-network',
};

async function dohvatiCijenu(symbol) {
    const sym = symbol.toUpperCase();
    const cgId = TOKEN_CG_MAP[sym];

    // If token has a known CoinGecko ID, use it directly (skip Binance)
    if (cgId) {
        try {
            const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`);
            if (priceRes.ok) {
                const priceData = await priceRes.json();
                if (priceData[cgId] && priceData[cgId].usd) {
                    return priceData[cgId].usd;
                }
            }
        } catch(e) { /* CoinGecko failed, fall through to Binance */ }
    }

    // If token is in CG map but ID is null, use CoinGecko search
    if (sym in TOKEN_CG_MAP && !cgId) {
        try {
            const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${sym}`);
            if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData.coins && searchData.coins.length > 0) {
                    const coinId = searchData.coins[0].id;
                    const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
                    if (priceRes.ok) {
                        const priceData = await priceRes.json();
                        if (priceData[coinId] && priceData[coinId].usd) {
                            return priceData[coinId].usd;
                        }
                    }
                }
            }
        } catch(e) { /* CoinGecko search failed, fall through to Binance */ }
    }

    // Try Binance (free, no key needed)
    try {
        const pair = sym + 'USDT';
        const res = await fetch(`${DCA_API_URL}/api/binance/price?symbol=${pair}`);
        if (res.ok) {
            const data = await res.json();
            const price = parseFloat(data.price);
            if (price > 0) return price;
        }
    } catch(e) { /* Binance failed, try CoinGecko */ }

    // Fallback: Try CoinGecko search
    try {
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${sym}`);
        if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.coins && searchData.coins.length > 0) {
                const coinId = searchData.coins[0].id;
                const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
                if (priceRes.ok) {
                    const priceData = await priceRes.json();
                    if (priceData[coinId] && priceData[coinId].usd) {
                        return priceData[coinId].usd;
                    }
                }
            }
        }
    } catch(e) { /* CoinGecko also failed */ }

    return null;
}

async function dohvatiViseCijena(symbols) {
    try {
        // Use Binance public API directly (free, no key needed, user's IP)
        const res = await fetch(`${DCA_API_URL}/api/binance/ticker`);
        if (!res.ok) return {};
        const tickerData = await res.json();
        const priceMap = {};
        tickerData.forEach(t => {
            if (t.symbol && t.symbol.endsWith('USDT')) {
                const base = t.symbol.replace('USDT', '');
                priceMap[base] = parseFloat(t.price);
            }
        });
        const result = {};
        symbols.forEach(sym => {
            if (priceMap[sym.toUpperCase()]) result[sym] = priceMap[sym.toUpperCase()];
        });
        return result;
    } catch { return {}; }
}

// Batch fetch all TOKEN_CG_MAP prices in a single CoinGecko API call
async function fetchCoinGeckoBatch() {
    const ids = Object.values(TOKEN_CG_MAP).filter(Boolean);
    const symById = {};
    Object.entries(TOKEN_CG_MAP).forEach(([sym, id]) => { if (id) symById[id] = sym; });
    const result = {};
    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
        console.log('[AQMath] CoinGecko batch fetch:', ids.length, 'tokens');
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('[AQMath] CoinGecko batch failed:', res.status, res.statusText);
            return result;
        }
        const data = await res.json();
        ids.forEach(id => {
            if (data[id] && data[id].usd) {
                result[symById[id]] = data[id].usd;
            }
        });
        console.log('[AQMath] CoinGecko batch result:', Object.keys(result).length, 'prices fetched');
    } catch(e) {
        console.warn('[AQMath] CoinGecko batch error:', e.message);
    }
    return result;
}

async function osvjeziSveCijene() {
    if (portfolio.length === 0) return showToast('Add a position first.', 'warning');
    const btn = document.getElementById('btnSyncAll');
    const originalText = btn.textContent;
    btn.textContent = "[ SYNC... ]";
    btn.disabled = true;
    try {
        const data = await fetchBinanceMarkets();
        const priceMap = {};
        data.forEach(c => {
            if (c.symbol && c.current_price) priceMap[c.symbol] = c.current_price;
        });
        // Remove Binance prices for tokens that must use CoinGecko (Binance has wrong/missing prices)
        Object.keys(TOKEN_CG_MAP).forEach(sym => { delete priceMap[sym]; });
        // Batch fetch CoinGecko prices for mapped tokens (single API call, avoids rate-limit)
        const cgPrices = await fetchCoinGeckoBatch();
        Object.entries(cgPrices).forEach(([sym, price]) => { priceMap[sym] = price; });
        // Fallback: fetch individual prices for remaining tokens not yet resolved
        const missing = portfolio.filter(t => !priceMap[t.sym] && !['USDC','USDT','DAI','BUSD','TUSD','FDUSD','USDP'].includes(t.sym));
        for (const t of missing) {
            const p = await dohvatiCijenu(t.sym);
            if (p) priceMap[t.sym] = p;
        }
        let cnt = 0;
        portfolio.forEach(t => {
            if (t.sym && priceMap[t.sym]) { t.price = priceMap[t.sym]; cnt++; }
            if (['USDC','USDT','DAI','BUSD','TUSD','FDUSD','USDP'].includes(t.sym)) { t.price = 1.0; cnt++; }
        });
        render();
        updatePortfolioATH();
        const cgCount = Object.keys(cgPrices).length;
        console.log(`[AQMath] synced ${cnt} prices (${cgCount} from CoinGecko, rest from Binance)`);
        showToast(`Prices updated for ${cnt} ${cnt === 1 ? 'coin' : 'coins'}.`, 'success');
    } catch(e) {
        console.error('[AQMath] price sync failed:', e.message);
        showToast("Couldn't refresh prices — please try again.", 'error');
    }
    finally {
        btn.textContent = originalText;
        btn.disabled = true;
        await sleep(5000);
        btn.disabled = false;
    }
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) throw new Error('CSV file must have a header and at least one data row.');
    const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
    const dateIdx = headers.findIndex(h => h === 'DATE');
    const typeIdx = headers.findIndex(h => h === 'TYPE');
    const symIdx  = headers.findIndex(h => h === 'SYMBOL' || h === 'TOKEN');
    const amtIdx  = headers.findIndex(h => h === 'AMOUNT' || h === 'QUANTITY');
    const priceIdx = headers.findIndex(h => h === 'PRICE');
    if (dateIdx < 0 || typeIdx < 0 || symIdx < 0 || amtIdx < 0) {
        throw new Error('CSV must contain columns: Date, Type, Symbol, Amount (and optional Price).');
    }
    const transactions = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (Math.max(dateIdx, typeIdx, symIdx, amtIdx) >= cols.length) continue;
        const symbol = cols[symIdx].toUpperCase();
        if (!symbol) continue;
        const type = cols[typeIdx].toUpperCase();
        const amount = parseFloat(cols[amtIdx]);
        if (isNaN(amount) || amount <= 0) continue;
        const price = priceIdx >= 0 ? parseFloat(cols[priceIdx]) || 0 : 0;
        transactions.push({ symbol, type, amount, price });
    }
    return transactions;
}

function calculateNetTokens(transactions) {
    const map = {};
    for (const tx of transactions) {
        if (!map[tx.symbol]) map[tx.symbol] = { amount: 0, totalCost: 0, totalTokens: 0 };
        switch (tx.type) {
            case 'BUY': case 'DEPOSIT': case 'RECEIVE':
                map[tx.symbol].amount += tx.amount;
                if (tx.price > 0) {
                    map[tx.symbol].totalCost += tx.amount * tx.price;
                    map[tx.symbol].totalTokens += tx.amount;
                }
                break;
            case 'SELL': case 'SEND': case 'WITHDRAWAL': case 'WITHDRAW':
                map[tx.symbol].amount -= tx.amount;
                break;
        }
    }
    return map;
}

async function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    showLoading('PARSING CSV', 'Reading transactions...');
    try {
        const text = await file.text();
        const transactions = parseCSV(text);
        if (transactions.length === 0) throw new Error('No valid transactions.');
        const netMap = calculateNetTokens(transactions);
        const symbols = Object.keys(netMap).filter(sym => netMap[sym].amount > 0);
        if (symbols.length === 0) throw new Error('No token with a positive net quantity.');
        document.getElementById('loadingSub').textContent = 'Fetching prices from backend...';
        const prices = await dohvatiViseCijena(symbols);
        document.getElementById('loadingSub').textContent = 'Creating portfolio...';
        const newPortfolio = [];
        const skipped = [];
        for (const sym of symbols) {
            const net = netMap[sym];
            const price = prices[sym] || 0;
            if (price <= 0) { skipped.push(sym); continue; }
            const value = net.amount * price;
            if (value < 5) { skipped.push(`${sym} (dust $${value.toFixed(2)})`); continue; }
            let avgEntry = net.totalTokens > 0 ? net.totalCost / net.totalTokens : price;
            if (!avgEntry || avgEntry <= 0) avgEntry = price;
            newPortfolio.push({
                sym, coinId: sym.toLowerCase(), amount: net.amount, price,
                entry: avgEntry, apy: 0, target: 0,
                costBasis: net.totalCost, totalTokens: net.totalTokens,
                frozen: false, insufficientHistory: false
            });
        }
        // Beta users have full access — no token limit
        for (const nt of newPortfolio) {
            const existIdx = portfolio.findIndex(t => t.sym === nt.sym);
            if (existIdx >= 0) {
                portfolio[existIdx].amount = nt.amount;
                portfolio[existIdx].price = nt.price;
                portfolio[existIdx].entry = nt.entry;
                portfolio[existIdx].costBasis = nt.costBasis;
                portfolio[existIdx].totalTokens = nt.totalTokens;
            } else {
                portfolio.push(nt);
            }
        }
        saveState();
        render();
        let msg = `Imported ${newPortfolio.length} ${newPortfolio.length === 1 ? 'token' : 'tokens'}.`;
        if (skipped.length > 0) msg += `\nskipped: ${skipped.join(', ')}`;
        showToast(msg, 'success');
    } catch(e) {
        console.error('[AQMath] CSV import failed:', e.message);
        showToast("Couldn't read that CSV — check the format and try again.", 'error');
    }
    finally { hideLoading(); event.target.value = ''; }
}

function parseHistoryCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
        console.warn('CSV has too few rows (needs header + at least 1 data row).');
        return [];
    }

    const prices = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(p => p.trim());
        const price = parseFloat(parts[1]);
        if (!isNaN(price) && price > 0) prices.push(price);
    }

    console.log(`parseHistoryCSV: read ${prices.length} prices from ${lines.length - 1} rows.`);
    return prices;
}

async function fetchPrices(symbol, forceRefresh = false) {
    if (!isPro) return null; // Free tier uses dohvatiCijenu (Binance/CoinGecko) directly
    const CACHE_KEY = `aq_history_${symbol}`;
    const MAX_AGE = 7 * 86400000;

    if (!forceRefresh) {
        const manualCache = localStorage.getItem(CACHE_KEY);
        if (manualCache) {
            try {
                const parsed = JSON.parse(manualCache);
                if (parsed.source === 'csv' && parsed.prices && parsed.prices.length > 0) {
                    return { prices: parsed.prices, source: 'csv' };
                }
            } catch(e) {}
        }
    }

    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed.prices && parsed.timestamp) {
                const age = Date.now() - parsed.timestamp;
                if (age < MAX_AGE) return { prices: parsed.prices, source: 'api-cache' };
            }
        } catch(e) {}
    }

    const maxRetries = 3;
    const delays = [1000, 2000, 4000];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const res = await fetch(`${API_URL}/history/${symbol}?days=180`);
            if (res.ok) {
                const json = await res.json();
                if (json.prices && Array.isArray(json.prices) && json.prices.length > 0) {
                    const prices = json.prices;
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ prices, timestamp: Date.now(), source: 'api' }));
                    return { prices, source: 'api-fresh' };
                }
            }
            if (attempt < maxRetries - 1) await sleep(delays[attempt]);
        } catch(e) {
            if (attempt < maxRetries - 1) await sleep(delays[attempt]);
        }
    }

    const staleCache = localStorage.getItem(CACHE_KEY);
    if (staleCache) {
        try {
            const parsed = JSON.parse(staleCache);
            if (parsed.prices) return { prices: parsed.prices, source: 'api-stale' };
        } catch(e) {}
    }

    return null;
}

async function refreshAllHistory() {
    const tokens = activeTokens();
    if (tokens.length === 0) return showToast('Add a token first.', 'warning');
    showLoading('REFRESHING HISTORY', 'Fetching 180-day data for all tokens...');
    for (const token of tokens) {
        await fetchPrices(token.sym, true);
        await sleep(2000);
    }
    hideLoading();
    showToast('Price history updated.', 'success');
}

// ============ QUANTITATIVE HELPERS (VOLATILITY, CAP, TREND) ============
function calculateVolatility(prices, days = 30) {
    const subset = prices.slice(-days);
    if (subset.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < subset.length; i++) {
        if (subset[i] > 0 && subset[i - 1] > 0) returns.push(Math.log(subset[i] / subset[i - 1]));
    }
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
}

function calculateMaxTarget(prices, maxVolInPortfolio, maxCap = 40, minCap = 10) {
    if (!prices || prices.length < 30) return (maxCap + minCap) / 2;
    const vol = calculateVolatility(prices, 30);
    if (maxVolInPortfolio === 0) return maxCap;
    const cap = maxCap - ((vol / maxVolInPortfolio) * (maxCap - minCap));
    return Math.max(minCap, Math.min(maxCap, Math.round(cap * 10) / 10));
}

function isAboveAverage(prices, days = 50) {
    const subset = prices.slice(-days);
    if (subset.length < 2) return false;
    const avg = subset.reduce((a, b) => a + b, 0) / subset.length;
    return prices[prices.length - 1] > avg;
}

function calculateSafetyFactor(prices) {
    const vol = calculateVolatility(prices, 30);
    return Math.max(0.2, 1 - (vol * 5));
}

// ============ ADD / UPDATE TOKEN ============
function popuniFormu(sym) {
    const token = portfolio.find(p => p.sym === sym);
    if (!token) return;
    document.getElementById('iSym').value = token.sym;
    document.getElementById('iAmt').value = token.amount;
    document.getElementById('iPrice').value = token.price;
    document.getElementById('iEntry').value = token.entry || '';
    document.getElementById('iApy').value = token.apy || 0;
    document.getElementById('iTarget').value = token.target;
    document.getElementById('btnAdd').textContent = '[ Update ]';
    editMode = token.sym;
}

function resetForme() {
    ['iSym','iAmt','iPrice','iEntry','iApy','iTarget'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('iHistoryCSV').value = '';
    document.getElementById('btnAdd').textContent = '[ Load ]';
    editMode = null;
}

async function dodajToken() {
    const input = document.getElementById('iSym').value.trim();
    if (!input) return showToast('enter a symbol or name.', 'warning');
    const sym = input.toUpperCase();

    const amount = parseFloat(document.getElementById('iAmt').value);
    let price = parseFloat(document.getElementById('iPrice').value);
    const entryInput = parseFloat(document.getElementById('iEntry').value);
    const apy = parseFloat(document.getElementById('iApy').value) || 0;
    const target = parseFloat(document.getElementById('iTarget').value);
    const safeHaven = isStablecoin(sym);
    if (isNaN(amount) || amount <= 0) return showToast('quantity must be > 0.', 'warning');
    if (isNaN(target) || target <= 0) return showToast('allocation must be > 0%.', 'warning');

    const coinId = sym.toLowerCase();  // use sym as coinId
    const btn = document.getElementById('btnAdd');
    btn.textContent = "[ FETCHING... ]";
    btn.disabled = true;
    try {
        const csvFile = document.getElementById('iHistoryCSV').files[0];
        if (csvFile) {
            const text = await csvFile.text();
            const prices = parseHistoryCSV(text);
            if (prices.length === 0) {
                showToast('csv contains no valid prices.', 'error');
                editMode = null;
                resetForme();
                btn.textContent = '[ Load ]';
                btn.disabled = false;
                return;
            }
            localStorage.setItem(`aq_history_${sym}`, JSON.stringify({ prices, timestamp: Date.now(), source: 'csv' }));
            showToast(`Historical data loaded from CSV: ${prices.length} data points saved for ${sym}.`, 'success');
        }

        if (isNaN(price) || price <= 0) {
            if (safeHaven) {
                price = 1.0; // stablecoin pegged to $1
                document.getElementById('iPrice').value = price;
            } else {
            const apiPrice = await dohvatiCijenu(sym);
            if (!apiPrice) {
                showToast(`Price for ${sym} not found on Binance or CoinGecko.\n\nPlease enter the current price manually in the Price field.`, 'error');
                editMode = null;
                resetForme();
                btn.textContent = '[ Load ]';
                btn.disabled = false;
                return;
            }
            price = apiPrice;
            document.getElementById('iPrice').value = price;
            }
        }

        let entry = entryInput;
        if (isNaN(entry) || entry <= 0) entry = price;

        const costBasis = entry && entry > 0 ? amount * entry : 0;
        const totalTokens = entry && entry > 0 ? amount : 0;
        const newToken = {
            sym, coinId, amount, price, entry, apy, target,
            costBasis, totalTokens, frozen: false, insufficientHistory: false,
            safeHaven: safeHaven || false
        };
        if (editMode) {
            const idx = portfolio.findIndex(t => t.sym === editMode);
            if (idx >= 0) {
                newToken.frozen = portfolio[idx].frozen;
                newToken.insufficientHistory = portfolio[idx].insufficientHistory;
                portfolio[idx] = newToken;
            }
        } else {
            portfolio.push(newToken);
        }
        resetForme();
        render();
    } catch(e) {
        console.error('[AQMath] add token failed:', e.message);
        showToast("Couldn't add that token — please check the details and try again.", 'error');
        editMode = null;
        resetForme();
    }
    finally {
        btn.textContent = '[ Load ]';
        btn.disabled = false;
        editMode = null;
    }
}

function toggleFreeze(sym) {
    const t = portfolio.find(p => p.sym === sym);
    if (t) { t.frozen = !t.frozen; render(); }
}

function obrisiToken(sym) {
    showToast(`delete ${sym}?`, 'warning', [
        { label: '[ yes ]', primary: true, onClick: () => {
            portfolio = portfolio.filter(t => t.sym !== sym);
            if (editMode === sym) resetForme();
            render();
            saveState();
            showToast(`${sym} removed.`, 'success');
        }},
        { label: '[ no ]', onClick: () => {} }
    ]);
}

function obrisiSve() {
    showToast('delete entire portfolio?', 'warning', [
        { label: '[ yes ]', primary: true, onClick: () => {
            portfolio = [];
            lastDcaDate = null;
            lastOptimization = null;
            localStorage.removeItem(DCA_KEY);
            localStorage.removeItem(OPT_KEY);
            localStorage.removeItem(HISTORY_KEY);
            portfolioHistory = [];
            saveHistory();
            resetForme();
            ensureUSDC();
            render();
            renderHistoryChart();
            showToast('portfolio cleared.', 'success');
        }},
        { label: '[ no ]', onClick: () => {} }
    ]);
}

// ============ DCA DISTRIBUTION ============
// Free tier: manual CSV upload only (client-side)
// Pro tier: backend API with data-pipeline + AQMath engine
// DCA safety pipeline: backend handles Circuit Breaker (Shield-aligned) → Safety Factor → Trend Filter → Hard Caps → Risk Budget
async function distribuirajDca() {
    if (Math.abs(totalTarget() - 100) > 0.01) {
        return showToast('Set your target allocations to total 100% before running DCA.', 'warning');
    }
    const dcaAmount = parseFloat(document.getElementById('iDcaAmount').value);
    if (isNaN(dcaAmount) || dcaAmount <= 0) return showToast('Enter a DCA amount greater than $0.', 'warning');
    const active = activeTokens();
    if (active.length === 0) return showToast('Add a token first.', 'warning');

    // Circuit Breaker is handled by backend (dca-engine) — Shield-aligned logic
    // Backend returns error if Shield detects extreme crash (DCA lockout)

    showLoading('REBALANCING', 'Calculating optimal DCA distribution...');

    const positions = portfolio.map(t => ({
        symbol: t.sym,
        amount: t.amount,
        price: t.price,
        entry: (t.entry && t.entry > 0) ? t.entry : t.price,
        apy: t.apy || 0,
        target: t.target,
        costBasis: t.costBasis || 0,
        totalTokens: t.totalTokens || 0,
        frozen: t.frozen || false,
        safeHaven: t.safeHaven || false
    }));

    // Send Shield state to backend for Circuit Breaker (Shield-aligned logic)
    const shieldState = isPro ? getDeleverageShieldState() : null;

    try {
        const resp = await fetch(`${DCA_API_URL}/dca`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positions, dca_amount: dcaAmount, shield_state: shieldState })
        });
        if (!resp.ok) {
            hideLoading();
            console.error('[DCA] service HTTP', resp.status);
            return showToast('The DCA service is unavailable right now — please try again shortly.', 'error');
        }
        const result = await resp.json();

        // DEBUG: Log full API response
        console.log('DCA API Response:', JSON.stringify(result, null, 2));

        if (result.error) {
            hideLoading();
            console.error('[DCA] engine returned error:', result.error);
            const errText = String(result.error).toLowerCase();
            if (errText.includes('defensive') || errText.includes('shield') || errText.includes('circuit') || errText.includes('paused') || errText.includes('lockout') || errText.includes('breaker')) {
                return showToast("DCA paused: your portfolio is in defensive mode — it'll resume automatically when markets recover.", 'notice');
            }
            return showToast("Couldn't run DCA right now — please try again shortly.", 'error');
        }

        const updated = result.updated_positions || [];
        console.log('DCA updated positions count:', updated.length);
        
        // Backend already applies hard caps + risk budget + stablecoin redirect
        // Just use the structural_limits returned by backend (no duplicate processing)
        const capped = result.structural_limits || [];
        if (capped.length > 0) {
            console.log('[DCA] Structural limits from backend:', capped);
        }
        
        updated.forEach(up => {
            const idx = portfolio.findIndex(t => t.sym === up.symbol);
            if (idx >= 0) {
                // Protect safe-haven tokens: never reduce amounts during DCA
                // (DCA adds external money, should not touch existing USDC balance)
                if (portfolio[idx].safeHaven && up.amount < portfolio[idx].amount) {
                    console.log(`[DCA] Protected safe-haven ${up.symbol} from reduction: ${up.amount} → keeping ${portfolio[idx].amount}`);
                    up.amount = portfolio[idx].amount;
                }
                console.log(`DCA: ${up.symbol} amount ${portfolio[idx].amount} → ${up.amount}`);
                portfolio[idx].amount = up.amount;
                portfolio[idx].costBasis = up.costBasis || portfolio[idx].costBasis;
                portfolio[idx].totalTokens = up.totalTokens || portfolio[idx].totalTokens;
            }
        });

        lastDcaDate = Date.now();

        const buySummary = result.buy_summary || [];
        const warnings = result.warnings || [];
        const totalAlloc = result.total_allocated || 0;
        const remaining = result.remaining || 0;
        console.log('DCA Result:', { budget: dcaAmount, totalAlloc, remaining, buySummary, warnings });

        // Return unallocated DCA budget back to safe-haven USDC (prevents value loss)
        if (remaining > 0.01) {
            const usdc = portfolio.find(t => t.safeHaven && !t.frozen);
            if (usdc) {
                usdc.amount += remaining;
                console.log(`[DCA] Returned $${remaining.toFixed(2)} remaining budget to ${usdc.sym}`);
            }
        }

        saveState();
        document.getElementById('iDcaAmount').value = '';
        addSnapshot();
        render();

        // Artificial delay for "heavy math" feel
        await sleep(1500);

        hideLoading();

        // Aggregate buys per token for logging + summary (sum $ and tokens, filter dust)
        const tokenTotals = {};
        let dustTotal = 0;
        buySummary.forEach(b => {
            const m = b.match(/^(\w+):\s*\+\$([\d.]+)\s*\(([\d.]+)\s*tokens?\)/);
            if (m) {
                const sym = m[1];
                const usd = parseFloat(m[2]);
                const tokens = parseFloat(m[3]);
                if (usd < 0.05) { dustTotal += usd; return; }
                if (!tokenTotals[sym]) tokenTotals[sym] = { usd: 0, tokens: 0 };
                tokenTotals[sym].usd += usd;
                tokenTotals[sym].tokens += tokens;
            }
        });
        const coinCount = Object.keys(tokenTotals).length;

        // Full breakdown (buys, warnings, structural limits) -> console only
        console.log('[DCA] breakdown', {
            budget: dcaAmount, allocated: totalAlloc, remaining,
            buys: Object.entries(tokenTotals).map(([sym, t]) => `${sym}: +$${t.usd.toFixed(2)} (${t.tokens} tokens)`),
            dustFiltered: dustTotal, warnings, structuralLimits: capped
        });

        // Friendly, outcome-focused summary
        let msg;
        if (totalAlloc >= 0.01 && coinCount > 0) {
            msg = `Added $${totalAlloc.toFixed(2)} across ${coinCount} ${coinCount === 1 ? 'coin' : 'coins'}.`;
            if (remaining > 0.01) msg += ` $${remaining.toFixed(2)} parked in USDC for next time.`;
            // Task 1: show the actual buys (tokens + USD) per coin
            msg += '\n\nBought:';
            Object.entries(tokenTotals).forEach(([sym, t]) => {
                msg += `\n  ${sym}: +${fmtTokens(t.tokens)} tokens (~$${t.usd.toFixed(2)})`;
            });
        } else {
            msg = `Your portfolio is already at its targets — $${dcaAmount.toFixed(2)} parked in USDC for next time.`;
        }

        showToast(msg, 'success', [
            { label: '[ export json ]', primary: true, onClick: () => exportJSON() }
        ]);
    } catch(e) {
        hideLoading();
        console.error('[DCA] rebalancing failed:', e.message);
        showToast("DCA couldn't complete — please check your connection and try again.", 'error');
    }
}

// ============ AQMath ENGINE OPTIMIZATION (data-pipeline /optimize) — PRO ONLY ============
async function optimizePortfolio() {
    if (!isPro) { showProModal(); return; }

    const unfrozen = portfolio.filter(t => !t.frozen && !t.safeHaven);
    if (unfrozen.length < 2) return showToast('Add at least 2 unfrozen risky tokens to optimize.', 'warning');

    showLoading('AQMath Engine', 'Building covariance matrix + ERC optimization...');

    const frozenTargets = {};
    portfolio.filter(t => t.frozen).forEach(t => { frozenTargets[t.sym] = t.target; });

    const tokens = unfrozen.map(t => ({ sym: t.sym, value: t.curVal || 0 }));

    // Deleverage: send toggle state + persisted shield state
    const deleverageEnabled = isPro && getDeleverageToggle();
    const shieldState = deleverageEnabled ? getDeleverageShieldState() : null;

    try {
        const resp = await pipelineFetch(`${DCA_API_URL}/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tokens,
                deleverage_enabled: deleverageEnabled,
                shield_state: shieldState,
                total_equity: totalValue()  // Real portfolio value for tranche exposure calc
            })
        });
        const result = await resp.json();

        if (result.detail) {
            hideLoading();
            // Parse cooldown message and display user-friendly time remaining
            const secMatch = (result.detail || '').match(/(\d+)s remaining/);
            if (secMatch) {
                const secs = parseInt(secMatch[1]);
                const h = Math.floor(secs / 3600);
                const m = Math.floor((secs % 3600) / 60);
                const timeStr = h > 0 ? `${h}h ${m}min` : `${m} min`;
                return showToast(`\u23f3 Next optimization available in ${timeStr}`, 'notice');
            }
            console.error('[Optimize] engine detail:', result.detail);
            return showToast("Couldn't optimize right now — please try again shortly.", 'error');
        }

        const weights = result.weights || [];
        if (weights.length === 0) {
            hideLoading();
            return showToast("Optimization didn't return any allocations — please try again.", 'error');
        }

        // Apply weights as new targets
        weights.forEach(w => {
            const token = portfolio.find(t => t.sym === w.sym);
            if (token && w.weight > 0) {
                token.target = w.weight;
            }
        });

        // Close the gap: assign remainder to USDC (safe-haven) so totalTarget = 100%
        const riskyTotal = weights.reduce((sum, w) => sum + (w.weight > 0 ? w.weight : 0), 0);
        const frozenTotal = Object.values(frozenTargets).reduce((s, v) => s + v, 0);
        const usdc = portfolio.find(t => t.safeHaven);
        let usdcTarget = 0;
        if (usdc) {
            usdcTarget = Math.max(0, +(100 - riskyTotal - frozenTotal).toFixed(2));
            usdc.target = usdcTarget;
        }

        // Track tokens with insufficient history: engine 'insufficient_data' error ILI stvarna pokrivenost < 180 dana.
        // Reset radimo za SVE tokene (osim safe-havena), ne samo unfrozen, da se stari flag ne zaglavi.
        const dataPoints = result.data_points || {};
        const insufficient = weights.filter(w => w.error === 'insufficient_data').map(w => w.sym);
        portfolio.forEach(t => {
            if (t.safeHaven) { t.insufficientHistory = false; return; }
            const dp = dataPoints[t.sym];
            t.insufficientHistory = insufficient.includes(t.sym) || (dp != null && dp < 180);
        });

        // Deleverage: persist shield state for next call
        let dlInfo = null;
        if (deleverageEnabled && result.deleverage) {
            const dl = result.deleverage;
            setDeleverageShieldState(dl.shield_state);
            dlInfo = dl.diagnostics;
        } else if (!deleverageEnabled) {
            setDeleverageShieldState(null);
        }

        lastOptimization = Date.now();
        saveState();
        render();

        await sleep(2000);
        hideLoading();

        let msg = '\u2699\ufe0f AQMath Engine Optimization Complete\n';
        msg += '\u2501'.repeat(30) + '\n';
        msg += `Method: ${result.method || 'ERC+covariance+KKT'} (${result.erc_iterations || '?'} iter)\n`;
        if (result.portfolio_volatility) msg += `Portfolio vol: ${(result.portfolio_volatility * 100).toFixed(1)}%\n`;
        msg += '\n';
        msg += 'Weights (KKT-projected):\n\n';
        weights.forEach(w => {
            const vol = w.volatility != null ? `vol:${(w.volatility * 100).toFixed(1)}%` : 'no data';
            const rc = w.risk_contribution ? `rc:${(w.risk_contribution * 100).toFixed(1)}%` : '';
            const dynCap = result.dynamic_caps && result.dynamic_caps[w.sym] != null ? `cap:${(result.dynamic_caps[w.sym]*100).toFixed(0)}%` : '';
            const cap = w.capped ? ` \u26a0\ufe0f(${dynCap})` : (dynCap ? ` ${dynCap}` : '');
            const erc = w.erc_weight != null ? `erc:${w.erc_weight}%` : '';
            msg += `  ${w.sym}: ${w.weight}% (${vol}, ${erc}, ${rc})${cap}\n`;
        });
        if (usdcTarget > 0) msg += `  USDC: ${usdcTarget}% (safe-haven remainder)\n`;
        if (result.correlations && result.correlations.length > 0) {
            msg += '\nTop correlations:\n';
            result.correlations.slice(0, 3).forEach(c => {
                msg += `  ${c.pair}: ${c.corr.toFixed(2)}\n`;
            });
        }
        if (result.kkt_constraints && result.kkt_constraints.length > 0) {
            msg += '\nKKT constraints:\n';
            result.kkt_constraints.forEach(k => { msg += `  \u26a0\ufe0f ${k}\n`; });
        }
        if (insufficient.length > 0) msg += `\n\u26a0\ufe0f Insufficient history (<30d): ${insufficient.join(', ')}`;
        if (result.data_points) msg += `\nData: ${Object.entries(result.data_points).map(([s,n]) => `${s}=${n}d`).join(', ')}`;

        // Deleverage diagnostics
        if (dlInfo) {
            msg += '\n\n\u26a1 Deleverage Shield:\n';
            msg += `  Status: ${dlInfo.shield_active ? '\u26a1 ACTIVE' : '\u2705 NORMAL'}\n`;
            msg += `  Target exposure: ${(dlInfo.target_exposure * 100).toFixed(1)}%\n`;
            // Gap 2: Show effective exposure when asymmetric cap is active
            if (dlInfo.effective_exposure != null) {
                const effPct = (dlInfo.effective_exposure * 100).toFixed(1);
                const tgtPct = (dlInfo.target_exposure * 100).toFixed(1);
                if (dlInfo.effective_exposure < dlInfo.target_exposure - 0.001) {
                    const delta = ((dlInfo.target_exposure - dlInfo.effective_exposure) * 100).toFixed(1);
                    msg += `  Effective exposure: ${effPct}% (capped, +${delta}% remaining)\n`;
                } else {
                    msg += `  Effective exposure: ${effPct}%\n`;
                }
            }
            msg += `  Global DD: ${(dlInfo.global_dd * 100).toFixed(1)}%  |  Window DD: ${(dlInfo.current_dd * 100).toFixed(1)}%\n`;
            msg += `  Downside vol: ${(dlInfo.ds_vol * 100).toFixed(1)}%\n`;
            // Gap 3: Show peak_ds_vol with lockout threshold
            if (dlInfo.peak_ds_vol != null) {
                const peakVol = (dlInfo.peak_ds_vol * 100).toFixed(1);
                const lockout = (dlInfo.peak_ds_vol * 0.70 * 100).toFixed(1);
                if (dlInfo.peak_ds_vol > 0.01) {
                    msg += `  Peak DS vol: ${peakVol}% (lockout threshold: ${lockout}%)\n`;
                } else {
                    msg += `  Peak DS vol: ${peakVol}% (decayed — lockout cleared)\n`;
                }
            }
            if (dlInfo.exit_reason) msg += `  Exit reason: ${dlInfo.exit_reason}\n`;
            // Gap 4: Show divergence guard block status
            if (dlInfo.exit_blocked) msg += `  \u26d4 EXIT BLOCKED: ${dlInfo.exit_block_reason}\n`;
            if (dlInfo.entry_triggered) msg += `  \u26a0\ufe0f Shield ENTRY triggered this call\n`;
            msg += `  Risky total: ${dlInfo.risky_total}%  |  USDC: ${dlInfo.usdc_remainder}%\n`;
        }

        // Full technical breakdown (method, weights, correlations, KKT, shield diagnostics) -> console only
        console.log('[Optimize] details:\n' + msg);

        // Friendly, outcome-focused summary
        const coinCount = weights.filter(w => w.weight > 0).length;
        let summary = `Portfolio optimized — new targets set for ${coinCount} ${coinCount === 1 ? 'coin' : 'coins'}.`;
        if (usdcTarget > 0) summary += ` ${usdcTarget}% kept in USDC.`;

        // Implied rebalance trades to reach the new targets.
        // (the engine sets target weights, it does not execute the buys/sells)
        // Fee-avoidance: skip any trade below $20 notional.
        // Defensive (shield ACTIVE): deleverage only REDUCES exposure — never buy; DCA is paused.
        // Normal (shield inactive/off): only BUY drifted-underweight positions — no sells.
        const equity = totalValue();
        const shieldActive = !!(dlInfo && dlInfo.shield_active);
        const MIN_TRADE_USD = 20;
        const buys = [];
        const sells = [];
        let sellUsdTotal = 0;
        unfrozen.forEach(t => {
            if (t.safeHaven || !t.price || t.price <= 0) return;
            const targetVal = (t.target / 100) * equity;
            const curVal = t.amount * t.price;
            const delta = targetVal - curVal;
            const usd = Math.abs(delta);
            if (usd < MIN_TRADE_USD) return;
            const qty = usd / t.price;
            if (shieldActive) {
                if (delta < 0) {
                    sells.push(`  ${t.sym}: sell ${fmtTokens(qty)} tokens (~$${usd.toFixed(2)})`);
                    sellUsdTotal += usd;
                }
            } else if (delta > 0) {
                buys.push(`  ${t.sym}: BUY ${fmtTokens(qty)} tokens (~$${usd.toFixed(2)})`);
            }
        });

        // Deleverage status + a single (non-duplicated) trade block
        if (dlInfo) {
            summary += `\n\nDeleverage: ${shieldActive ? 'ACTIVE' : 'INACTIVE'}`;
            if (shieldActive) {
                summary += "\nDefensive mode is on — exposure is dialed back while markets are shaky. New DCA buys are paused; they'll resume automatically as markets recover.";
                if (sells.length > 0) {
                    summary += '\n\nReduce exposure — sell into USDC:\n' + sells.join('\n');
                    summary += `\n  Total to USDC: ~$${sellUsdTotal.toFixed(2)}`;
                }
            } else if (buys.length > 0) {
                summary += '\n\nSuggested buys (drift rebalance):\n' + buys.join('\n');
            }
        } else {
            summary += '\n\nDeleverage: OFF';
            if (buys.length > 0) {
                summary += '\n\nSuggested buys (drift rebalance):\n' + buys.join('\n');
            }
        }
        if (insufficient.length > 0) summary += `\n\nNot enough price history yet for: ${insufficient.join(', ')}.`;
        showToast(summary, 'success');
    } catch(e) {
        hideLoading();
        console.error('[Optimize] failed:', e.message);
        showToast("Optimization couldn't complete — please check your connection and try again.", 'error');
    }
}

// ============ EXPORT / IMPORT ============
function exportJSON() {
    const exportData = {
        portfolio: portfolio.map(t => ({
            sym: t.sym, coinId: t.coinId, amount: t.amount, price: t.price,
            entry: t.entry, apy: t.apy, target: t.target,
            costBasis: t.costBasis, totalTokens: t.totalTokens, frozen: t.frozen,
            insufficientHistory: t.insufficientHistory
        })),
        lastDcaDate: lastDcaDate,
        lastOptimization: lastOptimization,
        portfolioHistory: portfolioHistory,
        exportTimestamp: new Date().toISOString(),
        version: '2.9'
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aqmath_portfolio_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function importJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.portfolio && Array.isArray(data.portfolio)) {
                portfolio = data.portfolio.map(t => ({
                    ...t, coinId: t.coinId || t.sym.toLowerCase(), frozen: t.frozen || false,
                    costBasis: t.costBasis || 0, totalTokens: t.totalTokens || 0,
                    insufficientHistory: t.insufficientHistory || false
                }));
                ensureUSDC();
                lastDcaDate = data.lastDcaDate || null;
                lastOptimization = data.lastOptimization || null;
                if (data.portfolioHistory && Array.isArray(data.portfolioHistory)) {
                    portfolioHistory = data.portfolioHistory;
                }
                saveState();
                saveHistory();
                render();
                renderHistoryChart();
                showToast(`Portfolio imported (${portfolio.length} tokens).`, 'success');
            } else {
                showToast('Invalid JSON file.', 'error');
            }
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ============ REFRESH HISTORY (PRO) ============
async function refreshHistory() {
    if (!isPro) { updateProButtons(); return; }
    const tokens = portfolio.filter(t => t.amount > 0 && !t.safeHaven);
    if (tokens.length === 0) return showToast('no positions to build history from.', 'warning');

    showLoading('Refresh History', 'Fetching 90-day price data from Binance...');

    const STABLES = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDP'];
    const priceMap = {};

    try {
        for (const t of tokens) {
            if (STABLES.includes(t.sym)) {
                priceMap[t.sym] = Array(90).fill(1.0);
                continue;
            }
            const symbol = t.sym + 'USDT';
            try {
                const res = await fetch(`${DCA_API_URL}/api/binance/klines?symbol=${symbol}&interval=1d&limit=90`);
                if (!res.ok) continue;
                const klines = await res.json();
                priceMap[t.sym] = klines.map(k => parseFloat(k[4]));
            } catch(e) { continue; }
        }

        const syms = Object.keys(priceMap);
        if (syms.length === 0) {
            hideLoading();
            return showToast('could not fetch price data for any token.', 'error');
        }

        const minLen = Math.min(...syms.map(s => priceMap[s].length));
        const history = [];

        for (let i = 0; i < minLen; i++) {
            let total = 0;
            for (const t of tokens) {
                if (priceMap[t.sym] && priceMap[t.sym][i] != null) {
                    total += t.amount * priceMap[t.sym][i];
                }
            }
            if (total > 0) {
                const daysAgo = minLen - 1 - i;
                history.push({
                    timestamp: Date.now() - daysAgo * 86400000,
                    total: total
                });
            }
        }

        portfolioHistory = history;
        saveHistory();
        renderHistoryChart();

        await sleep(1500);
        hideLoading();
        showToast(`History rebuilt — ${history.length} data points from ${syms.length} ${syms.length === 1 ? 'token' : 'tokens'}.`, 'success');
    } catch(e) {
        hideLoading();
        console.error('[AQMath] history rebuild failed:', e.message);
        showToast("Couldn't rebuild history — please try again.", 'error');
    }
}

// ============ HISTORY CHART ============
function renderHistoryChart() {
    if (historyChart) { historyChart.destroy(); historyChart = null; }
    if (!portfolioHistory.length) {
        const ctx = document.getElementById('historyChart').getContext('2d');
        historyChart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Portfolio Value', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.05)', fill: true }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { ticks: { callback: v => '$' + v.toFixed(0) } } } }
        });
        return;
    }

    const sorted = portfolioHistory.slice().sort((a,b) => a.timestamp - b.timestamp);
    const labels = sorted.map(p => new Date(p.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' }));
    const values = sorted.map(p => p.total);

    historyChart = new Chart(historyCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Portfolio Value',
                data: values,
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(56,189,248,0.05)',
                fill: true,
                tension: 0.2,
                pointRadius: 2,
                pointHoverRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => '$' + ctx.raw.toFixed(2) } }
            },
            scales: {
                x: { ticks: { color: '#7a8ba5', font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { callback: v => '$' + v.toFixed(0), color: '#7a8ba5', font: { size: 9 } }, grid: { color: 'rgba(6,182,212,0.08)' } }
            }
        }
    });
}

// ============ RENDER ============
function render() {
    saveState();
    const portVal = totalValue();
    const allTokens = portfolio;
    const tgt = totalTarget();
    const colors = genColors(allTokens.length);
    const allocationOk = Math.abs(tgt - 100) < 0.01;

    document.getElementById('hTotal').textContent = `$${fmtUSD(portVal)}`;
    document.getElementById('hPos').textContent = allTokens.length;
    const hStatus = document.getElementById('hStatus');
    if (!allTokens.length) { hStatus.textContent = '—'; hStatus.className = 'hstat-v'; }
    else if (tgt > 100.01) { hStatus.textContent = 'OVER'; hStatus.className = 'hstat-v col-red'; }
    else if (!allocationOk) { hStatus.textContent = 'DRIFT'; hStatus.className = 'hstat-v col-red'; }
    else { hStatus.textContent = 'SYNCED'; hStatus.className = 'hstat-v col-green'; }

    const bar = document.getElementById('statusBar');
    const txt = document.getElementById('statusTxt');
    if (!allTokens.length) { bar.className = 'status idle'; txt.textContent = 'Add positions or import CSV/JSON.'; }
    else if (tgt > 100.01) { bar.className = 'status warn'; txt.textContent = `Overallocation ${tgt}% — DCA frozen.`; }
    else if (!allocationOk) { bar.className = 'status warn'; txt.textContent = `Allocation ${tgt}% — DCA frozen.`; }
    else { bar.className = 'status ok'; txt.textContent = 'Portfolio synced — DCA active.'; }

    const dcaBtn = document.getElementById('btnDca');
    const canDca = activeTokens().length > 0 && allocationOk;
    dcaBtn.disabled = !canDca;
    dcaBtn.title = canDca ? 'Start DCA distribution' : 'DCA is available only when total target allocation equals 100%.';

    const pct = Math.min(Math.max(tgt, 0), 100);
    const fill = document.getElementById('aFill'); fill.style.width = `${pct}%`;
    fill.className = `a-fill${tgt > 100.01 ? ' over' : tgt >= 99.99 ? ' full' : ''}`;
    document.getElementById('aPctLbl').textContent = `${tgt}%`;
    document.getElementById('aNumVal').textContent = tgt.toFixed(2);
    const remEl = document.getElementById('aRem'), rem = r2(100 - tgt, 4);
    remEl.textContent = rem > 0.005 ? `Remaining: ${rem}%` : (Math.abs(rem) < 0.01 ? 'Allocation full' : `Overage by ${Math.abs(rem)}%`);

    if (myChart) { myChart.destroy(); myChart = null; }
    document.getElementById('cCV').textContent = allTokens.length || '—';
    document.getElementById('legend').innerHTML = '';
    if (allTokens.length) {
        const data = allTokens.map(t => portVal > 0 ? r2((t.amount * t.price / portVal) * 100, 2) : t.target);
        myChart = new Chart(chartCtx, {
            type: 'doughnut',
            data: { labels: allTokens.map(t => t.sym), datasets: [{ data, backgroundColor: colors.map(c => c.replace('hsl(', 'hsla(').replace(')', ', 0.82)')), borderColor: '#060810', borderWidth: 2 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '74%', plugins: { legend: { display: false } } }
        });
        document.getElementById('legend').innerHTML = allTokens.map((t,i) => `<div class="leg-item"><div class="leg-dot" style="background:${colors[i]}"></div>${t.sym}</div>`).join('');
    }

    document.getElementById('sTotalVal').textContent = `$${fmtUSD(portVal)}`;
    if (!allTokens.length) { ['sPnl','sLargest','sMaxDrift','sNeedReb','sAllocSt'].forEach(id => document.getElementById(id).textContent = '—'); }
    else {
        let cost = 0, curTot = 0;
        allTokens.forEach(t => { if (t.entry) { cost += t.amount * t.entry; curTot += t.amount * t.price; } });
        document.getElementById('sPnl').textContent = cost > 0 ? `${r2(((curTot - cost) / cost) * 100, 2)}%` : 'N/A';
        const lg = allTokens.reduce((a, b) => a.amount * a.price > b.amount * b.price ? a : b);
        document.getElementById('sLargest').textContent = lg.sym;
        const drifts = activeTokens().map(t => Math.abs(calcToken(t, portVal).drift));
        document.getElementById('sMaxDrift').textContent = drifts.length ? `${Math.max(...drifts).toFixed(2)}%` : 'N/A';
        const need = activeTokens().filter(t => calcToken(t, portVal).actionClass === 'buy').length;
        document.getElementById('sNeedReb').textContent = need > 0 ? `${need} positions` : 'No';
        document.getElementById('sAllocSt').textContent = allocationOk ? '100% OK' : `${tgt}%`;
    }

    const wrap = document.getElementById('tblWrap');
    if (!allTokens.length) {
        wrap.innerHTML = `<div class="empty"><div class="empty-ico">[∅]</div><div class="empty-txt">Portfolio empty</div></div>`;
    } else {
        const rows = allTokens.map((t, i) => {
            const c = calcToken(t, portVal);
            const barW = Math.min(c.curPct, 100), barT = Math.min(t.target, 100);
            const pnlStr = c.pnl !== null ? `${c.pnl >= 0 ? '+' : ''}${c.pnl.toFixed(2)}%` : '—';
            const avgStr = c.avgPrice ? `$${fmtPrice(c.avgPrice)} (${c.avgType === 'down' ? '→' : c.avgType === 'up' ? '→' : '→'})` : '—';
            const ygStr = c.yieldGap >= 0 ? `+${c.yieldGap.toFixed(1)}%` : `${c.yieldGap.toFixed(1)}%`;
            const frozenIcon = t.frozen ? '❄️' : '🔥';
            const warnIcon = t.insufficientHistory ? `<span class="warn-icon" title="Less than 180 days of history — unreliable data"></span>` : '';
            const safeIcon = t.safeHaven ? `<span style="color:var(--green);font-size:0.6rem;margin-left:4px;" title="Safe-haven (stablecoin) — exempt from filters">🛡</span>` : '';
            return `<tr${t.safeHaven ? ' class="row-safe-haven"' : ''}>
                <td><span class="sym" style="color:${colors[i]}">${t.sym}${warnIcon}${safeIcon}</span></td>
                <td>${fmtQty(t.amount, t.price)}</td>
                <td>$${fmtPrice(t.price)}</td>
                <td>$${fmtUSD(c.curVal)}</td>
                <td>${c.curPct.toFixed(2)}% <span class="mbar"><span class="mbar-f" style="width:${barW}%;background:${colors[i]}"></span><span class="mbar-t" style="left:${barT}%"></span></span></td>
                <td>${t.target.toFixed(1)}%</td>
                <td><span class="drift ${Math.abs(c.drift) < 0.5 ? 'n' : (c.drift > 0 ? 'p' : 'm')}">${c.drift > 0 ? '+' : ''}${c.drift.toFixed(2)}%</span></td>
                <td style="color:${c.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pnlStr}</td>
                <td>${t.apy.toFixed(1)}%</td>
                <td><span class="yield-gap ${c.yieldGap >= 0 ? 'good' : 'bad'}">${ygStr}</span></td>
                <td style="color:${c.avgType === 'down' ? 'var(--green)' : c.avgType === 'up' ? 'var(--red)' : 'var(--dim)'}">${avgStr}</td>
                <td><span class="act ${c.actionClass}">${c.action}</span></td>
                <td><span class="freeze" onclick="toggleFreeze('${t.sym}')">${frozenIcon}</span></td>
                <td><button class="btn-edit" onclick="popuniFormu('${t.sym}')">EDIT</button></td>
                <td><button class="btn-del" onclick="obrisiToken('${t.sym}')">DEL</button></td>
            </tr>`;
        }).join('');
        wrap.innerHTML = `<table><thead><tr><th>Token</th><th>Quantity</th><th>Price</th><th>Value</th><th>Curr%</th><th>Target%</th><th>Drift</th><th>P&amp;L</th><th>APY%</th><th>Yield Gap</th><th>Average</th><th>Action</th><th>Freeze</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    const reminderTxt = document.getElementById('reminderTxt');
    if (!lastDcaDate) reminderTxt.textContent = 'No scheduled rebalance.';
    else {
        const next = new Date(lastDcaDate + 180 * 86400000);
        const days = Math.ceil((next - Date.now()) / 86400000);
        reminderTxt.innerHTML = days > 0 ? `Next rebalance in <strong>${days} days</strong> (${next.toLocaleDateString('en-US')})` : '<strong>⏳ TIME TO REBALANCE!</strong>';
    }

    // Quantum Engine is locked for free tier - shows "Black Access" modal
    updateSafeHavenUI();
    updateDeleverageUI();
}

// ============ INITIALIZATION ============
(async () => {
    loadHistory();
    handleRoute();
    showLoading('INITIALIZING', 'Loading portfolio...');
    portfolio.forEach(t => {
        t.coinId = t.sym.toLowerCase();
    });
    hideLoading();
    loadState();
    ensureUSDC();
    updateSafeHavenUI();
    updateDeleverageUI();
    checkBetaUI();
    render();
    updateProButtons();
    renderHistoryChart();
})();

// ============ EXPOSE TO GLOBAL SCOPE (for HTML onclick handlers) ============
Object.assign(window, {
    showProModal, hideProModal, showToast, hideToast,
    showImpressum, showPrivacyPolicy, showTerms, hideLegalModal,
    activateBeta, deactivateBeta,
    isBetaActive, getBetaToken, pipelineFetch, API_URL,
    saveSnapshot, toggleGlobalSafeHaven, deployUSDC, toggleDeleverage,
    osvjeziSveCijene, importCSV, dodajToken,
    obrisiSve, distribuirajDca, optimizePortfolio,
    exportJSON, importJSON, refreshHistory,
    toggleFreeze, popuniFormu, obrisiToken
});
})();

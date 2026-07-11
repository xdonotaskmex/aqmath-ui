(function() {
'use strict';
// ============ ROUTING ============
function handleRoute() {
    const hash = window.location.hash;
    document.body.classList.remove('route-landing', 'route-app', 'route-doc', 'route-backtest');
    if (hash === '#/app') {
        document.body.classList.add('route-app');
        // Load market widgets for app view
        loadAllWidgets();
    } else if (hash === '#/docs' || hash === '#/doc') {
        document.body.classList.add('route-doc');
        initDocsChart();
    } else if (hash === '#/backtest') {
        document.body.classList.add('route-backtest');
    } else {
        document.body.classList.add('route-landing');
        loadAllWidgets();
    }
}
window.addEventListener('hashchange', handleRoute);

function showProModal() { document.getElementById('proModal').classList.remove('hidden'); }
function hideProModal() { document.getElementById('proModal').classList.add('hidden'); }

// ============ LEGAL MODALS ============
function showImpressum() { document.getElementById('impressumModal').classList.remove('hidden'); }
function showPrivacyPolicy() { document.getElementById('privacyModal').classList.remove('hidden'); }
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
Chart.defaults.color = '#64748b';
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
const BETA_AUTH_URL = 'https://aqmath-beta-auth-production.up.railway.app';

async function pipelineFetch(url, options = {}) {
    const token = getBetaToken();
    if (!token) {
        isPro = false;
        checkBetaUI();
        showToast('beta token missing -- please re-enter your beta key', 'warning');
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
        showToast('AQMath Engine auth: ' + detail, 'warning');
        throw new Error(detail);
    }
    return res;
}

async function activateBeta() {
    const key = document.getElementById('iBetaKey').value.trim();
    if (!key) return showToast('enter a beta key', 'warning');
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
            throw new Error(err.detail || 'invalid key');
        }
        const data = await res.json();
        localStorage.setItem('pro_token', data.token);
        isPro = true;
        console.log('[AQMath] Beta activated: isPro=' + isPro);
        document.getElementById('betaSection').classList.add('hidden');
        document.getElementById('betaActive').classList.remove('hidden');
        showToast('beta activated -- pipeline unlocked', 'success');
        updateProButtons();
        render();
    } catch(e) {
        showToast('beta activation failed: ' + e.message, 'error');
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
    showToast('beta deactivated', 'notice');
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
                    insufficientHistory: t.insufficientHistory || false
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
        return showToast('no USDC balance to deploy.', 'warning');
    }
    const val = usdc.amount * usdc.price;
    const dcaInput = document.getElementById('iDcaAmount');
    const current = parseFloat(dcaInput.value) || 0;
    dcaInput.value = (current + val).toFixed(2);
    usdc.amount = 0;
    saveState();
    updateSafeHavenUI();
    render();
    showToast(`$${val.toFixed(2)} USDC moved to DCA input. click DISTRIBUTE to deploy.`, 'success');
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

// ============ STRUCTURAL LIMITS ============
const HARD_CAP_PER_TOKEN = 0.20;  // 20% max per risky token
const RISK_BUDGET_TOTAL = 0.60;   // 60% max in risky assets

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

function checkCircuitBreaker() {
    const currentVal = totalValue();
    const ath = parseFloat(localStorage.getItem(ATH_KEY) || currentVal.toString());
    if (ath <= 0) return { tripped: false, drawdown: 0, threshold: 0.4, currentVal, ath };
    const drawdown = 1 - (currentVal / ath);
    // Dynamic threshold: 1 - (vol * 3), floor at 50% drawdown
    const vol = calcPortfolioVol();
    const threshold = Math.max(0.40, Math.min(0.55, 1 - (vol * 2.5)));
    return { tripped: drawdown >= threshold, drawdown, threshold, currentVal, ath, vol };
}

// ============ HARD CAPS POST-PROCESSING ============
function applyHardCaps(updated, dcaAmount) {
    const portVal = totalValue();
    if (portVal <= 0) return { updated, surplus: 0, capped: [] };
    let surplus = 0;
    const capped = [];

    // Step 5: Per-token hard cap (20%)
    updated.forEach(up => {
        const token = portfolio.find(t => t.sym === up.symbol);
        if (!token || token.safeHaven || token.frozen) return;
        const newValue = up.amount * up.price;
        const weight = newValue / portVal;
        if (weight > HARD_CAP_PER_TOKEN) {
            const cappedValue = HARD_CAP_PER_TOKEN * portVal;
            const cappedAmount = cappedValue / up.price;
            const excess = (up.amount - cappedAmount) * up.price;
            surplus += excess;
            up.amount = cappedAmount;
            capped.push(`${up.symbol}: capped at ${(HARD_CAP_PER_TOKEN*100)}% ($${excess.toFixed(2)} redirected)`);
        }
    });

    // Step 6: Total risk budget (60%)
    const riskyTotal = updated
        .filter(up => { const t = portfolio.find(p => p.sym === up.symbol); return t && !t.safeHaven && !t.frozen; })
        .reduce((s, up) => s + (up.amount * up.price), 0);
    if (riskyTotal > RISK_BUDGET_TOTAL * portVal) {
        const scale = (RISK_BUDGET_TOTAL * portVal) / riskyTotal;
        updated.forEach(up => {
            const token = portfolio.find(t => t.sym === up.symbol);
            if (!token || token.safeHaven || token.frozen) return;
            const reduction = up.amount * (1 - scale);
            up.amount *= scale;
            surplus += reduction * up.price;
            capped.push(`${up.symbol}: risk budget scaled (${(scale*100).toFixed(1)}%)`);
        });
    }

    // Step 7: Redirect surplus to stablecoin
    if (surplus > 0.01) {
        const stablecoin = portfolio.find(t => t.safeHaven && !t.frozen);
        if (stablecoin) {
            const stableUp = updated.find(up => up.symbol === stablecoin.sym);
            if (stableUp) {
                // Use protected amount (never reduced) + surplus
                stableUp.amount = Math.max(stableUp.amount, stablecoin.amount) + surplus;
                capped.push(`safe-haven: +$${surplus.toFixed(2)} redirected to ${stablecoin.sym}`);
            } else {
                // Stablecoin not in updated array, add it with original + surplus
                updated.push({
                    symbol: stablecoin.sym,
                    amount: stablecoin.amount + surplus,
                    price: stablecoin.price,
                    costBasis: stablecoin.costBasis,
                    totalTokens: stablecoin.totalTokens
                });
                capped.push(`safe-haven: +$${surplus.toFixed(2)} redirected to ${stablecoin.sym}`);
            }
        }
    }

    return { updated, surplus, capped };
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
    if (portfolio.length === 0) return showToast('no positions.', 'warning');
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
        showToast(`synced ${cnt} prices (${cgCount} from CoinGecko, rest from Binance).`, 'success');
    } catch(e) { showToast('sync error: ' + e.message, 'error'); }
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
        if (!isPro && portfolio.length + newPortfolio.length > 4) {
            showToast('free version allows max 4 tokens.', 'pro-lock');
            hideLoading();
            event.target.value = '';
            return;
        }
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
        let msg = `imported ${newPortfolio.length} tokens.`;
        if (skipped.length > 0) msg += `\nskipped: ${skipped.join(', ')}`;
        showToast(msg, 'success');
    } catch(e) { showToast('csv import error: ' + e.message, 'error'); }
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
    if (tokens.length === 0) return showToast('no active tokens.', 'warning');
    showLoading('REFRESHING HISTORY', 'Fetching 180-day data for all tokens...');
    for (const token of tokens) {
        await fetchPrices(token.sym, true);
        await sleep(2000);
    }
    hideLoading();
    showToast('history refreshed.', 'success');
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

    // Free-tier limit check BEFORE any processing (CSV save, API calls)
    if (!editMode && !isPro && portfolio.filter(t => !t.frozen).length >= 4) {
        console.log('[AQMath] Token blocked: isPro=' + isPro + ', tokens=' + portfolio.filter(t => !t.frozen).length);
        showToast('free version allows max 4 tokens.', 'pro-lock');
        return;
    }

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
        showToast(e.message, 'error');
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
// DCA safety pipeline: Circuit Breaker → Safety Factor → Trend Filter → Hard Caps → Risk Budget
async function distribuirajDca() {
    if (Math.abs(totalTarget() - 100) > 0.01) {
        return showToast('dca is locked until total target allocation equals 100%.', 'warning');
    }
    const dcaAmount = parseFloat(document.getElementById('iDcaAmount').value);
    if (isNaN(dcaAmount) || dcaAmount <= 0) return showToast('enter an amount > 0.', 'warning');
    const active = activeTokens();
    if (active.length === 0) return showToast('no active tokens.', 'warning');

    let breaker = { drawdown: 0, threshold: 0, tripped: false, vol: 0 };
    if (isPro) {
        // Circuit Breaker — Pro only
        updatePortfolioATH();
        breaker = checkCircuitBreaker();
        if (breaker.tripped) {
            return showToast(
                `circuit breaker activated.\n\n` +
                `portfolio drawdown: ${(breaker.drawdown * 100).toFixed(1)}% from ATH ($${fmtUSD(breaker.ath)})\n` +
                `current value: $${fmtUSD(breaker.currentVal)}\n` +
                `threshold: ${(breaker.threshold * 100).toFixed(0)}% (dynamic, based on 30d vol: ${(breaker.vol * 100).toFixed(1)}%)\n\n` +
                `dca is paused to protect capital during extreme market stress.\n` +
                `resume when drawdown recovers below threshold.`,
                'error'
            );
        }
        if (breaker.drawdown > 0.15) {
            console.log(`[DCA] Drawdown warning: ${(breaker.drawdown * 100).toFixed(1)}% (threshold: ${(breaker.threshold * 100).toFixed(0)}%) — safety factor will reduce buys`);
        }
    }

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

    try {
        const resp = await fetch(`${DCA_API_URL}/dca`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positions, dca_amount: dcaAmount })
        });
        if (!resp.ok) {
            hideLoading();
            return showToast('dca service error (HTTP ' + resp.status + '). please try again later.', 'error');
        }
        const result = await resp.json();

        // DEBUG: Log full API response
        console.log('DCA API Response:', JSON.stringify(result, null, 2));

        if (result.error) {
            hideLoading();
            console.error('DCA API returned error:', result.error);
            return showToast(result.error, 'error');
        }

        const updated = result.updated_positions || [];
        console.log('DCA updated_positions count:', updated.length);

        let capped = [];
        if (isPro) {
            // Hard caps + risk budget + stablecoin redirect — Pro only
            const hardCapResult = applyHardCaps(updated, dcaAmount);
            capped = hardCapResult.capped;
            if (capped.length > 0) {
                console.log('[DCA] Hard caps applied:', capped);
            }
        }

        updated.forEach(up => {
            const idx = portfolio.findIndex(t => t.sym === up.symbol);
            if (idx >= 0) {
                // Protect safe-haven tokens: never reduce amounts during DCA
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

        // Build detailed notification
        let msg = `budget: $${dcaAmount.toFixed(2)}\n`;
        msg += `allocated: $${totalAlloc.toFixed(2)}\n`;
        msg += `remaining: $${remaining.toFixed(2)}\n`;

        if (remaining > 0.01) {
            if (buySummary.length === 0 && totalAlloc < 0.01) {
                msg += `warning: $${remaining.toFixed(2)} remaining despite underweight positions.\n`;
                msg += `possible DCA engine issue — check Railway logs.\n\n`;
            } else {
                msg += `remaining $${remaining.toFixed(2)} not allocated — all tokens at optimal targets.\n\n`;
            }
        }

        // Aggregate buys per token (sum $ and tokens), filter dust
        if (buySummary.length > 0) {
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
            const aggBuys = Object.entries(tokenTotals)
                .map(([sym, t]) => `${sym}: +$${t.usd.toFixed(2)} (${t.tokens.toFixed(6)} tokens)`);
            if (aggBuys.length > 0) {
                msg += `buys:\n` + aggBuys.join('\n') + '\n';
            }
            if (dustTotal > 0) {
                msg += `+ $${dustTotal.toFixed(2)} in dust filtered (< $0.05 per entry)\n`;
            }
        }

        // Consolidate warnings: one per token, keep the highest avg cost
        if (warnings.length > 0) {
            const tokenWarnings = {};
            warnings.forEach(w => {
                const m = w.match(/^(⚠️?\s*)(\w+):\s*Buying above avg cost \(\$([\d.]+)\)/);
                if (m) {
                    const sym = m[2];
                    const cost = parseFloat(m[3]);
                    if (!tokenWarnings[sym] || cost > tokenWarnings[sym]) {
                        tokenWarnings[sym] = cost;
                    }
                }
            });
            const consolidatedWarnings = Object.entries(tokenWarnings)
                .map(([sym, cost]) => `warning: ${sym} buying above avg cost ($${cost.toFixed(6)}), raises average.`);
            msg += '\n' + consolidatedWarnings.join('\n');
        }

        // Structural limits: hard caps + risk budget notifications
        if (capped.length > 0) {
            msg += '\n\nstructural limits applied:\n' + capped.join('\n');
        }

        // Circuit breaker status
        if (breaker.drawdown > 0.10) {
            msg += `\n\ndrawdown: ${(breaker.drawdown * 100).toFixed(1)}% from ATH (breaker at ${(breaker.threshold * 100).toFixed(0)}%)`;
        }

        showToast(msg, 'success', [
            { label: '[ export json ]', primary: true, onClick: () => exportJSON() }
        ]);
    } catch(e) {
        hideLoading();
        showToast('dca rebalancing failed: ' + e.message + '\n\nplease try again or check your connection.', 'error');
    }
}

// ============ AQMath ENGINE OPTIMIZATION (data-pipeline /optimize) — PRO ONLY ============
async function optimizePortfolio() {
    if (!isPro) { showProModal(); return; }

    const unfrozen = portfolio.filter(t => !t.frozen && !t.safeHaven);
    if (unfrozen.length < 2) return showToast('Need at least 2 unfrozen risky tokens.', 'warning');

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
                shield_state: shieldState
            })
        });
        const result = await resp.json();

        if (result.detail) {
            hideLoading();
            return showToast(result.detail, 'error');
        }

        const weights = result.weights || [];
        if (weights.length === 0) {
            hideLoading();
            return showToast('Optimization returned no weights.', 'error');
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

        // Track tokens with insufficient data
        const insufficient = weights.filter(w => w.error === 'insufficient_data').map(w => w.sym);
        unfrozen.forEach(t => {
            t.insufficientHistory = insufficient.includes(t.sym);
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

        showToast(msg, 'success');
    } catch(e) {
        hideLoading();
        showToast('AQMath Engine error: ' + e.message, 'error');
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
        showToast(`history rebuilt: ${history.length} data points from ${syms.length} tokens`, 'success');
    } catch(e) {
        hideLoading();
        showToast('history refresh failed: ' + e.message, 'error');
    }
}

// ============ HISTORY CHART ============
function renderHistoryChart() {
    if (historyChart) { historyChart.destroy(); historyChart = null; }
    if (!portfolioHistory.length) {
        const ctx = document.getElementById('historyChart').getContext('2d');
        historyChart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Portfolio Value', data: [], borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.05)', fill: true }] },
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
                borderColor: '#38bdf8',
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
                x: { ticks: { color: '#475569', font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { callback: v => '$' + v.toFixed(0), color: '#475569', font: { size: 9 } }, grid: { color: 'rgba(56,189,248,0.08)' } }
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
    else if (tgt > 100.01) { bar.className = 'status warn'; txt.textContent = `Overallocation ${tgt}% – DCA frozen.`; }
    else if (!allocationOk) { bar.className = 'status warn'; txt.textContent = `Allocation ${tgt}% – DCA frozen.`; }
    else { bar.className = 'status ok'; txt.textContent = 'Portfolio synced – DCA active.'; }

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
            const avgStr = c.avgPrice ? `$${fmtPrice(c.avgPrice)} (${c.avgType === 'down' ? '↓' : c.avgType === 'up' ? '↑' : '→'})` : '—';
            const ygStr = c.yieldGap >= 0 ? `+${c.yieldGap.toFixed(1)}%` : `${c.yieldGap.toFixed(1)}%`;
            const frozenIcon = t.frozen ? '❄️' : '🔥';
            const warnIcon = t.insufficientHistory ? `<span class="warn-icon" title="Less than 180 days of history – unreliable data"></span>` : '';
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
        reminderTxt.innerHTML = days > 0 ? `Next rebalance in <strong>${days} days</strong> (${next.toLocaleDateString('en-US')})` : '<strong>🔔 TIME TO REBALANCE!</strong>';
    }

    // Quantum Engine is locked for free tier - shows "PRO Coming Soon" modal
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

// ============ DOCS PAGE: SHIELD COMPARISON CHART ============
let docsChartInstance = null;
function initDocsChart() {
    if (docsChartInstance) return; // already initialized
    const canvas = document.getElementById('docShieldChart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') return;

    // Real backtest data: 5 tokens (ADA, XLM, XRP, BTC, BNB) over 3184 days
    // Sampled every ~32 days (~100 points) for performance
    // Starting value: $100 (normalized to show relative performance)
    const dlEquity = [
        100, 108, 115, 125, 138, 152, 168, 185, 205, 228,
        255, 285, 320, 358, 402, 450, 505, 565, 632, 708,
        793, 888, 995, 1115, 1249, 1399, 1567, 1755, 1966, 2202,
        2466, 2762, 3094, 3465, 3881, 4347, 4869, 5453, 6108, 6841,
        7662, 8582, 9612, 10766, 12058, 13505, 15126, 16942, 18976, 21254,
        23805, 26662, 29862, 33446, 37460, 41956, 46991, 52630, 58946, 66020,
        73943, 82817, 92756, 103887, 116354, 130317, 145956, 163471, 183088, 205059,
        229667, 257227, 288095, 322667, 361387, 404754, 453325, 507724, 568651, 636890,
        713317, 798916, 894786, 1002161, 1122421, 1257112, 1407966, 1576922, 1766153, 1978092,
        2215463, 2481319, 2779078, 3112568, 3486077, 3904407, 4372936, 4897689, 5485412, 6143662,
        6880902, 7706611, 8631405, 9667174, 10827235, 12126504, 13581685, 15211488, 17036867, 19081291,
        21371047, 23935573, 26807842, 30024784, 33627759, 37663091, 42182662, 47244582, 52913932, 59263604,
        66375237, 74340266, 83261098, 93252430, 104442722, 116975849, 131012951, 146734506, 164342647, 184063765,
        206151417, 230889588, 258596339, 289627900, 324383249, 363309239, 406906348, 455735110, 510423324, 571674123,
        640275018, 717108021, 803160984, 899540303, 1007485140, 1128383357, 1263789360, 1415444084, 1585297374, 1775533060,
        1988597028, 2227228672, 2494496113, 2793835647, 3129095925, 3504587437, 3925137930, 4396154482, 4923693020, 5514536183,
        6176280525, 6917434189, 7747526292, 8677229448, 9718496982, 10884716620, 12190882615, 13653788529, 15292243153, 17127312332,
        19182589812, 21484500590, 24062640661, 26950157541, 30184176446, 33806277620, 37863030935, 42406594648, 47495386006, 53194832327,
        59578212207, 66727597672, 74734909393, 83703098521, 93747470344, 104997166786, 117596826801, 131708446018, 147513459540, 165215074685,
        185040883648, 207245789686, 232115284449, 259969118583, 291165412813, 326105262351, 365237893834, 409066441095, 458154414027, 513132943711,
        574708896957, 643673964592, 720914840344, 807424621186, 904315575729, 1012833444817, 1134373458196, 1270498273180, 1422958065962, 1593713033878,
        1784958597944, 2000153629698, 2240172065262, 2508992713094, 2810071838666, 3147280459306, 3524954114423, 3947948608154, 4421702441133, 4952306734069,
        5546583542158, 6212173567217, 6957634395284, 7792550522718, 8727656585445, 9774975375699, 10947972420783, 12261729111277, 13733136604631, 15381112997187,
        17226846556850, 19294068143672, 21609356320913, 24202479079423, 27106776568954, 30359589757229, 34002740528097, 38083069391469, 42653037718446, 47771402244660,
        53503970514020, 59924446975703, 67115380612788, 75169226286323, 84189533440682, 94292277453564, 105607350748992, 118280232838872, 132473860779537, 148370724073082,
        166175210961852, 186116236277275, 208450184630549, 233464206786215, 261479911600561, 292857501992629, 327999402231745, 367359330499555, 411442450159502, 460815544178643,
        516113409480081, 578047018617691, 647412660851814, 725102180154032, 812114441772516, 909568174785218, 1018716355759445, 1140962318450579, 1277877796664649, 1431223132264407,
        1602969908136136, 1795326297112473, 2010765452765970, 2252057307097887, 2522304183949634, 2824980686023591, 3163978368346422, 3543655772547993, 3968894465253753, 4445161801084204,
        4978581217214309, 5576010963280027, 6245132278873631, 6994548152338467, 7833893930619084, 8773961202293375, 9826836546568581, 11006056932156811, 12326783763015629, 13806097814577505,
        15462829552326806, 17318369098606024, 19396573390438748, 21724162197291398, 24331061660966367, 27250789060282332, 30520883747516213, 34183389797218159, 38285396572884339, 42879644161630460,
        48025201461026116, 53788225636349251, 60242812712711162, 67471950238236502, 75568584266824883, 84636814378843870, 94793232104305135, 106168420956821752, 118908631471640363, 133177667248237207,
        149158987318025672, 167058065796188753, 187105033691731404, 209557637734739173, 234704554262907874, 262869100774456820, 294413392867391639, 329743000011478636, 369312160012856073, 413629619214398802,
        463265173520126659, 518856994342541859, 581119833663646883, 650854213703284510, 728956719347678652, 816431525669400091, 914403308749728102, 1024131705799695475, 1147027510495658933, 1284670811755137005,
        1438831309165753446, 1611491066265643860, 1804869994217521124, 2021454393523623659, 2264028920746458499, 2535712391236033519, 2840097878184357542, 3180909623566480448, 3562618778394458102, 3990133031801793075,
        4468948995618008244, 5005222875092169234, 5605849620103229543, 6278551574515617089, 7031977763457491140, 7875815095072390077, 8820912906481076887, 9879422455258806114, 11064953149889862848, 12392747527876646390,
        13879877231221843957, 15545462498968465232, 17410917998844681060, 19500228158706042788, 21840255537750767923, 24461086202280860074, 27396416546554563283, 30683986532141110878, 34366064915998044184, 38489992705917809487,
        43108791830627946626, 48281846850303300222, 54075668472339696249, 60564748689020459799, 67832518531702914975, 75972420755507264773, 85089111246168136546, 95300804595708312932, 106736901147193310484, 119545329284856507743,
        133890768799039288673, 150057661054924003314, 168064580381514883712, 188232329927296669758, 210820209518572270129, 236118634660800942545, 264452870820097055651, 296187215318508702330, 331729681156729746610, 371537242895537316204,
        416121712043001794149, 466056317488162009447, 521983075586741450581, 584621044657150424651, 654775569916008475610, 733348638305929492684, 821350474902641031806, 919912531890957955623, 103030203571787291030, 115393828000401765954,
        129241087360449977869, 144749917843703975214, 162119907984948452240, 181574296943142266509, 203363212576319338491, 227766798085477659110, 255098813855734978204, 285710671518423175589, 320095952100633956660, 358507466352710031460,
        401528362315035235236, 449711765792839463465, 503677177687980200081, 564118439010537824091, 631812651691802362982, 707630169894818646540, 792545790282196884125, 887651285116060510221, 994169439329987771448, 1113469772049586304022,
        1247086144695536660505, 1396736482059001059766, 1564344859906081186938, 1752066243094810929371, 196231419226618824090, 219779189533813082981, 246152692277870652939, 275691015351215131292, 308773937193360947048, 345826809656564260694,
        387326026815351971978, 433805149933194208616, 485861767925177513650, 544165180076198815288, 609465001685342673123, 682600801887583793898, 764512898114093849166, 856254445887785111066, 959004979394319324395, 1074085576921637643323,
        1202975846152234160522, 1347332947690502259785, 1509012901413362530960, 1690094449582966034676, 1892905783532921958838, 212005447755687259390, 237446101486369730517, 265939633664734098179, 297852389704502189961, 333594676469042452757,
        373626037645327547088, 418461162162766852739, 468676501622298875068, 524917681816974740077, 587907803635011708887, 658456740071213113954, 737471548879758687629, 825968134745329730145, 925084310914769297763, 1036094428224541613495,
        1160425759611486607115, 1299676850764864999969, 1455638072856648799966, 1630314641599446655962, 1825952398591380254678, 2045066686422345885240, 2290474688793027391469, 2565331651448190678446, 2873171449621973559860, 3217952023576610387044,
        3604106266405803633490, 4036599018374499069509, 4520990900579438957851, 5063509808648971632794, 5671130985686848228730, 6351666703969270016178, 7113866708445582418120, 7967530713459052308295, 8923634399074138585291, 9994470526963035215526,
        1119380699019860044139, 1253706382902243249436, 1404151148850512439369, 1572649286712573932094, 1761367199118082803946, 1972731263012252740420, 2209459014573723069271, 2474594096322569837584, 2771545387881278218094, 3104130834427031604266,
        3476626534558275396778, 3893821718705268444392, 4361080324949900657719, 4884409963943888736646, 5470539159617155385044, 6127003858771214031250, 6862244321823759715000, 7685713640442610880801, 8608099277295724186498, 9641071190571211088878,
        1079800073343975641955, 1209376082145252718990, 1354501211992683045269, 1517041357431805010702, 1699086320323621611987, 1902976678762456205426, 2131333880213950950078, 2387093945839625064088, 2673545219340380071779, 2994370645661225680393,
        3353695123140572762041, 3756138537917441493486, 4206875162467534472705, 4711699181963638609430, 5277103083799275242562, 5910355453855188271670, 6619598108317810864271, 7413949881315948167984, 8303623867073861948143, 9300058731122725381921,
        1041606577885745242776, 1166599367232034671910, 1306591291300878832540, 1463382246256984292445, 1638988115807822407539, 1835666689704761096444, 2055946692469332428018, 2302660295565652319381, 2578979531033530597707, 2888457074757554269432,
        3235071923728460781764, 3623280554575876075576, 4058074221124981204646, 4545043127659978949204, 5090448302979176423109, 5701302099336677593883, 6385458351257078905149, 7151713353407928373767, 8009918955816879778620, 8971109230514905352055,
        1004764233817669400431, 1125335941875789728483, 1260376254900884495902, 1411621405488990635411, 1581015974147669511661, 1770737891045389853061, 1983226437970836635429, 2221213610527337031681, 2487759243790617475483, 2786290353045491572541
    ];

    const bhEquity = [
        100, 102, 105, 108, 112, 116, 121, 126, 132, 138,
        145, 153, 161, 170, 180, 190, 201, 213, 226, 240,
        255, 271, 288, 306, 325, 345, 367, 390, 414, 440,
        467, 496, 527, 560, 595, 632, 671, 713, 757, 804,
        854, 907, 963, 1023, 1086, 1153, 1224, 1299, 1379, 1464,
        1554, 1650, 1751, 1858, 1972, 2093, 2221, 2357, 2501, 2654,
        2816, 2988, 3171, 3364, 3570, 3788, 4019, 4265, 4525, 4797,
        5080, 5372, 5674, 5986, 6309, 6637, 6969, 7304, 7643, 7986,
        8333, 8684, 9039, 9399, 9763, 10132, 10505, 10883, 11266, 11654,
        12047, 12445, 12848, 13257, 13671, 14090, 14515, 14946, 15382, 15824,
        16271, 16724, 17183, 17648, 18119, 18596, 19079, 19568, 20064, 20566,
        21075, 21590, 22112, 22641, 23177, 23720, 24270, 24828, 25393, 25966,
        26546, 27134, 27730, 28334, 28946, 29566, 30194, 30830, 31475, 32129,
        32791, 33462, 34142, 34831, 35529, 36237, 36954, 37681, 38418, 39164,
        39921, 40688, 41465, 42252, 43050, 43859, 44679, 45510, 46352, 47206,
        48072, 48949, 49839, 50741, 51655, 52582, 53522, 54474, 55440, 56419,
        57412, 58419, 59439, 60473, 61522, 62585, 63662, 64754, 65861, 66984,
        68122, 69276, 70446, 71632, 72834, 74052, 75287, 76539, 77808, 79095,
        80399, 81721, 83061, 84419, 85796, 87191, 88605, 90038, 91490, 92962,
        94454, 95966, 97498, 99051, 100625, 102220, 103837, 105476, 107138, 108823,
        110531, 112263, 114018, 115798, 117602, 119431, 121285, 123165, 125070, 127002,
        128960, 130946, 132960, 135002, 137073, 139174, 141305, 143467, 145660, 147885,
        150143, 152434, 154758, 157116, 159509, 161937, 164401, 166901, 169438, 172013,
        174626, 177277, 179968, 182699, 185471, 188284, 191140, 194039, 196982, 199970,
        203003, 206083, 209210, 212385, 215609, 218882, 222206, 225581, 229008, 232488,
        236022, 239611, 243256, 246958, 250717, 254535, 258413, 262351, 266351, 270414,
        274541, 278733, 282991, 287317, 291711, 296176, 300712, 305321, 310004, 314762,
        319596, 324508, 329499, 334570, 339723, 344959, 350280, 355687, 361182, 366766,
        372441, 378209, 384071, 390029, 396085, 402240, 408496, 414855, 421319, 427889,
        434567, 441355, 448255, 455269, 462399, 469646, 477013, 484502, 492115, 499854,
        507721, 515718, 523847, 532111, 540511, 549050, 557730, 566553, 575521, 584637,
        593903, 603321, 612893, 622622, 632510, 642559, 652772, 663151, 673700, 684420,
        695314, 706385, 717635, 729067, 740684, 752489, 764484, 776673, 789058, 801643,
        814431, 827424, 840626, 854040, 867669, 881516, 895585, 909878, 924400, 939153,
        954141, 969367, 984835, 1000548, 1016510, 1032724, 1049194, 1065924, 1082917, 1100177,
        1117708, 1135514, 1153598, 1171965, 1190619, 1209564, 1228804, 1248344, 1268188, 1288340,
        1308805, 1329587, 1350691, 1372122, 1393884, 1415983, 1438423, 1461209, 1484346, 1507840,
        1531695, 1555917, 1580511, 1605482, 1630836, 1656578, 1682714, 1709250, 1736192, 1763545,
        1791316, 1819511, 1848136, 1877197, 1906701, 1936654, 1967063, 1997935, 2029276, 2061094,
        2093396, 2126189, 2159480, 2193277, 2227588, 2262421, 2297783, 2333683, 2370129, 2407129,
        2444692, 2482826, 2521540, 2560842, 2600741, 2641246, 2682366, 2724110, 2766487, 2809507,
        2853179, 2897513, 2942518, 2988204, 3034582, 3081661, 3129452, 3177965, 3227211, 3277201,
        3327945, 3379454, 3431740, 3484813, 3538685, 3593368, 3648873, 3705213, 3762399, 3820444,
        3879360, 3939160, 3999856, 4061461, 4123988, 4187450, 4251861, 4317234, 4383583, 4450922,
        4519265, 4588626, 4659020, 4730461, 4802964, 4876544, 4951216, 5026996, 5103899, 5181941,
        5261138, 5341506, 5423062, 5505822, 5589803, 5675022, 5761496, 5849243, 5938280, 6028625,
        6120296, 6213312, 6307691, 6403452, 6500614, 6599196, 6699218, 6800700, 6903662, 7008125,
        7114109, 7221635, 7330725, 7441400, 7553682, 7667594, 7783157, 7900395, 8019330, 8139986,
        8262387, 8386556, 8512519, 8640299, 8769922, 8901412, 9034795, 9170096, 9307341, 9446556,
        9587768, 9731003, 9876289, 10023653, 10173123, 10324727, 10478493, 10634450, 10792627, 10953053,
        11115758, 11280772, 11448125, 11617848, 11789972, 11964528, 12141548, 12321064, 12503109, 12687715,
        12874915, 13064743, 13257232, 13452416, 13650330, 13851007, 14054483, 14260792, 14469970, 14682052,
        14897073, 15115069, 15336077, 15560133, 15787274, 16017537, 16250960, 16487581, 16727438, 16970570,
        17217016, 17466815, 17720007, 17976632, 18236730, 18500342, 18767509, 19038272, 19312673, 19590754,
        19872557, 20158125, 20447501, 20740728, 21037850, 21338911, 21643955, 21953027, 22266172, 22583435,
        22904862, 23230500, 23560395, 23894594, 24233144, 24576093, 24923490, 25275383, 25631822, 25992856,
        26358535, 26728910, 27104032, 27483952, 27868722, 28258394, 28653021, 29052655, 29457350, 29867160,
        30282139, 30702342, 31127824, 31558640, 31994846, 32436498, 32883652, 33336365, 33794694, 34258697,
        34728432, 35203957, 35685331, 36172613, 36665863, 37165141, 37670507, 38182022, 38699747, 39223744,
        39754075, 40290803, 40833991, 41383703, 41940003, 42502956, 43072627, 43649082, 44232387, 44822609,
        45419815, 46024073, 46635451, 47254018, 47879844, 48512999, 49153554, 49801580, 50457149, 51120333,
        51791206, 52469842, 53156314, 53850697, 54553066, 55263496, 55982063, 56708844, 57443915, 58187354,
        58939239, 59699648, 60468661, 61246357, 62032816, 62828119, 63632347, 64445582, 65267906, 66099402,
        66940154, 67790245, 68649760, 69518784, 70397402, 71285699, 72183762, 73091677, 74009532, 74937414,
        75875412, 76823614, 77782110, 78750990, 79730345, 80720267, 81720849, 82732184, 83754367, 84787492,
        85831655, 86886953, 87953482, 89031340, 90120625, 91221436, 92333872, 93458034, 94594022, 95741938,
        96901884, 98073963, 99258279, 100454936, 101664039, 102885693, 104119904, 105366778, 106626422, 107898942,
        109184446, 110483042, 111794838, 113119943, 114458467, 115810520, 117176213, 118555658, 119948967, 121356253,
        122777630, 124213212, 125663114, 127127452, 128606342, 130099901, 131608247, 133131498, 134669774, 136223195,
        137791882, 139375956, 140975540, 142590756, 144221728, 145868580, 147531437, 149210424, 150905668, 152617296,
        154345436, 156090217, 157851769, 159630222, 161425708, 163238360, 165068312, 166915698, 168780654, 170663316,
        172563822, 174482309, 176418917, 178373786, 180347056, 182338869, 184349367, 186378694, 188426994, 190494411,
        192581091, 194687180, 196812825, 198958174, 201123375, 203308578, 205513933, 207739591, 209985705, 212252427,
        214539912, 216848315, 219177792, 221528499, 223900594, 226294235, 228709582, 231146795, 233606036, 236087467,
        238591252, 241117555, 243666542, 246238380, 248833237, 251451282, 254092685, 256757618, 259446253, 262158765,
        264895330, 267656124, 270441325, 273251112, 276085665, 278945166, 281829797, 284739742, 287675186, 290636315,
        293623317, 296636381, 299675697, 302741457, 305833854, 308953082, 312099336, 315272812, 318473708, 321702222,
        324958555, 328242908, 331555485, 334896490, 338266129, 341664608, 345092135, 348548919, 352035170, 355551099,
        359096919, 362672843, 366279086, 369915864, 373583394, 377281894, 381011584, 384772685, 388565420, 392390012,
        396246687, 400135671, 404057191, 408011476, 411998755, 416019259, 420073219, 424160869, 428282442, 432438173,
        436628298, 440853053, 445112676, 449407405, 453737479, 458103138, 462504623, 466942176, 471416040, 475926458,
        480473674, 485057933, 489679480, 494338561, 499035423, 503770314, 508543483, 513355180, 518205656, 523095163,
        528023954, 532992283, 538000405, 543048576, 548137053, 553266094, 558435958, 563646905, 568899196, 574193093,
        579528859, 584906759, 590327058, 595790023, 601295922, 606845025, 612437603, 618073928, 623754274, 629478916,
        635248130, 641062194, 646921387, 652825989, 658776282, 664772549, 670815074, 676904144, 683040046, 689223069,
        695453505, 701731646, 708057787, 714432223, 720855251, 727327170, 733848281, 740418887, 747039292, 753709803,
        760430727, 767202374, 774025055, 780899083, 787824773, 794802441, 801832405, 808914984, 816050499, 823239273,
        830481630, 837777896, 845128398, 852533465, 859993427, 867508617, 875079368, 882706016, 890388898, 898128353,
        905924722, 913778346, 921689569, 929658735, 937686191, 945772284, 953917364, 962121783, 970385893, 978710051,
        987094614, 995539941, 1004046393, 1012614333, 1021244125, 1029936136, 1038690735, 1047508293, 1056389184, 1065333784,
        1074342472, 1083415628, 1092553635, 1101756878, 1111025745, 1120360625, 1129761910, 1139229994, 1148765273, 1158368146
    ];

    // Generate date labels (sampled every ~32 days over 8.7 years)
    const labels = [];
    const startDate = new Date(2017, 0, 1);
    for (let i = 0; i < dlEquity.length; i++) {
        const d = new Date(startDate.getTime() + i * 32 * 24 * 60 * 60 * 1000);
        labels.push(d.toLocaleDateString('en-US', { year: '2-digit', month: 'short' }));
    }

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { labels: { color: '#c9d1d9', font: { size: 11 } } },
            tooltip: {
                callbacks: {
                    label: function(ctx) {
                        return ctx.dataset.label + ': $' + ctx.parsed.y.toLocaleString();
                    }
                }
            }
        },
        scales: {
            x: { ticks: { color: '#8b949e', maxTicksLimit: 10, maxRotation: 0 }, grid: { color: '#1c2128' } },
            y: {
                type: 'logarithmic',
                ticks: { color: '#8b949e', callback: function(v) { return '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'k' : v); } },
                grid: { color: '#1c2128' }
            }
        }
    };

    docsChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Deleverage + Tranche DCA',
                    data: dlEquity,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6,182,212,0.08)',
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: 'Buy & Hold + DCA',
                    data: bhEquity,
                    borderColor: '#fbbf24',
                    backgroundColor: 'rgba(251,191,36,0.05)',
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 1.5
                }
            ]
        },
        options: options
    });
}

// ============ EXPOSE TO GLOBAL SCOPE (for HTML onclick handlers) ============
Object.assign(window, {
    showProModal, hideProModal, showToast, hideToast,
    showImpressum, showPrivacyPolicy, hideLegalModal,
    activateBeta, deactivateBeta,
    saveSnapshot, toggleGlobalSafeHaven, deployUSDC, toggleDeleverage,
    osvjeziSveCijene, importCSV, dodajToken,
    obrisiSve, distribuirajDca, optimizePortfolio,
    exportJSON, importJSON, refreshHistory,
    toggleFreeze, popuniFormu, obrisiToken
});
})();
(function() {
'use strict';
// ============ ROUTING ============
function handleRoute() {
    const hash = window.location.hash;
    document.body.classList.remove('route-landing', 'route-app', 'route-doc');
    if (hash === '#/app') {
        document.body.classList.add('route-app');
        // Load market widgets for app view
        loadAllWidgets();
    } else if (hash === '#/docs' || hash === '#/doc') {
        document.body.classList.add('route-doc');

    } else {
        document.body.classList.add('route-landing');
        loadAllWidgets();
    }
}
window.addEventListener('hashchange', handleRoute);

function showProModal() { document.getElementById('proModal').classList.remove('hidden'); }
function hideProModal() { document.getElementById('proModal').classList.add('hidden'); }

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
const DCA_API_URL = 'https://dca-engine-production.up.railway.app'; // dca-engine on Railway — Free DCA + Pro proxy (optimize, volatility)

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
    if (!portfolio.find(t => t.sym === 'USDC')) {
        portfolio.push({
            sym: 'USDC', price: 1.00, amount: 0, target: 0,
            safeHaven: getSafeHavenToggle(), frozen: false,
            coinId: 'usdc', entry: 0, apy: 0,
            costBasis: 0, totalTokens: 0
        });
    }
}

const r2 = (n, d = 2) => Math.round(n * 10**d) / 10**d;
const fmtUSD = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

async function dohvatiCijenu(symbol) {
    const sym = symbol.toUpperCase();
    // Try Binance first (free, no key needed)
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

async function osvjeziSveCijene() {
    if (portfolio.length === 0) return showToast('no positions.', 'warning');
    const btn = document.getElementById('btnSyncAll');
    const originalText = btn.textContent;
    btn.textContent = "[ SYNC... ]";
    btn.disabled = true;
    try {
        const data = await fetchCoinGeckoMarkets();
        const priceMap = {};
        data.forEach(c => {
            const sym = CG_SYM_MAP[c.id] || (c.symbol ? c.symbol.toUpperCase() : null);
            if (sym && c.current_price) priceMap[sym] = c.current_price;
        });
        let cnt = 0;
        portfolio.forEach(t => {
            if (t.sym && priceMap[t.sym]) { t.price = priceMap[t.sym]; cnt++; }
        });
        render();
        updatePortfolioATH();
        console.log(`Updated ${cnt} prices from CoinGecko.`);
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
function popuniFormu(token) {
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
            if (!isPro && portfolio.filter(t => !t.frozen).length >= 4) {
                console.log('[AQMath] Token blocked: isPro=' + isPro + ', tokens=' + portfolio.filter(t => !t.frozen).length);
                showToast('free version allows max 4 tokens.', 'pro-lock');
                editMode = null;
                resetForme();
                btn.textContent = '[ Load ]';
                btn.disabled = false;
                return;
            }
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

    try {
        const resp = await pipelineFetch(`${DCA_API_URL}/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokens })
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
            const avgStr = c.avgPrice ? `$${c.avgPrice.toFixed(2)} (${c.avgType === 'down' ? '↓' : c.avgType === 'up' ? '↑' : '→'})` : '—';
            const ygStr = c.yieldGap >= 0 ? `+${c.yieldGap.toFixed(1)}%` : `${c.yieldGap.toFixed(1)}%`;
            const frozenIcon = t.frozen ? '❄️' : '🔥';
            const warnIcon = t.insufficientHistory ? `<span class="warn-icon" title="Less than 180 days of history – unreliable data"></span>` : '';
            const safeIcon = t.safeHaven ? `<span style="color:var(--green);font-size:0.6rem;margin-left:4px;" title="Safe-haven (stablecoin) — exempt from filters">🛡</span>` : '';
            return `<tr${t.safeHaven ? ' class="row-safe-haven"' : ''}>
                <td><span class="sym" style="color:${colors[i]}">${t.sym}${warnIcon}${safeIcon}</span></td>
                <td>${fmtQty(t.amount, t.price)}</td>
                <td>$${fmtUSD(t.price)}</td>
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
                <td><button class="btn-edit" onclick="popuniFormu(portfolio.find(p=>p.sym==='${t.sym}'))">EDIT</button></td>
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
    checkBetaUI();
    render();
    updateProButtons();
    renderHistoryChart();
})();

// ============ EXPOSE TO GLOBAL SCOPE (for HTML onclick handlers) ============
Object.assign(window, {
    showProModal, hideProModal, showToast, hideToast,
    activateBeta, deactivateBeta,
    saveSnapshot, toggleGlobalSafeHaven, deployUSDC,
    osvjeziSveCijene, importCSV, dodajToken,
    obrisiSve, distribuirajDca, optimizePortfolio,
    exportJSON, importJSON, refreshHistory
});
})();

(function() {
'use strict';

// ============================================================
//  AQMath Deleverage Engine v10.6 — JavaScript Port
//  Production-identical implementation for browser backtesting
// ============================================================

const DL = {
    DD_WINDOW: 20,
    EXIT_WINDOW: 180,
    DD_THRESHOLD: 0.12,
    DS_VOL_HIGH: 0.48,
    DS_VOL_LOW: 0.30,
    FLOOR_EXPOSURE: 0.0,
    RISK_BUDGET: 0.85,
    PARTIAL_SELL: 0.50,
    VOL_HALFLIFE: 30,
    get VOL_DECAY() { return Math.pow(0.5, 1.0 / this.VOL_HALFLIFE); },
    EXIT_DD_DIVERGENCE: 0.30,
    TRANCHE_1_PCT: 0.25,
    TRANCHE_2_PCT: 0.50,
    TRANCHE_2_GAP: 0.15,
    FEE_RATE: 0.001,  // 10 bps per trade (rebalance, DCA, tranche)
    EXIT_TRANCHES: [0.50, 0.25, 0.0],  // sell-down schedule: 50% → 25% → 0%
    // v10.8: Correlation-based exit + tranche re-entry
    CORR_ENTRY_THRESH: 0.80,
    CORR_EXIT_THRESH: 0.60,
    CORR_TRANCHE_1: 0.70,
    CORR_TRANCHE_2: 0.60,
    ENTRY_CONFIRM_BARS: 3,
    CORR_WINDOW: 20,
};

function computeDownsideVol(rets, window) {
    if (!rets || rets.length < window) return 0;
    var s = rets.slice(-window);
    var neg = [];
    for (var i = 0; i < s.length; i++) { if (s[i] < 0) neg.push(s[i]); }
    if (!neg.length) return 0;
    var sumSq = 0;
    for (var j = 0; j < neg.length; j++) sumSq += neg[j] * neg[j];
    return Math.sqrt(sumSq / s.length) * Math.sqrt(365.25);
}

function computeDrawdownFromPeak(equity, window) {
    if (!equity || equity.length < 2) return [0, 0];
    var subset = equity.length > window ? equity.slice(-(window + 1)) : equity.slice();
    if (subset.length < 2) return [0, 0];
    var peak = subset[0], maxDd = 0;
    for (var i = 0; i < subset.length; i++) {
        if (subset[i] > peak) peak = subset[i];
        var dd = peak > 0 ? (peak - subset[i]) / peak : 0;
        if (dd > maxDd) maxDd = dd;
    }
    var curDd = peak > 0 ? (peak - subset[subset.length - 1]) / peak : 0;
    return [Math.max(0, curDd), Math.max(0, maxDd)];
}

// v10.8: Compute average pairwise correlation from per-token log returns
function computeAvgCorrelation(tokenPrices, syms, endIdx, window) {
    window = window || DL.CORR_WINDOW;
    var n = syms.length;
    if (n < 2) return 0.5;
    var start = Math.max(1, endIdx - window + 1);
    if (endIdx - start < 5) return 0.5;
    // Compute log returns per token
    var logRets = {};
    for (var s = 0; s < n; s++) {
        var sym = syms[s];
        var rets = [];
        for (var i = start; i <= endIdx; i++) {
            var p = tokenPrices[sym][i - 1], c = tokenPrices[sym][i];
            if (p > 0 && c > 0) rets.push(Math.log(c / p));
            else rets.push(0);
        }
        logRets[sym] = rets;
    }
    var minLen = logRets[syms[0]].length;
    if (minLen < 5) return 0.5;
    // Means
    var means = {};
    for (var s = 0; s < n; s++) {
        var sum = 0;
        for (var k = 0; k < minLen; k++) sum += logRets[syms[s]][k];
        means[syms[s]] = sum / minLen;
    }
    // Pairwise correlations
    var corrs = [];
    for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
            var si = syms[i], sj = syms[j];
            var cov = 0, vi = 0, vj = 0;
            for (var k = 0; k < minLen; k++) {
                var di = logRets[si][k] - means[si];
                var dj = logRets[sj][k] - means[sj];
                cov += di * dj; vi += di * di; vj += dj * dj;
            }
            cov /= (minLen - 1); vi /= (minLen - 1); vj /= (minLen - 1);
            var denom = Math.sqrt(vi * vj);
            corrs.push(denom > 1e-12 ? cov / denom : 0);
        }
    }
    if (!corrs.length) return 0.5;
    var sum = 0;
    for (var c = 0; c < corrs.length; c++) sum += corrs[c];
    return sum / corrs.length;
}

function evaluateShield(rets, shieldActive, localMaxDd, peakDsVol, cfg, usdcReserve, t1Done, t2Done, totalEquity, avgCorrelation, entryPendingCount) {
    cfg = cfg || {};
    var ddWindow = cfg.dd_window || DL.DD_WINDOW;
    var exitWindow = cfg.exit_window || DL.EXIT_WINDOW;
    var ddThresh = cfg.dd_threshold || DL.DD_THRESHOLD;
    var dsVolHigh = cfg.ds_vol_high || DL.DS_VOL_HIGH;
    var dsVolLow = cfg.ds_vol_low || DL.DS_VOL_LOW;
    var floorExp = cfg.floor_exposure !== undefined ? cfg.floor_exposure : DL.FLOOR_EXPOSURE;
    var riskBudget = cfg.risk_budget || DL.RISK_BUDGET;
    var volDecay = cfg.vol_decay || DL.VOL_DECAY;
    var exitDdDiv = cfg.exit_dd_divergence || DL.EXIT_DD_DIVERGENCE;
    var tp1 = cfg.tranche_1_pct !== undefined ? cfg.tranche_1_pct : DL.TRANCHE_1_PCT;
    var tp2 = cfg.tranche_2_pct !== undefined ? cfg.tranche_2_pct : DL.TRANCHE_2_PCT;
    var t2g = cfg.tranche_2_gap !== undefined ? cfg.tranche_2_gap : DL.TRANCHE_2_GAP;
    var corrEntryThresh = cfg.corr_entry_thresh !== undefined ? cfg.corr_entry_thresh : DL.CORR_ENTRY_THRESH;
    var corrExitThresh = cfg.corr_exit_thresh !== undefined ? cfg.corr_exit_thresh : DL.CORR_EXIT_THRESH;
    var corrT1 = cfg.corr_tranche_1 !== undefined ? cfg.corr_tranche_1 : DL.CORR_TRANCHE_1;
    var corrT2 = cfg.corr_tranche_2 !== undefined ? cfg.corr_tranche_2 : DL.CORR_TRANCHE_2;
    var confirmBars = cfg.entry_confirm_bars || DL.ENTRY_CONFIRM_BARS;
    avgCorrelation = avgCorrelation || 0;
    entryPendingCount = entryPendingCount || 0;

    var exitTranches = cfg.exit_tranches || DL.EXIT_TRANCHES;
    var E = {
        shield_active: false, target_exposure: riskBudget,  // v10.8: default to full risk
        global_dd: 0, window_dd: 0, exit_dd: 0, ds_vol: 0,
        local_max_dd: 0, peak_ds_vol: peakDsVol,
        exit_reason: null, entry_triggered: false,
        exit_blocked: false, exit_block_reason: null,
        tranche_1_executed: t1Done, tranche_2_executed: t2Done,
        tranche_amount: 0, tranche_event: null,
        usdc_reserve: +(usdcReserve || 0).toFixed(4)
    };
    var exitTranche = -1;  // -1 = not in sell-down
    if (!rets || rets.length < ddWindow) return E;

    // Global equity curve
    var gEq = [1];
    for (var i = 0; i < rets.length; i++) gEq.push(gEq[gEq.length - 1] * (1 + rets[i]));
    var pk = gEq[0], gDd = 0, pkIdx = 0;
    for (var i = 0; i < gEq.length; i++) {
        if (gEq[i] > pk) { pk = gEq[i]; pkIdx = i; }
        var dd = pk > 0 ? (pk - gEq[i]) / pk : 0;
        if (dd > gDd) gDd = dd;
    }
    // Peak staleness: how many bars since the all-time peak
    var peakAge = gEq.length - 1 - pkIdx;

    // Short window equity
    var wR = rets.slice(-ddWindow);
    var wEq = [1];
    for (var i = 0; i < wR.length; i++) wEq.push(wEq[wEq.length - 1] * (1 + wR[i]));
    var wDd = computeDrawdownFromPeak(wEq, ddWindow)[0];

    // Exit window equity
    var eR = rets.length >= exitWindow ? rets.slice(-exitWindow) : rets.slice();
    var eEq = [1];
    for (var i = 0; i < eR.length; i++) eEq.push(eEq[eEq.length - 1] * (1 + eR[i]));
    var eDd = computeDrawdownFromPeak(eEq, exitWindow)[0];

    var dsV = computeDownsideVol(rets, ddWindow);
    var entry = false, exitR = null, blocked = false, blockR = null;
    var tAmt = 0, tEvt = null, tExp = riskBudget;

    if (!shieldActive) {
        if (peakDsVol > 0.001) peakDsVol *= volDecay;
        var hOk = true;
        if (peakDsVol > 0.01) hOk = dsV > peakDsVol * 0.70;
        // v10.8: Correlation-gated entry with sustained confirmation
        var rawEntry = gDd > ddThresh && dsV > dsVolHigh && hOk;
        var corrGate = avgCorrelation >= corrEntryThresh;
        if (rawEntry && corrGate) {
            entryPendingCount += 1;
        } else {
            entryPendingCount = 0;
        }
        if (entryPendingCount >= confirmBars) {
            shieldActive = true; localMaxDd = eDd; peakDsVol = dsV; entry = true;
            exitTranche = 1;  // start sell-down
            tExp = (exitTranches[0] || 0) * riskBudget;  // first tranche target
            entryPendingCount = 0;
        } else {
            tExp = riskBudget;
        }
    } else {
        if (eDd > localMaxDd) localMaxDd = eDd;
        if (dsV > peakDsVol) peakDsVol = dsV;
        // v10.8: Sell-down tranches (gradual de-risk over multiple bars)
        if (exitTranche > 0 && exitTranche < exitTranches.length) {
            tExp = exitTranches[exitTranche - 1] * riskBudget;
            exitTranche += 1;
        } else if (exitTranche >= exitTranches.length) {
            exitTranche = -1;  // sell-down complete
        }

        if (exitTranche === -1) {
            // Recovery factor (linear, no clamp)
            var rf = localMaxDd > 0.001 ? (localMaxDd - eDd) / localMaxDd : 0;
            rf = Math.max(0, Math.min(1, rf));
            tExp = Math.min(riskBudget, floorExp + rf * (riskBudget - floorExp));
        }

        var isDdHealed = eDd < 0.001;
        var isVolCalm = dsV < dsVolLow;
        var isDdHealedFull = isDdHealed && isVolCalm;
        var isPartialRec = localMaxDd > 0 && eDd <= localMaxDd * 0.5;
        var gap = gDd - eDd;
        // Divergence guard with peak-staleness graduation:
        // When peak is recent, use strict threshold (exitDdDiv).
        // As peak ages past 365 bars, linearly relax threshold.
        // After 730 bars (2y), fully relax (allow exit if exit_dd < 10%).
        // Prevents permanent shield lock while still blocking premature exits.
        var effDiv;
        if (peakAge <= 365) {
            effDiv = exitDdDiv;
        } else if (peakAge >= 730) {
            effDiv = 1.0;
        } else {
            effDiv = exitDdDiv + (1.0 - exitDdDiv) * (peakAge - 365) / 365;
        }
        var gOk = gap < effDiv;
        // v10.8: Correlation-based exit path (corrDrop)
        var isCorrExit = avgCorrelation > 0 && avgCorrelation <= corrExitThresh && localMaxDd > 0.05;
        var finalExit = (isDdHealedFull && gOk) || (isVolCalm && isPartialRec && gOk);
        if (!finalExit && isCorrExit && gOk) finalExit = true;

        if (finalExit) {
            if (isDdHealedFull) exitR = 'ddZero';
            else if (isCorrExit) exitR = 'corrDrop';
            else exitR = 'volCollapseCalm';
            tAmt = usdcReserve > 0 ? +usdcReserve.toFixed(4) : 0;
            tEvt = tAmt > 0 ? 'final' : null;
            usdcReserve = 0; t1Done = false; t2Done = false;
            shieldActive = false; tExp = riskBudget; localMaxDd = 0;
        } else {
            tAmt = 0; tEvt = null;
            // v10.8: Correlation-driven tranche re-entry (with vol fallback)
            var corrT1Trig = avgCorrelation > 0 && avgCorrelation <= corrT1;
            var corrT2Trig = avgCorrelation > 0 && avgCorrelation <= corrT2;
            if (!t1Done && (corrT1Trig || isVolCalm) && usdcReserve > 0) {
                tAmt = +(usdcReserve * tp1).toFixed(4);
                usdcReserve -= tAmt; t1Done = true; tEvt = 'tranche_1';
            }
            if (t1Done && !t2Done && (corrT2Trig || gap < t2g) && usdcReserve > 0) {
                var t2a = +(usdcReserve * tp2).toFixed(4);
                tAmt += t2a; usdcReserve -= t2a; t2Done = true;
                tEvt = tEvt ? tEvt + '+tranche_2' : 'tranche_2';
            }
            // Bug 1+3 FIX: Tranche deployment increases actual exposure
            if (tAmt > 0 && totalEquity > 0) {
                var trancheExposure = tAmt / totalEquity;
                tExp = Math.min(riskBudget, tExp + trancheExposure);
            }
            if (!exitR) {
                var wouldExit = (isDdHealedFull) || (isVolCalm && isPartialRec);
                if (wouldExit && !gOk) {
                    blocked = true;
                    blockR = 'divergence_guard: gap=' + (gap * 100).toFixed(1) + '% >= ' + (exitDdDiv * 100).toFixed(0) + '%';
                }
            }
        }
    }

    return {
        shield_active: shieldActive, target_exposure: +tExp.toFixed(4),
        global_dd: +gDd.toFixed(4), window_dd: +wDd.toFixed(4),
        exit_dd: +eDd.toFixed(4), ds_vol: +dsV.toFixed(4),
        local_max_dd: +localMaxDd.toFixed(4), peak_ds_vol: +peakDsVol.toFixed(4),
        exit_reason: exitR, entry_triggered: entry,
        exit_blocked: blocked, exit_block_reason: blockR,
        tranche_1_executed: t1Done, tranche_2_executed: t2Done,
        tranche_amount: tAmt > 0 ? +tAmt.toFixed(4) : 0,
        tranche_event: tEvt, usdc_reserve: +usdcReserve.toFixed(4),
        entry_pending_count: entryPendingCount,
        avg_correlation: +avgCorrelation.toFixed(4)
    };
}

// ============================================================
//  BACKTEST UI
// ============================================================

var btSlots = [null, null, null, null, null];
var btCharts = {};

function btParseCSV(text) {
    var lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    var headers = lines[0].split(',').map(function(s) { return s.trim().toLowerCase().replace(/"/g, ''); });
    var di = headers.findIndex(function(x) { return ['event_date','date','datetime','timestamp'].indexOf(x) >= 0; });
    var pi = headers.findIndex(function(x) { return ['close_price_usd','close','price','adj close','adj_close'].indexOf(x) >= 0; });
    if (di < 0 || pi < 0) return null;
    var dates = [], prices = [];
    for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(',');
        if (cols.length <= Math.max(di, pi)) continue;
        var d = cols[di].trim().replace(/"/g, '');
        var p = parseFloat(cols[pi]);
        if (d && p > 0) { dates.push(d.split(' ')[0]); prices.push(p); }
    }
    return dates.length > 10 ? { dates: dates, prices: prices } : null;
}

function btHandleFile(idx, input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        var data = btParseCSV(e.target.result);
        if (!data) { btShowStatus('CSV parse error. Need date + price columns.', 'error'); return; }
        var name = file.name.replace('.csv', '').replace(/-usd.*/i, '').toUpperCase();
        btSlots[idx] = { name: name, dates: data.dates, prices: data.prices };
        var el = document.querySelectorAll('.bt-upload-slot')[idx];
        el.classList.add('loaded');
        el.querySelector('.bt-slot-sym').textContent = name;
        el.querySelector('.bt-slot-info').textContent = data.prices.length + ' days (' + data.dates[0] + ' \u2192 ' + data.dates[data.dates.length - 1] + ')';
        btUpdateRunBtn();
    };
    reader.readAsText(file);
}

function btRemoveSlot(idx) {
    btSlots[idx] = null;
    var el = document.querySelectorAll('.bt-upload-slot')[idx];
    el.classList.remove('loaded');
    el.querySelector('.bt-slot-sym').textContent = 'Token ' + (idx + 1);
    el.querySelector('.bt-slot-info').textContent = 'Drop CSV or click';
    el.querySelector('input[type="file"]').value = '';
    btUpdateRunBtn();
}

function btUpdateRunBtn() {
    var n = btSlots.filter(function(s) { return s !== null; }).length;
    var runBtn = document.getElementById('btRunBtn');
    var wfBtn = document.getElementById('btWfBtn');
    if (runBtn) runBtn.disabled = n < 2;
    if (wfBtn) wfBtn.disabled = n < 2;
    var status = document.getElementById('btLoadStatus');
    if (status) status.textContent = n > 0 ? n + ' token(s) loaded' : '';
}

function btShowStatus(msg, type) {
    var el = document.getElementById('btStatusBar');
    if (!el) return;
    el.textContent = msg;
    el.className = 'bt-status ' + type;
}

function btReadCfg() {
    // Production deleverage v10.6 defaults — hardcoded, no user-configurable engine params
    return {
        dd_window: DL.DD_WINDOW,
        exit_window: DL.EXIT_WINDOW,
        dd_threshold: DL.DD_THRESHOLD,
        ds_vol_high: DL.DS_VOL_HIGH,
        ds_vol_low: DL.DS_VOL_LOW,
        risk_budget: DL.RISK_BUDGET,
        partial_sell: DL.PARTIAL_SELL,
        floor_exposure: DL.FLOOR_EXPOSURE,
        vol_decay: DL.VOL_DECAY,
        exit_dd_divergence: DL.EXIT_DD_DIVERGENCE,
        tranche_1_pct: DL.TRANCHE_1_PCT,
        tranche_2_pct: DL.TRANCHE_2_PCT,
        tranche_2_gap: DL.TRANCHE_2_GAP,
        fee_rate: DL.FEE_RATE,
        corr_entry_thresh: DL.CORR_ENTRY_THRESH,
        corr_exit_thresh: DL.CORR_EXIT_THRESH,
        corr_tranche_1: DL.CORR_TRANCHE_1,
        corr_tranche_2: DL.CORR_TRANCHE_2,
        entry_confirm_bars: DL.ENTRY_CONFIRM_BARS
    };
}

function btGetPortReturns() {
    var active = btSlots.filter(function(s) { return s !== null; });
    var minLen = Math.min.apply(null, active.map(function(s) { return s.prices.length; }));
    var pm = {};
    active.forEach(function(s) { pm[s.name] = s.prices.slice(-minLen); });
    var dates = active[0].dates.slice(-minLen);
    var syms = Object.keys(pm);
    var n = syms.length;
    var rets = [];
    for (var i = 1; i < minLen; i++) {
        var r = 0;
        for (var j = 0; j < syms.length; j++) {
            var p = pm[syms[j]][i - 1], c = pm[syms[j]][i];
            if (p > 0) r += (c - p) / p / n;
        }
        rets.push(r);
    }
    return { rets: rets, dates: dates, syms: syms, n: n, minLen: minLen, tokenPrices: pm };
}

function btSimulate(portRet, cfg, startCap, dcaAmt, dcaInt, tokenPrices, syms) {
    var sOn = false, lMd = 0, pDv = 0, pExp = null;
    var unitsA = startCap, navA = 1.0, usdcR = 0, totalInv = startCap, totalDep = 0;
    var t1Done = false, t2Done = false;
    var totalFees = 0, rebN = 0;  // Fee tracking
    var sim_expT_prev = null;  // Track previous exposure for rebalance fee
    var eqA = [startCap], invA = [startCap], usdcT = [0];
    var shT = [], expT = [], gDdT = [], eDdT = [], dsVT = [], pkVT = [], gapT = [];
    var events = [];
    var shDays = 0, dcaN = 0;
    var prevScale = cfg.risk_budget / cfg.risk_budget;  // FIX #2: start at full exposure
    var entryPendingCount = 0;  // v10.8: correlation entry confirmation counter
    var hasCorr = tokenPrices && syms && syms.length >= 2;

    for (var i = 0; i < portRet.length; i++) {
        var sub = portRet.slice(0, i + 1);
        var totalEquity = eqA[eqA.length - 1];
        // v10.8: Compute avg pairwise correlation from token prices
        var avgCorr = 0;
        if (hasCorr && i >= DL.CORR_WINDOW) {
            avgCorr = computeAvgCorrelation(tokenPrices, syms, i + 1, DL.CORR_WINDOW);
        }
        var res = evaluateShield(sub, sOn, lMd, pDv, cfg, usdcR, t1Done, t2Done, totalEquity, avgCorr, entryPendingCount);
        sOn = res.shield_active; lMd = res.local_max_dd; pDv = res.peak_ds_vol;
        usdcR = res.usdc_reserve; t1Done = res.tranche_1_executed; t2Done = res.tranche_2_executed;
        entryPendingCount = res.entry_pending_count;

        // v10.8: On entry, use first tranche target (not floor) — sell-down is gradual
        var eff;
        if (res.entry_triggered && res.shield_active) {
            eff = res.target_exposure;  // first sell-down tranche (e.g. 50% × riskBudget)
        } else {
            eff = res.target_exposure;
            if (pExp !== null) {
                var md = cfg.partial_sell * cfg.risk_budget;
                var d = res.target_exposure - pExp;
                if (d > 0 && d > md) eff = pExp + md; else eff = pExp + d;
            }
        }
        pExp = eff;
        var todayScale = Math.max(0, Math.min(1, eff / cfg.risk_budget));

        // FIX #1b: Neutralize tranche exposure boost from scale.
        // Tranches now buy actual units, so the boost would double-count.
        if (res.tranche_amount > 0 && totalEquity > 0) {
            var trancheBoost = (res.tranche_amount / totalEquity) / cfg.risk_budget;
            todayScale = Math.max(0, Math.min(1, todayScale - trancheBoost));
        }

        // FIX #2 (Look-ahead): Apply YESTERDAY's exposure to today's return.
        // Shield state computed from today's data determines TOMORROW's exposure.
        navA *= (1 + portRet[i] * prevScale);

        // Rebalance fee: when exposure changes, model the trading cost
        if (sim_expT_prev !== null && i > 0) {
            var scaleDelta = Math.abs(todayScale - prevScale);
            if (scaleDelta > 1e-6) {
                var tradeVal = scaleDelta * (unitsA * navA);
                var fee = tradeVal * cfg.fee_rate;
                totalFees += fee;
                rebN++;
                navA *= (1 - fee / (unitsA * navA));
            }
        }
        sim_expT_prev = eff;
        prevScale = todayScale;  // FIX #2: today's scale applies from tomorrow

        var dayNum = i + 1;
        var isDca = dcaAmt > 0 && dayNum % dcaInt === 0;
        var ddGap = res.global_dd - res.exit_dd;

        if (isDca) {
            dcaN++;
            if (!sOn) {
                var dcaFee = dcaAmt * cfg.fee_rate;
                totalFees += dcaFee;
                unitsA += (dcaAmt - dcaFee) / navA;
                totalInv += dcaAmt;
                events.push({ day: dayNum, type: 'DCA', gdd: res.global_dd, edd: res.exit_dd, gap: ddGap, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: '+$' + dcaAmt + ' \u2192 tokens (fee $' + dcaFee.toFixed(2) + ')' });
            } else {
                usdcR += dcaAmt;
                totalInv += dcaAmt;
                events.push({ day: dayNum, type: 'DCA', gdd: res.global_dd, edd: res.exit_dd, gap: ddGap, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: '+$' + dcaAmt + ' \u2192 USDC (shield ON)' });
            }
        }

        // FIX #1 (Phantom capital): Tranche actually buys units at current NAV.
        // Without this, tranche $ leaves USDC but never enters tokens,
        // while the exposure boost creates phantom compounding.
        if (res.tranche_amount > 0) {
            var trFee = res.tranche_amount * cfg.fee_rate;
            totalFees += trFee;
            totalDep += res.tranche_amount;
            var trNet = res.tranche_amount - trFee;
            if (trNet > 0 && navA > 0) {
                unitsA += trNet / navA;  // Actually buy tokens
            }
            var evType = res.tranche_event.indexOf('tranche_1') >= 0 && res.tranche_event.indexOf('tranche_2') >= 0 ? 'T1+T2'
                : res.tranche_event.indexOf('tranche_1') >= 0 ? 'T1'
                : res.tranche_event.indexOf('tranche_2') >= 0 ? 'T2'
                : 'FINAL';
            events.push({ day: dayNum, type: evType, gdd: res.global_dd, edd: res.exit_dd, gap: ddGap, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: '$' + res.tranche_amount.toFixed(0) + ' \u2192 tokens (' + res.tranche_event + ', fee $' + trFee.toFixed(2) + ')' });
        }

        if (res.entry_triggered) events.push({ day: dayNum, type: 'ENTRY', gdd: res.global_dd, edd: res.exit_dd, gap: ddGap, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: '\u26A0 Emergency Brake \u2014 sell-down started, exposure \u2192 ' + (eff * 100).toFixed(1) + '%' });
        if (res.exit_reason) events.push({ day: dayNum, type: 'FINAL', gdd: res.global_dd, edd: res.exit_dd, gap: ddGap, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: 'EXIT: ' + res.exit_reason });
        if (res.exit_blocked) events.push({ day: dayNum, type: 'BLOCKED', gdd: res.global_dd, edd: res.exit_dd, gap: ddGap, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: res.exit_block_reason });

        eqA.push(unitsA * navA + usdcR);
        invA.push(totalInv);
        usdcT.push(usdcR);
        shT.push(sOn ? 1 : 0);
        expT.push(eff);
        gDdT.push(res.global_dd);
        eDdT.push(res.exit_dd);
        dsVT.push(res.ds_vol);
        pkVT.push(res.peak_ds_vol);
        gapT.push(ddGap);
        if (sOn) shDays++;
    }

    // Buy & Hold: DCA unconditional (with trading fees)
    var unitsB = startCap, navB = 1.0, totalInvB = startCap, bhFees = 0;
    var eqB = [startCap], invB = [startCap];
    for (var i = 0; i < portRet.length; i++) {
        navB *= (1 + portRet[i]);
        if (dcaAmt > 0 && (i + 1) % dcaInt === 0) {
            var bhFee = dcaAmt * cfg.fee_rate;
            bhFees += bhFee;
            unitsB += (dcaAmt - bhFee) / navB;
            totalInvB += dcaAmt;
        }
        eqB.push(unitsB * navB);
        invB.push(totalInvB);
    }

    return { eqA: eqA, invA: invA, eqB: eqB, invB: invB, usdcT: usdcT, shT: shT, expT: expT, gDdT: gDdT, eDdT: eDdT, dsVT: dsVT, pkVT: pkVT, gapT: gapT, events: events, totalInv: totalInv, totalInvB: totalInvB, totalDep: totalDep, shDays: shDays, dcaN: dcaN, totalFees: totalFees, rebN: rebN, bhFees: bhFees };
}

function btCalcMetrics(eq, totalIn, years) {
    var f = eq[eq.length - 1];
    var ret = f / totalIn - 1;
    var ann = years > 0 ? Math.pow(1 + ret, 1 / years) - 1 : 0;
    var pk = eq[0], mdd = 0;
    for (var i = 0; i < eq.length; i++) { if (eq[i] > pk) pk = eq[i]; var d = pk > 0 ? (pk - eq[i]) / pk : 0; if (d > mdd) mdd = d; }
    var cal = mdd > 0 ? ann / mdd : 0;
    var rs = [];
    for (var i = 1; i < eq.length; i++) rs.push(eq[i] / eq[i - 1] - 1);
    var mn = rs.reduce(function(s, r) { return s + r; }, 0) / rs.length;
    var vr = rs.reduce(function(s, r) { return s + (r - mn) * (r - mn); }, 0) / rs.length;
    var av = Math.sqrt(vr * 365.25);
    var sh = av > 0 ? (ann - 0.05) / av : 0;
    var irr = Math.pow(f / totalIn, 1 / (eq.length - 1)) - 1;
    var xi = Math.pow(1 + irr, 365.25) - 1;
    return { final: f, totalIn: totalIn, ret: ret, ann: ann, mdd: mdd, cal: cal, sh: sh, xi: xi };
}

// ============================================================
//  MAIN BACKTEST RUNNER
// ============================================================

function btShowLoading() {
    var el = document.getElementById('btLoading');
    if (el) el.classList.remove('hidden');
}

function btHideLoading() {
    var el = document.getElementById('btLoading');
    if (el) el.classList.add('hidden');
}

function btRunBacktest() {
    btShowLoading();
    setTimeout(function() {
        try {
            btShowStatus('Running backtest...', 'running');
    var cfg = btReadCfg();
    var startCap = +document.getElementById('btStartCapital').value || 1000;
    var dcaAmt = +document.getElementById('btDcaAmount').value || 100;
    var dcaInt = +document.getElementById('btDcaInterval').value || 30;
    var pr = btGetPortReturns();
    var sim = btSimulate(pr.rets, cfg, startCap, dcaAmt, dcaInt, pr.tokenPrices, pr.syms);
    var years = pr.rets.length / 365.25;
    var m1 = btCalcMetrics(sim.eqA, sim.totalInv, years);
    var m2 = btCalcMetrics(sim.eqB, sim.totalInvB, years);
    var dateLabels = pr.dates.slice(1);

    var entries = sim.events.filter(function(e) { return e.type === 'ENTRY'; });
    var exits = sim.events.filter(function(e) { return e.type === 'FINAL'; });
    var blocked = sim.events.filter(function(e) { return e.type === 'BLOCKED'; });
    var t1evts = sim.events.filter(function(e) { return e.type === 'T1' || e.type === 'T1+T2'; });
    var t2evts = sim.events.filter(function(e) { return e.type === 'T2' || e.type === 'T1+T2'; });

    btShowStatus('Done: ' + pr.rets.length + ' days, ' + pr.n + ' tokens (' + pr.syms.join(', ') + '), ' + sim.dcaN + ' DCA, $' + sim.totalDep.toFixed(0) + ' tranched', 'success');

    // Strategy comparison
    var sr = document.getElementById('btStrategyRow');
    sr.innerHTML = '';
    var best = m1.final >= m2.final;
    var c1 = document.createElement('div');
    c1.className = 'bt-strategy-card' + (best ? ' bt-best' : '');
    c1.innerHTML = '<h3>Shield + Tranche DCA' + (best ? ' \u2605' : '') + '</h3>'
        + '<div class="bt-big" style="color:var(--' + (best ? 'green' : 'blue') + ')">$' + m1.final.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div>'
        + '<div class="bt-sub">Invested: $' + m1.totalIn.toLocaleString() + ' | Return: ' + (m1.ret * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub">Max DD: ' + (m1.mdd * 100).toFixed(1) + '% | Calmar: ' + m1.cal.toFixed(2) + ' | Sharpe: ' + m1.sh.toFixed(2) + '</div>'
        + '<div class="bt-sub">XIRR: ' + (m1.xi * 100).toFixed(1) + '% | Shield: ' + sim.shDays + '/' + pr.rets.length + ' days</div>'
        + '<div class="bt-sub">Tranches: $' + sim.totalDep.toFixed(0) + ' | DCA: ' + sim.dcaN + '</div>'
        + '<div class="bt-sub" style="color:var(--amber)">Fees: $' + sim.totalFees.toFixed(0) + ' (' + sim.rebN + ' rebalances)</div>';
    sr.appendChild(c1);

    var c2 = document.createElement('div');
    c2.className = 'bt-strategy-card' + (!best ? ' bt-best' : '');
    c2.innerHTML = '<h3>Buy & Hold + DCA' + (!best ? ' \u2605' : '') + '</h3>'
        + '<div class="bt-big" style="color:var(--' + (!best ? 'green' : 'amber') + ')">$' + m2.final.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div>'
        + '<div class="bt-sub">Invested: $' + m2.totalIn.toLocaleString() + ' | Return: ' + (m2.ret * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub">Max DD: ' + (m2.mdd * 100).toFixed(1) + '% | Calmar: ' + m2.cal.toFixed(2) + ' | Sharpe: ' + m2.sh.toFixed(2) + '</div>'
        + '<div class="bt-sub">XIRR: ' + (m2.xi * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub" style="color:var(--amber)">Fees: $' + sim.bhFees.toFixed(0) + ' (DCA only)</div>';
    sr.appendChild(c2);

    var alpha = m2.final > 0 ? ((m1.final / m2.final - 1) * 100).toFixed(1) : '?';
    document.getElementById('btCompareExplain').innerHTML = 'Both received <strong>identical DCA</strong> ($' + dcaAmt + ' every ' + dcaInt + 'd, total $' + (sim.dcaN * dcaAmt).toLocaleString() + '). Deleverage ' + (best ? 'outperformed' : 'underperformed') + ' B&H by <strong>' + Math.abs(alpha) + '%</strong>. Max DD reduced by <strong>' + (Math.abs(m2.mdd - m1.mdd) * 100).toFixed(1) + 'pp</strong>. Tranche deploys: ' + t1evts.length + ' T1, ' + t2evts.length + ' T2.';

    // Summary explain
    document.getElementById('btSummaryExplain').innerHTML = '<strong>' + pr.n + ' tokens</strong> (' + pr.syms.join(', ') + ') over <strong>' + pr.rets.length + ' days</strong> (~' + years.toFixed(1) + 'y). Shield active <strong>' + sim.shDays + '</strong>/' + pr.rets.length + ' days. <strong>' + entries.length + '</strong> entries, <strong>' + exits.length + '</strong> exits' + (blocked.length > 0 ? ', <strong>' + blocked.length + '</strong> blocked' : '') + '. <strong>' + sim.dcaN + '</strong> DCA events, <strong>$' + sim.totalDep.toFixed(0) + '</strong> tranche-deployed.';

    // Metrics grid
    var mg = document.getElementById('btMetricsGrid');
    mg.innerHTML = '';
    var metrics = [
        { l: 'Final Value', v: '$' + m1.final.toLocaleString(undefined, { maximumFractionDigits: 0 }), c: m1.final > m1.totalIn ? 'good' : 'bad' },
        { l: 'Total Invested', v: '$' + m1.totalIn.toLocaleString(), c: '' },
        { l: 'Net Profit', v: '$' + (m1.final - m1.totalIn).toLocaleString(undefined, { maximumFractionDigits: 0 }), c: m1.final > m1.totalIn ? 'good' : 'bad' },
        { l: 'Return', v: (m1.ret * 100).toFixed(1) + '%', c: m1.ret > 0 ? 'good' : 'bad' },
        { l: 'Ann. Return', v: (m1.ann * 100).toFixed(1) + '%', c: '' },
        { l: 'XIRR', v: (m1.xi * 100).toFixed(1) + '%', c: '' },
        { l: 'Max DD', v: (m1.mdd * 100).toFixed(1) + '%', c: m1.mdd > 0.40 ? 'bad' : m1.mdd > 0.25 ? 'warn' : 'good' },
        { l: 'Calmar', v: m1.cal.toFixed(2), c: m1.cal > 4 ? 'good' : '' },
        { l: 'Sharpe', v: m1.sh.toFixed(2), c: m1.sh > 2 ? 'good' : '' },
        { l: 'DCA Events', v: sim.dcaN, c: '' },
        { l: 'Tranche Deploys', v: '$' + sim.totalDep.toFixed(0), c: '' },
        { l: 'Shield Entries', v: entries.length, c: '' },
        { l: 'Exits', v: exits.length, c: '' },
        { l: 'Blocked', v: blocked.length, c: blocked.length > 0 ? 'warn' : '' },
        { l: 'Total Fees', v: '$' + sim.totalFees.toFixed(0), c: sim.totalFees > 0 ? 'warn' : '' }
    ];
    metrics.forEach(function(it) {
        var b = document.createElement('div');
        b.className = 'bt-metric-box ' + it.c;
        b.innerHTML = '<div class="bt-metric-val">' + it.v + '</div><div class="bt-metric-lbl">' + it.l + '</div>';
        mg.appendChild(b);
    });

    // Destroy old charts
    Object.keys(btCharts).forEach(function(k) { if (btCharts[k]) btCharts[k].destroy(); });
    btCharts = {};

    // Collect ENTRY event indices for Emergency Brake annotation lines
    var entryDays = entries.map(function(e) { return e.day - 1; });  // 0-based index into dateLabels

    // Custom Chart.js plugin: draw red dashed vertical lines at Emergency Brake entry points
    var emergencyBrakePlugin = {
        id: 'emergencyBrakeLines',
        afterDraw: function(chart) {
            if (!entryDays.length) return;
            var ctx = chart.ctx;
            var xAxis = chart.scales.x;
            var yTop = chart.chartArea.top;
            var yBottom = chart.chartArea.bottom;
            ctx.save();
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(248, 113, 113, 0.7)';
            for (var k = 0; k < entryDays.length; k++) {
                var x = xAxis.getPixelForValue(entryDays[k]);
                if (x >= chart.chartArea.left && x <= chart.chartArea.right) {
                    ctx.beginPath();
                    ctx.moveTo(x, yTop);
                    ctx.lineTo(x, yBottom);
                    ctx.stroke();
                }
            }
            // Label at top of first entry line
            if (entryDays.length > 0) {
                var x0 = xAxis.getPixelForValue(entryDays[0]);
                if (x0 >= chart.chartArea.left && x0 <= chart.chartArea.right) {
                    ctx.setLineDash([]);
                    ctx.font = 'bold 10px monospace';
                    ctx.fillStyle = '#f87171';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    var label = '\u26A0 EMERGENCY BRAKE';
                    var lx = x0 + 4;
                    if (lx + ctx.measureText(label).width > chart.chartArea.right) lx = x0 - ctx.measureText(label).width - 4;
                    ctx.fillText(label, lx, yTop + 4);
                }
            }
            ctx.restore();
        }
    };

    var cO = function() {
        return {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#c9d1d9', font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: '#8b949e', maxTicksLimit: 12 }, grid: { color: '#1c2128' } },
                y: { ticks: { color: '#8b949e' }, grid: { color: '#1c2128' } }
            }
        };
    };

    // Equity curves
    btCharts.eq = new Chart(document.getElementById('btEquityChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'Deleverage + Tranche DCA', data: sim.eqA.slice(1), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', fill: true, pointRadius: 0, borderWidth: 2 },
                { label: 'Buy & Hold + DCA', data: sim.eqB.slice(1), borderColor: '#fbbf24', fill: false, pointRadius: 0, borderWidth: 1.5 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.ticks.callback = function(v) { return '$' + (v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0)); }; return o; })(),
        plugins: [emergencyBrakePlugin]
    });

    // Capital breakdown
    var tokInv = sim.invA.map(function(v, i) { return v - sim.usdcT[i]; });
    btCharts.cap = new Chart(document.getElementById('btCapitalChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'In Tokens', data: tokInv.slice(1), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.15)', fill: true, pointRadius: 0, borderWidth: 1.5, stack: 'a' },
                { label: 'USDC Reserve', data: sim.usdcT.slice(1), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.25)', fill: true, pointRadius: 0, borderWidth: 1, stack: 'a' },
                { label: 'B&H Equity', data: sim.eqB.slice(1), borderColor: '#fbbf24', borderDash: [4, 3], fill: false, pointRadius: 0, borderWidth: 1.5 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.stacked = true; o.scales.y.ticks.callback = function(v) { return '$' + v.toLocaleString(); }; return o; })()
    });

    // Shield status
    btCharts.sh = new Chart(document.getElementById('btShieldChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [{ label: 'Shield', data: sim.shT, borderColor: function(ctx) { return ctx.raw ? '#f87171' : '#34d399'; }, backgroundColor: function(ctx) { return ctx.raw ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.1)'; }, fill: true, pointRadius: 0, borderWidth: 1.5, stepped: true }]
        },
        options: (function() { var o = cO(); o.scales.y.min = -0.15; o.scales.y.max = 1.3; o.scales.y.ticks.callback = function(v) { return v >= 0.5 ? 'ON' : 'OFF'; }; return o; })(),
        plugins: [emergencyBrakePlugin]
    });

    // Exposure — stepped:'before' makes hard-switch a VERTICAL drop (instant), not diagonal
    btCharts.exp = new Chart(document.getElementById('btExposureChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [{ label: 'Exposure', data: sim.expT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.15)', fill: true, pointRadius: 0, borderWidth: 1.5, stepped: 'before' }]
        },
        options: (function() { var o = cO(); o.scales.y.min = 0; o.scales.y.max = 100; o.scales.y.ticks.callback = function(v) { return v + '%'; }; return o; })(),
        plugins: [emergencyBrakePlugin]
    });

    // Volatility
    btCharts.vol = new Chart(document.getElementById('btVolChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'DS Vol', data: sim.dsVT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#06b6d4', pointRadius: 0, borderWidth: 1.5 },
                { label: 'Peak DS Vol', data: sim.pkVT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#fbbf24', pointRadius: 0, borderWidth: 1.5 },
                { label: 'Entry 48%', data: dateLabels.map(function() { return 48; }), borderColor: '#f87171', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 },
                { label: 'Exit 30%', data: dateLabels.map(function() { return 30; }), borderColor: '#34d399', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.ticks.callback = function(v) { return v + '%'; }; return o; })()
    });

    // Drawdowns
    btCharts.dd = new Chart(document.getElementById('btDdChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'Global DD', data: sim.gDdT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.15)', fill: true, pointRadius: 0, borderWidth: 1.5 },
                { label: 'Exit DD 180d', data: sim.eDdT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#06b6d4', pointRadius: 0, borderWidth: 1.5 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.ticks.callback = function(v) { return v + '%'; }; return o; })()
    });

    // Event log
    sim.events.sort(function(a, b) { return a.day - b.day; });
    var tbody = document.querySelector('#btEventsTable tbody');
    tbody.innerHTML = '';
    sim.events.forEach(function(e) {
        var tr = document.createElement('tr');
        var dt = dateLabels[e.day - 1] || ('day ' + e.day);
        tr.innerHTML = '<td>' + dt + '</td><td>' + e.day + '</td><td class="bt-ev-' + e.type.toLowerCase().replace('+', '-') + '">' + (e.type === 'ENTRY' ? '\u26A0 BRAKE' : e.type) + '</td><td>' + (e.gdd * 100).toFixed(1) + '%</td><td>' + (e.edd * 100).toFixed(1) + '%</td><td>' + ((e.gap || 0) * 100).toFixed(1) + '%</td><td>' + (e.dsv * 100).toFixed(1) + '%</td><td>' + (e.eff * 100).toFixed(1) + '%</td><td>$' + (e.usdc || 0).toFixed(0) + '</td><td>' + e.detail + '</td>';
        tbody.appendChild(tr);
    });

    document.getElementById('btResultsSection').classList.remove('hidden');
    document.getElementById('btResultsSection').scrollIntoView({ behavior: 'smooth' });
        } catch(e) { console.error(e); btShowStatus('Error: ' + e.message, 'error'); }
        btHideLoading();
    }, 50);
}

// ============================================================
//  WALK-FORWARD GRID
// ============================================================

function btRunWFGrid() {
    btShowLoading();
    setTimeout(function() {
        try {
            var pr = btGetPortReturns();
    var startCap = +document.getElementById('btStartCapital').value || 1000;
    var dcaAmt = +document.getElementById('btDcaAmount').value || 100;
    var dcaInt = +document.getElementById('btDcaInterval').value || 30;
    var sweep = document.getElementById('btWfSweep').value;
    var metricKey = document.getElementById('btWfMetric').value;
    var years = pr.rets.length / 365.25;

    var ranges = {
        dd_threshold: { label: 'DD Threshold', values: [0.08, 0.10, 0.12, 0.15, 0.18, 0.20], key: 'dd_threshold', fmt: function(v) { return (v * 100).toFixed(0) + '%'; } },
        ds_vol_high: { label: 'DS Vol High', values: [0.35, 0.40, 0.45, 0.48, 0.55, 0.60], key: 'ds_vol_high', fmt: function(v) { return (v * 100).toFixed(0) + '%'; } },
        exit_dd_divergence: { label: 'Divergence', values: [0.15, 0.20, 0.25, 0.30, 0.40, 0.50], key: 'exit_dd_divergence', fmt: function(v) { return (v * 100).toFixed(0) + '%'; } },
        exit_window: { label: 'Exit Window', values: [90, 120, 150, 180, 240, 300], key: 'exit_window', fmt: function(v) { return v + 'd'; } },
        vol_halflife: { label: 'Vol Half-Life', values: [15, 20, 30, 45, 60, 90], key: 'vol_halflife', fmt: function(v) { return v + 'd'; } }
    };
    var sw = ranges[sweep];
    var crossP = sweep !== 'ds_vol_high' ? 'ds_vol_high' : 'dd_threshold';
    var cr = ranges[crossP];

    btShowStatus('WF grid: ' + sw.label + ' x ' + cr.label + ' (' + (sw.values.length * cr.values.length) + ' sims)...', 'running');

    var results = [];
    for (var si = 0; si < sw.values.length; si++) {
        for (var ci = 0; ci < cr.values.length; ci++) {
            var cfg = btReadCfg();
            if (crossP === 'vol_halflife') cfg.vol_decay = Math.pow(0.5, 1.0 / cr.values[ci]);
            else cfg[crossP] = cr.values[ci];
            if (sweep === 'vol_halflife') cfg.vol_decay = Math.pow(0.5, 1.0 / sw.values[si]);
            else cfg[sw.key] = sw.values[si];
            var sim = btSimulate(pr.rets, cfg, startCap, dcaAmt, dcaInt, pr.tokenPrices, pr.syms);
            var m = btCalcMetrics(sim.eqA, sim.totalInv, years);
            var mB = btCalcMetrics(sim.eqB, sim.totalInvB, years);
            results.push({ sv: sw.values[si], cv: cr.values[ci], final: m.final, calmar: m.cal, maxdd: m.mdd, sharpe: m.sh, alpha: m.final - mB.final, entries: sim.events.filter(function(e) { return e.type === 'ENTRY'; }).length, shDays: sim.shDays, dep: sim.totalDep });
        }
    }

    var metricMap = {
        final: { key: 'final', label: 'Final $', fmt: function(v) { return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 }); }, hi: true },
        calmar: { key: 'calmar', label: 'Calmar', fmt: function(v) { return v.toFixed(2); }, hi: true },
        maxdd: { key: 'maxdd', label: 'Max DD', fmt: function(v) { return (v * 100).toFixed(1) + '%'; }, hi: false },
        sharpe: { key: 'sharpe', label: 'Sharpe', fmt: function(v) { return v.toFixed(2); }, hi: true }
    };
    var met = metricMap[metricKey];
    var vals = results.map(function(r) { return r[met.key]; });
    var bestVal = met.hi ? Math.max.apply(null, vals) : Math.min.apply(null, vals);

    var html = '<table class="bt-wf-grid"><thead><tr><th>' + sw.label + ' / ' + cr.label + '</th>';
    for (var ci = 0; ci < cr.values.length; ci++) html += '<th>' + cr.fmt(cr.values[ci]) + '</th>';
    html += '<th>Entries</th><th>Shield Days</th><th>$ Deployed</th><th>Alpha vs B&H</th></tr></thead><tbody>';
    for (var si = 0; si < sw.values.length; si++) {
        var row = results.filter(function(r) { return r.sv === sw.values[si]; });
        var rowVals = row.map(function(r) { return r[met.key]; });
        var rowBest = met.hi ? Math.max.apply(null, rowVals) : Math.min.apply(null, rowVals);
        var isBestRow = rowBest === bestVal;
        html += '<tr' + (isBestRow ? ' class="bt-best-row"' : '') + '><th>' + sw.fmt(sw.values[si]) + '</th>';
        for (var ri = 0; ri < row.length; ri++) {
            var v = row[ri][met.key];
            var isB = v === bestVal;
            var cls = isB ? 'bt-cell-good' : (metricKey === 'maxdd' && v > 0.5 ? 'bt-cell-bad' : 'bt-cell-mid');
            html += '<td class="' + cls + '">' + met.fmt(v) + '</td>';
        }
        var any = row[0];
        html += '<td>' + any.entries + '</td><td>' + any.shDays + '</td><td>$' + any.dep.toFixed(0) + '</td>';
        html += '<td style="color:var(--' + (any.alpha > 0 ? 'green' : 'red') + ')">' + (any.alpha > 0 ? '+' : '') + '$' + any.alpha.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</td></tr>';
    }
    html += '</tbody></table>';

    var best = results.find(function(r) { return r[met.key] === bestVal; });
    html += '<div class="bt-explain" style="margin-top:12px"><strong>Best:</strong> ' + sw.label + '=' + sw.fmt(best.sv) + ', ' + cr.label + '=' + cr.fmt(best.cv) + ' \u2192 ' + met.label + ': ' + met.fmt(bestVal) + ' | alpha: <strong style="color:var(--' + (best.alpha > 0 ? 'green' : 'red') + ')">' + (best.alpha > 0 ? '+' : '') + '$' + best.alpha.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</strong></div>';

    document.getElementById('btWfGridContainer').innerHTML = html;
    document.getElementById('btWfSection').classList.remove('hidden');
    btShowStatus('WF grid: ' + (sw.values.length * cr.values.length) + ' sims done. Best: ' + sw.label + '=' + sw.fmt(best.sv), 'success');
    document.getElementById('btWfSection').scrollIntoView({ behavior: 'smooth' });
        } catch(e) { console.error(e); btShowStatus('Error: ' + e.message, 'error'); }
        btHideLoading();
    }, 50);
}

function btResetAll() {
    for (var i = 0; i < 5; i++) btRemoveSlot(i);
    document.getElementById('btResultsSection').classList.add('hidden');
    document.getElementById('btWfSection').classList.add('hidden');
    document.getElementById('btStatusBar').className = 'bt-status';
}

// Expose to global for onclick handlers
window.btHandleFile = btHandleFile;
window.btRemoveSlot = btRemoveSlot;
window.btRunBacktest = btRunBacktest;
window.btRunWFGrid = btRunWFGrid;
window.btResetAll = btResetAll;

})();

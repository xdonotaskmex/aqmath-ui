// Debug script: replicate exact UI logic to find why shield doesn't activate
'use strict';
var fs = require('fs');
var path = require('path');

var CSV_DIR = 'C:\\Users\\user\\Desktop\\Hystorical Data TEST';
var TOKENS = {
    ADA: 'ada-usd-max.csv',
    BNB: 'bnb-usd-max.csv',
    BTC: 'btc-usd new.csv',
    SOL: 'sol-usd-max.csv',
    XRP: 'xrp-usd-max.csv'
};

// === DL config (exact copy from app-backtest.js) ===
var DL = {
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
    FEE_RATE: 0.001,
    EXIT_TRANCHES: [0.50, 0.25, 0.0],
    CORR_ENTRY_THRESH: 0.80,
    CORR_EXIT_THRESH: 0.60,
    CORR_TRANCHE_1: 0.70,
    CORR_TRANCHE_2: 0.60,
    ENTRY_CONFIRM_BARS: 3,
    CORR_WINDOW: 20,
};

// === CSV loader ===
function loadCSV(fname) {
    var content = fs.readFileSync(path.join(CSV_DIR, fname), 'utf-8');
    // Remove BOM
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    var lines = content.split(/\r?\n/);
    var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/"/g, ''); });
    var dateCol = -1, priceCol = -1;
    for (var i = 0; i < headers.length; i++) {
        var h = headers[i].toLowerCase();
        if (h === 'event_date' || h === 'date') dateCol = i;
        if (h === 'close_price_usd' || h === 'close' || h === 'price') priceCol = i;
    }
    if (dateCol < 0 || priceCol < 0) { console.log('Bad headers in ' + fname); return { dates: [], prices: [] }; }
    var dates = [], prices = [];
    for (var j = 1; j < lines.length; j++) {
        var cols = lines[j].split(',');
        if (cols.length <= Math.max(dateCol, priceCol)) continue;
        var p = parseFloat(cols[priceCol].replace(/"/g, ''));
        if (isNaN(p) || p <= 0) continue;
        dates.push(cols[dateCol].replace(/"/g, '').trim());
        prices.push(p);
    }
    return { dates: dates, prices: prices };
}

// === computeAvgCorrelation (exact copy from app-backtest.js) ===
function computeAvgCorrelation(tokenPrices, syms, endIdx, window) {
    window = window || DL.CORR_WINDOW;
    var n = syms.length;
    if (n < 2) return 0.5;
    var start = Math.max(1, endIdx - window + 1);
    if (endIdx - start < 5) return 0.5;
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
    for (var s = 1; s < n; s++) {
        if (logRets[syms[s]].length < minLen) minLen = logRets[syms[s]].length;
    }
    if (minLen < 5) return 0.5;
    var means = {};
    for (var s = 0; s < n; s++) {
        var sum = 0;
        for (var k = 0; k < minLen; k++) sum += logRets[syms[s]][k];
        means[syms[s]] = sum / minLen;
    }
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

// === evaluateShield (exact copy from app-backtest.js) ===
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
    var corrEntryThresh = cfg.corr_entry_thresh !== undefined ? cfg.corr_entry_thresh : DL.CORR_ENTRY_THRESH;
    var confirmBars = cfg.entry_confirm_bars || DL.ENTRY_CONFIRM_BARS;
    avgCorrelation = avgCorrelation || 0;
    entryPendingCount = entryPendingCount || 0;

    if (!rets || rets.length < ddWindow) return { shield_active: false, entry_pending_count: entryPendingCount, avg_correlation: avgCorrelation };

    // Global equity curve
    var gEq = [1];
    for (var i = 0; i < rets.length; i++) gEq.push(gEq[gEq.length - 1] * (1 + rets[i]));
    var pk = gEq[0], gDd = 0, pkIdx = 0;
    for (var i = 0; i < gEq.length; i++) {
        if (gEq[i] > pk) { pk = gEq[i]; pkIdx = i; }
        var dd = pk > 0 ? (pk - gEq[i]) / pk : 0;
        if (dd > gDd) gDd = dd;
    }
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

    var entry = false;

    if (!shieldActive) {
        if (peakDsVol > 0.001) peakDsVol *= volDecay;
        var hOk = true;
        if (peakDsVol > 0.01) hOk = dsV > peakDsVol * 0.70;
        var rawEntry = gDd > ddThresh && dsV > dsVolHigh && hOk;
        var corrGate = avgCorrelation >= corrEntryThresh;
        if (rawEntry && corrGate) {
            entryPendingCount += 1;
        } else {
            entryPendingCount = 0;
        }
        if (entryPendingCount >= confirmBars) {
            shieldActive = true; localMaxDd = eDd; peakDsVol = dsV; entry = true;
            entryPendingCount = 0;
        }
    }

    return {
        shield_active: shieldActive,
        entry_triggered: entry,
        entry_pending_count: entryPendingCount,
        avg_correlation: +avgCorrelation.toFixed(4),
        global_dd: +gDd.toFixed(4),
        exit_dd: +eDd.toFixed(4),
        ds_vol: +dsV.toFixed(4),
        peak_ds_vol: +peakDsVol.toFixed(4),
        hysteresis_ok: shieldActive ? true : (peakDsVol <= 0.01 || dsV > peakDsVol * 0.70)
    };
}

// === MAIN ===
console.log('Loading CSVs...');
var allData = {};
var syms = Object.keys(TOKENS);
for (var s = 0; s < syms.length; s++) {
    var d = loadCSV(TOKENS[syms[s]]);
    allData[syms[s]] = d;
    console.log('  ' + syms[s] + ': ' + d.prices.length + ' days (' + d.dates[0] + ' -> ' + d.dates[d.dates.length-1] + ')');
}

// Find common dates
var dateSets = syms.map(function(s) { return new Set(allData[s].dates); });
var commonDates = [];
for (var i = 0; i < allData[syms[0]].dates.length; i++) {
    var d = allData[syms[0]].dates[i];
    var inAll = true;
    for (var j = 1; j < dateSets.length; j++) {
        if (!dateSets[j].has(d)) { inAll = false; break; }
    }
    if (inAll) commonDates.push(d);
}
commonDates.sort();
console.log('\nCommon dates: ' + commonDates.length + ' (' + commonDates[0] + ' -> ' + commonDates[commonDates.length-1] + ')');

// Build aligned prices
var tokenPrices = {};
for (var s = 0; s < syms.length; s++) {
    var dateToPrice = {};
    for (var i = 0; i < allData[syms[s]].dates.length; i++) {
        dateToPrice[allData[syms[s]].dates[i]] = allData[syms[s]].prices[i];
    }
    tokenPrices[syms[s]] = commonDates.map(function(d) { return dateToPrice[d]; });
}

// Compute portfolio returns (equal-weighted, same as btGetPortReturns)
var minLen = commonDates.length;
var rets = [];
for (var i = 1; i < minLen; i++) {
    var r = 0;
    for (var j = 0; j < syms.length; j++) {
        var p = tokenPrices[syms[j]][i - 1], c = tokenPrices[syms[j]][i];
        if (p > 0) r += (c - p) / p / syms.length;
    }
    rets.push(r);
}

console.log('\nPortfolio returns: ' + rets.length);

// === Run simulate loop (same as btSimulate) ===
var sOn = false, lMd = 0, pDv = 0;
var entryPendingCount = 0;
var activations = 0;
var maxPending = 0;
var rawEntryDays = 0;
var corrGateDays = 0;
var bothDays = 0;

console.log('\n=== Entry Condition Trace (2021-06 to 2023-06) ===');
console.log('Date         Day    G_DD    DS_Vol  Corr    HystOk  RawEntry CorrGate Pending Shield');
console.log('-'.repeat(95));

for (var i = 0; i < rets.length; i++) {
    var sub = rets.slice(0, i + 1);
    var avgCorr = 0;
    if (i >= DL.CORR_WINDOW) {
        avgCorr = computeAvgCorrelation(tokenPrices, syms, i + 1, DL.CORR_WINDOW);
    }
    var res = evaluateShield(sub, sOn, lMd, pDv, {}, 0, false, false, 100000, avgCorr, entryPendingCount);
    
    var date = commonDates[i + 1];
    var dayNum = i + 1;
    
    // Track stats
    if (res.entry_pending_count > maxPending) maxPending = res.entry_pending_count;
    
    // Show crash period
    if (date >= '2021-06' && date <= '2023-06') {
        if (dayNum % 60 === 0 || res.entry_pending_count > 0 || res.global_dd > 0.12) {
            var hOk = res.hysteresis_ok ? 'Y' : 'N';
            var rawE = (res.global_dd > DL.DD_THRESHOLD && res.ds_vol > DL.DS_VOL_HIGH && res.hysteresis_ok) ? 'Y' : 'N';
            var cGate = (res.avg_correlation >= DL.CORR_ENTRY_THRESH) ? 'Y' : 'N';
            var sh = sOn ? 'ON' : 'off';
            console.log(
                date.substring(0, 10).padEnd(12) +
                dayNum.toString().padStart(5) + '  ' +
                res.global_dd.toFixed(3).padStart(7) +
                res.ds_vol.toFixed(3).padStart(7) +
                res.avg_correlation.toFixed(4).padStart(7) + '  ' +
                hOk.padStart(6) + '  ' +
                rawE.padStart(8) + '  ' +
                cGate.padStart(8) + '  ' +
                res.entry_pending_count.toString().padStart(7) + '  ' +
                sh
            );
        }
    }
    
    // Check for activation
    if (res.entry_triggered) {
        activations++;
        console.log('\n*** ACTIVATION on ' + date + ' (day ' + dayNum + ') ***\n');
    }
    
    // Update state
    sOn = res.shield_active;
    lMd = res.local_max_dd || lMd;
    pDv = res.peak_ds_vol;
    entryPendingCount = res.entry_pending_count;
}

console.log('\n=== Summary ===');
console.log('Total activations: ' + activations);
console.log('Max pending count: ' + maxPending);
console.log('Required pending: ' + DL.ENTRY_CONFIRM_BARS);

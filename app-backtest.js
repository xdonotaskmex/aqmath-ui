(function() {
'use strict';

// ============================================================
//  AQMath Deleverage Engine v12.0 — JavaScript Port
//  Continuous DD + downside-vol regime modulator. No state machine,
//  no correlation gate, no timers. PRIMARY signal: rising drawdown +
//  rising downside volatility -> continuously scale exposure down.
//  Exit fast (close 50% of gap/bar), re-enter slow (6%/bar), no hard
//  floor. Validated on 5-token real data (ADA/BNB/ETH/XRP/XLM, ~8.7y):
//  Max DD ~36.0%, Calmar ~1.42, Sharpe ~0.98, avg exposure ~0.31.
// ============================================================

const DL = {
    DD_WINDOW: 20,          // trailing window for downside-vol
    DD_REF: 0.30,           // drawdown mapping to full de-risk (dd_sig = 1)
    VOL_LOW: 0.30,          // downside-vol where vol_sig starts rising
    VOL_HIGH: 0.90,         // downside-vol where vol_sig saturates
    W_DD: 0.70,             // weight on drawdown signal
    W_VOL: 0.30,            // weight on downside-vol signal
    EXIT_SPEED: 0.50,       // fast: close 50% of gap toward a LOWER target/bar
    ENTRY_SPEED: 0.06,      // slow: close 6% of gap toward a HIGHER target/bar
    REDEPLOY_THRESH: 0.50,  // exposure below this == defensive (park DCA)
    RISK_BUDGET: 0.85,
    FEE_RATE: 0.001,        // 10 bps per trade (rebalance, DCA, redeploy)
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

// v12.0: correlation is intentionally NOT a regime signal (empirically not
// predictive) — the old computeAvgCorrelation helper was removed.


function evaluateShield(rets, cfg, prevExpFrac) {
    // Continuous DD + downside-vol regime modulator (mirrors deleverage.py).
    // Signal is look-ahead safe: caller passes returns through day i-1 and the
    // previous exposure fraction; the returned fraction applies to day i.
    cfg = cfg || {};
    var ddWindow = cfg.dd_window || DL.DD_WINDOW;
    var ddRef = cfg.dd_ref !== undefined ? cfg.dd_ref : DL.DD_REF;
    var volLow = cfg.vol_low !== undefined ? cfg.vol_low : DL.VOL_LOW;
    var volHigh = cfg.vol_high !== undefined ? cfg.vol_high : DL.VOL_HIGH;
    var wDd = cfg.w_dd !== undefined ? cfg.w_dd : DL.W_DD;
    var wVol = cfg.w_vol !== undefined ? cfg.w_vol : DL.W_VOL;
    var exitSpeed = cfg.exit_speed !== undefined ? cfg.exit_speed : DL.EXIT_SPEED;
    var entrySpeed = cfg.entry_speed !== undefined ? cfg.entry_speed : DL.ENTRY_SPEED;
    var redeployThresh = cfg.redeploy_thresh !== undefined ? cfg.redeploy_thresh : DL.REDEPLOY_THRESH;
    var riskBudget = cfg.risk_budget || DL.RISK_BUDGET;
    var prevFrac = Math.max(0, Math.min(1, prevExpFrac === undefined ? 1.0 : prevExpFrac));

    function result(expFrac, curDd, dsVol, ddSig, volSig, baseRisk, isDef) {
        return {
            shield_active: isDef,
            target_exposure: +(expFrac * riskBudget).toFixed(6),
            exposure_frac: +expFrac.toFixed(6),
            global_dd: +curDd.toFixed(4), window_dd: +curDd.toFixed(4), exit_dd: 0,
            ds_vol: +dsVol.toFixed(4), dd_sig: +ddSig.toFixed(4),
            vol_sig: +volSig.toFixed(4), base_risk: +baseRisk.toFixed(4),
            local_max_dd: 0, peak_ds_vol: 0,
            exit_reason: null, entry_triggered: false,
            exit_blocked: false, exit_block_reason: null,
            tranche_1_executed: false, tranche_2_executed: false,
            tranche_amount: 0, tranche_event: null, usdc_reserve: 0,
            entry_pending_count: 0, exit_tranche: -1,
            avg_correlation: 0, corr_gate_blocked: false, shield_active_days: 0
        };
    }

    if (!rets || rets.length === 0) return result(1.0, 0, 0, 0, 0, 0, false);

    // Current drawdown from the all-time peak of the equity curve.
    var equity = 1.0, peak = 1.0;
    for (var i = 0; i < rets.length; i++) {
        equity *= (1 + rets[i]);
        if (equity > peak) peak = equity;
    }
    var curDd = peak > 0 ? (peak - equity) / peak : 0;
    curDd = Math.max(0, curDd);

    // Trailing annualized downside deviation (divides by full segment length).
    var seg = rets.slice(-ddWindow);
    var dsVol = 0;
    if (seg.length >= 2) {
        var ss = 0;
        for (var k = 0; k < seg.length; k++) { if (seg[k] < 0) ss += seg[k] * seg[k]; }
        dsVol = Math.sqrt(ss / seg.length) * Math.sqrt(365.25);
    }

    var ddSig = ddRef > 0 ? Math.max(0, Math.min(1, curDd / ddRef)) : 0;
    var volSig = volHigh > volLow ? Math.max(0, Math.min(1, (dsVol - volLow) / (volHigh - volLow))) : 0;
    var baseRisk = Math.max(0, Math.min(1, wDd * ddSig + wVol * volSig));
    var tgt = 1.0 - baseRisk;

    // Asymmetric ramp: exit fast toward a lower target, re-enter slowly.
    var expFrac;
    if (tgt < prevFrac) expFrac = prevFrac + (tgt - prevFrac) * exitSpeed;
    else expFrac = prevFrac + (tgt - prevFrac) * entrySpeed;
    expFrac = Math.max(0, Math.min(1, expFrac));

    var isDef = expFrac < redeployThresh;
    return result(expFrac, curDd, dsVol, ddSig, volSig, baseRisk, isDef);
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
    // Production deleverage v12.0 modulator defaults — hardcoded, no user-configurable engine params
    return {
        dd_window: DL.DD_WINDOW,
        dd_ref: DL.DD_REF,
        vol_low: DL.VOL_LOW,
        vol_high: DL.VOL_HIGH,
        w_dd: DL.W_DD,
        w_vol: DL.W_VOL,
        exit_speed: DL.EXIT_SPEED,
        entry_speed: DL.ENTRY_SPEED,
        redeploy_thresh: DL.REDEPLOY_THRESH,
        risk_budget: DL.RISK_BUDGET,
        fee_rate: DL.FEE_RATE
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
    var unitsA = startCap, navA = 1.0, usdcR = 0, totalInv = startCap, totalDep = 0;
    var totalFees = 0, rebN = 0;  // Fee tracking
    var eqA = [startCap], invA = [startCap], usdcT = [0];
    var shT = [], expT = [], gDdT = [], eDdT = [], dsVT = [], pkVT = [], gapT = [], corrT = [], bRiskT = [];
    var events = [];
    var shDays = 0, dcaN = 0;
    var prevFrac = 1.0;  // previous exposure fraction (look-ahead safe)
    var redeploy = cfg.redeploy_thresh !== undefined ? cfg.redeploy_thresh : DL.REDEPLOY_THRESH;

    for (var i = 0; i < portRet.length; i++) {
        // Look-ahead safe: decide exposure from data through day i-1.
        var sub = portRet.slice(0, i);
        var res = evaluateShield(sub, cfg, prevFrac);
        var expFrac = res.exposure_frac;
        var eff = res.target_exposure;   // = expFrac * risk_budget (for display)
        var sOn = res.shield_active;      // defensive == expFrac < redeploy

        // Rebalance fee on exposure change (charged before today's return).
        var delta = Math.abs(expFrac - prevFrac);
        if (delta > 1e-6 && unitsA * navA > 0) {
            var tradeVal = delta * (unitsA * navA);
            var fee = tradeVal * cfg.fee_rate;
            totalFees += fee; rebN++;
            navA *= (1 - fee / (unitsA * navA));
        }

        // Look-ahead: apply YESTERDAY's exposure to today's return.
        navA *= (1 + portRet[i] * prevFrac);

        var dayNum = i + 1;
        var isDca = dcaAmt > 0 && dayNum % dcaInt === 0;

        if (isDca) {
            dcaN++;
            if (expFrac >= redeploy) {
                var dcaFee = dcaAmt * cfg.fee_rate;
                totalFees += dcaFee;
                unitsA += (dcaAmt - dcaFee) / navA;
                totalInv += dcaAmt;
                events.push({ day: dayNum, type: 'DCA', gdd: res.global_dd, edd: 0, gap: 0, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: '+$' + dcaAmt + ' \u2192 tokens (fee $' + dcaFee.toFixed(2) + ')' });
            } else {
                usdcR += dcaAmt;
                totalInv += dcaAmt;
                events.push({ day: dayNum, type: 'DCA', gdd: res.global_dd, edd: 0, gap: 0, dsv: res.ds_vol, eff: eff, usdc: usdcR, detail: '+$' + dcaAmt + ' \u2192 USDC (defensive, exp ' + (expFrac * 100).toFixed(0) + '%)' });
            }
        }

        // Redeploy parked cash on the cross-up back into a risk-on regime.
        if (expFrac >= redeploy && usdcR > 0 && navA > 0) {
            var rdFee = usdcR * cfg.fee_rate;
            totalFees += rdFee;
            totalDep += usdcR;
            unitsA += (usdcR - rdFee) / navA;
            events.push({ day: dayNum, type: 'REDEPLOY', gdd: res.global_dd, edd: 0, gap: 0, dsv: res.ds_vol, eff: eff, usdc: 0, detail: '$' + usdcR.toFixed(0) + ' parked cash \u2192 tokens (fee $' + rdFee.toFixed(2) + ')' });
            usdcR = 0;
        }

        prevFrac = expFrac;

        eqA.push(unitsA * navA + usdcR);
        invA.push(totalInv);
        usdcT.push(usdcR);
        shT.push(sOn ? 1 : 0);
        expT.push(eff);
        gDdT.push(res.global_dd);
        eDdT.push(0);
        dsVT.push(res.ds_vol);
        pkVT.push(0);
        gapT.push(0);
        corrT.push(0);
        bRiskT.push(res.base_risk);
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

    return { eqA: eqA, invA: invA, eqB: eqB, invB: invB, usdcT: usdcT, shT: shT, expT: expT, gDdT: gDdT, eDdT: eDdT, dsVT: dsVT, pkVT: pkVT, gapT: gapT, corrT: corrT, bRiskT: bRiskT, events: events, totalInv: totalInv, totalInvB: totalInvB, totalDep: totalDep, shDays: shDays, dcaN: dcaN, totalFees: totalFees, rebN: rebN, bhFees: bhFees };
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

    var redeploys = sim.events.filter(function(e) { return e.type === 'REDEPLOY'; });
    var expFracs = sim.expT.map(function(v) { return cfg.risk_budget > 0 ? v / cfg.risk_budget : 0; });
    var avgExp = expFracs.length ? expFracs.reduce(function(s, v) { return s + v; }, 0) / expFracs.length : 0;
    var minExp = expFracs.length ? Math.min.apply(null, expFracs) : 0;

    btShowStatus('Done: ' + pr.rets.length + ' days, ' + pr.n + ' tokens (' + pr.syms.join(', ') + '), ' + sim.dcaN + ' DCA, ' + sim.shDays + ' defensive days', 'success');

    // Strategy comparison — scored on Calmar + Sharpe (B&H shown as reference only)
    var sr = document.getElementById('btStrategyRow');
    sr.innerHTML = '';
    var c1 = document.createElement('div');
    c1.className = 'bt-strategy-card bt-best';
    c1.innerHTML = '<h3>Deleverage Modulator \u2605</h3>'
        + '<div class="bt-big" style="color:var(--blue)">Calmar ' + m1.cal.toFixed(2) + '</div>'
        + '<div class="bt-sub">Max DD: ' + (m1.mdd * 100).toFixed(1) + '% | Sharpe: ' + m1.sh.toFixed(2) + '</div>'
        + '<div class="bt-sub">Final: $' + m1.final.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' | Return: ' + (m1.ret * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub">Avg exposure: ' + (avgExp * 100).toFixed(0) + '% | Defensive: ' + sim.shDays + '/' + pr.rets.length + ' days</div>'
        + '<div class="bt-sub" style="color:var(--amber)">Fees: $' + sim.totalFees.toFixed(0) + ' (' + sim.rebN + ' rebalances, ' + redeploys.length + ' redeploys)</div>';
    sr.appendChild(c1);

    var c2 = document.createElement('div');
    c2.className = 'bt-strategy-card';
    c2.innerHTML = '<h3>Buy &amp; Hold + DCA (reference)</h3>'
        + '<div class="bt-big" style="color:var(--amber)">Calmar ' + m2.cal.toFixed(2) + '</div>'
        + '<div class="bt-sub">Max DD: ' + (m2.mdd * 100).toFixed(1) + '% | Sharpe: ' + m2.sh.toFixed(2) + '</div>'
        + '<div class="bt-sub">Final: $' + m2.final.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' | Return: ' + (m2.ret * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub" style="color:var(--amber)">Fees: $' + sim.bhFees.toFixed(0) + ' (DCA only)</div>';
    sr.appendChild(c2);

    var ddCut = ((m2.mdd - m1.mdd) * 100).toFixed(1);
    document.getElementById('btCompareExplain').innerHTML = 'Scored on <strong>Calmar</strong> and <strong>Sharpe</strong> (not on beating Buy &amp; Hold). Modulator Calmar <strong>' + m1.cal.toFixed(2) + '</strong>, Sharpe <strong>' + m1.sh.toFixed(2) + '</strong>, Max DD <strong>' + (m1.mdd * 100).toFixed(1) + '%</strong> — a <strong>' + ddCut + 'pp</strong> drawdown reduction vs the B&amp;H reference (' + (m2.mdd * 100).toFixed(1) + '%). Both received identical DCA ($' + dcaAmt + ' every ' + dcaInt + 'd, total $' + (sim.dcaN * dcaAmt).toLocaleString() + ').';

    // Summary explain
    document.getElementById('btSummaryExplain').innerHTML = '<strong>' + pr.n + ' tokens</strong> (' + pr.syms.join(', ') + ') over <strong>' + pr.rets.length + ' days</strong> (~' + years.toFixed(1) + 'y). Defensive (exposure &lt; ' + (cfg.redeploy_thresh * 100).toFixed(0) + '%) on <strong>' + sim.shDays + '</strong>/' + pr.rets.length + ' days. Avg exposure <strong>' + (avgExp * 100).toFixed(0) + '%</strong>, min <strong>' + (minExp * 100).toFixed(0) + '%</strong>. <strong>' + sim.dcaN + '</strong> DCA events, <strong>' + redeploys.length + '</strong> cash redeploys.';

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
        { l: 'Calmar', v: m1.cal.toFixed(2), c: m1.cal > 1.5 ? 'good' : m1.cal > 1 ? 'warn' : '' },
        { l: 'Sharpe', v: m1.sh.toFixed(2), c: m1.sh > 1 ? 'good' : '' },
        { l: 'Avg Exposure', v: (avgExp * 100).toFixed(0) + '%', c: '' },
        { l: 'Min Exposure', v: (minExp * 100).toFixed(0) + '%', c: '' },
        { l: 'Defensive Days', v: sim.shDays, c: '' },
        { l: 'DCA Events', v: sim.dcaN, c: '' },
        { l: 'Cash Redeploys', v: redeploys.length, c: '' },
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

    // Collect defensive-onset indices (exposure crosses below redeploy threshold)
    // for the de-risk annotation lines.
    var entryDays = [];
    for (var di = 1; di < sim.shT.length; di++) {
        if (sim.shT[di] === 1 && sim.shT[di - 1] === 0) entryDays.push(di);
    }

    // Custom Chart.js plugin: draw dashed vertical lines where the modulator turns defensive
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
                    var label = '\u25BC DE-RISK';
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
            plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: '#7a8ba5', maxTicksLimit: 12 }, grid: { color: '#1c2128' } },
                y: { ticks: { color: '#7a8ba5' }, grid: { color: '#1c2128' } }
            }
        };
    };

    // Equity curves
    btCharts.eq = new Chart(document.getElementById('btEquityChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'Deleverage Modulator', data: sim.eqA.slice(1), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', fill: true, pointRadius: 0, borderWidth: 2 },
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

    // Exposure + Shield status (merged) — stepped:'before' for instant transitions
    btCharts.exp = new Chart(document.getElementById('btExposureChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'Exposure', data: sim.expT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.15)', fill: true, pointRadius: 0, borderWidth: 1.5, stepped: 'before', yAxisID: 'y' },
                { label: 'Shield', data: sim.shT, borderColor: function(ctx) { return ctx.raw ? '#f87171' : '#34d399'; }, backgroundColor: function(ctx) { return ctx.raw ? 'rgba(248,113,113,0.2)' : 'rgba(52,211,153,0.05)'; }, fill: true, pointRadius: 0, borderWidth: 1, stepped: true, yAxisID: 'y1' }
            ]
        },
        options: (function() { 
            var o = cO(); 
            o.scales.y = { min: 0, max: 100, ticks: { color: '#7a8ba5', callback: function(v) { return v + '%'; } }, grid: { color: '#1c2128' } };
            o.scales.y1 = { position: 'right', min: -0.1, max: 1.2, ticks: { color: '#7a8ba5', callback: function(v) { return v >= 0.5 ? 'ON' : 'OFF'; } }, grid: { display: false } };
            return o; 
        })(),
        plugins: [emergencyBrakePlugin]
    });

    // Volatility
    btCharts.vol = new Chart(document.getElementById('btVolChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'DS Vol (20d)', data: sim.dsVT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#06b6d4', pointRadius: 0, borderWidth: 1.5 },
                { label: 'Vol Low 30% (de-risk starts)', data: dateLabels.map(function() { return 30; }), borderColor: '#34d399', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 },
                { label: 'Vol High 90% (full de-risk)', data: dateLabels.map(function() { return 90; }), borderColor: '#f87171', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }
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
                { label: 'Drawdown from peak', data: sim.gDdT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.15)', fill: true, pointRadius: 0, borderWidth: 1.5 },
                { label: 'DD Ref 30% (full de-risk)', data: dateLabels.map(function() { return 30; }), borderColor: '#fbbf24', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.ticks.callback = function(v) { return v + '%'; }; return o; })()
    });

    // Regime de-risk signal: base_risk (0..1) drives target exposure = 1 - base_risk
    if (sim.bRiskT && sim.bRiskT.length > 0) {
        btCharts.corr = new Chart(document.getElementById('btCorrChart'), {
            type: 'line',
            data: {
                labels: dateLabels,
                datasets: [
                    { label: 'De-risk signal (base_risk)', data: sim.bRiskT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.12)', fill: true, pointRadius: 0, borderWidth: 2 },
                    { label: 'Exposure', data: sim.expT.map(function(v) { return +((cfg.risk_budget > 0 ? v / cfg.risk_budget : 0) * 100).toFixed(1); }), borderColor: '#a855f7', pointRadius: 0, borderWidth: 1.5, stepped: 'before' },
                    { label: 'Redeploy 50%', data: dateLabels.map(function() { return 50; }), borderColor: '#34d399', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }
                ]
            },
            options: (function() {
                var o = cO();
                o.scales.y.min = 0;
                o.scales.y.max = 100;
                o.scales.y.ticks.callback = function(v) { return v + '%'; };
                return o;
            })(),
            plugins: [emergencyBrakePlugin]
        });
    }

    // Event log
    sim.events.sort(function(a, b) { return a.day - b.day; });
    var tbody = document.querySelector('#btEventsTable tbody');
    tbody.innerHTML = '';
    sim.events.forEach(function(e) {
        var tr = document.createElement('tr');
        var dt = dateLabels[e.day - 1] || ('day ' + e.day);
        tr.innerHTML = '<td>' + dt + '</td><td>' + e.day + '</td><td class="bt-ev-' + e.type.toLowerCase().replace('+', '-') + '">' + e.type + '</td><td>' + (e.gdd * 100).toFixed(1) + '%</td><td>' + (e.dsv * 100).toFixed(1) + '%</td><td>' + (e.eff * 100).toFixed(1) + '%</td><td>$' + (e.usdc || 0).toFixed(0) + '</td><td>' + e.detail + '</td>';
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
        dd_ref: { label: 'DD Ref', values: [0.20, 0.25, 0.30, 0.35, 0.40, 0.50], key: 'dd_ref', fmt: function(v) { return (v * 100).toFixed(0) + '%'; } },
        vol_low: { label: 'Vol Low', values: [0.20, 0.25, 0.30, 0.35, 0.40, 0.45], key: 'vol_low', fmt: function(v) { return (v * 100).toFixed(0) + '%'; } },
        vol_high: { label: 'Vol High', values: [0.60, 0.70, 0.80, 0.90, 1.00, 1.20], key: 'vol_high', fmt: function(v) { return (v * 100).toFixed(0) + '%'; } },
        w_dd: { label: 'DD Weight', values: [0.50, 0.60, 0.70, 0.80, 0.90, 1.00], key: 'w_dd', fmt: function(v) { return v.toFixed(2); } },
        exit_speed: { label: 'Exit Speed', values: [0.30, 0.40, 0.50, 0.60, 0.75, 1.00], key: 'exit_speed', fmt: function(v) { return v.toFixed(2); } },
        entry_speed: { label: 'Entry Speed', values: [0.03, 0.06, 0.10, 0.15, 0.20, 0.30], key: 'entry_speed', fmt: function(v) { return v.toFixed(2); } }
    };
    var sw = ranges[sweep] || ranges.dd_ref;
    var crossP = sw.key !== 'vol_high' ? 'vol_high' : 'dd_ref';
    var cr = ranges[crossP];

    btShowStatus('WF grid: ' + sw.label + ' x ' + cr.label + ' (' + (sw.values.length * cr.values.length) + ' sims)...', 'running');

    var results = [];
    for (var si = 0; si < sw.values.length; si++) {
        for (var ci = 0; ci < cr.values.length; ci++) {
            var cfg = btReadCfg();
            cfg[cr.key] = cr.values[ci];
            cfg[sw.key] = sw.values[si];
            // Keep DD/vol weights complementary when sweeping w_dd.
            cfg.w_vol = Math.max(0, 1 - cfg.w_dd);
            var sim = btSimulate(pr.rets, cfg, startCap, dcaAmt, dcaInt, pr.tokenPrices, pr.syms);
            var m = btCalcMetrics(sim.eqA, sim.totalInv, years);
            var redeployN = sim.events.filter(function(e) { return e.type === 'REDEPLOY'; }).length;
            results.push({ sv: sw.values[si], cv: cr.values[ci], final: m.final, calmar: m.cal, maxdd: m.mdd, sharpe: m.sh, defDays: sim.shDays, redeploys: redeployN });
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
    html += '<th>Def Days</th><th>Redeploys</th></tr></thead><tbody>';
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
        html += '<td>' + any.defDays + '</td><td>' + any.redeploys + '</td></tr>';
    }
    html += '</tbody></table>';

    var best = results.find(function(r) { return r[met.key] === bestVal; });
    html += '<div class="bt-explain" style="margin-top:12px"><strong>Best:</strong> ' + sw.label + '=' + sw.fmt(best.sv) + ', ' + cr.label + '=' + cr.fmt(best.cv) + ' \u2192 ' + met.label + ': ' + met.fmt(bestVal) + ' (scored on Calmar / Sharpe / Max DD, not on beating B&amp;H).</div>';

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

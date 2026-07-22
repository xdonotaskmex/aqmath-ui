(function() {
'use strict';

// ============================================================
//  AQMath Backtest — UI only
//  The Deleverage engine (parameters + modulator math) lives on the
//  server. This file only: parses CSVs in the browser, uploads the
//  parsed price series to the JWT-gated /backtest endpoint, and renders
//  the returned result with Chart.js. No engine parameters ship here.
//  Uploaded series are processed in-memory on the server and discarded.
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

// --- Helpers ---------------------------------------------------------------

// Collect the parsed slots into the payload the server expects.
function btActiveTokens() {
    return btSlots
        .filter(function(s) { return s !== null; })
        .map(function(s) { return { name: s.name, dates: s.dates, prices: s.prices }; });
}

function btNum(id, dflt) {
    var el = document.getElementById(id);
    var raw = el ? String(el.value).trim() : '';
    if (raw === '') return dflt;      // empty -> default
    var n = Number(raw);
    return isNaN(n) ? dflt : n;       // explicit 0 is kept (no more `|| default`)
}

function btInputs() {
    return {
        start_capital: btNum('btStartCapital', 1000),
        dca_amount: btNum('btDcaAmount', 100),   // 0 = no DCA (lump-sum only)
        dca_interval: btNum('btDcaInterval', 30)
    };
}

// Friendly beta gate: backtest runs on the server, so it needs a beta key
// (same gate as the DCA / Optimize engines).
function btRequireBeta() {
    if (typeof isBetaActive === 'function' && isBetaActive()) return true;
    btShowStatus('Enter your beta key above to run a backtest \u2014 the engine runs securely on our server.', 'notice');
    if (typeof showToast === 'function') showToast('Enter your beta key to run a backtest', 'notice');
    return false;
}

// POST parsed series to a JWT-gated engine endpoint and return parsed JSON.
async function btPost(path, body) {
    if (typeof pipelineFetch !== 'function') throw new Error('auth helper unavailable');
    var res = await pipelineFetch(API_URL + path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        throw new Error(err.detail || ('request failed (' + res.status + ')'));
    }
    return res.json();
}

function btShowLoading() {
    var el = document.getElementById('btLoading');
    if (el) el.classList.remove('hidden');
}

function btHideLoading() {
    var el = document.getElementById('btLoading');
    if (el) el.classList.add('hidden');
}

// ============================================================
//  MAIN BACKTEST RUNNER
// ============================================================

async function btRunBacktest() {
    if (!btRequireBeta()) return;
    var tokens = btActiveTokens();
    if (tokens.length < 2) { btShowStatus('Load at least 2 token CSVs to run a backtest.', 'error'); return; }

    btShowLoading();
    btShowStatus('Running backtest...', 'running');
    try {
        var inp = btInputs();
        var data = await btPost('/backtest', {
            tokens: tokens,
            start_capital: inp.start_capital,
            dca_amount: inp.dca_amount,
            dca_interval: inp.dca_interval
        });
        btRenderBacktest(data, inp);
    } catch (e) {
        console.error(e);
        btShowStatus('Could not run backtest: ' + e.message, 'error');
    }
    btHideLoading();
}

function btRenderBacktest(data, inp) {
    var pr = data.pr, sim = data.sim, m1 = data.m1, m2 = data.m2, cfg = data.cfg;
    var days = pr.rets_length;
    var years = days / 365.25;
    var dcaAmt = inp.dca_amount, dcaInt = inp.dca_interval;
    var dateLabels = pr.dates.slice(1);

    var redeploys = sim.events.filter(function(e) { return e.type === 'REDEPLOY'; });
    var expFracs = sim.expT.map(function(v) { return cfg.risk_budget > 0 ? v / cfg.risk_budget : 0; });
    var avgExp = expFracs.length ? expFracs.reduce(function(s, v) { return s + v; }, 0) / expFracs.length : 0;
    var minExp = expFracs.length ? Math.min.apply(null, expFracs) : 0;

    btShowStatus('Done: ' + days + ' days, ' + pr.n + ' tokens (' + pr.syms.join(', ') + '), ' + sim.dcaN + ' DCA, ' + sim.shDays + ' defensive days', 'success');

    // Strategy comparison — scored on Calmar + Sharpe (B&H shown as reference only)
    var sr = document.getElementById('btStrategyRow');
    sr.innerHTML = '';
    var c1 = document.createElement('div');
    c1.className = 'bt-strategy-card bt-best';
    c1.innerHTML = '<h3>Deleverage Modulator \u2605</h3>'
        + '<div class="bt-big" style="color:var(--blue)">Calmar ' + m1.cal.toFixed(2) + '</div>'
        + '<div class="bt-sub">Max DD: ' + (m1.mdd * 100).toFixed(1) + '% | Sharpe: ' + m1.sh.toFixed(2) + '</div>'
        + '<div class="bt-sub">Final: $' + m1.final.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' | Return: ' + (m1.ret * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub">Avg exposure: ' + (avgExp * 100).toFixed(0) + '% | Defensive: ' + sim.shDays + '/' + days + ' days</div>'
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
    document.getElementById('btSummaryExplain').innerHTML = '<strong>' + pr.n + ' tokens</strong> (' + pr.syms.join(', ') + ') over <strong>' + days + ' days</strong> (~' + years.toFixed(1) + 'y). Defensive (exposure &lt; ' + (cfg.redeploy_thresh * 100).toFixed(0) + '%) on <strong>' + sim.shDays + '</strong>/' + days + ' days. Avg exposure <strong>' + (avgExp * 100).toFixed(0) + '%</strong>, min <strong>' + (minExp * 100).toFixed(0) + '%</strong>. <strong>' + sim.dcaN + '</strong> DCA events, <strong>' + redeploys.length + '</strong> cash redeploys.';

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

    // Volatility (reference lines driven by the server's authoritative config)
    var volLowPct = (cfg.vol_low * 100).toFixed(0);
    var volHighPct = (cfg.vol_high * 100).toFixed(0);
    btCharts.vol = new Chart(document.getElementById('btVolChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'DS Vol (20d)', data: sim.dsVT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#06b6d4', pointRadius: 0, borderWidth: 1.5 },
                { label: 'Vol Low ' + volLowPct + '% (de-risk starts)', data: dateLabels.map(function() { return +volLowPct; }), borderColor: '#34d399', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 },
                { label: 'Vol High ' + volHighPct + '% (full de-risk)', data: dateLabels.map(function() { return +volHighPct; }), borderColor: '#f87171', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.ticks.callback = function(v) { return v + '%'; }; return o; })()
    });

    // Drawdowns (DD Ref line driven by server config)
    var ddRefPct = (cfg.dd_ref * 100).toFixed(0);
    btCharts.dd = new Chart(document.getElementById('btDdChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'Drawdown from peak', data: sim.gDdT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.15)', fill: true, pointRadius: 0, borderWidth: 1.5 },
                { label: 'DD Ref ' + ddRefPct + '% (full de-risk)', data: dateLabels.map(function() { return +ddRefPct; }), borderColor: '#fbbf24', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.ticks.callback = function(v) { return v + '%'; }; return o; })()
    });

    // Regime de-risk signal: base_risk (0..1) drives target exposure = 1 - base_risk
    if (sim.bRiskT && sim.bRiskT.length > 0) {
        var redeployPct = (cfg.redeploy_thresh * 100).toFixed(0);
        btCharts.corr = new Chart(document.getElementById('btCorrChart'), {
            type: 'line',
            data: {
                labels: dateLabels,
                datasets: [
                    { label: 'De-risk signal (base_risk)', data: sim.bRiskT.map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.12)', fill: true, pointRadius: 0, borderWidth: 2 },
                    { label: 'Exposure', data: sim.expT.map(function(v) { return +((cfg.risk_budget > 0 ? v / cfg.risk_budget : 0) * 100).toFixed(1); }), borderColor: '#a855f7', pointRadius: 0, borderWidth: 1.5, stepped: 'before' },
                    { label: 'Redeploy ' + redeployPct + '%', data: dateLabels.map(function() { return +redeployPct; }), borderColor: '#34d399', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }
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
}

// ============================================================
//  WALK-FORWARD GRID
// ============================================================

async function btRunWFGrid() {
    // Ignore the <select> onchange handlers until a grid can actually run.
    if (btActiveTokens().length < 2) return;
    if (!btRequireBeta()) return;

    btShowLoading();
    try {
        var inp = btInputs();
        var sweep = document.getElementById('btWfSweep').value;
        var metric = document.getElementById('btWfMetric').value;
        btShowStatus('Running walk-forward grid...', 'running');
        var data = await btPost('/backtest/wf-grid', {
            tokens: btActiveTokens(),
            start_capital: inp.start_capital,
            dca_amount: inp.dca_amount,
            dca_interval: inp.dca_interval,
            sweep: sweep,
            metric: metric
        });
        btRenderWFGrid(data);
    } catch (e) {
        console.error(e);
        btShowStatus('Could not run walk-forward grid: ' + e.message, 'error');
    }
    btHideLoading();
}

function btRenderWFGrid(data) {
    // Value formatters mirror the server-declared format tags (no engine math here).
    function mkFmt(tag) {
        return tag === 'pct'
            ? function(v) { return (v * 100).toFixed(0) + '%'; }
            : function(v) { return v.toFixed(2); };
    }
    var swFmt = mkFmt(data.sweep_fmt);
    var crFmt = mkFmt(data.cross_fmt);
    function metFmt(v) {
        if (data.metric_key === 'final') return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (data.metric_key === 'maxdd') return (v * 100).toFixed(1) + '%';
        return v.toFixed(2);
    }

    var results = data.results;
    var bestVal = data.best_val;
    var mk = data.metric_key;

    var html = '<table class="bt-wf-grid"><thead><tr><th>' + data.sweep_label + ' / ' + data.cross_label + '</th>';
    for (var ci = 0; ci < data.cross_values.length; ci++) html += '<th>' + crFmt(data.cross_values[ci]) + '</th>';
    html += '<th>Def Days</th><th>Redeploys</th></tr></thead><tbody>';
    for (var si = 0; si < data.sweep_values.length; si++) {
        var sv = data.sweep_values[si];
        var row = results.filter(function(r) { return r.sv === sv; });
        var rowVals = row.map(function(r) { return r[mk]; });
        var rowBest = data.metric_hi ? Math.max.apply(null, rowVals) : Math.min.apply(null, rowVals);
        var isBestRow = rowBest === bestVal;
        html += '<tr' + (isBestRow ? ' class="bt-best-row"' : '') + '><th>' + swFmt(sv) + '</th>';
        for (var ri = 0; ri < row.length; ri++) {
            var v = row[ri][mk];
            var isB = v === bestVal;
            var cls = isB ? 'bt-cell-good' : (mk === 'maxdd' && v > 0.5 ? 'bt-cell-bad' : 'bt-cell-mid');
            html += '<td class="' + cls + '">' + metFmt(v) + '</td>';
        }
        var any = row[0];
        html += '<td>' + (any ? any.defDays : 0) + '</td><td>' + (any ? any.redeploys : 0) + '</td></tr>';
    }
    html += '</tbody></table>';

    var best = data.best;
    html += '<div class="bt-explain" style="margin-top:12px"><strong>Best:</strong> ' + data.sweep_label + '=' + swFmt(best.sv) + ', ' + data.cross_label + '=' + crFmt(best.cv) + ' \u2192 ' + data.metric_label + ': ' + metFmt(bestVal) + ' (scored on Calmar / Sharpe / Max DD, not on beating B&amp;H).</div>';

    document.getElementById('btWfGridContainer').innerHTML = html;
    document.getElementById('btWfSection').classList.remove('hidden');
    btShowStatus('Walk-forward grid done. Best: ' + data.sweep_label + '=' + swFmt(best.sv), 'success');
    document.getElementById('btWfSection').scrollIntoView({ behavior: 'smooth' });
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

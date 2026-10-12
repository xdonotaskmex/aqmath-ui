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
var btEventsData = null;   // Proteus (v18) event rows for the current run
var btEventLabels = [];

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
    if (runBtn) runBtn.disabled = n < 2;
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

// The engine enforces the same bounds (and would answer with a 422), but
// checking here first gives the user a readable message instead of a
// validation round-trip.
function btValidateInputs(inp) {
    if (!(inp.start_capital > 0)) return 'Start capital must be greater than 0.';
    if (inp.dca_amount < 0) return 'DCA amount cannot be negative.';
    if (inp.dca_amount > 0 && (inp.dca_interval < 1 || inp.dca_interval > 365))
        return 'DCA interval must be between 1 and 365 days \u2014 set the DCA amount to 0 for a one-time lump-sum run.';
    return null;
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
        throw new Error(btErrDetail(err, res.status));
    }
    return res.json();
}

// FastAPI error bodies: `detail` is a plain string for HTTPExceptions, but an
// array of {loc, msg, type} objects for 422 validation errors. Flatten both
// into something a human can read instead of "[object Object]".
function btErrDetail(err, status) {
    var d = err && err.detail;
    if (typeof d === 'string' && d) return d;
    if (Array.isArray(d) && d.length) {
        return d.map(function(it) {
            var field = Array.isArray(it.loc) ? it.loc.slice(1).join('.') : '';
            var msg = it.msg || 'invalid value';
            return field ? field + ' \u2014 ' + msg : msg;
        }).join(' | ');
    }
    return 'request failed (' + status + ')';
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
    var inp = btInputs();
    var bad = btValidateInputs(inp);
    if (bad) { btShowStatus(bad, 'error'); return; }

    btShowLoading();
    btShowStatus('Running backtest...', 'running');
    try {
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
    var pr = data.pr, cfg = data.cfg;

    // ── Response shape ──────────────────────────────────────────────────────
    // /backtest returns ONE engine leg: Proteus (v18), the production shield,
    // as { engine, sim, bh, m, mBh }. The legacy branch reads the older
    // two-engine payload ({ sim = Aegis v14, sim18, m1, m2, m18 }) so the page
    // keeps working while the engine deploy rolls out. Remove it once
    // api-engine.aqmath.xyz answers with engine: "v18".
    var v18Primary = data.engine === 'v18';
    var legacy = data.sim || {};
    var sim = v18Primary ? data.sim : (data.sim18 || null);
    var m = v18Primary ? data.m : (data.m18 || null);
    var mBh = v18Primary ? data.mBh : data.m2;
    var bh = v18Primary ? (data.bh || {}) : {
        eqB: legacy.eqB, totalInvB: legacy.totalInvB, bhFees: legacy.bhFees
    };
    if (!sim || !m || !mBh) {
        btShowStatus('The engine returned no Proteus (v18) leg. Reload the page and run it again.', 'error');
        return;
    }
    // invA (cumulative capital put in) is engine-independent: both engines add
    // every DCA contribution to it whether it buys tokens or parks as USDC.
    // The legacy payload only carried it on the v14 leg, so fall back to that.
    var invA = sim.invA || legacy.invA || [];

    var days = pr.rets_length;
    var years = days / 365.25;
    var dcaAmt = inp.dca_amount, dcaInt = inp.dca_interval;
    var dateLabels = pr.dates.slice(1);

    var redeploys = (sim.events || []).filter(function(e) { return e.type === 'REDEPLOY'; });
    function expFracs(s) {
        return (s.expT || []).map(function(v) { return cfg.risk_budget > 0 ? v / cfg.risk_budget : 0; });
    }
    function expStats(s) {
        var f = expFracs(s);
        if (!f.length) return { avg: 0, min: 0 };
        return { avg: f.reduce(function(a, v) { return a + v; }, 0) / f.length,
                 min: Math.min.apply(null, f) };
    }
    var v18x = expStats(sim);

    // One engine on the user's basket; Buy & Hold is the reference, not a
    // competitor. The tag states the deployed fact: Proteus (v18) IS the
    // production engine (see bt.enginesNotice / shield.nextgen).
    var engine = { label: 'Proteus v18 · Adaptive', tag: 'production' };

    function money(v) { return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
    btShowStatus('Done: ' + days + ' days, ' + pr.n + ' tokens (' + pr.syms.join(', ') + ') — final: '
        + 'Proteus v18 ' + money(m.final) + ' · B&H ' + money(mBh.final), 'success');

    // Strategy comparison — scored on Calmar + Sharpe (B&H shown as reference only)
    var sr = document.getElementById('btStrategyRow');
    sr.innerHTML = '';
    var c1 = document.createElement('div');
    c1.className = 'bt-strategy-card';
    c1.innerHTML = '<h3>' + engine.label + '</h3>'
        + '<div class="bt-big" style="color:var(--purple)">Calmar ' + m.cal.toFixed(2) + '</div>'
        + '<div class="bt-sub">' + engine.tag + ' | Max DD: ' + (m.mdd * 100).toFixed(1) + '% | Sharpe: ' + m.sh.toFixed(2) + '</div>'
        + '<div class="bt-sub">Final: ' + money(m.final) + ' | Return: ' + (m.ret * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub">Avg exposure: ' + (v18x.avg * 100).toFixed(0) + '% | Defensive: ' + sim.shDays + '/' + days + ' days</div>'
        + '<div class="bt-sub" style="color:var(--amber)">Fees: $' + sim.totalFees.toFixed(0) + ' (' + sim.rebN + ' rebalances)</div>';
    sr.appendChild(c1);

    var c2 = document.createElement('div');
    c2.className = 'bt-strategy-card';
    c2.innerHTML = '<h3>Buy &amp; Hold + DCA (reference)</h3>'
        + '<div class="bt-big" style="color:var(--amber)">Calmar ' + mBh.cal.toFixed(2) + '</div>'
        + '<div class="bt-sub">reference | Max DD: ' + (mBh.mdd * 100).toFixed(1) + '% | Sharpe: ' + mBh.sh.toFixed(2) + '</div>'
        + '<div class="bt-sub">Final: ' + money(mBh.final) + ' | Return: ' + (mBh.ret * 100).toFixed(1) + '%</div>'
        + '<div class="bt-sub">Avg exposure: 100% | Defensive: 0/' + days + ' days</div>'
        + '<div class="bt-sub" style="color:var(--amber)">Fees: $' + (bh.bhFees || 0).toFixed(0) + ' (DCA only)</div>';
    sr.appendChild(c2);

    var macroInt = pr.macro_interval_days || 180;
    document.getElementById('btCompareExplain').innerHTML = 'The <strong>production engine, Proteus (v18)</strong>, and the <strong>Buy &amp; Hold reference</strong> ran the <strong>same basket, capital and DCA</strong> ($' + dcaAmt + ' every ' + dcaInt + 'd, total $' + (sim.dcaN * dcaAmt).toLocaleString() + '). Scored on <strong>Calmar</strong> and <strong>Sharpe</strong>, not on beating Buy &amp; Hold: Calmar <strong>' + m.cal.toFixed(2) + '</strong>, Sharpe <strong>' + m.sh.toFixed(2) + '</strong>. Drawdown reduction vs the B&amp;H reference (' + (mBh.mdd * 100).toFixed(1) + '%): <strong>' + ((mBh.mdd - m.mdd) * 100).toFixed(1) + 'pp</strong>. The basket follows the production <strong>' + macroInt + '-day macro loop</strong> &mdash; a KKT risk-parity re-optimisation every ' + macroInt + ' days (<strong>' + (pr.macro_reopts || 0) + '</strong> re-opts in this window).';

    // Metrics table — the production engine against the B&H reference. No
    // best-cell highlighting: with one engine there is nothing to rank.
    var ct = document.getElementById('btCompareTable');
    if (ct) {
        var cols = [
            { label: 'Proteus v18 · Adaptive', m: m, s: sim },
            { label: 'Buy & Hold', m: mBh, s: null }
        ];
        var rows = [
            { l: 'Final Value', get: function(c) { return c.m.final; }, fmt: money },
            { l: 'Total Return', get: function(c) { return c.m.ret; }, fmt: function(v) { return (v * 100).toFixed(1) + '%'; } },
            { l: 'Ann. Return', get: function(c) { return c.m.ann; }, fmt: function(v) { return (v * 100).toFixed(1) + '%'; } },
            { l: 'XIRR', get: function(c) { return c.m.xi; }, fmt: function(v) { return (v * 100).toFixed(1) + '%'; } },
            { l: 'Max Drawdown', get: function(c) { return c.m.mdd; }, fmt: function(v) { return (v * 100).toFixed(1) + '%'; } },
            { l: 'Calmar', get: function(c) { return c.m.cal; }, fmt: function(v) { return v.toFixed(2); } },
            { l: 'Sharpe', get: function(c) { return c.m.sh; }, fmt: function(v) { return v.toFixed(2); } },
            { l: 'Defensive Days', get: function(c) { return c.s ? c.s.shDays : 0; }, fmt: function(v) { return String(v); } },
            { l: 'Rebalances', get: function(c) { return c.s ? c.s.rebN : 0; }, fmt: function(v) { return String(v); } },
            { l: 'Total Fees', get: function(c) { return c.s ? c.s.totalFees : (bh.bhFees || 0); }, fmt: function(v) { return '$' + v.toFixed(0); } }
        ];
        var html = '<table class="bt-wf-grid"><thead><tr><th>Metric</th>';
        cols.forEach(function(c) { html += '<th>' + c.label + '</th>'; });
        html += '</tr></thead><tbody>';
        rows.forEach(function(r) {
            html += '<tr><th>' + r.l + '</th>';
            cols.forEach(function(c) { html += '<td>' + r.fmt(r.get(c)) + '</td>'; });
            html += '</tr>';
        });
        html += '</tbody></table>';
        ct.innerHTML = html;
    }

    // Summary explain
    document.getElementById('btSummaryExplain').innerHTML = '<strong>' + pr.n + ' tokens</strong> (' + escapeHtml(pr.syms.join(', ')) + ') over <strong>' + days + ' days</strong> (~' + years.toFixed(1) + 'y). Proteus v18 (production): defensive (exposure &lt; ' + (cfg.redeploy_thresh * 100).toFixed(0) + '%) on <strong>' + sim.shDays + '</strong>/' + days + ' days, avg exposure <strong>' + (v18x.avg * 100).toFixed(0) + '%</strong>, <strong>' + sim.dcaN + '</strong> DCA events, <strong>' + redeploys.length + '</strong> cash redeploys, <strong>' + (sim.boostDays || 0) + '</strong> V-bounce boost days.';

    // Metrics grid (Proteus v18 production detail)
    var mg = document.getElementById('btMetricsGrid');
    mg.innerHTML = '';
    var metrics = [
        { l: 'Final Value', v: money(m.final), c: m.final > m.totalIn ? 'good' : 'bad' },
        { l: 'Total Invested', v: '$' + m.totalIn.toLocaleString(), c: '' },
        { l: 'Net Profit', v: money(m.final - m.totalIn), c: m.final > m.totalIn ? 'good' : 'bad' },
        { l: 'Return', v: (m.ret * 100).toFixed(1) + '%', c: m.ret > 0 ? 'good' : 'bad' },
        { l: 'Ann. Return', v: (m.ann * 100).toFixed(1) + '%', c: '' },
        { l: 'XIRR', v: (m.xi * 100).toFixed(1) + '%', c: '' },
        { l: 'Max DD', v: (m.mdd * 100).toFixed(1) + '%', c: m.mdd > 0.40 ? 'bad' : m.mdd > 0.25 ? 'warn' : 'good' },
        { l: 'Calmar', v: m.cal.toFixed(2), c: m.cal > 1.5 ? 'good' : m.cal > 1 ? 'warn' : '' },
        { l: 'Sharpe', v: m.sh.toFixed(2), c: m.sh > 1 ? 'good' : '' },
        { l: 'Avg Exposure', v: (v18x.avg * 100).toFixed(0) + '%', c: '' },
        { l: 'Min Exposure', v: (v18x.min * 100).toFixed(0) + '%', c: '' },
        { l: 'Defensive Days', v: sim.shDays, c: '' },
        { l: 'V-Bounce Boost Days', v: sim.boostDays || 0, c: '' },
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

    // Equity curves — the production engine + the B&H reference
    var eqDatasets = [
        { label: 'Proteus v18 · Adaptive', data: sim.eqA.slice(1), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.08)', fill: true, pointRadius: 0, borderWidth: 2 },
        { label: 'Buy & Hold + DCA', data: (bh.eqB || []).slice(1), borderColor: '#fbbf24', borderDash: [4, 3], fill: false, pointRadius: 0, borderWidth: 1.5 }
    ];
    btCharts.eq = new Chart(document.getElementById('btEquityChart'), {
        type: 'line',
        data: { labels: dateLabels, datasets: eqDatasets },
        options: (function() { var o = cO(); o.scales.y.ticks.callback = function(v) { return '$' + (v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0)); }; return o; })(),
        plugins: [emergencyBrakePlugin]
    });

    // Capital breakdown (Proteus v18): what the shield holds in tokens vs the
    // USDC it parks while defensive.
    var usdcT = sim.usdcT || [];
    var tokInv = invA.map(function(v, i) { return v - (usdcT[i] || 0); });
    btCharts.cap = new Chart(document.getElementById('btCapitalChart'), {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                { label: 'In Tokens', data: tokInv.slice(1), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.15)', fill: true, pointRadius: 0, borderWidth: 1.5, stack: 'a' },
                { label: 'USDC Reserve', data: usdcT.slice(1), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.25)', fill: true, pointRadius: 0, borderWidth: 1, stack: 'a' },
                { label: 'B&H Equity', data: (bh.eqB || []).slice(1), borderColor: '#fbbf24', borderDash: [4, 3], fill: false, pointRadius: 0, borderWidth: 1.5 }
            ]
        },
        options: (function() { var o = cO(); o.scales.y.stacked = true; o.scales.y.ticks.callback = function(v) { return '$' + v.toLocaleString(); }; return o; })()
    });

    // Exposure — Proteus v18 held exposure × risk budget
    var expDatasets = [
        { label: 'Proteus v18', data: (sim.expT || []).map(function(v) { return +(v * 100).toFixed(1); }), borderColor: '#a855f7', fill: false, pointRadius: 0, borderWidth: 1.5, stepped: 'before' }
    ];
    btCharts.exp = new Chart(document.getElementById('btExposureChart'), {
        type: 'line',
        data: { labels: dateLabels, datasets: expDatasets },
        options: (function() {
            var o = cO();
            o.scales.y = { min: 0, max: 100, ticks: { color: '#7a8ba5', callback: function(v) { return v + '%'; } }, grid: { color: '#1c2128' } };
            return o;
        })(),
        plugins: [emergencyBrakePlugin]
    });

    // Event log — one engine, so no selector
    btEventsData = (sim.events || []).slice();
    btEventLabels = dateLabels;
    btRenderEvents();

    document.getElementById('btResultsSection').classList.remove('hidden');
    document.getElementById('btResultsSection').scrollIntoView({ behavior: 'smooth' });
}

// Render the Proteus (v18) event table.
function btRenderEvents() {
    if (!btEventsData) return;
    var events = btEventsData.slice();
    events.sort(function(a, b) { return a.day - b.day; });
    var tbody = document.querySelector('#btEventsTable tbody');
    tbody.innerHTML = '';
    events.forEach(function(e) {
        var tr = document.createElement('tr');
        var dt = btEventLabels[e.day - 1] || ('day ' + e.day);
        tr.innerHTML = '<td>' + dt + '</td><td>' + e.day + '</td><td class="bt-ev-' + escapeHtml(e.type.toLowerCase().replace('+', '-')) + '">' + escapeHtml(e.type) + '</td><td>' + (e.eff * 100).toFixed(1) + '%</td><td>$' + (e.usdc || 0).toFixed(0) + '</td><td>' + escapeHtml(e.detail) + '</td>';
        tbody.appendChild(tr);
    });
}

function btResetAll() {
    for (var i = 0; i < 5; i++) btRemoveSlot(i);
    document.getElementById('btResultsSection').classList.add('hidden');
    document.getElementById('btStatusBar').className = 'bt-status';
}

// Expose to global for onclick handlers
window.btHandleFile = btHandleFile;
window.btRemoveSlot = btRemoveSlot;
window.btRunBacktest = btRunBacktest;
window.btResetAll = btResetAll;

})();

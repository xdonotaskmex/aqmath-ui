// ============================================================================
// app-boot.js — externalized inline logic + CSP-safe event delegation
//
// Everything here previously lived in inline <script> blocks / inline on*=
// attributes in index.html. Moving it into a first-party file lets the CSP
// drop 'unsafe-inline' from script-src, which is what actually stops an
// injected <script> or event-handler attribute from executing.
//
// Loaded LAST (defer) so every handler target defined in app.js / app-widgets
// / app-backtest is already available when a user event fires.
// ============================================================================

// ---------------------------------------------------------------------------
// 1) Landing terminal typing animation (was inline block at index.html L165)
// ---------------------------------------------------------------------------
(function () {
    var els = [
        document.getElementById('termLine0'),
        document.getElementById('termLine1'),
        document.getElementById('termLine2'),
        document.getElementById('termLine3')
    ];
    if (!els[0] || !els[1] || !els[2] || !els[3]) return;

    var sets = [
        [
            'computing risk parity weights...',
            'covariance matrix computed (BTC\u00d7SUI\u00d7XMR) \u2014 KKT projection converged',
            'reading regime signal (drawdown + downside vol)...',
            'regime healthy \u2014 exposure set: 87.3% risky / 12.7% USDC'
        ],
        [
            'deleverage modulator: tracking drawdown + downside volatility...',
            '\u26a0 DE-RISK \u2014 drawdown + downside vol rising, exposure scaled down fast',
            'rerouting DCA to USDC reserve while defensive...',
            'capital preserved \u2014 drawdown held to 35.0% vs 83.8% buy & hold'
        ],
        [
            'regime clearing: drawdown/vol easing \u2014 re-entering gradually...',
            'parked USDC redeployed to tokens as exposure recovers \u2265 40%',
            'continuous exposure control \u2014 no timers, no correlation gate',
            'exposure fully data-driven across 106 DCA events'
        ],
        [
            'backtest validation: 3,184 days (ADA/BNB/ETH/XRP/XLM) \u2014 8.7 years...',
            'scored on risk-adjusted return, not on beating buy & hold',
            'Sharpe 0.93 vs B&H 0.75 \u2014 now beats buy & hold risk-adjusted',
            'max drawdown 35.0% vs 83.8% \u2014 less than half the pain'
        ],
        [
            'privacy audit: processing portfolio in-memory...',
            '0 bytes persisted \u2014 no wallet, no account, no data stored',
            'ephemeral processing: data received \u2192 computed \u2192 discarded',
            'your portfolio stays in your browser. we never see it.'
        ]
    ];

    var CHAR_DELAY = 28;
    var LINE_DELAY = 300;
    var PAUSE_AFTER_SET = 3500;
    var setIdx = 0;

    function typeLine(lineIdx, text, charIdx, cb) {
        if (charIdx <= text.length) {
            els[lineIdx].textContent = text.substring(0, charIdx);
            setTimeout(function () { typeLine(lineIdx, text, charIdx + 1, cb); }, CHAR_DELAY);
        } else {
            cb();
        }
    }

    function typeSet(set, lineIdx, done) {
        if (lineIdx >= set.length) return done();
        els[lineIdx].textContent = '';
        typeLine(lineIdx, set[lineIdx], 0, function () {
            setTimeout(function () { typeSet(set, lineIdx + 1, done); }, LINE_DELAY);
        });
    }

    function clearLines() {
        for (var i = 0; i < els.length; i++) els[i].textContent = '';
    }

    function renderFull(set) {
        for (var i = 0; i < els.length; i++) els[i].textContent = set[i] || '';
    }

    // Persist the active set across reloads / SPA navigations so the terminal
    // resumes where it left off instead of restarting from a blank frame — that
    // blank-to-text jump on every page load is the flicker we want to kill.
    var STORE_KEY = 'aqTermSet';
    function persist(idx) {
        try { sessionStorage.setItem(STORE_KEY, String(idx)); } catch (e) { /* storage disabled */ }
    }

    function loop() {
        clearLines();
        typeSet(sets[setIdx], 0, function () {
            persist(setIdx);
            setTimeout(function () {
                setIdx = (setIdx + 1) % sets.length;
                loop();
            }, PAUSE_AFTER_SET);
        });
    }

    var cached = null;
    try { cached = sessionStorage.getItem(STORE_KEY); } catch (e) { /* storage disabled */ }

    if (cached !== null && sets[+cached]) {
        // Returning within the session: paint the cached set instantly (no blank
        // flash), hold it like a freshly-finished set, then continue typing.
        setIdx = +cached;
        renderFull(sets[setIdx]);
        setTimeout(function () {
            setIdx = (setIdx + 1) % sets.length;
            loop();
        }, PAUSE_AFTER_SET);
    } else {
        // First visit this session: full typewriter from the top.
        setIdx = 0;
        loop();
    }
})();

// ---------------------------------------------------------------------------
// 2) Live paper-trading fragment (was inline block at index.html L1710)
//    Server-side fragment regenerated daily at 01:30 UTC. The fragment is
//    engine output, but it arrives over the network, so it is parsed in an
//    inert document and stripped down to its presentational subset before it
//    touches the live DOM (see sanitizeFirstPartyHtml). On any failure the
//    bundled snapshot stays.
// ---------------------------------------------------------------------------
function sanitizeFirstPartyHtml(html) {
    // The forward-log fragment only ever needs text, layout tags and SVG.
    // Anything that can run code, load a resource or submit a form is dropped:
    // bad tags removed, on* handler attributes stripped, URLs allowed only when
    // same-site. DOMParser never executes scripts, so this pass is CSP-safe.
    var BAD_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, FRAME: 1, OBJECT: 1,
                     EMBED: 1, LINK: 1, META: 1, BASE: 1, FORM: 1,
                     TEMPLATE: 1, NOSCRIPT: 1 };
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var els = doc.body.getElementsByTagName('*');
    // Live NodeList: walk backwards so removals don't shift the iteration.
    for (var i = els.length - 1; i >= 0; i--) {
        var el = els[i];
        if (BAD_TAGS[el.tagName]) {
            el.parentNode.removeChild(el);
            continue;
        }
        var attrs = el.attributes;
        for (var j = attrs.length - 1; j >= 0; j--) {
            var name = attrs[j].name.toLowerCase();
            if (name.slice(0, 2) === 'on' || name === 'srcdoc' || name === 'formaction') {
                el.removeAttribute(attrs[j].name);
                continue;
            }
            if (name === 'href' || name === 'src' || name === 'xlink:href') {
                // Strip control chars/whitespace so "java\tscript:" style bypasses fail.
                var val = (attrs[j].value || '').replace(/[\u0000-\u0020]/g, '').toLowerCase();
                var ok = val.charAt(0) === '#' || val.charAt(0) === '/' ||
                         val.slice(0, 20) === 'https://aqmath.xyz/' ||
                         val.slice(0, 31) === 'https://api-backtest.aqmath.xyz';
                if (!ok) el.removeAttribute(attrs[j].name);
            }
        }
    }
    return doc.body.innerHTML;
}

// The forward-log fragment is regenerated daily on the server and swapped in
// via fetch, so it can never carry data-i18n attributes. Instead the canonical
// EN markup is kept per box and re-rendered on every language switch: EN is a
// verbatim pass-through, zh-CN is rebuilt from locale keys (rv.fl*), with the
// live figures (dates, amounts, ratios) re-extracted from the EN source so a
// daily regeneration can never invalidate the translation.
var _flOriginals = {};

function renderForwardLog(box) {
    if (!box) return;
    var src = _flOriginals[box.id] || box.innerHTML;
    _flOriginals[box.id] = src;
    box.innerHTML = src;
    try {
        if ((localStorage.getItem('aqmath-lang') || 'en') === 'zh-CN') {
            localizeForwardLog(box);
        }
    } catch (e) { /* storage disabled — EN snapshot already applied */ }
}

function localizeForwardLog(box) {
    if (!window.i18next || typeof i18next.t !== 'function') return;
    function t(key, opts) {
        var s = i18next.t(key, opts || {});
        return (s && s !== key) ? s : null;
    }
    var s, m;

    var h2 = box.querySelector('.rv-h2');
    if (h2 && /Live Paper Trading/.test(h2.textContent)) {
        s = t('rv.flTitle');
        if (s) h2.textContent = s;
    }

    var note = box.querySelector('.rv-note');
    if (note) {
        var nh = note.innerHTML;
        var mf = nh.match(/frozen on (\d{4}-\d{2}-\d{2})/);
        var mr = nh.match(/re-optimisation:\s*<strong>(\d{4}-\d{2}-\d{2})<\/strong>/);
        if (mf && mr) {
            s = t('rv.flNote', { frozen: mf[1], reopt: mr[1] });
            if (s) note.innerHTML = s;
        }
    }

    box.querySelectorAll('.rv-card').forEach(function (card) {
        var lbl = card.querySelector('.rv-lbl');
        var sub = card.querySelector('.rv-sub');
        if (!lbl) return;
        var txt = sub ? sub.textContent : '';
        switch (lbl.textContent) {
        case 'virtual equity':
            s = t('rv.flEq'); if (s) lbl.textContent = s;
            if (sub) {
                m = txt.match(/as of (\d{4}-\d{2}-\d{2}) \u00b7 (\$[\d,]+) invested since (\d{4}-\d{2}-\d{2})/);
                if (m) { s = t('rv.flEqSub', { date: m[1], amt: m[2], start: m[3] }); if (s) sub.textContent = s; }
            }
            break;
        case 'buy & hold benchmark':
            s = t('rv.flBh'); if (s) lbl.textContent = s;
            if (sub) {
                m = txt.match(/same (\$[\d,]+) invested \u00b7 max drawdown ([\d.]+%)/);
                if (m) { s = t('rv.flBhSub', { amt: m[1], dd: m[2] }); if (s) sub.textContent = s; }
            }
            break;
        case 'risky exposure':
            s = t('rv.flExp'); if (s) lbl.textContent = s;
            if (sub) {
                var neg = sub.querySelector('.neg');
                if (neg) { var d = t('rv.flExpDef'); if (d) neg.textContent = d; }
                m = txt.match(/shield dial ([\d.]+%)/);
                if (m) {
                    s = t('rv.flExpDial', { pct: m[1] });
                    if (s) sub.innerHTML = neg ? neg.outerHTML + ' \u00b7 ' + s : s;
                }
            }
            break;
        case 'Calmar ratio':
            s = t('rv.flCalmar'); if (s) lbl.textContent = s;
            if (sub) {
                m = txt.match(/\(([\d.]+%)\) \u00b7 since (\d{4}-\d{2}-\d{2}) \u00b7 B&H: (-?[\d.]+)/);
                if (m) { s = t('rv.flCalmarSub', { dd: m[1], start: m[2], bh: m[3] }); if (s) sub.textContent = s; }
            }
            break;
        case 'Sharpe ratio':
            s = t('rv.flSharpe'); if (s) lbl.textContent = s;
            if (sub) {
                m = txt.match(/since (\d{4}-\d{2}-\d{2}) \u00b7 B&H: (-?[\d.]+)/);
                if (m) { s = t('rv.flSharpeSub', { start: m[1], bh: m[2] }); if (s) sub.textContent = s; }
            }
            break;
        case 'forward days':
            s = t('rv.flDays'); if (s) lbl.textContent = s;
            if (sub) { s = t('rv.flDaysSub'); if (s) sub.textContent = s; }
            break;
        case 'next re-optimisation':
            s = t('rv.flReopt'); if (s) lbl.textContent = s;
            if (sub) { s = t('rv.flReoptSub'); if (s) sub.textContent = s; }
            break;
        }
    });

    var disc = box.querySelector('.rv-disc');
    if (disc) {
        var dt = disc.textContent;
        var md = dt.match(/Telemetry generated (\d{4}-\d{2}-\d{2})/);
        var mz = dt.match(/frozen (\d{4}-\d{2}-\d{2})/);
        if (md && mz) {
            s = t('rv.flTelemetry', { date: md[1], frozen: mz[1] });
            if (s) disc.innerHTML = s;
        }
    }
}

(function () {
    var box = document.getElementById('forwardLogLive');
    if (!box) return;
    _flOriginals[box.id] = box.innerHTML;   // baked EN snapshot
    if (!window.fetch) return;
    fetch('https://api-backtest.aqmath.xyz/forward-log')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) {
            _flOriginals[box.id] = sanitizeFirstPartyHtml(html);
            renderForwardLog(box);
        })
        .catch(function () { /* keep the bundled snapshot */ });
})();

// Parallel v15 experiment fragment: same sanitizer, revealed only when the
// fetch succeeds — on any failure the section stays hidden.
(function () {
    var box = document.getElementById('forwardLogV15');
    if (!box || !window.fetch) return;
    fetch('https://api-backtest.aqmath.xyz/forward-log-v15')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) {
            _flOriginals[box.id] = sanitizeFirstPartyHtml(html);
            box.hidden = false;
            renderForwardLog(box);
        })
        .catch(function () { /* experimental section stays hidden */ });
})();

// Parallel v16 experiment fragment: same sanitizer, revealed only when the
// fetch succeeds — on any failure the section stays hidden.
(function () {
    var box = document.getElementById('forwardLogV16');
    if (!box || !window.fetch) return;
    fetch('https://api-backtest.aqmath.xyz/forward-log-v16')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) {
            _flOriginals[box.id] = sanitizeFirstPartyHtml(html);
            box.hidden = false;
            renderForwardLog(box);
        })
        .catch(function () { /* experimental section stays hidden */ });
})();

// ---------------------------------------------------------------------------
// 3) i18n / language switching (was inline block at index.html L2573)
// ---------------------------------------------------------------------------
var i18nResources = {};
var i18nReady = false;

function loadLocale(lang) {
    return fetch('/locales/' + lang + '.json?v=d959d4bf66')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
}

function switchLang(lang) {
    document.querySelectorAll('.lp-lang-btn').forEach(function (btn) {
        btn.classList.toggle('lp-lang-active', btn.getAttribute('data-lang') === lang);
    });
    localStorage.setItem('aqmath-lang', lang);

    loadLocale(lang).then(function (res) {
        if (!res) return;
        i18nResources[lang] = { translation: res };
        i18next.init({ lng: lang, resources: i18nResources, fallbackLng: 'en' }, function (err) {
            if (err) return;
            i18nReady = true;
            applyTranslations();
        });
    });
}

function applyTranslations() {
    if (!i18nReady) return;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.getAttribute('data-i18n');
        var t = i18next.t(key);
        if (t && t !== key) el.textContent = t;
    });
    // /locales/*.json is first-party, self-hosted content — safe for innerHTML.
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
        var key = el.getAttribute('data-i18n-html');
        var t = i18next.t(key);
        if (t && t !== key) el.innerHTML = t;
    });
    // Server-rendered forward-log fragments carry no data-i18n — re-render
    // each box from its stored EN original for the active language.
    ['forwardLogLive', 'forwardLogV15', 'forwardLogV16'].forEach(function (id) {
        renderForwardLog(document.getElementById(id));
    });
}

(function () {
    var savedLang = localStorage.getItem('aqmath-lang') || 'en';
    switchLang(savedLang);
})();

// ---------------------------------------------------------------------------
// 4) Event delegation — replaces every inline on*= attribute.
//    A single document-level listener dispatches through a CLOSED allowlist:
//    the data-action value is only ever used as a key into this map, never
//    executed, so a forged attribute cannot reach anything not listed here.
//    Delegation also covers table rows created later via innerHTML.
// ---------------------------------------------------------------------------
(function () {
    var CLICK = {
        // no-argument portfolio / app actions
        osvjeziSveCijene: function () { osvjeziSveCijene(); },
        exportJSON: function () { exportJSON(); },
        obrisiSve: function () { obrisiSve(); },
        deactivateBeta: function () { deactivateBeta(); },
        activateBeta: function () { activateBeta(); },
        dodajToken: function () { dodajToken(); },
        recordBuy: function () { recordBuy(); },
        recordSell: function () { recordSell(); },
        distribuirajDca: function () { distribuirajDca(); },
        confirmDca: function () { confirmDca(); },
        cancelDca: function () { cancelDca(); },
        optimizePortfolio: function () { optimizePortfolio(); },
        refreshHistory: function () { refreshHistory(); },
        toggleGlobalSafeHaven: function () { toggleGlobalSafeHaven(); },
        deployUSDC: function () { deployUSDC(); },
        toggleDeleverage: function () { toggleDeleverage(); },
        saveSnapshot: function () { saveSnapshot(); },
        btRunBacktest: function () { btRunBacktest(); },
        btRunWFGrid: function () { btRunWFGrid(); },
        btResetAll: function () { btResetAll(); },
        hideProModal: function () { hideProModal(); },
        reloadApp: function () { window.location.reload(); },
        closeWhatsNew: function () {
            var card = document.getElementById('whatsNew');
            if (card) card.classList.add('hidden');
            localStorage.setItem('aqmath-whatsnew-seen', '2.1');
        },
        // signal-only automation (app-notify.js)
        showHowAqmath: function () { showHowAqmath(false); },
        hideHowAqmath: function () { hideHowAqmath(); },
        ackHowAqmath: function () { ackHowAqmath(); },
        syncShieldPortfolio: function () { syncShieldPortfolio(); },
        saveShieldSettings: function () { saveShieldSettings(); },
        enableNotifications: function () { enableNotifications(); },
        disableNotifications: function () { disableNotifications(); },
        copyField: function (el) { _copyText(el); },
        // One-Tap Alignment signal actions (app-notify.js)
        confirmSignal: function (el, arg) { confirmSignal(el, arg); },
        skipSignal: function (el, arg) { skipSignal(el, arg); },
        skipAllSignals: function () { skipAllSignals(); },
        showAdjustForm: function (el, arg) { showAdjustForm(el, arg); },
        hideAdjustForm: function (el, arg) { hideAdjustForm(el, arg); },
        adjustSignal: function (el, arg) { adjustSignal(el, arg); },
        // argument actions (arg comes from data-arg)
        lang: function (el, arg) { switchLang(arg); },
        clickEl: function (el, arg) { var t = document.getElementById(arg); if (t) t.click(); },
        btRemoveSlot: function (el, arg) { btRemoveSlot(parseInt(arg, 10)); },
        toggleFreeze: function (el, arg) { toggleFreeze(arg); },
        popuniFormu: function (el, arg) { popuniFormu(arg); },
        obrisiToken: function (el, arg) { obrisiToken(arg); },
        // DOM-only behaviour (no app function)
        toggleParentOpen: function (el) { el.parentElement.classList.toggle('open'); },
        toggleOpen: function (el) { el.classList.toggle('open'); },
        toggleHamburger: function (el) {
            var hdr = el.closest('.hdr');
            if (hdr) hdr.classList.toggle('menu-open');
        },
        hideToast: function (el, arg, e) { hideToast(e); },
        stop: function (el, arg, e) { e.stopPropagation(); }
    };

    var CHANGE = {
        importCSV: function (el, arg, e) { importCSV(e); },
        importJSON: function (el, arg, e) { importJSON(e); },
        btRunWFGrid: function () { btRunWFGrid(); },
        btHandleFile: function (el, arg) { btHandleFile(parseInt(arg, 10), el); }
    };

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        var fn = CLICK[el.getAttribute('data-action')];
        if (fn) fn(el, el.getAttribute('data-arg'), e);
    });

    document.addEventListener('change', function (e) {
        var el = e.target.closest('[data-change]');
        if (!el) return;
        var fn = CHANGE[el.getAttribute('data-change')];
        if (fn) fn(el, el.getAttribute('data-arg'), e);
    });
})();

// ---------------------------------------------------------------------------
// 5) Freshness check - every visitor runs the latest build.
//    The whole asset set is pinned to one build id (?v=..., written by
//    tools/stamp_version.py), and that id is mirrored to /version.txt at
//    build time. If this tab loaded an older cached build, its own ?v= stamp
//    differs from the published one, so show the update banner - one reload
//    then brings the user to the complete new build, never a mixed one.
//    Re-checked when the tab is brought back to the foreground: this app is
//    left open for days, and a load-time-only check would never notice a build
//    that shipped after the tab was opened.
// ---------------------------------------------------------------------------
(function () {
    var own = document.querySelector('script[src*="app-boot.js"]');
    var m = own && own.src.match(/\?v=([\w]+)/);
    if (!m || !window.fetch) return;
    var mine = m[1];
    var last = 0;
    var MIN_GAP = 5 * 60 * 1000;

    function check() {
        var now = Date.now();
        if (now - last < MIN_GAP) return;
        last = now;
        // Cache-busted + no-store: this file must reflect the LIVE build, not a
        // CDN/browser copy. On any failure (404, offline) stay silent.
        fetch('/version.txt?t=' + now, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.text() : null; })
            .then(function (latest) {
                if (!latest) return;
                latest = latest.trim();
                if (!latest || latest === mine) return;
                var banner = document.getElementById('updateBanner');
                if (banner) banner.classList.remove('hidden');
            })
            .catch(function () { /* offline / missing file: keep the current build */ });
    }

    check();
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) check();
    });
})();

// ---------------------------------------------------------------------------
// 6) What's New card — shown once after each version update.
//    Compares localStorage flag against the current version label.
//    Dismissed via the × button (closeWhatsNew action above).
// ---------------------------------------------------------------------------
(function () {
    var VER = '2.1';
    var seen = localStorage.getItem('aqmath-whatsnew-seen');
    if (seen === VER) return;
    var card = document.getElementById('whatsNew');
    if (card) card.classList.remove('hidden');
})();

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

(function () {
    var box = document.getElementById('forwardLogLive');
    if (!box || !window.fetch) return;
    fetch('https://api-backtest.aqmath.xyz/forward-log')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) { box.innerHTML = sanitizeFirstPartyHtml(html); })
        .catch(function () { /* keep the bundled snapshot */ });
})();

// ---------------------------------------------------------------------------
// 3) i18n / language switching (was inline block at index.html L2573)
// ---------------------------------------------------------------------------
var i18nResources = {};
var i18nReady = false;

function loadLocale(lang) {
    return fetch('/locales/' + lang + '.json?v=df39b2702d')
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
// ---------------------------------------------------------------------------
(function () {
    var own = document.querySelector('script[src*="app-boot.js"]');
    var m = own && own.src.match(/\?v=([\w]+)/);
    if (!m || !window.fetch) return;
    var mine = m[1];
    // Cache-busted + no-store: this file must reflect the LIVE build, not a
    // CDN/browser copy. On any failure (404, offline) stay silent.
    fetch('/version.txt?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (latest) {
            if (!latest) return;
            latest = latest.trim();
            if (!latest || latest === mine) return;
            var banner = document.getElementById('updateBanner');
            if (banner) banner.classList.remove('hidden');
        })
        .catch(function () { /* offline / missing file: keep the current build */ });
})();

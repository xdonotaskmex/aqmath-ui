// One-off screenshot harness for the Discipline Meter (One-Tap Alignment).
//
// Serves the built site with tests/static-server.cjs, fakes a live beta
// session (pro_token JWT with a far-future exp) and mocks the engine API
// (via ?remote so the https API origins pass the page CSP) so the real
// loadDisciplineMeter() rendering path runs end-to-end. Captures the card in
// its three meaningful states:
//   1. new user (no signals yet — empty state + goal picker)
//   2. healthy user at their own goal (discount surprise revealed)
//   3. pattern alert (>=4 of last 10 SHOCK missed) + opt-in reminders ON
//
//   node tools/shoot_discipline.cjs
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(__dirname, '..');

// Unsigned JWT with exp far in the future — isBetaActive() only decodes the
// payload; no request to beta-auth is ever made with it.
const FAKE_JWT = (() => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
        .replace(/=+$/, '');
    return b64({ alg: 'none', typ: 'JWT' }) + '.'
        + b64({ kid: 'screenshot', exp: 2000000000 }) + '.sig';
})();

const SCENARIOS = [
    {
        name: '_disc_meter_new_user.png',
        title: 'NEW USER — empty state, goal picker visible before first signal',
        discipline: {
            overall_rate: 0, target: 0.8, discount_eligible: false,
            recent: null, shock_recent: null, pattern_alert: false,
            total: 0, confirmed: 0, missed: 0, skipped: 0, pending: 0,
            median_reaction_sec: null, per_regime: [], escalation_opt_in: false,
        },
    },
    {
        name: '_disc_meter_goal_met.png',
        title: 'HEALTHY — 92% vs own 90% goal (green) + discount surprise revealed',
        discipline: {
            overall_rate: 0.92, target: 0.9, discount_eligible: true,
            recent: { resolved: 10, confirmed: 9, rate: 0.9 },
            shock_recent: { resolved: 6, missed: 1 }, pattern_alert: false,
            total: 25, confirmed: 22, missed: 2, skipped: 1, pending: 0,
            median_reaction_sec: 2520, per_regime: [], escalation_opt_in: false,
        },
    },
    {
        name: '_disc_meter_pattern_alert.png',
        title: 'PATTERN ALERT — 55% vs own 90% goal, 4/10 SHOCK missed, reminders opt-in ON',
        discipline: {
            overall_rate: 0.55, target: 0.9, discount_eligible: false,
            recent: { resolved: 10, confirmed: 5, rate: 0.5 },
            shock_recent: { resolved: 10, missed: 4 }, pattern_alert: true,
            total: 20, confirmed: 10, missed: 7, skipped: 3, pending: 2,
            median_reaction_sec: 7200, per_regime: [], escalation_opt_in: true,
        },
    },
];

function mockEngine(pathname) {
    // Default per-endpoint payloads; the discipline body is swapped per scenario.
    if (pathname.startsWith('/portfolio/discipline/history')) {
        return { ok: true, body: { points: [] } };
    }
    if (pathname.startsWith('/portfolio/signal-stats')) {
        return { ok: false, status: 404, body: { detail: 'no stats' } };
    }
    if (pathname.startsWith('/portfolio/signals')) {
        return { ok: true, body: { signals: [] } };
    }
    if (pathname.startsWith('/portfolio/settings')) {
        return { ok: true, body: { status: 'ok', settings: {} } };
    }
    if (pathname.startsWith('/portfolio')) {
        return { ok: true, body: { initialized: false } };
    }
    return { ok: true, body: {} };
}

async function shootScenario(browser, sc) {
    const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC',
    });
    // Live beta session before any script runs.
    await ctx.addInitScript((tok) => {
        localStorage.setItem('pro_token', tok);
        localStorage.setItem('aqmath-whatsnew-seen', '2.1');
    }, FAKE_JWT);
    const page = await ctx.newPage();
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning')
            console.log(`  [console:${m.type()}] ${m.text().slice(0, 160)}`);
    });
    page.on('requestfailed', (r) =>
        console.log(`  [reqfail] ${r.url().slice(0, 110)} ${r.failure() && r.failure().errorText}`));
    // Mock the whole engine + auth + DCA surface so no real network is needed.
    // `?remote` flips _LOCAL_BACKEND off so API URLs are https (the page CSP
    // allows connect-src https:) — Playwright fulfils them locally.
    await page.route('https://api-engine.aqmath.xyz/**', (route) => {
        const u = new URL(route.request().url());
        let m;
        if (u.pathname.startsWith('/portfolio/discipline')
            && !u.pathname.startsWith('/portfolio/discipline/history')) {
            m = { ok: true, body: sc.discipline };
        } else {
            m = mockEngine(u.pathname);
        }
        route.fulfill({
            status: m.status || 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(m.body),
        });
    });
    await page.route('https://api-auth.aqmath.xyz/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ acked: true }) }));
    await page.route('https://api-dca.aqmath.xyz/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }));

    await page.goto(BASE + '/app?remote', { waitUntil: 'domcontentloaded' });
    // Belt & braces: the meter renders from refreshNotifyUI(); re-invoke it
    // once the DOM is live so the mock data is definitely picked up.
    await page.waitForSelector('#disciplineCard');
    await page.waitForTimeout(800);
    await page.evaluate(() => { if (typeof loadDisciplineMeter === 'function') loadDisciplineMeter(); });
    await page.waitForTimeout(900);  // fill-bar width transition settles

    const card = page.locator('#disciplineCard');
    const visible = await card.isVisible().catch(() => false);
    if (!visible) {
        console.error(`  !! card hidden for ${sc.name}`);
        await page.screenshot({ path: path.join(OUT, sc.name) });
    } else {
        await card.screenshot({ path: path.join(OUT, sc.name) });
    }
    console.log(`  ok ${sc.name}  —  ${sc.title}`);
    await ctx.close();
}

(async () => {
    const srv = spawn(process.execPath,
        [path.join(__dirname, '..', 'tests', 'static-server.cjs')],
        { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
    await new Promise((r) => setTimeout(r, 900));  // let the server bind
    const browser = await chromium.launch();
    try {
        for (const sc of SCENARIOS) await shootScenario(browser, sc);
    } finally {
        await browser.close();
        srv.kill();
    }
    console.log('done.');
})();

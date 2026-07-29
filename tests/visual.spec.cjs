// Visual regression snapshots for the 5 key AQMath pages.
//
// AQMath is a single-page app: every .html file is the same shell and the router
// in app.js swaps a body class per clean URL. We drive the real routes through the
// SPA-fallback static server, stub every off-origin call so screenshots don't
// depend on live market data / feeds / auth, and assert the route actually
// rendered before snapshotting.
//
// First run (no baselines yet):  npm run test:update
// Subsequent runs (regression):  npm test
const { test, expect } = require('@playwright/test');

/** The five most important routes and the body class each must resolve to. */
const PAGES = [
  { name: 'landing', path: '/', bodyClass: 'route-landing' },
  { name: 'app', path: '/app', bodyClass: 'route-app' },
  { name: 'backtest', path: '/backtest', bodyClass: 'route-backtest' },
  { name: 'results', path: '/results', bodyClass: 'route-results' },
  { name: 'docs', path: '/docs', bodyClass: 'route-doc' },
];

/**
 * Deterministic stub for off-origin DATA calls (xhr/fetch) only.
 * Live crypto prices, news feeds, the Fear & Greed gauge and the beta-auth slot
 * counter all vary run-to-run, so we answer them with fixed, empty-shaped bodies.
 *
 * Off-origin *library* requests (chart.js, i18next, analytics — <script>/<link>/
 * fonts/images) are let through to the real network: they are pinned, stable
 * versions and the app throws at init if globals like `Chart` are missing.
 * Intercepting them (returning JSON for a <script>) is what left `body` classless.
 */
async function stubExternalNetwork(page, baseURL) {
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = request.url();

    // Same-origin assets (our static server) pass through untouched.
    if (url.startsWith(baseURL)) return route.continue();

    // Only stub data fetches; let scripts/styles/fonts/images load for real.
    const type = request.resourceType();
    if (type !== 'xhr' && type !== 'fetch') return route.continue();

    let body = '[]';
    if (url.includes('/history/') || url.includes('/prices')) {
      body = '{"prices":[]}';
    } else if (url.includes('/api/slots')) {
      body = '{"total":10,"used":0,"remaining":10}';
    } else if (url.includes('rss2json')) {
      body = '{"status":"ok","items":[]}';
    } else if (url.includes('alternative.me')) {
      body = '{"data":[{"value":"50","value_classification":"Neutral"}]}';
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body,
    });
  });
}

test.describe('AQMath key pages — visual regression', () => {
  for (const p of PAGES) {
    test(`${p.name} (${p.path}) renders and matches snapshot`, async ({ page, baseURL }) => {
      // Seed determinism before any page script runs.
      await page.addInitScript(() => {
        let seed = 0.4242;
        // eslint-disable-next-line no-global-assign
        Math.random = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        // Neutralise the live Binance WebSocket price feed. It pushes ticks
        // sub-second, re-rendering the ticker/widgets forever so a full-page
        // screenshot never reaches two stable frames. A no-op socket that never
        // opens or emits lets the UI settle into a fixed (empty) state.
        class DeadSocket {
          constructor() {
            this.readyState = 3; // CLOSED
          }
          send() {}
          close() {}
          addEventListener() {}
          removeEventListener() {}
        }
        DeadSocket.CONNECTING = 0;
        DeadSocket.OPEN = 1;
        DeadSocket.CLOSING = 2;
        DeadSocket.CLOSED = 3;
        // eslint-disable-next-line no-global-assign
        window.WebSocket = DeadSocket;

        // Neutralise the hero-terminal typewriter at its source. An inline script
        // in app.html types into #termLine0..3 on a recursive setTimeout forever,
        // reflowing the page so a full-page screenshot never reaches two stable
        // frames. That script self-aborts if the elements are missing
        // (`if (!els[0] || ...) return;`), so we hide exactly those four IDs from
        // getElementById. The lines stay empty and deterministic; everything else
        // (including other lookups) is untouched.
        const FROZEN_IDS = new Set(['termLine0', 'termLine1', 'termLine2', 'termLine3']);
        const realGetById = Document.prototype.getElementById;
        Document.prototype.getElementById = function (id) {
          if (FROZEN_IDS.has(id)) return null;
          return realGetById.call(this, id);
        };
      });

      await stubExternalNetwork(page, baseURL);

      await page.goto(p.path, { waitUntil: 'domcontentloaded' });

      // Functional check: the SPA router resolved this clean URL to the right view.
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${p.bodyClass}\\b`));

      // Kill animations/transitions/scroll so pixels are stable.
      await page.addStyleTag({
        content: `*,*::before,*::after{animation:none!important;transition:none!important}
                  html{scroll-behavior:auto!important}`,
      });

      // Let layout, fonts and i18n settle.
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      await page.waitForTimeout(600);

      // With the typewriter neutralised and off-origin data stubbed, the whole
      // page is deterministic — diff every pixel.
      await expect(page).toHaveScreenshot(`${p.name}.png`, {
        fullPage: true,
      });
    });
  }
});

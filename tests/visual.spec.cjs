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
    if (url.includes('/forward-log')) return route.fulfill({ status: 503, body: '' });

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
      // Full-page docs now include readable, taller diagrams (over 21,000px).
      if (p.name === 'docs') test.setTimeout(90_000);
      // Seed determinism before any page script runs.
      await page.addInitScript(() => {
        let seed = 0.4242;
        // eslint-disable-next-line no-global-assign
        Math.random = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        // Suppress the first-visit onboarding overlays so the snapshot captures
        // the steady-state page a returning visitor sees, not a transient modal.
        // Both are gated on exactly these keys: app-boot.js shows the "What's New"
        // card unless aqmath-whatsnew-seen === APP_VERSION, and app-tour.js launches the
        // driver.js tour on /app unless aqmath_tour_done is set. Left unseeded they
        // dim/cover the page and re-break the baseline on every copy tweak.
        localStorage.setItem('aqmath-whatsnew-seen', '2.1.1');
        localStorage.setItem('aqmath_tour_done', '1');

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
        timeout: p.name === 'docs' ? 60_000 : 30_000,
      });
    });
  }
});

// Behavioral checks complement screenshots: a new baseline must not bless
// clipped mobile content, illegible chart labels, or a misleading app state.
test.describe('Readability and responsive layouts', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aqmath-whatsnew-seen', '2.1.1');
      localStorage.setItem('aqmath_tour_done', '1');
      window.WebSocket = class { close() {} addEventListener() {} };
    });
    await stubExternalNetwork(page, baseURL);
  });

  for (const width of [320, 390]) {
    test(`public pages fit at ${width}px and charts remain readable`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 844 });
      const routes = ['/', '/app', '/backtest', '/results', '/docs', '/v18',
        '/about', '/privacy', '/terms', '/impressum', '/widerruf', '/research/',
        '/research/exposure-capping', '/research/liveness-screen-zh',
        '/research/oos-v14-new-tokens-zh'];
      for (const route of routes) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, route).toBeLessThanOrEqual(1);
        if (route === '/') {
          for (const card of await page.locator('.v2-plan').all()) {
            const box = await card.boundingBox();
            expect(box.x + box.width).toBeLessThanOrEqual(width - 19);
          }
        }
        const labels = await page.locator('.figure-scroll svg text').evaluateAll(nodes =>
          nodes.map(el => parseFloat(getComputedStyle(el).fontSize) * el.getScreenCTM().a));
        if (['/backtest', '/results', '/docs'].includes(route)) expect(labels.length).toBeGreaterThan(0);
        for (const size of labels) expect(size, route).toBeGreaterThanOrEqual(11.9);
        for (const wrap of await page.locator('.figure-scroll.is-overflowing').all()) {
          await expect(wrap).toHaveAttribute('tabindex', '0');
          await expect(wrap.locator('+ .scroll-hint')).toBeVisible();
        }
        for (const link of await page.locator('.legal-hdr .hdr-nav-btn').all()) {
          const box = await link.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
      }
    });
  }

  test('docs translations display arrows and keep chart wrappers idempotent', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.locator('[data-i18n="doc.s8.m7"]')).toHaveText('59.8% B&H → 29.4%');
    const count = await page.locator('.figure-scroll').count();
    const privacyNotes = page.locator('#doc-arch svg text[x="700"][font-size="7"]');
    await expect(privacyNotes).toHaveCount(3);
    for (const note of await privacyNotes.all()) {
      const box = await note.evaluate(el => {
        const b = el.getBBox();
        return { x: b.x, right: b.x + b.width, bottom: b.y + b.height };
      });
      expect(box.x).toBeGreaterThan(620);
      expect(box.right).toBeLessThan(780);
      expect(box.bottom).toBeLessThan(310);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#doc-arch .figure-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.locator('#doc-arch .doc-diagram').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -90));
    await page.locator('#doc-arch .doc-diagram').screenshot({ path: test.info().outputPath('architecture-note.png') });
    await page.evaluate(() => switchLang('zh-CN'));
    await expect(page.locator('[data-i18n="doc.s8.m7"]')).toHaveText('59.8% 买入持有 → 29.4%');
    expect(await page.locator('.figure-scroll').count()).toBe(count);
    expect(await page.locator('.figure-scroll .figure-scroll').count()).toBe(0);
    await expect(page.locator('.figure-scroll').first()).toHaveAttribute('aria-label', /横向滚动/);
  });

  test('fresh telemetry receives readable scroll regions', async ({ page }) => {
    await page.route('**/forward-log-v18', route => route.fulfill({
      contentType: 'text/html', body: '<div class="rv-chart"><svg viewBox="0 0 860 200"><text x="20" y="30" font-size="10">Synthetic telemetry</text></svg></div>',
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/v18');
    const region = page.locator('#forwardLogV18 .figure-scroll');
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region.locator('text')).toHaveText('Synthetic telemetry');
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test('research prose wraps and plots expose full-size links', async ({ page }) => {
    await page.goto('/research/exposure-capping');
    const prose = page.locator('.rs-tablewrap td[style="text-align:left"]').first();
    await expect(prose).toHaveCSS('white-space', 'normal');
    await expect(page.locator('.rs-tablewrap').first()).toHaveAttribute('tabindex', '0');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/research/oos-v14-new-tokens-zh');
    const basket = page.locator('.rs-tablewrap td').filter({ hasText: /^AVAX\/CRO\/DOGE$/ });
    expect((await basket.boundingBox()).width).toBeGreaterThanOrEqual(160);
    await expect(basket).toHaveCSS('overflow-wrap', 'normal');
    const links = page.locator('.rs-fig figcaption a');
    expect(await links.count()).toBeGreaterThan(0);
    await expect(links.first()).toHaveText('打开完整尺寸图表');
    const href = await links.first().getAttribute('href');
    const response = await page.request.get(href);
    expect(response.ok()).toBeTruthy();
    const popupPromise = page.waitForEvent('popup');
    await links.first().click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(new URL(popup.url()).pathname).toBe(href);
    await popup.close();
  });

  test('active card and notifications retain readable, separate controls', async ({ page }) => {
    await page.goto('/app');
    await page.evaluate(() => {
      document.getElementById('betaSection').classList.add('hidden');
      document.getElementById('betaActive').classList.remove('hidden');
      document.getElementById('ntfyOff').classList.add('hidden');
      document.getElementById('ntfyOn').classList.remove('hidden');
      _setNtfyStatus(true, 'synthetic-visual-test-topic');
      document.getElementById('ntfyTopic').textContent = 'synthetic-visual-test-topic';
    });
    expect(await page.locator('#betaActive .pro-badge .btn-deact').count()).toBe(0);
    const help = await page.locator('#betaActive .btn-how').boundingBox();
    const tour = await page.locator('#betaActive .btn-tour').boundingBox();
    expect(Math.abs(help.width - tour.width)).toBeLessThan(1);
    expect(Math.abs(help.height - tour.height)).toBeLessThan(1);
    await expect(page.locator('#ntfyStatus')).not.toContainText('synthetic-visual-test-topic');
    for (const id of ['btnNtfyDisable', 'btnEraseData']) {
      await expect(page.locator('#' + id)).toHaveCSS('opacity', '1');
      await expect(page.locator('#' + id)).toHaveCSS('font-size', '14px');
    }
    await expect(page.locator('#ntfyTopic')).toHaveCSS('font-size', '12px');
    await page.locator('#betaActive').screenshot({ path: test.info().outputPath('active-black.png') });
    await page.locator('.ntfy-card').screenshot({ path: test.info().outputPath('notifications.png') });
    // Hidden ancestors must remove the activation step; the toolbar target
    // must point at Import/Export, not the header's language controls.
    const steps = await page.evaluate(() => {
      let captured;
      window.driver.js.driver = options => { captured = options.steps; return { drive() {} }; };
      startProductTour();
      return captured.map(step => step.element);
    });
    expect(steps).not.toContain('#iBetaKey');
    expect(steps).toContain('.app-toolbar');
  });

  test('actual tour and help remain readable in inactive and active layouts', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app');
    for (const active of [false, true]) {
      if (active) await page.evaluate(() => {
        document.getElementById('betaSection').classList.add('hidden');
        document.getElementById('betaActive').classList.remove('hidden');
      });
      await page.locator(active ? '#betaActive .btn-tour' : '#betaSection .btn-tour').click();
      const popover = page.locator('.driver-popover');
      const titles = [];
      for (let step = 0; step < 12; step++) {
        await expect(popover).toBeVisible();
        await page.waitForTimeout(400);
        const title = await popover.locator('.driver-popover-title').innerText();
        titles.push(title);
        const box = await popover.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1440);
        expect(box.y + box.height).toBeLessThanOrEqual(900);
        if (title === 'Import & Export') {
          await expect(page.locator('.app-toolbar')).toHaveClass(/driver-active-element/);
          await page.screenshot({ path: test.info().outputPath(`tour-toolbar-${active}.png`) });
        }
        if (title === 'Allocation Overview') {
          await expect(popover).toContainText('number of tokens');
        }
        const [current, total] = (await popover.locator('.driver-popover-progress-text').innerText())
          .match(/\d+/g).map(Number);
        await popover.locator('.driver-popover-next-btn').click();
        if (current === total) break;
      }
      await expect(popover).toBeHidden();
      expect(titles).toContain('Import & Export');
      expect(titles).toContain('Allocation Overview');
      if (active) expect(titles).not.toContain('Unlock Black');
      else expect(titles).toContain('Unlock Black');
    }
    await page.locator('#betaActive .btn-how').click();
    await expect(page.locator('#howAqmathModal')).toBeVisible();
    await expect(page.locator('#howAqmathBody h2').first()).toBeVisible();
    await expect(page.locator('#howAqmathBody h2 + p').first()).toHaveCSS('font-size', '15px');
    await expect(page.locator('#howAqmathBody h1')).toHaveCSS('letter-spacing', /^(normal|0px)$/);
    expect(await page.locator('#howAqmathBody').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator('.howaq-box').screenshot({ path: test.info().outputPath('app-help.png') });
    await page.locator('[data-action="hideHowAqmath"]').click();
    await expect(page.locator('#howAqmathModal')).toBeHidden();
    await page.evaluate(() => switchLang('zh-CN'));
    await expect(page.locator('#historyEmpty')).toContainText('暂无历史记录');
    await page.locator('#betaActive').screenshot({ path: test.info().outputPath('active-black-zh.png') });
  });

  test('portfolio history transitions between empty and populated states', async ({ page }) => {
    await page.goto('/app');
    await expect(page.locator('#historyEmpty')).toBeVisible();
    await expect(page.locator('.history-chart-wrap')).toBeHidden();
    await page.locator('#historyEmpty').screenshot({ path: test.info().outputPath('history-empty.png') });
    await page.evaluate(() => {
      localStorage.setItem('aegis_portfolio_history', JSON.stringify([{ timestamp: Date.now(), total: 100 }]));
    });
    await page.reload();
    await expect(page.locator('#historyEmpty')).toBeHidden();
    await expect(page.locator('.history-chart-wrap')).toBeVisible();
    await page.evaluate(() => localStorage.removeItem('aegis_portfolio_history'));
    await page.reload();
    await expect(page.locator('#historyEmpty')).toBeVisible();
  });

  test('market mover signs and colors follow the value, not ranking', async ({ page }) => {
    await page.goto('/app');
    await page.evaluate(async () => {
      fetchMovers = async () => [
        { symbol: 'BTCUSDT', priceChangePercent: '2.34' },
        { symbol: 'ETHUSDT', priceChangePercent: '0' },
        { symbol: 'SOLUSDT', priceChangePercent: '-3.02' },
      ];
      await loadTopGainers();
    });
    const card = page.locator('.lp-widget').filter({ hasText: 'Top Gainers 24h' }).last();
    await expect(card.locator('.val')).toHaveText(['+2.34%', '+0.00%', '-3.02%']);
    await expect(card.locator('.val').last()).toHaveClass('val down');
  });

  test('all research articles fit on phones and expose readable content', async ({ page }) => {
    test.setTimeout(180_000);
    const fs = require('fs');
    const path = require('path');
    const articles = fs.readdirSync(path.join(__dirname, '..', 'research'))
      .filter(name => name.endsWith('.html') && name !== 'index.html').sort();
    await page.setViewportSize({ width: 1600, height: 940 });
    await page.goto('/research/');
    for (let start = 0; start < articles.length; start += 4) {
      const group = articles.slice(start, start + 4);
      await page.evaluate(names => {
        document.body.replaceChildren();
        document.body.style.cssText = 'display:flex;gap:8px;padding:8px;align-items:flex-start';
        for (const name of names) {
          const panel = document.createElement('div');
          panel.style.cssText = 'width:390px;flex:none;font:12px sans-serif';
          panel.append(document.createTextNode(name));
          const frame = document.createElement('iframe');
          frame.src = '/research/' + name;
          frame.style.cssText = 'display:block;width:390px;height:900px;border:0';
          panel.append(frame);
          document.body.append(panel);
        }
      }, group);
      await expect(page.locator('iframe')).toHaveCount(group.length);
      expect(page.frames().filter(frame => frame.parentFrame()).length).toBe(group.length);
      for (const frame of page.frames().filter(frame => frame.parentFrame())) {
        await frame.waitForSelector('.research-page h1');
        await frame.evaluate(() => document.fonts.ready);
      }
      await page.screenshot({ path: test.info().outputPath(`research-${start}-headings.png`) });
      for (const frame of page.frames().filter(frame => frame.parentFrame())) {
        const width = await frame.evaluate(() => document.documentElement.scrollWidth);
        expect(width, frame.url()).toBeLessThanOrEqual(390);
        for (const image of await frame.locator('.rs-fig img').all()) {
          await image.scrollIntoViewIfNeeded();
          await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBeTruthy();
          const imgUrl = await image.getAttribute('src');
          await expect(image.locator('..')).toHaveAttribute('href', imgUrl);
        }
        await frame.evaluate(() => {
          const target = document.querySelector('.rs-tablewrap, .research-page h2');
          if (target) window.scrollTo(0, target.getBoundingClientRect().top + scrollY - 175);
        });
      }
      await page.screenshot({ path: test.info().outputPath(`research-${start}-content.png`) });
    }
  });
});

// Focused functional test for the DCA-due pending signal card (side='DCA').
//
// Verifies, against the real app-notify.js / app-boot.js code running in the
// browser (not a copy):
//   1. _renderDcaBlock renders BOTH routes (USDC parking + tokens/redeploy)
//   2. the per-token buy list and amounts are present
//   3. [ execute DCA ] / [ dismiss ] buttons carry the right data-action
//   4. clicking [ execute DCA ] flows through the app-boot CLICK dispatcher
//      into executeDcaSignal (proven by the synchronous #iDcaAmount pre-fill)
//   5. no uncaught JS errors during render + interaction
//
// This is a verification harness, NOT a visual-regression baseline: it asserts
// DOM/logic and writes one inspection screenshot to tests/_dca_card_verify.png.
const { test, expect } = require('@playwright/test');

function iso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();
}

// Shapes mirror portfolio_service.get_pending_signals() output exactly.
const DCA_USDC = {
  signal_id: 'dcausdc0000000000001',
  side: 'DCA', sym: 'DCA', units: 0, usd: 500,
  shield_regime: 'SHOCK', signal_date: '2026-09-07', days_pending: 0,
  expires_at: iso(47),
  dca_payload: { route: 'USDC', amount: 500, parked_total: 2000 },
};
const DCA_TOKENS = {
  signal_id: 'dcatok00000000000001',
  side: 'DCA', sym: 'DCA', units: 0, usd: 500,
  shield_regime: 'LOW_VOL', signal_date: '2026-09-05', days_pending: 2,
  expires_at: iso(47),
  dca_payload: {
    route: 'tokens', amount: 500,
    buys: [{ sym: 'BTC', usd: 250 }, { sym: 'ETH', usd: 150 }, { sym: 'SOL', usd: 100 }],
    redeploy_usdc: 1000,
  },
};

test.describe('DCA pending signal card', () => {
  test('renders both routes and wires execute through the CLICK dispatcher', async ({ page, baseURL }) => {
    // Stub off-origin DATA calls; let same-origin assets load for real.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(baseURL)) return route.continue();
      const type = route.request().resourceType();
      if (type !== 'xhr' && type !== 'fetch') return route.continue();
      return route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}',
      });
    });

    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push('pageerror: ' + e.message));

    // Suppress the onboarding "What's New" modal (it dims the page and would
    // cover the signal card in the inspection screenshot).
    await page.addInitScript(() => {
      localStorage.setItem('aqmath-whatsnew-seen', '2.1');
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    // Inject both mock DCA signals and run the REAL render pipeline.
    const diag = await page.evaluate((mocks) => {
      _pendingSignals = mocks;            // global lexical binding in app-notify.js
      _rerenderSignalList();
      const list = document.getElementById('signalList');
      const card = document.getElementById('signalCard');
      // Force the card + every ancestor visible so we can screenshot it.
      let n = card;
      while (n && n !== document.body) { n.classList.remove('hidden'); n = n.parentElement; }
      const html = list.innerHTML;
      return {
        cardHidden: card.classList.contains('hidden'),
        blockCount: list.querySelectorAll('.sig-block.sig-dca').length,
        hasExecBtn: !!list.querySelector('[data-action="executeDcaSignal"]'),
        hasDismissBtn: !!list.querySelector('[data-action="skipSignal"]'),
        hasBadge: html.includes('sig-dca-badge'),
        // USDC (defensive) route
        hasDefensive: html.includes('Defensive mode'),
        hasParked: html.includes('2,000'),
        // tokens (risk-on) route
        hasRiskOn: html.includes('Risk-on'),
        hasRedeploy: html.includes('redeployed') && html.includes('1,000'),
        hasBtc: html.includes('BTC') && html.includes('250'),
        hasEth: html.includes('ETH') && html.includes('150'),
        hasSol: html.includes('SOL') && html.includes('100'),
        // function wiring present in global scope
        renderType: typeof _renderDcaBlock,
        execType: typeof executeDcaSignal,
        confirmType: typeof confirmPendingDcaSignal,
        clearType: typeof clearPendingDcaSignal,
        distribuirajType: typeof distribuirajDca,
        hasDcaInput: !!document.getElementById('iDcaAmount'),
      };
    }, [DCA_USDC, DCA_TOKENS]);

    console.log('DCA CARD DIAGNOSTICS:', JSON.stringify(diag, null, 2));

    expect(diag.renderType).toBe('function');
    expect(diag.execType).toBe('function');
    expect(diag.confirmType).toBe('function');
    expect(diag.clearType).toBe('function');
    expect(diag.distribuirajType).toBe('function');
    expect(diag.hasDcaInput).toBe(true);
    expect(diag.cardHidden).toBe(false);
    expect(diag.blockCount).toBe(2);
    expect(diag.hasExecBtn).toBe(true);
    expect(diag.hasDismissBtn).toBe(true);
    expect(diag.hasBadge).toBe(true);
    expect(diag.hasDefensive).toBe(true);
    expect(diag.hasParked).toBe(true);
    expect(diag.hasRiskOn).toBe(true);
    expect(diag.hasRedeploy).toBe(true);
    expect(diag.hasBtc).toBe(true);
    expect(diag.hasEth).toBe(true);
    expect(diag.hasSol).toBe(true);

    // Inspection screenshot BEFORE any click — a click opens a validation modal
    // that dims the whole page. Capture the viewport with the card scrolled
    // into view: exactly what a user sees.
    const cardLoc = page.locator('#signalCard');
    const box = await cardLoc.boundingBox().catch(() => null);
    console.log('CARD BOUNDING BOX:', JSON.stringify(box));
    await cardLoc.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'tests/_dca_card_verify.png' }).catch(() => {});

    // Wiring: click the first [ execute DCA ] button through the REAL document
    // dispatcher. executeDcaSignal pre-fills #iDcaAmount synchronously before it
    // awaits distribuirajDca(), so the input value proves the whole chain
    // (rendered button -> app-boot CLICK map -> executeDcaSignal) is connected.
    const wired = await page.evaluate(() => {
      const btn = document.querySelector('[data-action="executeDcaSignal"]');
      const arg = btn.getAttribute('data-arg');
      btn.click();
      return { arg: arg, amt: document.getElementById('iDcaAmount').value };
    });
    console.log('EXECUTE WIRING:', JSON.stringify(wired));
    expect(wired.arg).toBe(DCA_USDC.signal_id);
    expect(wired.amt).toBe('500');

    // No uncaught JS errors during render + interaction.
    expect(jsErrors).toEqual([]);
  });
});

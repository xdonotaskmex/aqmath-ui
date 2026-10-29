// TEMPORARY image crawl - not committed.
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_logs', 'imgcrawl.jsonl');
try { fs.unlinkSync(OUT); } catch (e) {}

const pages = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .map((f) => '/' + f);
const research = fs.readdirSync(path.join(ROOT, 'research'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => '/research/' + f);
const ALL = pages.concat(research);

test('crawl all pages for broken images', async ({ page }) => {
    test.setTimeout(300000);
    const bad = [];
    const seen = new Set();
    page.on('response', (r) => {
        const url = r.url();
        if (!/\.(png|jpe?g|webp|avif|gif|svg|ico)(\?|$)/i.test(url)) return;
        if (r.status() >= 400) bad.push({ url, status: r.status(), page: page.url() });
    });
    page.on('requestfailed', (req) => {
        if (/\.(png|jpe?g|webp|avif|gif|svg|ico)(\?|$)/i.test(req.url())) {
            bad.push({ url: req.url(), status: 'failed', page: page.url() });
        }
    });
    await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('http://127.0.0.1:4173')) return route.continue();
        const t = route.request().resourceType();
        if (t !== 'xhr' && t !== 'fetch' && t !== 'image') return route.continue();
        if (t === 'image') return route.abort();
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    });

    for (const p of ALL) {
        await page.goto(p, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(400);
        const zero = await page.evaluate(() => Array.from(document.images)
            .filter((i) => i.complete && i.naturalWidth === 0)
            .map((i) => i.currentSrc || i.src));
        zero.forEach((u) => { if (!bad.find((b) => b.url === u && b.page.endsWith(p))) bad.push({ url: u, status: 'naturalWidth=0', page: p }); });
        seen.add(p);
    }
    fs.appendFileSync(OUT, bad.map((b) => JSON.stringify(b)).join('\n') + (bad.length ? '\n' : ''));
    console.log('CRAWLED ' + seen.size + ' pages, broken=' + bad.length);
    bad.slice(0, 40).forEach((b) => console.log('BROKEN ' + b.status + ' ' + b.url + ' on ' + b.page));
});

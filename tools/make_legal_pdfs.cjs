#!/usr/bin/env node
/**
 * AQMath — legal PDF generator.
 *
 * The law wants the consumer information, the withdrawal notice and the
 * contract confirmation on a DURABLE MEDIUM (dauerhafter Datenträger). A
 * Telegram message is not one: it can be edited or deleted. A PDF attachment
 * is. This script renders the HTML sources in _legal/ to PDF.
 *
 *   Before the order (send both, once, to every prospect):
 *     node tools/make_legal_pdfs.cjs
 *       -> _legal/out/AQMath_Vorvertragliche_Informationen.pdf   (DE)
 *       -> _legal/out/AQMath_Pre-contract_Information.pdf        (EN)
 *
 *   After the contract is concluded (one per customer):
 *     node tools/make_legal_pdfs.cjs --confirm \
 *        --kunde "Max Mustermann" --kontakt "@telegram_handle / mail@example.com" \
 *        --datum 2026-11-05 --zahlung "999 USDC, TXID 0xabc…" \
 *        --status Verbraucher --freischaltung sofort
 *
 *   --freischaltung sofort   = activated at once on the customer's express
 *                              request (pro-rata compensation on withdrawal)
 *   --freischaltung nach14   = key issued after the 14 days have passed
 *
 * Requires the repo's own playwright (npm i) — no other dependency.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '_legal');
const OUT = path.join(SRC, 'out');

const DOCS = [
  ['vorvertragliche-informationen.html', 'AQMath_Vorvertragliche_Informationen.pdf'],
  ['pre-contract-information.html', 'AQMath_Pre-contract_Information.pdf'],
  ['verzeichnis-verarbeitungstaetigkeiten.html', 'AQMath_Verzeichnis_Verarbeitungstaetigkeiten.pdf'],
];

function args() {
  const a = process.argv.slice(2);
  const o = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true;
      o[k] = v;
    } else o._.push(a[i]);
  }
  return o;
}

const de = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

async function render(browser, html, outFile, landscape = false) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: outFile, format: 'A4', landscape, printBackground: true });
  await page.close();
  console.log('wrote', path.relative(ROOT, outFile));
}

(async () => {
  const { chromium } = require('playwright');
  const o = args();
  fs.mkdirSync(OUT, { recursive: true });
  const today = new Date();
  const browser = await chromium.launch();

  if (!o.confirm) {
    for (const [src, out] of DOCS) {
      const html = fs.readFileSync(path.join(SRC, src), 'utf8')
        .replace(/__STAND__/g, de(today));
      await render(browser, html, path.join(OUT, out), src.includes('verzeichnis'));
    }
  } else {
    const miss = '— bitte eintragen —';
    const datum = o.datum ? new Date(o.datum + 'T12:00:00') : today;
    const sofort = String(o.freischaltung || '').toLowerCase().startsWith('sofort');
    const start = sofort ? datum : addDays(datum, 14);
    const map = {
      __KUNDE__: o.kunde || miss,
      __KONTAKT__: o.kontakt || miss,
      __ZAHLUNG__: o.zahlung || miss,
      __VERTRAGSDATUM__: de(datum),
      __WIDERRUF_ENDE__: de(addDays(datum, 14)),
      __FREISCHALTUNG__: o.freischaltung
        ? (sofort
            ? 'Sofort auf Ihr ausdrückliches Verlangen, am ' + de(start)
              + ' / immediately at your express request'
            : 'Nach Ablauf der Widerrufsfrist, am ' + de(start)
              + ' / after the withdrawal period')
        : miss,
      __LAUFZEIT__: de(start) + ' – ' + de(addDays(addMonths(start, 12), -1))
        + ' (12 Monate / 12 months)',
      __STATUS__: o.status || miss,
      __ERKL_FREISCHALTUNG__: o.freischaltung
        ? (sofort
            ? 'Sofortige Freischaltung ausdrücklich verlangt; Wertersatzfolge zur Kenntnis genommen'
            : 'Standard: Freischaltung nach Ablauf der 14 Tage')
        : miss,
      __ERKL_SOFTWARE__: o.erklSoftware
        || 'Zur Kenntnis genommen: Berechnungswerkzeug, keine Anlageberatung',
      __ERKL_UNTERLAGEN__: o.erklUnterlagen
        || 'Vorvertragliche Informationen, AGB und Widerrufsbelehrung vor der Bestellung erhalten; mind. 18 Jahre und unbeschränkt geschäftsfähig',
      __ERKL_DATUM__: o.erklDatum ? de(new Date(o.erklDatum + 'T12:00:00')) : de(datum),
      __HEUTE__: de(today),
    };
    let html = fs.readFileSync(path.join(SRC, 'vertragsbestaetigung.html'), 'utf8');
    for (const [k, v] of Object.entries(map)) html = html.split(k).join(v);
    const slug = String(o.kunde || 'kunde').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    const stamp = datum.toISOString().slice(0, 10);
    await render(browser, html, path.join(OUT, `Vertragsbestaetigung_${slug}_${stamp}.pdf`));
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

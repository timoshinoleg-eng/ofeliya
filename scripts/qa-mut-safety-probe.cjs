// Run against a QA-enabled server: OFELIYA_QA_BASE=http://127.0.0.1:5430/ node scripts/qa-mut-safety-probe.cjs
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const base = process.env.OFELIYA_QA_BASE || 'http://127.0.0.1:5400/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [input, expected] of [
      ['<b data-qa-marker>INJECTED</b>', 'MULTI'],
      ['../', 'MULTI'], ['   ', 'MULTI'], ['not-in-catalog', 'MULTI'],
      ['multi', 'MULTI'], ['pierce', 'PIERCE'],
    ]) {
      const page = await browser.newPage();
      const params = new URLSearchParams({ qa: 'carry-pair', mut: input, video: '0' });
      await page.goto(`${base}?${params}`);
      const overlay = page.locator('[data-qa-overlay="carry-pair"]');
      await overlay.waitFor({ timeout: 30000 });
      assert.equal(await page.locator('[data-qa-marker]').count(), 0, 'mut must never create markup');
      assert.match(await overlay.innerText(), new RegExp(`Переносимая мутация:\\s*${expected}\\b`));
      await page.close();
      console.log(`PASS mut ${JSON.stringify(input)} -> ${expected}`);
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

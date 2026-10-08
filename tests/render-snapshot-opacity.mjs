import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const assets = new URL('../dist/assets/', import.meta.url);
const chunks = readdirSync(assets).filter((name) => name.endsWith('.js'));
assert.ok(chunks.length > 0, 'ordinary production JS bundle required');
for (const name of chunks) {
  assert.equal(readFileSync(new URL(name, assets), 'utf8').includes('__renderSnapshot'), false,
    `ordinary production chunk ${name} must not contain the diagnostic hook`);
  assert.equal(readFileSync(new URL(name, assets), 'utf8').includes('renderDensity'), false,
    `ordinary production chunk ${name} must not contain the density experiment query`);
}

const executablePath = process.platform === 'win32' ? undefined :
  ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.route('https://st.max.ru/**', (route) => route.fulfill({ body: '' }));
  await page.goto(`${process.env.OFELIYA_URL || 'http://127.0.0.1:4173/'}?renderer=canvas&debug=1&renderDensity=2`);
  await page.waitForSelector('#game canvas');
  // Existing startup marker completes after Menu's two rendered frames, without QA hooks.
  await page.waitForFunction(() => document.querySelector('#game canvas') &&
    JSON.parse(sessionStorage.getItem('ofeliya_startup_nav_v1') || '{}').completed === true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => [typeof window.__game, typeof window.__viewportManager, typeof window.__renderSnapshot]),
    ['undefined', 'undefined', 'undefined'], 'ordinary production must remain opaque even with a debug query');
  assert.equal(await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas');
    const bounds = canvas.getBoundingClientRect();
    return canvas.width === Math.round(bounds.width) && canvas.height === Math.round(bounds.height);
  }), true, 'ordinary production must retain 1x backing despite DPR2 and renderDensity query');
  console.log('render snapshot production opacity: ok');
} finally { await browser.close(); }

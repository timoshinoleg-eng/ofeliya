import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const executablePath = process.platform === 'win32' ? undefined :
  ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://st.max.ru/**', (route) => route.fulfill({ body: '' }));
  await page.goto(`${process.env.OFELIYA_URL || 'http://127.0.0.1:4173/'}?renderer=canvas&debug=1`);
  await page.waitForSelector('#game canvas');
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => [typeof window.__game, typeof window.__viewportManager, typeof window.__renderSnapshot]),
    ['undefined', 'undefined', 'undefined'], 'ordinary production must remain opaque even with a debug query');
  console.log('render snapshot production opacity: ok');
} finally { await browser.close(); }

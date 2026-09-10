import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;

try {
  await server.listen();
  const pageUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.addInitScript(() => {
    const never = new Promise(() => {});
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: () => never, ready: never },
    });
  });

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => ({
    splash: Boolean(document.querySelector('#splash')),
    canvases: document.querySelectorAll('#game canvas').length,
  }));

  assert.equal(state.splash, false, 'font readiness must not block the Mini App startup');
  assert.equal(state.canvases, 1, 'Phaser canvas must be created after the font timeout');
} finally {
  await browser?.close();
  await server.close();
}

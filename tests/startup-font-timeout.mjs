import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
assert.ok(chrome, 'System Chrome/Chromium is required for startup smoke');

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;

try {
  await server.listen();
  const pageUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.addInitScript(() => {
    const never = new Promise(() => {});
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: () => never, ready: never },
    });
  });

  // Font readiness is renderer-independent. Force the proven Canvas fallback here so this test
  // stays deterministic; High-DPI WebGL is exercised separately by renderer-smoke.cjs.
  const startedAt = Date.now();
  await page.goto(`${pageUrl}?renderer=canvas`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !document.querySelector('#splash') && document.querySelectorAll('#game canvas').length === 1,
    undefined,
    { timeout: 3000 }
  );
  const elapsedMs = Date.now() - startedAt;
  const state = await page.evaluate(() => ({
    splash: Boolean(document.querySelector('#splash')),
    canvases: document.querySelectorAll('#game canvas').length,
    renderer: window.__game?.renderer.constructor.name,
  }));

  assert.equal(state.splash, false, 'font readiness must not block the Mini App startup');
  assert.equal(state.canvases, 1, 'Phaser canvas must be created after the font timeout');
  assert.equal(state.renderer, 'CanvasRenderer', 'explicit Canvas recovery path must still boot');
  assert.ok(elapsedMs < 3000, `font timeout boot exceeded bounded startup window: ${elapsedMs}ms`);
} finally {
  await browser?.close();
  await server.close();
}

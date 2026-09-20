import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;

try {
  await server.listen();
  const pageUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await context.addInitScript(() => {
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-startup-timeout',
      initDataUnsafe: { user: { id: 42, first_name: 'Startup', last_name: 'QA' } },
      // Reproduces the production failure mode: the MAX bridge call never settles.
      getViewportSize: () => new Promise(() => {}),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await context.newPage();
  const startedAt = Date.now();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 6000 });
  const elapsedMs = Date.now() - startedAt;
  const state = await page.evaluate(() => ({
    splash: Boolean(document.querySelector('#splash')),
    canvases: document.querySelectorAll('#game canvas').length,
    source: document.getElementById('game')?.dataset.viewportSource ?? '',
    scale: [window.__game?.scale.width, window.__game?.scale.height],
  }));

  assert.equal(state.splash, false, 'stalled platform viewport must not leave the splash visible');
  assert.equal(state.canvases, 1, 'Phaser must boot even when the platform viewport promise hangs');
  assert.deepEqual(state.scale, [390, 844], 'startup must fall back to the browser viewport');
  // Assert bounded startup, not GitHub/Playwright cold-start performance. The product-level
  // viewport wait itself is capped at 320ms; this integration ceiling only catches a true hang.
  assert.ok(elapsedMs < 5000, `stalled MAX viewport delayed startup too long: ${elapsedMs}ms`);
} finally {
  await browser?.close();
  await server.close();
}

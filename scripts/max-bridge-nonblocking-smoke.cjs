const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  let releaseBridge;
  const bridgeGate = new Promise((resolve) => {
    releaseBridge = resolve;
  });

  await ctx.route('https://st.max.ru/**', async (route) => {
    await bridgeGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.WebApp = {
          platform: 'android',
          version: '26.20.0',
          initData: 'late-max-bridge',
          initDataUnsafe: { user: { id: 1, first_name: 'Late' } },
          getViewportSize: async () => ({ width: '360', height: '720' }),
          BackButton: {
            show() { window.__maxBackShown = (window.__maxBackShown || 0) + 1; },
            hide() { window.__maxBackHidden = (window.__maxBackHidden || 0) + 1; },
            onClick(callback) { window.__maxBackHandler = callback; },
            offClick(callback) {
              if (window.__maxBackHandler === callback) window.__maxBackHandler = null;
            },
          },
          HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
        };
      `,
    });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  const startedAt = Date.now();
  await page.goto('http://127.0.0.1:5173/?app=ofeliya-20260912-strain-zero-rc3-utf8', {
    waitUntil: 'domcontentloaded',
    timeout: 4000,
  });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 3500 });
  const menuElapsedMs = Date.now() - startedAt;

  const beforeBridge = await page.evaluate(() => ({
    platform: document.querySelector('#game')?.dataset.viewportSource || '',
    width: window.__game?.scale.width,
    height: window.__game?.scale.height,
    splash: Boolean(document.querySelector('#splash')),
  }));

  if (beforeBridge.splash) throw new Error('splash remained visible while MAX bridge was stalled');
  if (menuElapsedMs >= 3500) {
    throw new Error('stalled MAX bridge blocked menu startup: ' + menuElapsedMs + 'ms');
  }
  if (beforeBridge.platform !== 'browser') {
    throw new Error('expected browser fallback before late bridge: ' + JSON.stringify(beforeBridge));
  }

  // Enter gameplay while the MAX script is still stalled. GameScene installs its native back
  // callback through the browser fallback at this point; the facade must remember and rebind it
  // when the real MAX adapter becomes available later.
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() => window.__game?.scene.isActive('Game'), null, { timeout: 5000 });

  releaseBridge();

  await page.waitForFunction(() => window.WebApp?.platform === 'android', null, { timeout: 5000 });
  await page.waitForFunction(
    () => window.__ofeliyaEarlyMarks?.some(([name]) => name === 'max.bridge.loaded'),
    null,
    { timeout: 5000 }
  );

  // Re-fire the documented readiness signal after the fake bridge is definitely installed.
  // This isolates the late viewport contract from route/onload scheduling jitter in CI.
  await page.evaluate(() => window.dispatchEvent(new Event('ofeliya:max-bridge-ready')));
  await page.waitForFunction(() => document.querySelector('#game')?.dataset.viewportSource === 'max', null, {
    timeout: 5000,
  });
  await page.waitForFunction(
    () => window.__game?.scale.width === 360 && window.__game?.scale.height === 720,
    null,
    { timeout: 5000 }
  );

  const afterBridge = await page.evaluate(() => ({
    platform: document.querySelector('#game')?.dataset.viewportSource || '',
    width: window.__game?.scale.width,
    height: window.__game?.scale.height,
    marks: window.__ofeliyaEarlyMarks,
  }));

  if (afterBridge.platform !== 'max' || afterBridge.width !== 360 || afterBridge.height !== 720) {
    throw new Error('late MAX bridge did not resync viewport: ' + JSON.stringify(afterBridge));
  }

  await page.waitForFunction(
    () => typeof window.__maxBackHandler === 'function' && (window.__maxBackShown || 0) > 0,
    null,
    { timeout: 5000 }
  );
  await page.evaluate(() => window.__maxBackHandler());
  await page.waitForFunction(
    () => window.__game?.scene.isActive('Menu') && !window.__game?.scene.isActive('Game'),
    null,
    { timeout: 5000 }
  );

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));

  await ctx.close();
  await browser.close();
  console.log('non-blocking MAX bridge smoke: ok (' + menuElapsedMs + 'ms before bridge)');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

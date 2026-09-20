const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const VIEWPORT = { width: 360, height: 640 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function touchAt(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function textCenter(page, label) {
  return page.evaluate((wanted) => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    const text = flat.find((obj) => obj?.text === wanted && obj.visible !== false);
    const bounds = text?.getBounds?.();
    return bounds ? { x: Math.round(bounds.centerX), y: Math.round(bounds.centerY) } : null;
  }, label);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(({ width, height }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-pause-smoke',
      initDataUnsafe: { user: { id: 77, first_name: 'Pause', last_name: 'QA' } },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, VIEWPORT);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  await page.evaluate(() => window.__game.registry.set('joy', { x: 1, y: 0 }));
  await sleep(260);
  const before = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    return { timeMs: gs.runState.run.timeMs, x: gs.player.x, y: gs.player.y };
  });

  const pausePoint = await textCenter(page, 'Ⅱ');
  if (!pausePoint) throw new Error('pause hit target missing');
  await touchAt(ctx, page, pausePoint);
  await page.waitForFunction(() => window.__game.scene.isPaused('Game'));

  const paused = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    return {
      timeMs: gs.runState.run.timeMs,
      x: gs.player.x,
      y: gs.player.y,
      joy: window.__game.registry.get('joy'),
      aimJoy: window.__game.registry.get('aimJoy'),
    };
  });
  await sleep(420);
  const stillPaused = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    return { timeMs: gs.runState.run.timeMs, x: gs.player.x, y: gs.player.y };
  });

  if (Math.abs(stillPaused.timeMs - paused.timeMs) > 1) {
    throw new Error('run clock advanced while paused');
  }
  if (Math.hypot(stillPaused.x - paused.x, stillPaused.y - paused.y) > 0.5) {
    throw new Error('player moved while paused');
  }
  if ((paused.joy?.x ?? 1) !== 0 || (paused.joy?.y ?? 1) !== 0) {
    throw new Error('movement input not cleared on pause: ' + JSON.stringify({ paused, stillPaused }));
  }

  const continuePoint = await textCenter(page, 'ПРОДОЛЖИТЬ');
  if (!continuePoint) throw new Error('continue button missing');
  await touchAt(ctx, page, continuePoint);
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && !window.__game.scene.isPaused('Game'));
  await sleep(260);
  const resumedTime = await page.evaluate(() => window.__game.scene.getScene('Game').runState.run.timeMs);
  if (resumedTime <= paused.timeMs + 100) throw new Error('run clock did not resume');

  const pauseAgain = await textCenter(page, 'Ⅱ');
  if (!pauseAgain) throw new Error('pause hit target missing after resume');
  await touchAt(ctx, page, pauseAgain);
  await page.waitForFunction(() => window.__game.scene.isPaused('Game'));

  const menuPoint = await textCenter(page, 'В МЕНЮ');
  if (!menuPoint) throw new Error('pause menu exit button missing');
  await touchAt(ctx, page, menuPoint);
  await page.waitForFunction(() => {
    const game = window.__game;
    return game.scene.isActive('Menu') && !game.scene.isActive('Game') && !game.scene.isActive('UI');
  });

  if (before.timeMs <= 0) throw new Error('run did not advance before pause');
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));

  await ctx.close();
  await browser.close();
  console.log('real-touch pause smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

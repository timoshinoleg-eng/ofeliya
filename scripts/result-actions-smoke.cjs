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

async function bootResult(browser) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.route('**/api/score', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        rank: null,
        ranked: false,
        rulesetVersion: 2,
        campaignVersion: 2,
      }),
    })
  );
  await ctx.addInitScript(({ width, height }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.__shared = null;
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-result-actions-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Result', last_name: 'QA' } },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      shareMaxContent: async (params) => { window.__shared = params; },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, VIEWPORT);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));

  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    menu.registry.set('difficultyId', 'strained');
    menu.scene.start('Game');
  });
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    gs.runState.run.timeMs = 130000;
    gs.runState.run.kills = 90;
    gs.runState.run.hostCellsInfected = 5;
    gs.runState.run.highestLevel = 10;
    gs.runState.stage.level = 10;
    gs.runState.run.comboBest = 24;
    gs.finish(false);
    game.scene.getScene('UI').update();
  });
  await sleep(220);

  if (errors.length) throw new Error('page errors before result action: ' + errors.join(' | '));
  return { ctx, page, errors };
}

async function buttonCenter(page, label) {
  return page.evaluate((wanted) => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    const text = flat.find((obj) => obj?.text === wanted && obj.visible !== false);
    if (!text) return null;
    const container = text.parentContainer;
    const bg = container?.list?.find(
      (obj) =>
        obj !== text &&
        obj.input?.enabled &&
        Math.abs((obj.y ?? -9999) - text.y) < 1 &&
        typeof obj.getBounds === 'function'
    );
    const bounds = bg?.getBounds?.();
    if (!bounds) return null;
    return { x: Math.round(bounds.centerX), y: Math.round(bounds.centerY) };
  }, label);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // Exact STRAINED result path reported from production: real touch must invoke native share.
  {
    const { ctx, page, errors } = await bootResult(browser);
    const point = await buttonCenter(page, 'ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ');
    if (!point) throw new Error('Strained share button hit target missing');
    await touchAt(ctx, page, point);
    await page.waitForFunction(() => !!window.__shared);
    const shared = await page.evaluate(() => window.__shared);
    if (!shared?.text) throw new Error('real touch did not invoke MAX share');
    if (errors.length) throw new Error('page errors after share: ' + errors.join(' | '));
    await ctx.close();
  }

  // Restart must create a fresh playable Game/UI pair, not leave the paused result scene.
  {
    const { ctx, page, errors } = await bootResult(browser);
    const point = await buttonCenter(page, 'ЕЩЁ ОДИН ЦИКЛ');
    if (!point) throw new Error('restart button hit target missing');
    await touchAt(ctx, page, point);
    await sleep(650);
    const restartState = await page.evaluate(() => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const ui = game.scene.getScene('UI');
      return {
        gameActive: game.scene.isActive('Game'),
        gamePaused: game.scene.isPaused('Game'),
        gameStatus: gs?.sys?.settings?.status ?? null,
        uiActive: game.scene.isActive('UI'),
        uiPaused: game.scene.isPaused('UI'),
        uiStatus: ui?.sys?.settings?.status ?? null,
        menuActive: game.scene.isActive('Menu'),
        runResult: game.registry.get('runResult') ? 'present' : 'null',
        sameGameRef: ui?.gs === gs,
        restartMethod: typeof gs?.restartRun,
      };
    });
    if (
      !restartState.gameActive ||
      restartState.gamePaused ||
      !restartState.uiActive ||
      restartState.runResult !== 'null'
    ) {
      throw new Error(
        'restart touch lifecycle failed: ' +
          JSON.stringify({ restartState, pageErrors: errors })
      );
    }
    if (errors.length) throw new Error('page errors after restart: ' + errors.join(' | '));
    await ctx.close();
  }

  // Menu must stop both gameplay scenes and restore the menu.
  {
    const { ctx, page, errors } = await bootResult(browser);
    const point = await buttonCenter(page, 'В МЕНЮ');
    if (!point) throw new Error('menu button hit target missing');
    await touchAt(ctx, page, point);
    await page.waitForFunction(() => {
      const game = window.__game;
      return game.scene.isActive('Menu') && !game.scene.isActive('Game') && !game.scene.isActive('UI');
    });
    if (errors.length) throw new Error('page errors after menu: ' + errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log('real-touch result actions smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

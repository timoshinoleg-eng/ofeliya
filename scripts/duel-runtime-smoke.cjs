const fs = require('fs');

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function touchText(ctx, page, sceneKey, label) {
  const point = await page.evaluate(({ sceneKey, label }) => {
    const scene = window.__game.scene.getScene(sceneKey);
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    scene.children.list.forEach(visit);
    const text = flat.find((obj) => obj?.text === label && obj.visible !== false);
    if (!text) return null;
    const candidates = flat
      .filter((obj) => obj?.input?.enabled && typeof obj.getBounds === 'function')
      .map((obj) => ({ bounds: obj.getBounds() }))
      .filter(({ bounds }) =>
        text.x >= bounds.left && text.x <= bounds.right && text.y >= bounds.top && text.y <= bounds.bottom
      )
      .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
    const bounds = candidates[0]?.bounds;
    return bounds ? { x: Math.round(bounds.centerX), y: Math.round(bounds.centerY) } : null;
  }, { sceneKey, label });
  if (!point) throw new Error(`interactive target missing for ${label}`);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(35);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  const challengeId = 'AbCdEf0123_-xyZ9';
  const seed = 'duel-runtime-seed';
  const targetTimeMs = 600_000;
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 740 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  const events = [];
  const attempts = [];
  let scoreCalls = 0;

  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.route(`**/api/duel/${challengeId}`, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ranked: false,
        challenge: {
          challengeId,
          rulesetVersion: 2,
          campaignVersion: 2,
          runSeed: seed,
          difficultyId: 'standard',
          controlMode: 'dual-move',
          targetTimeMs,
          createdAt: Date.now() - 1000,
          expiresAt: Date.now() + 7 * 86_400_000,
        },
      }),
    });
  });
  await ctx.route(`**/api/duel/${challengeId}/event`, async (route) => {
    events.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, ranked: false }),
    });
  });
  await ctx.route(`**/api/duel/${challengeId}/attempt`, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    attempts.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ranked: false,
        valid: true,
        beaten: false,
        targetTimeMs,
        attemptCount: attempts.length,
        bestTimeMs: null,
        everBeaten: false,
      }),
    });
  });
  await ctx.route('**/api/score', async (route) => {
    scoreCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ranked: true,
        rank: 1,
        rulesetVersion: 2,
        campaignVersion: 2,
      }),
    });
  });

  await ctx.addInitScript(({ challengeId }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    localStorage.setItem('ofeliya_difficulty_v1', 'strained');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-duel-runtime-smoke',
      initDataUnsafe: {
        user: { id: 42, first_name: 'Duel', last_name: 'QA' },
        start_param: `d3_${challengeId}`,
      },
      getViewportSize: async () => ({ width: '390', height: '740' }),
      shareMaxContent: async () => {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { challengeId });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (id) => window.__game?.registry.get('duelChallenge')?.challengeId === id,
    challengeId,
    { timeout: 4000 }
  );

  const menuState = await page.evaluate(() => {
    const game = window.__game;
    const menu = game.scene.getScene('Menu');
    const texts = [];
    const visit = (obj) => {
      if (typeof obj?.text === 'string') texts.push(obj.text);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    menu.children.list.forEach(visit);
    return {
      difficulty: game.registry.get('difficultyId'),
      controlMode: game.registry.get('controlMode'),
      challenge: game.registry.get('duelChallenge'),
      texts,
    };
  });
  if (
    menuState.difficulty !== 'standard' ||
    menuState.controlMode !== 'dual-move' ||
    menuState.challenge?.runSeed !== seed ||
    !menuState.texts.includes('ПРИНЯТЬ ДУЭЛЬ')
  ) {
    throw new Error('duel menu snapshot contract failed: ' + JSON.stringify(menuState));
  }
  await page.waitForFunction(() => true);
  if (!events.some((event) => event.event === 'open')) {
    await sleep(120);
  }
  if (!events.some((event) => event.event === 'open')) {
    throw new Error('duel open telemetry missing: ' + JSON.stringify(events));
  }

  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const selector = menu.children.getByName('ofeliya-menu-control-selector');
    if (!selector?.input?.enabled) throw new Error('duel control selector hit target missing');
    selector.emit('pointerup');
  });
  const afterControlTouch = await page.evaluate(() => window.__game.registry.get('controlMode'));
  if (afterControlTouch !== 'dual-move') {
    throw new Error('fixed duel control mode changed after selector touch: ' + afterControlTouch);
  }

  await touchText(ctx, page, 'Menu', 'ПРИНЯТЬ ДУЭЛЬ');
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );
  const runState = await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    return {
      seed: gs.runSeed,
      controlMode: gs.controlMode,
      difficulty: gs.difficulty.id,
      overrideConsumed: game.registry.get('runSeedOverride') == null,
      challengeId: game.registry.get('duelChallenge')?.challengeId,
    };
  });
  if (
    runState.seed !== seed ||
    runState.controlMode !== 'dual-move' ||
    runState.difficulty !== 'standard' ||
    !runState.overrideConsumed ||
    runState.challengeId !== challengeId
  ) {
    throw new Error('duel runtime snapshot contract failed: ' + JSON.stringify(runState));
  }
  if (!events.some((event) => event.event === 'start')) {
    await sleep(120);
  }
  if (!events.some((event) => event.event === 'start')) {
    throw new Error('duel start telemetry missing: ' + JSON.stringify(events));
  }

  await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    gs.finish(false, 'dead');
    game.scene.getScene('UI').update();
  });
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    return flat.some((obj) => obj?.text === 'ЕЩЁ ОДИН ЦИКЛ' && obj.visible !== false);
  });
  for (let i = 0; i < 20 && attempts.length === 0; i++) await sleep(50);
  if (attempts.length !== 1) throw new Error('duel attempt was not submitted exactly once');
  if (
    attempts[0]?.payload?.runSeed !== seed ||
    attempts[0]?.payload?.controlMode !== 'dual-move' ||
    attempts[0]?.payload?.difficultyId !== 'standard'
  ) {
    throw new Error('duel attempt payload drifted from snapshot: ' + JSON.stringify(attempts[0]));
  }
  if (scoreCalls !== 0) throw new Error('duel attempt leaked into canonical /api/score');

  await touchText(ctx, page, 'UI', 'ЕЩЁ ОДИН ЦИКЛ');
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && !window.__game.registry.get('runResult'),
    null,
    { timeout: 4000 }
  );
  const rematch = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    return { seed: gs.runSeed, controlMode: gs.controlMode, difficulty: gs.difficulty.id };
  });
  if (rematch.seed !== seed || rematch.controlMode !== 'dual-move' || rematch.difficulty !== 'standard') {
    throw new Error('duel rematch snapshot changed: ' + JSON.stringify(rematch));
  }
  if (!events.some((event) => event.event === 'rematch')) {
    await sleep(120);
  }
  if (!events.some((event) => event.event === 'rematch')) {
    throw new Error('duel rematch telemetry missing: ' + JSON.stringify(events));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('fixed-seed duel runtime browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

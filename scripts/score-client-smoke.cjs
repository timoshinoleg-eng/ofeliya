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

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );

  let captured = null;
  let requestUrl = null;
  await ctx.route('**/api/score', async (route) => {
    const req = route.request();
    requestUrl = req.url();
    captured = JSON.parse(req.postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        rank: 7,
        ranked: true,
        rulesetVersion: 2,
        campaignVersion: 2,
        top: [],
      }),
    });
  });

  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-score-client-smoke',
      initDataUnsafe: {
        user: { id: 42, first_name: 'Score', last_name: 'QA' },
      },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));

  await page.evaluate(() => {
    const game = window.__game;
    game.registry.set('runSeedOverride', 'score-client-seed');
    game.scene.getScene('Menu').scene.start('Game');
  });
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.run.timeMs = 145_000;
    gs.runState.run.kills = 73;
    gs.runState.run.hostCellsInfected = 6;
    gs.runState.run.highestLevel = 11;
    gs.runState.stage.level = 11;
    gs.runState.run.comboBest = 19;
    gs.finish(false, 'dead');
    window.__game.scene.getScene('UI').update();
  });

  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    return flat.some(
      (obj) => typeof obj.text === 'string' && obj.text.includes('РЕЙТИНГ · МЕСТО #7')
    );
  }, null, { timeout: 2500 });

  if (!captured) throw new Error('score request was not sent');
  if (!requestUrl || !requestUrl.endsWith('/api/score')) {
    throw new Error('score endpoint is not the relative api/score route: ' + requestUrl);
  }
  if (
    captured.platform !== 'max' ||
    captured.initData !== 'signed-score-client-smoke' ||
    captured.anonId != null
  ) {
    throw new Error('trusted MAX score envelope failed: ' + JSON.stringify(captured));
  }

  const p = captured.payload || {};
  const expected = {
    rulesetVersion: 2,
    campaignVersion: 2,
    difficultyId: 'standard',
    completionStage: 'bloodstream',
    runSeed: 'score-client-seed',
    controlMode: 'two-hand',
    bossesDefeated: 0,
    boss1ClearMs: null,
    hostCellsInfected: 6,
    win: false,
    timeMs: 145000,
    kills: 73,
    level: 11,
    daily: false,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (p[key] !== value) {
      throw new Error(`score payload mismatch for ${key}: ${JSON.stringify(captured)}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dateKey || '')) {
    throw new Error('score payload has no local dateKey: ' + JSON.stringify(captured));
  }

  const resultState = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    const texts = flat.filter((obj) => typeof obj.text === 'string').map((obj) => obj.text);
    return {
      rank: texts.find((text) => text.includes('РЕЙТИНГ · RULESET 2 · #7')) ?? null,
      retry: texts.includes('ЕЩЁ ОДИН ЦИКЛ'),
      menu: texts.includes('В МЕНЮ'),
      share: texts.includes('БРОСИТЬ ВЫЗОВ'),
    };
  });

  if (!resultState.rank || !resultState.retry || !resultState.menu || !resultState.share) {
    throw new Error('score sync disrupted result UI: ' + JSON.stringify(resultState));
  }
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));

  await browser.close();
  console.log('trusted score client browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

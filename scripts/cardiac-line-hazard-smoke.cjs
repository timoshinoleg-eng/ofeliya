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
    viewport: { width: 390, height: 740 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-cardiac-hazard-smoke',
      initDataUnsafe: { user: { id: 73, first_name: 'Cardiac', last_name: 'QA' } },
      getViewportSize: async () => ({ width: '390', height: '740' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const setup = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;
    for (const enemy of gs.enemies.getChildren()) {
      if (enemy.active) enemy.deactivateForStageReset();
    }

    gs.stageDirector.restore({
      stageId: 'heart',
      phase: 'BOSS_ACTIVE',
      milestoneIndex: 4,
      runStarted: true,
    });
    gs.runState.resetStageProgression(gs.stageDirector.currentStage);
    gs.runState.stage.hp = 1_000;
    gs.runState.stage.maxHp = 1_000;
    gs.wave.startStage(gs.stageDirector.currentStage);
    gs.heartbeatPulse.reset(0);
    gs.cardiacHazard.reset();
    gs.cardiacHazardVisual = null;

    const boss = gs.spawnEnemy('boss', gs.player.x + 260, gs.player.y, false);
    if (!boss) throw new Error('failed to spawn CARDIAC TITAN');
    boss.speed = 0;
    boss.dmg = 0;
    boss.hp = boss.maxHp;
    gs.wave.boss = boss;

    return {
      stageId: gs.stageDirector.currentStage.id,
      behavior: gs.stageDirector.currentStage.boss.behavior,
      phase: boss.bossPhase,
      hp: gs.runState.stage.hp,
    };
  });

  if (setup.stageId !== 'heart' || setup.behavior !== 'heartbeat-pulse' || setup.phase !== 1) {
    throw new Error('Heart phase-one setup failed: ' + JSON.stringify(setup));
  }

  await page.waitForTimeout(900);
  const phaseOneVisual = await page.evaluate(() =>
    Boolean(window.__game.scene.getScene('Game').cardiacHazardVisual)
  );
  if (phaseOneVisual) throw new Error('Cardiac line hazard appeared during boss phase 1');

  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const boss = gs.wave.boss;
    boss.hp = boss.maxHp * 0.49;
  });
  await page.waitForFunction(() => window.__game.scene.getScene('Game').wave.boss?.bossPhase === 2);

  await page.waitForFunction(
    () => Boolean(window.__game.scene.getScene('Game').cardiacHazardVisual),
    null,
    { timeout: 8_000 }
  );

  const telegraph = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const visual = gs.cardiacHazardVisual;
    if (!visual) return null;
    const warning = visual.warning;
    const beam = visual.beam;
    const heartbeatClear =
      gs.heartbeatSafeIndicator === null && gs.time.now > gs.heartbeatOpportunityUntil;
    const hpBefore = gs.runState.stage.hp;
    gs.player.setPosition(warning.x, warning.y);
    if (gs.player.body?.reset) gs.player.body.reset(warning.x, warning.y);
    return {
      serial: visual.serial,
      warningVisible: warning.visible,
      beamVisible: beam.visible,
      width: warning.width,
      height: warning.height,
      heartbeatClear,
      hpBefore,
    };
  });

  if (
    !telegraph ||
    !telegraph.warningVisible ||
    telegraph.beamVisible ||
    telegraph.width < 500 ||
    telegraph.height < 40 ||
    !telegraph.heartbeatClear
  ) {
    throw new Error('Cardiac line telegraph contract failed: ' + JSON.stringify(telegraph));
  }

  await page.waitForFunction(() => {
    const gs = window.__game.scene.getScene('Game');
    return Boolean(gs.cardiacHazardVisual?.beam?.visible);
  }, null, { timeout: 2_000 });

  const fired = await page.evaluate((hpBefore) => {
    const gs = window.__game.scene.getScene('Game');
    return {
      hpAfter: gs.runState.stage.hp,
      damage: hpBefore - gs.runState.stage.hp,
      warningVisible: gs.cardiacHazardVisual?.warning?.visible ?? null,
      beamVisible: gs.cardiacHazardVisual?.beam?.visible ?? null,
    };
  }, telegraph.hpBefore);

  if (!fired.beamVisible || fired.warningVisible !== false) {
    throw new Error('Cardiac beam did not replace warning: ' + JSON.stringify(fired));
  }
  if (Math.abs(fired.damage - 14) > 0.01) {
    throw new Error('Cardiac beam damage contract failed: ' + JSON.stringify(fired));
  }

  await page.waitForFunction(
    () => window.__game.scene.getScene('Game').cardiacHazardVisual === null,
    null,
    { timeout: 1_500 }
  );

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('CARDIAC TITAN line hazard runtime smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

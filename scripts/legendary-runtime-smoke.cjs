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

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-legendary-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Legendary', last_name: 'QA' } },
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
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() =>
    window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const immediate = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;

    const setLegendary = (id) => {
      gs.runState.run.legendaryIds.clear();
      gs.runState.run.legendaryIds.add(id);
    };

    setLegendary('split-geometry');
    // The live scene may have already auto-fired during boot. Isolate this mechanic from those
    // legitimate pooled projectiles before asserting the +2 split children.
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;
    for (const bullet of gs.bullets.getChildren()) {
      if (bullet.active) bullet.deactivateForStageReset();
    }
    const source = gs.bullets.get(gs.player.x, gs.player.y);
    source.fire(gs.time.now, 0, 10, 0, true, 0);
    gs.trySplitProjectile(source, { x: 480, y: 0 });
    const bullets = gs.bullets.getChildren().filter((b) => b.active);
    const split = {
      active: bullets.length,
      generations: bullets.map((b) => b.generation).sort(),
    };
    for (const bullet of bullets) bullet.deactivateForStageReset();

    setLegendary('core-predator');
    const elite = gs.spawnEnemy('brute', gs.player.x + 160, gs.player.y, true);
    const coreDamages = [
      gs.applyCorePredator(elite, 10),
      gs.applyCorePredator(elite, 10),
      gs.applyCorePredator(elite, 10),
      gs.applyCorePredator(elite, 10),
      gs.applyCorePredator(elite, 10),
    ];

    setLegendary('zero-point');
    const zeroEnemy = gs.spawnEnemy('runner', gs.player.x + 220, gs.player.y + 40, false);
    const zeroStarted = gs.beginZeroPoint(gs.time.now);
    const zeroUntil = gs.zeroPointUntil;
    gs.applyZeroPointPull(16);

    setLegendary('myocardial-rhythm');
    const originalStageId = gs.runState.stage.id;
    gs.runState.stage.id = 'heart';
    gs.heartbeatLegendaryWindowUntil = gs.time.now + 650;
    gs.heartbeatLegendarySpent = false;
    const rhythmFirst = gs.consumeMyocardialRhythm();
    const rhythmSecond = gs.consumeMyocardialRhythm();
    gs.runState.stage.id = originalStageId;

    return {
      split,
      coreDamages,
      zeroStarted,
      zeroUntil,
      now: gs.time.now,
      zeroEnemyActive: Boolean(zeroEnemy?.active),
      rhythmFirst,
      rhythmSecond,
    };
  });

  if (
    immediate.split.active !== 3 ||
    JSON.stringify(immediate.split.generations) !== JSON.stringify([0, 1, 1])
  ) {
    throw new Error(`Geometry Split runtime failed: ${JSON.stringify(immediate.split)}`);
  }
  if (
    immediate.coreDamages.slice(0, 4).some((value) => value !== 10) ||
    Math.abs(immediate.coreDamages[4] - 17.5) > 1e-9
  ) {
    throw new Error(`Core Predator runtime failed: ${JSON.stringify(immediate.coreDamages)}`);
  }
  if (!immediate.zeroStarted || immediate.zeroUntil <= immediate.now || !immediate.zeroEnemyActive) {
    throw new Error(`Zero Point runtime failed: ${JSON.stringify(immediate)}`);
  }
  if (!immediate.rhythmFirst || immediate.rhythmSecond) {
    throw new Error(`Myocardial Rhythm consumption failed: ${JSON.stringify(immediate)}`);
  }

  const lysisBefore = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.run.legendaryIds.clear();
    gs.runState.run.legendaryIds.add('lysis-chain');
    const a = gs.spawnEnemy('brute', gs.player.x + 260, gs.player.y + 120, false);
    const b = gs.spawnEnemy('brute', gs.player.x - 260, gs.player.y - 120, false);
    const event = { x: gs.player.x, y: gs.player.y, radius: 24, damage: 100, rna: 0 };
    gs.__legendarySmokeTargets = [a, b];
    gs.triggerLysisChain(event, [a, b]);
    return [a.hp, b.hp];
  });
  await sleep(420);
  const lysisAfter = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    return gs.__legendarySmokeTargets.map((e) => e.hp);
  });
  if (!(lysisAfter[0] < lysisBefore[0] && lysisAfter[1] < lysisBefore[1])) {
    throw new Error(`Lysis Chain runtime failed: before=${lysisBefore} after=${lysisAfter}`);
  }

  const carrier = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.run.legendaryIds.clear();
    gs.runState.run.legendaryIds.add('last-carrier');
    gs.runState.stage.hp = -5;
    gs.runState.stage.xp = 100;
    gs.activateLastCarrier();
    return {
      hp: gs.runState.stage.hp,
      xp: gs.runState.stage.xp,
      used: gs.lastCarrierUsed,
    };
  });
  if (carrier.hp !== 1 || carrier.xp !== 75 || !carrier.used) {
    throw new Error(`Last Carrier runtime failed: ${JSON.stringify(carrier)}`);
  }

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('legendary runtime browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

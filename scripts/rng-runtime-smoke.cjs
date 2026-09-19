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
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    localStorage.setItem('ofeliya_difficulty_v1', 'strained');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-rng-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'RNG', last_name: 'QA' } },
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
    game.registry.set('runSeedOverride', 'runtime-seed-01');
    game.scene.getScene('Menu').scene.start('Game');
  });
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const result = await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;

    const Rng = gs.gameplayRng.constructor;
    const seed = gs.runSeed;

    const fingerprint = () => {
      gs.gameplayRng = new Rng(seed);
      gs.runState.stage.timeMs = 0;
      gs.runState.run.timeMs = 0;
      gs.runState.run.legendaryPity = 0;
      gs.runState.run.legendaryOffersSeen = 0;
      gs.queuedLevels = 1;
      gs.awaitingChoice = false;
      gs.pendingChoices = [];

      for (const enemy of gs.enemies.getChildren()) {
        if (enemy.active) enemy.deactivateForStageReset();
      }
      for (const gem of gs.gems.getChildren()) {
        if (gem.active) gem.deactivateForStageReset();
      }
      gs.hostCells.resetStage();

      const kindRolls = [gs.wave.randomKind(), gs.wave.randomKind(), gs.wave.randomKind()];
      const spawnRolls = [gs.wave.randomSpawn(), gs.wave.randomSpawn(), gs.wave.randomSpawn()];

      gs.hostCells.spawnNearPlayer();
      const host = gs.hostCells.cells.find((cell) => cell.active);
      if (!host) throw new Error('seeded host cell did not spawn');

      const eliteA = gs.spawnEnemy('swarm', gs.player.x + 150, gs.player.y, true);
      const eliteB = gs.spawnEnemy('runner', gs.player.x - 150, gs.player.y, true);

      gs.update(gs.time.now, 0);
      const choices = gs.pendingChoices.map((choice) => choice.id);

      for (const gem of gs.gems.getChildren()) {
        if (gem.active) gem.deactivateForStageReset();
      }
      gs.onHostCellLysis({
        x: gs.player.x,
        y: gs.player.y,
        rna: 4,
        radius: 1,
        damage: 0,
      });
      const loot = gs.gems
        .getChildren()
        .filter((gem) => gem.active)
        .slice(0, 4)
        .map((gem) => [Number(gem.x.toFixed(4)), Number(gem.y.toFixed(4))]);

      return {
        kindRolls,
        spawnRolls,
        host: [Number(host.image.x.toFixed(4)), Number(host.image.y.toFixed(4))],
        elites: [eliteA?.eliteModifier ?? null, eliteB?.eliteModifier ?? null],
        choices,
        loot,
      };
    };

    const a = fingerprint();
    const b = fingerprint();

    gs.finish(false, 'abandoned');
    const runResult = game.registry.get('runResult');

    return {
      a,
      b,
      seed: gs.runSeed,
      controlMode: gs.controlMode,
      overrideConsumed: game.registry.get('runSeedOverride') == null,
      resultSeed: runResult?.runSeed,
      resultControlMode: runResult?.controlMode,
    };
  });

  if (JSON.stringify(result.a) !== JSON.stringify(result.b)) {
    throw new Error('same run seed produced different gameplay fingerprint: ' + JSON.stringify(result));
  }
  if (
    result.seed !== 'runtime-seed-01' ||
    result.resultSeed !== 'runtime-seed-01' ||
    result.controlMode !== 'two-hand' ||
    result.resultControlMode !== 'two-hand' ||
    !result.overrideConsumed
  ) {
    throw new Error('run seed/control-mode result contract failed: ' + JSON.stringify(result));
  }
  if (
    result.a.kindRolls.length !== 3 ||
    result.a.spawnRolls.length !== 3 ||
    result.a.choices.length !== 3 ||
    result.a.loot.length !== 4 ||
    result.a.elites.some((value) => value === null)
  ) {
    throw new Error('gameplay fingerprint is incomplete: ' + JSON.stringify(result.a));
  }
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));

  await browser.close();
  console.log('seeded gameplay runtime smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

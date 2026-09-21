const fs = require('fs');
const path = require('path');

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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-visual-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Visual', last_name: 'QA' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const captureDir = process.platform === 'win32'
    ? path.join(process.cwd(), '.tmp-browser-smoke')
    : '/tmp/browser-smoke';
  fs.mkdirSync(captureDir, { recursive: true });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() =>
    window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const contract = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const ui = window.__game.scene.getScene('UI');
    gs.awaitingChoice = false;
    gs.pendingChoices = [];
    gs.queuedLevels = 0;
    ui.dismissProgressionForStageBoundary();

    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;

    for (const enemy of gs.enemies.getChildren()) {
      if (enemy.active) enemy.deactivateForStageReset();
    }
    for (const gem of gs.gems.getChildren()) {
      if (gem.active) gem.deactivateForStageReset();
    }

    const kinds = ['swarm', 'runner', 'brute'];
    const spawnTo = (target) => {
      const active = gs.enemies.getChildren().filter((e) => e.active).length;
      let elite = gs.enemies.getChildren().find((e) => e.active && e.isElite) ?? null;
      for (let i = active; i < target; i++) {
        const a = (i / target) * Math.PI * 2 + (i % 7) * 0.037;
        const ring = 86 + (i % 8) * 27;
        const x = gs.player.x + Math.cos(a) * ring;
        const y = gs.player.y + Math.sin(a) * ring;
        const e = gs.spawnEnemy(kinds[i % kinds.length], x, y, i === 7);
        if (i === 7) elite = e;
      }
      return elite;
    };

    const elite = spawnTo(100);

    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17;
      const pickupRadius = 142 + (i % 4) * 17;
      gs.spawnGem(
        gs.player.x + Math.cos(a) * pickupRadius,
        gs.player.y + Math.sin(a) * pickupRadius,
        1
      );
    }

    // Force the signature mechanic into the visual contract: one healthy and one partially
    // infected host cell must remain readable inside the enemy/RNA/projectile stack.
    gs.hostCells.resetStage();
    gs.hostCells.spawnNearPlayer();
    gs.hostCells.spawnNearPlayer();
    const activeCells = gs.hostCells.cells.filter((cell) => cell.active);
    if (activeCells[0]) activeCells[0].infection = 0;
    if (activeCells[1]) {
      activeCells[1].infection = 0.68;
      activeCells[1].infectionOverlay
        .setVisible(true)
        .setAlpha(0.82)
        .setPosition(activeCells[1].image.x, activeCells[1].image.y);
    }

    const source = gs.bullets.get(gs.player.x, gs.player.y);
    source.fire(gs.time.now, -0.15, 10, 0, false, 0);
    gs.physics.world.pause();

    window.__visualReadabilitySpawnTo = spawnTo;

    return {
      activeEnemies: gs.enemies.getChildren().filter((e) => e.active).length,
      activeGems: gs.gems.getChildren().filter((g) => g.active).length,
      activeHostCells: activeCells.length,
      hostCellDepth: activeCells[0]?.image?.depth ?? null,
      infectedHostCellVisible: Boolean(activeCells[1]?.infectionOverlay?.visible),
      playerAnchorVisible: Boolean(gs.player.focusAnchor?.visible),
      playerDepth: gs.player.depth,
      anchorDepth: gs.player.focusAnchor?.depth ?? null,
      eliteMarkerVisible: Boolean(elite?.eliteMarker?.visible),
      eliteRingVisible: Boolean(elite?.eliteRing?.visible),
      bulletTexture: source.texture.key,
      bulletDepth: source.depth,
      hud: {
        levelSize: parseFloat(String(ui.levelText?.style?.fontSize ?? '0')) || 0,
        killsSize: parseFloat(String(ui.killsText?.style?.fontSize ?? '0')) || 0,
        hpSize: parseFloat(String(ui.hpText?.style?.fontSize ?? '0')) || 0,
        bossSize: parseFloat(String(ui.bossLabel?.style?.fontSize ?? '0')) || 0,
        backdropAlpha: ui.hudBackdrop?.alpha ?? 0,
      },
    };
  });

  if (
    contract.activeEnemies < 100 ||
    contract.activeGems < 16 ||
    contract.activeHostCells < 2 ||
    !(contract.hostCellDepth > 10) ||
    !contract.infectedHostCellVisible ||
    !contract.playerAnchorVisible ||
    !(contract.anchorDepth < contract.playerDepth) ||
    !contract.eliteMarkerVisible ||
    !contract.eliteRingVisible ||
    contract.bulletTexture !== 'viral-particle' ||
    contract.hud.levelSize < 14 ||
    contract.hud.killsSize < 14 ||
    contract.hud.hpSize < 11 ||
    contract.hud.bossSize < 12 ||
    contract.hud.backdropAlpha < 0.3
  ) {
    throw new Error('Visual readability contract failed: ' + JSON.stringify(contract));
  }

  await page.waitForTimeout(180);
  await page.locator('#game').screenshot({
    path: path.join(captureDir, '06-readability-stress-100.png'),
  });

  for (const density of [150, 200]) {
    const actual = await page.evaluate((target) => {
      const gs = window.__game.scene.getScene('Game');
      window.__visualReadabilitySpawnTo(target);
      return gs.enemies.getChildren().filter((e) => e.active).length;
    }, density);
    if (actual < density) {
      throw new Error(`Visual readability density ${density} could not be reached: ${actual}`);
    }
    await page.waitForTimeout(150);
    const densityContract = await page.evaluate((target) => {
      const gs = window.__game.scene.getScene('Game');
      const enemies = gs.enemies.getChildren().filter((enemy) => enemy.active);
      const normals = enemies.filter((enemy) => !enemy.isBoss && !enemy.isElite);
      const elites = enemies.filter((enemy) => enemy.isElite || enemy.isBoss);
      const distance = (enemy) => Math.hypot(enemy.x - gs.player.x, enemy.y - gs.player.y);
      const far = normals.filter((enemy) => distance(enemy) > 170);
      const near = normals.filter((enemy) => distance(enemy) <= 150);
      const avg = (rows) =>
        rows.length ? rows.reduce((sum, enemy) => sum + (enemy.alpha ?? 1), 0) / rows.length : 1;
      return {
        target,
        cachedDensity: gs.getCombatVisualDensity(),
        farAverageAlpha: avg(far),
        nearAverageAlpha: avg(near),
        eliteMinAlpha: elites.length ? Math.min(...elites.map((enemy) => enemy.alpha ?? 1)) : 1,
      };
    }, density);

    if (densityContract.cachedDensity < density) {
      throw new Error('visual density cache lagged stress target: ' + JSON.stringify(densityContract));
    }
    if (density >= 150) {
      if (
        densityContract.farAverageAlpha >= 0.9 ||
        densityContract.nearAverageAlpha <= densityContract.farAverageAlpha ||
        densityContract.eliteMinAlpha < 0.98
      ) {
        throw new Error('dense-combat priority contract failed: ' + JSON.stringify(densityContract));
      }
    }

    await page.locator('#game').screenshot({
      path: path.join(captureDir, `06-readability-stress-${density}.png`),
    });
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('visual readability browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

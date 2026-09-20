const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const BASE = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:4173/';
const CAPTURE_DIR = process.env.OFELIYA_MATRIX_DIR || '/tmp/release-visual-matrix';
const APP_RELEASE_MARKER = 'ofeliya-20260912-strain-zero-rc3-utf8';
const DENSITIES = [100, 150, 200];
const CASES = [
  { renderer: 'webgl', tier: 'full' },
  { renderer: 'webgl', tier: 'reduced' },
  { renderer: 'canvas', tier: 'full' },
  { renderer: 'canvas', tier: 'reduced' },
];

fs.mkdirSync(CAPTURE_DIR, { recursive: true });

async function openCase(browser, spec) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(({ tier }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_performance_tier', tier);
    localStorage.setItem('ofeliya_difficulty_v1', 'standard');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-release-visual-matrix',
      initDataUnsafe: { user: { id: 42, first_name: 'Release', last_name: 'Matrix' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { tier: spec.tier });

  const page = await ctx.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push(`${msg.type()}: ${msg.text()}`);
    }
  });

  const url = new URL(BASE);
  url.searchParams.set('renderer', spec.renderer);
  url.searchParams.set('matrix', spec.tier);
  // Production runtime-config performs a one-time cache-busting redirect unless this marker is
  // already present. Supplying it up-front removes a navigation race from the release gate.
  url.searchParams.set('app', APP_RELEASE_MARKER);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, {
      timeout: 15_000,
    });
  } catch (error) {
    const boot = await page.evaluate(() => ({
      href: window.location.href,
      gamePresent: Boolean(window.__game),
      activeScenes:
        window.__game?.scene
          ?.getScenes(true)
          ?.map((scene) => scene.scene?.key ?? 'unknown') ?? [],
      splash: document.getElementById('splash')?.textContent ?? null,
      canvasPresent: Boolean(document.querySelector('#game canvas')),
    }));
    throw new Error(
      `matrix boot failed for ${JSON.stringify(spec)}: ${JSON.stringify({
        boot,
        pageErrors: errors,
        consoleErrors,
        cause: String(error),
      })}`
    );
  }
  await page.evaluate(() => {
    window.__game.registry.set('runSeedOverride', 'release-matrix-seed');
    window.__game.scene.getScene('Menu').scene.start('Game');
  });
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const baseContract = await page.evaluate(() => {
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
    gs.hostCells.resetStage();

    const kinds = ['swarm', 'runner', 'brute'];
    const spawnTo = (target) => {
      const active = gs.enemies.getChildren().filter((enemy) => enemy.active).length;
      for (let i = active; i < target; i++) {
        const a = (i / target) * Math.PI * 2 + (i % 7) * 0.037;
        const ring = 86 + (i % 8) * 27;
        const x = gs.player.x + Math.cos(a) * ring;
        const y = gs.player.y + Math.sin(a) * ring;
        gs.spawnEnemy(kinds[i % kinds.length], x, y, i === 7);
      }
      return gs.enemies.getChildren().filter((enemy) => enemy.active).length;
    };
    window.__releaseMatrixSpawnTo = spawnTo;

    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17;
      const pickupRadius = 142 + (i % 4) * 17;
      gs.spawnGem(
        gs.player.x + Math.cos(a) * pickupRadius,
        gs.player.y + Math.sin(a) * pickupRadius,
        1
      );
    }

    gs.hostCells.spawnNearPlayer();
    gs.hostCells.spawnNearPlayer();
    const cells = gs.hostCells.cells.filter((cell) => cell.active);
    if (cells[0]) cells[0].infection = 0;
    if (cells[1]) {
      cells[1].infection = 0.68;
      cells[1].infectionOverlay
        .setVisible(true)
        .setAlpha(0.82)
        .setPosition(cells[1].image.x, cells[1].image.y);
    }

    const bullet = gs.bullets.get(gs.player.x, gs.player.y);
    bullet.fire(gs.time.now, -0.15, 10, 0, false, 0);
    gs.physics.world.pause();

    return {
      renderer: gs.game.renderer?.constructor?.name ?? '',
      rendererType: gs.game.renderer?.type ?? null,
      tier: gs.registry.get('performanceTier'),
      vignetteVisible: Boolean(gs.vignette?.visible),
      runSeed: gs.runSeed,
      activeGems: gs.gems.getChildren().filter((gem) => gem.active).length,
      activeHostCells: cells.length,
      activeBullets: gs.bullets.getChildren().filter((item) => item.active).length,
      infectedHostCellVisible: Boolean(cells[1]?.infectionOverlay?.visible),
      playerAnchorVisible: Boolean(gs.player.focusAnchor?.visible),
    };
  });

  if (baseContract.tier !== spec.tier) {
    throw new Error(`performance tier mismatch for ${JSON.stringify(spec)}: ${JSON.stringify(baseContract)}`);
  }
  if (spec.renderer === 'webgl' && !baseContract.renderer.startsWith('WebGLRenderer')) {
    throw new Error(`WebGL release case fell back unexpectedly: ${JSON.stringify(baseContract)}`);
  }
  if (spec.renderer === 'canvas' && !baseContract.renderer.startsWith('CanvasRenderer')) {
    throw new Error(`Canvas release case did not use Canvas: ${JSON.stringify(baseContract)}`);
  }
  if (spec.renderer === 'webgl' && spec.tier === 'full' && baseContract.vignetteVisible) {
    throw new Error(`full WebGL case did not activate postFX path: ${JSON.stringify(baseContract)}`);
  }
  if (spec.tier === 'reduced' && !baseContract.vignetteVisible) {
    throw new Error(`reduced tier unexpectedly hid fallback vignette: ${JSON.stringify(baseContract)}`);
  }
  if (
    baseContract.runSeed !== 'release-matrix-seed' ||
    baseContract.activeGems !== 18 ||
    baseContract.activeHostCells !== 2 ||
    baseContract.activeBullets !== 1 ||
    !baseContract.infectedHostCellVisible ||
    !baseContract.playerAnchorVisible
  ) {
    throw new Error(`base visual matrix gameplay contract failed: ${JSON.stringify(baseContract)}`);
  }

  const rows = [];
  for (const density of DENSITIES) {
    const state = await page.evaluate((target) => {
      const gs = window.__game.scene.getScene('Game');
      const activeEnemies = window.__releaseMatrixSpawnTo(target);
      return {
        activeEnemies,
        activeGems: gs.gems.getChildren().filter((gem) => gem.active).length,
        activeHostCells: gs.hostCells.cells.filter((cell) => cell.active).length,
        activeBullets: gs.bullets.getChildren().filter((item) => item.active).length,
        tier: gs.registry.get('performanceTier'),
        runSeed: gs.runSeed,
      };
    }, density);

    if (
      state.activeEnemies !== density ||
      state.activeGems !== 18 ||
      state.activeHostCells !== 2 ||
      state.activeBullets !== 1 ||
      state.tier !== spec.tier ||
      state.runSeed !== 'release-matrix-seed'
    ) {
      throw new Error(
        `gameplay density changed in presentation case ${JSON.stringify(spec)} @ ${density}: ${JSON.stringify(state)}`
      );
    }

    await page.waitForTimeout(90);
    const file = `${spec.renderer}-${spec.tier}-${density}.png`;
    await page.locator('#game').screenshot({ path: path.join(CAPTURE_DIR, file) });
    rows.push({ density, ...state, file });
  }

  if (errors.length) {
    throw new Error(`${spec.renderer}/${spec.tier} page errors: ${errors.join(' | ')}`);
  }

  await ctx.close();
  return { ...spec, baseContract, rows };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
    ],
  });

  const results = [];
  try {
    for (const spec of CASES) results.push(await openCase(browser, spec));
  } finally {
    await browser.close();
  }

  const canonical = new Map();
  for (const result of results) {
    for (const row of result.rows) {
      const signature = JSON.stringify({
        activeEnemies: row.activeEnemies,
        activeGems: row.activeGems,
        activeHostCells: row.activeHostCells,
        activeBullets: row.activeBullets,
        runSeed: row.runSeed,
      });
      if (!canonical.has(row.density)) canonical.set(row.density, signature);
      if (canonical.get(row.density) !== signature) {
        throw new Error(`gameplay state diverged across renderer/tier at density ${row.density}`);
      }
    }
  }

  fs.writeFileSync(
    path.join(CAPTURE_DIR, 'matrix.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)
  );
  console.log(`release visual matrix: ok; captures=${CASES.length * DENSITIES.length}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

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
    let elite = null;
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      const ring = 105 + (i % 5) * 24;
      const x = gs.player.x + Math.cos(a) * ring;
      const y = gs.player.y + Math.sin(a) * ring;
      const e = gs.spawnEnemy(kinds[i % kinds.length], x, y, i === 7);
      if (i === 7) elite = e;
    }

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.17;
      gs.spawnGem(
        gs.player.x + Math.cos(a) * (68 + (i % 3) * 16),
        gs.player.y + Math.sin(a) * (68 + (i % 3) * 16),
        1
      );
    }

    const source = gs.bullets.get(gs.player.x, gs.player.y);
    source.fire(gs.time.now, -0.15, 10, 0, false, 0);

    return {
      activeEnemies: gs.enemies.getChildren().filter((e) => e.active).length,
      activeGems: gs.gems.getChildren().filter((g) => g.active).length,
      playerAnchorVisible: Boolean(gs.player.focusAnchor?.visible),
      playerDepth: gs.player.depth,
      anchorDepth: gs.player.focusAnchor?.depth ?? null,
      eliteMarkerVisible: Boolean(elite?.eliteMarker?.visible),
      eliteRingVisible: Boolean(elite?.eliteRing?.visible),
      bulletTexture: source.texture.key,
      bulletDepth: source.depth,
    };
  });

  if (
    contract.activeEnemies < 40 ||
    contract.activeGems < 10 ||
    !contract.playerAnchorVisible ||
    !(contract.anchorDepth < contract.playerDepth) ||
    !contract.eliteMarkerVisible ||
    !contract.eliteRingVisible ||
    contract.bulletTexture !== 'viral-particle'
  ) {
    throw new Error('Visual readability contract failed: ' + JSON.stringify(contract));
  }

  await page.waitForTimeout(180);
  await page.locator('#game').screenshot({
    path: path.join(captureDir, '06-readability-stress.png'),
  });

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('visual readability browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

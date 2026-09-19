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
    localStorage.setItem('ofeliya_difficulty_v1', 'strained');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-elite-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Elite', last_name: 'QA' } },
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
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const contract = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;

    for (const enemy of gs.enemies.getChildren()) {
      if (enemy.active) enemy.deactivateForStageReset();
    }

    const defs = [
      ['regenerator', 'regen-orbit', gs.player.x - 105, gs.player.y - 45],
      ['frenzied', 'frenzy-spikes', gs.player.x, gs.player.y + 95],
      ['volatile', 'volatile-diamond', gs.player.x + 105, gs.player.y - 45],
    ];

    const results = [];
    for (const [modifier, expectedSignature, x, y] of defs) {
      const enemy = gs.enemies.get(x, y);
      if (!enemy) throw new Error('enemy pool exhausted');
      enemy.activate(gs, 'swarm', x, y, {
        elite: true,
        hpScale: 1,
        dmgScale: 1,
        speedScale: 1,
        eliteModifier: modifier,
      });
      results.push({
        modifier,
        expectedSignature,
        signature: enemy.eliteVisualSignature,
        markerVisible: Boolean(enemy.eliteMarker?.visible),
        coronaVisible: Boolean(enemy.eliteRing?.visible),
        color: enemy.color,
        markerCommands: enemy.eliteMarker?.commandBuffer?.length ?? 0,
        coronaCommands: enemy.eliteRing?.commandBuffer?.length ?? 0,
      });
    }

    gs.physics.world.pause();
    return results;
  });

  if (contract.length !== 3) throw new Error('elite smoke did not create three modifiers');
  const signatures = new Set(contract.map((row) => row.signature));
  const colors = new Set(contract.map((row) => row.color));
  if (signatures.size !== 3 || colors.size !== 3) {
    throw new Error('elite modifiers are not visually distinct: ' + JSON.stringify(contract));
  }
  for (const row of contract) {
    if (
      row.signature !== row.expectedSignature ||
      !row.markerVisible ||
      !row.coronaVisible ||
      row.markerCommands <= 0 ||
      row.coronaCommands <= 0
    ) {
      throw new Error('elite visual contract failed: ' + JSON.stringify(contract));
    }
  }

  await page.waitForTimeout(120);
  await page.locator('#game').screenshot({
    path: path.join(captureDir, '07-elite-modifier-identities.png'),
  });

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('elite modifier readability runtime smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

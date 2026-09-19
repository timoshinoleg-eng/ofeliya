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
    localStorage.setItem('ofeliya_difficulty_v1', 'strained');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-difficulty-smoke',
      initDataUnsafe: { user: { id: 77, first_name: 'Strained', last_name: 'QA' } },
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

  const menuMode = await page.evaluate(() => ({
    difficultyId: window.__game.registry.get('difficultyId'),
    stored: localStorage.getItem('ofeliya_difficulty_v1'),
  }));
  if (menuMode.difficultyId !== 'strained' || menuMode.stored !== 'strained') {
    throw new Error('Menu did not restore Strained selection: ' + JSON.stringify(menuMode));
  }

  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() =>
    window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const baseline = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1000;
    gs.runState.stage.maxHp = 1000;
    return {
      difficulty: gs.difficulty.id,
      threat: gs.wave.debugThreatState,
      heartbeat: gs.heartbeatPulse.debugState,
    };
  });
  if (
    baseline.difficulty !== 'strained' ||
    baseline.threat.cap === null ||
    baseline.heartbeat.nextImpactAtMs >= 12000
  ) {
    throw new Error('Strained runtime profile was not applied: ' + JSON.stringify(baseline));
  }

  const affixes = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    for (const enemy of gs.enemies.getChildren()) {
      if (enemy.active) enemy.deactivateForStageReset();
    }

    const originalRandom = Math.random;
    const spawnElite = (randomValue, x, y) => {
      Math.random = () => randomValue;
      const elite = gs.spawnEnemy('swarm', x, y, true);
      Math.random = originalRandom;
      if (!elite) throw new Error('elite pool exhausted');
      return elite;
    };

    const px = gs.player.x;
    const py = gs.player.y;
    const regenerator = spawnElite(0, px - 150, py - 40);
    const frenzied = spawnElite(0.4, px + 150, py - 40);
    const volatile = spawnElite(0.9, px, py + 150);

    regenerator.hp = regenerator.maxHp * 0.5;
    regenerator.lastDamageAt = gs.time.now - 1200;

    window.__difficultySmoke = { regenerator, frenzied, volatile };
    return {
      ids: [regenerator.eliteModifier, frenzied.eliteModifier, volatile.eliteModifier],
      regeneratorHp: regenerator.hp,
      regeneratorMaxHp: regenerator.maxHp,
      regeneratorSpeed: regenerator.speed,
      frenziedSpeed: frenzied.speed,
      regeneratorDamage: regenerator.dmg,
      frenziedDamage: frenzied.dmg,
    };
  });

  if (affixes.ids.join(',') !== 'regenerator,frenzied,volatile') {
    throw new Error('Elite affix selection mismatch: ' + JSON.stringify(affixes));
  }
  if (
    !(affixes.frenziedSpeed > affixes.regeneratorSpeed) ||
    !(affixes.frenziedDamage > affixes.regeneratorDamage)
  ) {
    throw new Error('Frenzied behavior multipliers missing: ' + JSON.stringify(affixes));
  }

  await page.waitForTimeout(220);
  const healed = await page.evaluate(() => {
    const { regenerator } = window.__difficultySmoke;
    return { hp: regenerator.hp, maxHp: regenerator.maxHp };
  });
  if (!(healed.hp > affixes.regeneratorHp) || healed.hp > healed.maxHp) {
    throw new Error('Regenerator did not heal after damage cooldown: ' + JSON.stringify(healed));
  }

  await page.locator('#game').screenshot({ path: path.join(captureDir, '07-strained-elites.png') });

  const volatileResult = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const { volatile } = window.__difficultySmoke;
    gs.player.setPosition(volatile.x + 22, volatile.y);
    gs.player.hurtUntil = 0;
    const before = gs.runState.stage.hp;
    volatile.takeDamage(volatile.maxHp * 2);
    return {
      before,
      after: gs.runState.stage.hp,
      active: volatile.active,
      modifier: volatile.eliteModifier,
    };
  });
  if (!(volatileResult.after < volatileResult.before) || volatileResult.active) {
    throw new Error('Volatile death hazard did not damage nearby player: ' + JSON.stringify(volatileResult));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('strained difficulty runtime browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

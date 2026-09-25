const fs = require('fs');

function browserDriver() {
  try {
    const { chromium } = require('playwright');
    const managed = chromium.executablePath();
    if (managed && fs.existsSync(managed)) return { chromium, executablePath: managed };
  } catch {}
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
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 0 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-visual-impact-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Visual', last_name: 'Impact' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const baseUrl = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => {
    const game = window.__game;
    const scene = game.scene.getScene('Game');
    scene.events.once('create', () => scene.scene.pause('Game'));
  });
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  try {
    await page.waitForFunction(
      () => {
        const game = window.__game;
        return (game.scene.isActive('Game') || game.scene.isPaused('Game')) && game.scene.isActive('UI');
      },
      null,
      { timeout: 10_000 }
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      scenes: window.__game.scene.scenes.map((scene) => ({
        key: scene.scene.key,
        active: scene.scene.isActive(),
        paused: scene.scene.isPaused(),
        status: scene.sys.settings.status,
      })),
    }));
    throw new Error(`${error.message}; scene state: ${JSON.stringify(state)}; page errors: ${errors.join(' | ')}`);
  }

  const contract = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;

    for (const enemy of gs.enemies.getChildren()) {
      if (enemy.active) enemy.deactivateForStageReset();
    }

    const atmosphere = gs.atmosphere;
    const blood = {
      structureVisible: Boolean(atmosphere.structure.visible),
      structureAlpha: atmosphere.structure.alpha,
      plasmaTint: atmosphere.plasma.tintTopLeft,
      erythrocytes: atmosphere.erythrocytes.filter((cell) => cell.image.visible).length,
      hostCells: atmosphere.hostCells.filter((cell) => cell.image.visible).length,
    };

    const heart = gs.stageDirector.stages.find((stage) => stage.id === 'heart');
    if (!heart) throw new Error('heart stage missing');
    atmosphere.setStage(heart);
    atmosphere.update(gs.time.now, 16, 45_000, heart.durationMs);
    const heartVisual = {
      structureVisible: Boolean(atmosphere.structure.visible),
      structureAlpha: atmosphere.structure.alpha,
      plasmaTint: atmosphere.plasma.tintTopLeft,
      erythrocytes: atmosphere.erythrocytes.filter((cell) => cell.image.visible).length,
      hostCells: atmosphere.hostCells.filter((cell) => cell.image.visible).length,
    };

    const runner = gs.enemies.get(gs.player.x + 220, gs.player.y);
    if (!runner) throw new Error('runner pool unavailable');
    runner.activate(gs, 'runner', gs.player.x + 220, gs.player.y, {
      elite: false,
      hpScale: 1,
      dmgScale: 1,
      speedScale: 1,
    });
    runner.nextRoleActionAt = 0;
    runner.preUpdate(gs.time.now + 2_000, 16);
    const runnerCue = {
      visible: Boolean(runner.roleTelegraph?.visible),
      commands: runner.roleTelegraph?.commandBuffer?.length ?? 0,
      phase: runner.rolePhase,
    };
    runner.deactivateForStageReset();

    const boss = gs.enemies.get(gs.player.x + 150, gs.player.y);
    if (!boss) throw new Error('boss pool unavailable');
    boss.activate(gs, 'boss', gs.player.x + 150, gs.player.y, {
      elite: false,
      hpScale: 1,
      dmgScale: 1,
      speedScale: 1,
      bossBehavior: 'pressure-wave',
    });
    boss.nextBossAttackAt = 0;
    boss.preUpdate(gs.time.now + 2_100, 16);
    const bossCue = {
      visible: Boolean(boss.bossTelegraph?.visible),
      commands: boss.bossTelegraph?.commandBuffer?.length ?? 0,
      state: boss.bossAttackState,
    };

    const dmg = gs.dmgTexts[0];
    gs.styleDmg(dmg, 40);
    const critText = {
      fontSize: parseFloat(String(dmg.style.fontSize ?? '0')) || 0,
      strokeThickness: dmg.style.strokeThickness ?? 0,
      color: dmg.style.color,
    };

    gs.showPlayerImpactCue(gs.player.x + 100, gs.player.y);
    const impact = {
      visible: Boolean(gs.playerImpactCue?.visible),
      commands: gs.playerImpactCue?.commandBuffer?.length ?? 0,
      depth: gs.playerImpactCue?.depth ?? 0,
    };

    gs.physics.world.pause();
    return { blood, heart: heartVisual, runnerCue, bossCue, critText, impact };
  });

  if (
    contract.blood.structureVisible ||
    !contract.heart.structureVisible ||
    contract.heart.structureAlpha < 0.27 ||
    contract.heart.plasmaTint === contract.blood.plasmaTint ||
    contract.heart.erythrocytes >= contract.blood.erythrocytes ||
    contract.heart.hostCells >= contract.blood.hostCells
  ) {
    throw new Error('stage identity contract failed: ' + JSON.stringify(contract));
  }
  if (
    !contract.runnerCue.visible ||
    contract.runnerCue.phase !== 'windup' ||
    contract.runnerCue.commands < 18
  ) {
    throw new Error('runner telegraph contract failed: ' + JSON.stringify(contract.runnerCue));
  }
  if (
    !contract.bossCue.visible ||
    contract.bossCue.state !== 'telegraph' ||
    contract.bossCue.commands < 12
  ) {
    throw new Error('boss telegraph contract failed: ' + JSON.stringify(contract.bossCue));
  }
  if (contract.critText.fontSize < 20 || contract.critText.strokeThickness < 4) {
    throw new Error('critical damage hierarchy contract failed: ' + JSON.stringify(contract.critText));
  }
  if (!contract.impact.visible || contract.impact.commands < 10 || contract.impact.depth < 25) {
    throw new Error('localized player impact cue contract failed: ' + JSON.stringify(contract.impact));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('visual gameplay impact smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

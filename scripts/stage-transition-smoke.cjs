const fs = require('fs');
const path = require('path');

function browserDriver() {
  if (process.platform === 'win32') return { chromium: require('playwright').chromium, executablePath: undefined };
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
      initData: 'signed-ci-payload',
      initDataUnsafe: { user: { id: 42, first_name: 'Stage', last_name: 'QA' } },
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

  const bloodstreamBoss = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.runState.stage.timeMs = gs.stageDirector.currentStage.durationMs;
    gs.handleStageEvents(gs.stageDirector.update(gs.runState.stage.timeMs));
    const boss = gs.wave.boss;
    return boss && {
      stage: gs.stageDirector.currentStage.id,
      phase: gs.stageDirector.phase,
      texture: boss.texture.key,
      hp: boss.hp,
    };
  });
  if (!bloodstreamBoss || bloodstreamBoss.stage !== 'bloodstream' ||
      bloodstreamBoss.phase !== 'BOSS_ACTIVE' || bloodstreamBoss.texture !== 'immune-prime') {
    throw new Error(`Bloodstream boss contract failed: ${JSON.stringify(bloodstreamBoss)}`);
  }
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.wave.boss.takeDamage(Number.MAX_SAFE_INTEGER);
  });
  await page.waitForFunction(() => {
    const gs = window.__game.scene.getScene('Game');
    return gs.stageDirector.phase === 'STAGE_TRANSITION';
  });
  await sleep(420);
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    if (!gs.stageTransition) throw new Error('transition transaction missing');
    gs.requestStageTransitionCommit(gs.stageTransition.token);
  });
  await page.waitForFunction(() => {
    const gs = window.__game.scene.getScene('Game');
    return gs.stageDirector.currentStage.id === 'heart' && gs.stageDirector.phase === 'PLAYING';
  });

  const heartStart = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    return {
      stage: gs.runState.stage.id,
      order: gs.runState.stage.order,
      level: gs.runState.stage.level,
      timeMs: gs.runState.stage.timeMs,
      bossesDefeated: gs.runState.run.bossesDefeated,
      firstBossClear: gs.runState.run.bossClearTimesMs['immune-prime'],
      atmosphereStage: gs.atmosphere.stage?.id ?? null,
      structureVisible: gs.atmosphere.structure.visible,
      pulseNext: gs.heartbeatPulse.debugState.nextImpactAtMs,
    };
  });
  if (
    heartStart.stage !== 'heart' || heartStart.order !== 2 || heartStart.level !== 1 ||
    heartStart.timeMs > 1_000 || heartStart.bossesDefeated !== 1 ||
    !Number.isFinite(heartStart.firstBossClear) || heartStart.atmosphereStage !== 'heart' ||
    !heartStart.structureVisible || heartStart.pulseNext !== 12_000
  ) {
    throw new Error(`Heart transactional reset failed: ${JSON.stringify(heartStart)}`);
  }
  await page.locator('#game').screenshot({ path: path.join(captureDir, '03-heart-stage.png') });
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
  });

  const heartbeat = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const stage = gs.stageDirector.currentStage;
    gs.runState.stage.timeMs = 11_350;
    gs.updateHeartbeatSignature(stage, gs.runState.stage.timeMs);
    const telegraphed = gs.heartbeatPulse.debugState.telegraphedImpactAtMs;
    gs.runState.stage.timeMs = 12_000;
    gs.updateHeartbeatSignature(stage, gs.runState.stage.timeMs);
    return {
      telegraphed,
      pressure: gs.getEnemyPressureMultiplier(),
      pressureUntil: gs.heartbeatPulse.debugState.pressureUntilMs,
    };
  });
  if (heartbeat.telegraphed !== 12_000 || Math.abs(heartbeat.pressure - 1.18) > 1e-9 ||
      heartbeat.pressureUntil !== 13_050) {
    throw new Error(`Heartbeat pulse contract failed: ${JSON.stringify(heartbeat)}`);
  }

  const heartBoss = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.timeMs = gs.stageDirector.currentStage.durationMs;
    gs.handleStageEvents(gs.stageDirector.update(gs.runState.stage.timeMs));
    const boss = gs.wave.boss;
    return boss && {
      phase: gs.stageDirector.phase,
      texture: boss.texture.key,
      behavior: boss.bossBehavior,
      aura: Boolean(boss.bossAura?.visible),
    };
  });
  if (!heartBoss || heartBoss.phase !== 'BOSS_ACTIVE' || heartBoss.texture !== 'cardiac-titan' ||
      heartBoss.behavior !== 'heartbeat-pulse' || !heartBoss.aura) {
    throw new Error(`Cardiac Titan presentation failed: ${JSON.stringify(heartBoss)}`);
  }
  await page.locator('#game').screenshot({ path: path.join(captureDir, '04-cardiac-titan.png') });

  const killDebug = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const boss = gs.wave.boss;
    boss.takeDamage(Number.MAX_SAFE_INTEGER);
    return { phase: gs.stageDirector.phase, waveBoss: Boolean(gs.wave.boss), bossActive: boss.active, result: window.__game.registry.get('runResult') };
  });
  console.log('killDebug', JSON.stringify(killDebug));
  await sleep(1200);
  console.log('postKillDebug', JSON.stringify(await page.evaluate(() => { const gs = window.__game.scene.getScene('Game'); return { phase: gs.stageDirector.phase, waveBoss: Boolean(gs.wave.boss), result: window.__game.registry.get('runResult'), bosses: gs.runState.run.bossesDefeated }; })));
  await page.waitForFunction(() => {
    const result = window.__game.registry.get('runResult');
    return Boolean(result?.win && result?.reason === 'campaign-complete');
  });

  const result = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const runResult = window.__game.registry.get('runResult');
    return {
      result: runResult,
      phase: gs.stageDirector.phase,
      bossesDefeated: gs.runState.run.bossesDefeated,
      heartBossClear: gs.runState.run.bossClearTimesMs['cardiac-titan'],
    };
  });
  if (result.phase !== 'RUN_ENDED' || result.bossesDefeated !== 2 ||
      !Number.isFinite(result.heartBossClear) || result.result?.stageId !== 'heart' ||
      result.result?.stageOrder !== 2) {
    throw new Error(`campaign completion contract failed: ${JSON.stringify(result)}`);
  }
  await page.locator('#game').screenshot({ path: path.join(captureDir, '05-heart-result.png') });
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

  await browser.close();
  console.log('stage transition browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

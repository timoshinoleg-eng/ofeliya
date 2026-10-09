// P1 visual-polish capture harness (VISUAL_POLISH_AUDIT_V3).
// Usage: node scripts/visual-p1-capture.cjs <out-dir> [before|after]
// Drives the real game in headless Chromium and saves PNG screenshots per
// scenario/viewport so HUD hierarchy, dense-combat readability and the boss
// reveal can be reviewed before/after the polish pass.
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || 'visual-qa');
const TAG = process.argv[3] || 'capture';
const VIEWPORTS = [
  { name: '390x740', width: 390, height: 740 },
  { name: '360x640', width: 360, height: 640 },
  { name: '320x568', width: 320, height: 568 },
];
const DENSITIES = [100, 150, 200];

function browserDriver() {
  try {
    const { chromium } = require('playwright');
    const managed = chromium.executablePath();
    if (managed && fs.existsSync(managed)) return { chromium, executablePath: managed };
  } catch {}
  const { chromium } = require('playwright-core');
  const executablePath = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].find(fs.existsSync);
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
  fs.mkdirSync(OUT, { recursive: true });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });
    await ctx.route('https://st.max.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await ctx.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 2, tutorialDone: true }));
      window.WebApp = {
        platform: 'android',
        version: '26.20.0',
        initData: 'signed-visual-p1',
        initDataUnsafe: { user: { id: 42, first_name: 'Visual', last_name: 'P1' } },
        getViewportSize: async () => ({ width: String(window.innerWidth), height: String(window.innerHeight) }),
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      };
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    // Boot -> Menu -> Game (mirrors visual-gameplay-impact-smoke).
    await page.goto(process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 15_000 });
    await page.screenshot({ path: path.join(OUT, `${TAG}-${vp.name}-menu.png`) });
    await page.evaluate(() => {
      const scene = window.__game.scene.getScene('Game');
      scene.events.once('create', () => scene.scene.pause('Game'));
    });
    await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
    await page.waitForFunction(
      () => {
        const game = window.__game;
        return (game.scene.isActive('Game') || game.scene.isPaused('Game')) && game.scene.isActive('UI');
      },
      null,
      { timeout: 10_000 }
    );
    await page.evaluate(() => window.__game.scene.resume('Game'));
    // Freeze the world before any QA spawning so contact kills cannot open the
    // mutation modal or move bodies between scenarios.
    await page.evaluate(() => {
      window.__game.scene.getScene('Game').physics.world.pause();
    });

    const prepRun = () =>
      page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        const ui = window.__game.scene.getScene('UI');
        gs.runState.stage.hp = 1_000_000;
        gs.runState.stage.maxHp = 1_000_000;
        gs.nextFireAt = Number.MAX_SAFE_INTEGER;
        gs.queuedLevels = 0;
        gs.awaitingChoice = false;
        gs.dismissIntroHint(true);
        if (ui.modalOpen) ui.hideModal();
        ui.modalOpen = false;
        ui.uiBlocked = false;
        // A natural level-up modal pauses Game; QA scenarios need its update loop.
        if (window.__game.scene.isPaused('Game')) window.__game.scene.resume('Game');
        gs.physics.world.pause();
        ui.onboardingContainer?.setVisible(false);
        ui.contextHintContainer?.setVisible(false);
        for (const e of gs.enemies.getChildren()) if (e.active) e.deactivateForStageReset();
      });

    const clearEnemies = () =>
      page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        for (const e of gs.enemies.getChildren()) if (e.active) e.deactivateForStageReset();
      });

    const shot = (name) => page.screenshot({ path: path.join(OUT, `${TAG}-${vp.name}-${name}.png`) });

    // --- 0b: legendary reward modal (long Heart-transition copy) ---
    await prepRun();
    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      gs.runState.stage.level = 6;
      gs.legendaryRewardPending = true;
      gs.queuedLevels = 1;
    });
    await sleep(600); // level-up modal opens on the next Game update tick
    await shot('levelup-legendary');
    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      ui.hideModal();
      ui.modalOpen = false;
      ui.uiBlocked = false;
      gs.legendaryRewardPending = false;
      gs.awaitingChoice = false;
      gs.queuedLevels = 0;
      window.__game.scene.resume('Game');
    });

    // --- 1..3: dense bloodstream combat at 100/150/200 ---
    for (const n of DENSITIES) {
      await prepRun();
      const spawned = await page.evaluate((count) => {
        const gs = window.__game.scene.getScene('Game');
        const px = gs.player.x;
        const py = gs.player.y;
        const kinds = ['swarm', 'swarm', 'swarm', 'runner', 'brute'];
        let ok = 0;
        for (let i = 0; i < count; i++) {
          const a = i * 2.399963; // golden-angle spiral keeps the disc filled
          const r = 55 + Math.sqrt(i) * 16;
          const x = px + Math.cos(a) * r;
          const y = py + Math.sin(a) * r;
          const e = gs.enemies.get(x, y);
          if (!e) break;
          e.activate(gs, kinds[i % kinds.length], x, y, {
            elite: i % 17 === 0,
            hpScale: 1,
            dmgScale: 1,
            speedScale: 1,
          });
          e.nextRoleActionAt = e.nextBossAttackAt = Number.MAX_SAFE_INTEGER;
          ok++;
        }
        return ok;
      }, n);
      await sleep(700); // let preUpdate apply density-aware alpha and HUD settle
      await shot(`dense-${n}`);
      console.log(`${vp.name} dense-${n}: spawned ${spawned}`);
      await clearEnemies();
    }

    // --- 4: quiet Heart gameplay (HUD legibility over calm backdrop) ---
    await prepRun();
    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const heart = gs.stageDirector.stages.find((s) => s.id === 'heart');
      if (heart) {
        gs.atmosphere.setStage(heart);
        gs.atmosphere.update(gs.time.now, 16, 45_000, heart.durationMs);
      }
      const px = gs.player.x;
      const py = gs.player.y;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const e = gs.enemies.get(px + Math.cos(a) * 150, py + Math.sin(a) * 150);
        if (!e) continue;
        e.activate(gs, i === 0 ? 'brute' : 'swarm', px + Math.cos(a) * 150, py + Math.sin(a) * 150, {
          elite: i === 0,
          hpScale: 1,
          dmgScale: 1,
          speedScale: 1,
        });
        e.nextRoleActionAt = e.nextBossAttackAt = Number.MAX_SAFE_INTEGER;
      }
      gs.physics.world.pause();
    });
    await sleep(700);
    await shot('heart-quiet');
    console.log(`${vp.name} heart-quiet captured`);
    await clearEnemies();

    // --- 5: boss reveal band over live gameplay ---
    await prepRun();
    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const px = gs.player.x;
      const py = gs.player.y;
      const boss = gs.enemies.get(px, py - 120);
      if (boss) {
        boss.activate(gs, 'boss', px, py - 120, {
          elite: false,
          hpScale: 1,
          dmgScale: 1,
          speedScale: 1,
          bossBehavior: 'heartbeat-pulse',
        });
        boss.nextBossAttackAt = Number.MAX_SAFE_INTEGER;
      }
      window.__game.scene.getScene('UI').showBossReveal('СЕРДЕЧНЫЙ ТИТАН', 'cardiac-titan', 0xff5472);
    });
    await sleep(650); // reveal tween mid-flight (container alpha ramps to 1)
    await shot('boss-reveal');
    console.log(`${vp.name} boss-reveal captured`);

    // --- 6: real defeat -> result screen (compact-density reference) ---
    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      ui.hideModal();
      ui.modalOpen = false;
      ui.uiBlocked = false;
      for (const e of gs.enemies.getChildren()) if (e.active) e.deactivateForStageReset();
      gs.runState.stage.hp = 1;
      gs.runState.stage.maxHp = 100;
      gs.physics.world.resume();
      const px = gs.player.x;
      const py = gs.player.y;
      for (let i = 0; i < 4; i++) {
        const e = gs.enemies.get(px, py);
        if (!e) continue;
        e.activate(gs, 'brute', px, py, { elite: false, hpScale: 1, dmgScale: 60, speedScale: 1 });
      }
    });
    await page.waitForFunction(
      () => {
        const ui = window.__game.scene.getScene('UI');
        return ui.overShown === true;
      },
      null,
      { timeout: 9000 }
    );
    await sleep(700);
    await shot('result');
    console.log(`${vp.name} result captured`);

    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(`captures saved to ${OUT}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

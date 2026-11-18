// Paired dynamic-screenshot driver for the HUD text guards work (PR #301).
//
// Captures deterministic HUD states (timer tick, kill counter, HP, forced boss
// bar, level-label reflow across a timer-width tick) for one build. Run it
// against the base and guarded bundles with the same arguments and compare the
// pairs. Boss state is forced through the run snapshot (run.bossMax/bossHp/
// bossName), the same deterministic substitution precedent used for the B4 HUD
// capture: it exercises the identical render path as a real boss.
//
// Usage:
//   node scripts/hud-text-guards-capture.cjs --url http://127.0.0.1:7101/ \
//     --build base --viewport 390x844 --outdir artifacts/hud-text-guards
//
// Onboarding is skipped via the QA-visible OnboardingState so the HUD strip is
// unobstructed; each captured state is also written to <name>.json.

const fs = require('fs');
const path = require('path');
const { chromium } = process.platform === 'win32' ? require('playwright') : require('playwright-core');

const chrome = process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (process.platform !== 'win32' && !chrome) throw new Error('Chrome not found');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const url = arg('url', process.env.OFELIYA_URL || 'http://127.0.0.1:4173/');
const build = arg('build', 'build');
const [vw, vh] = String(arg('viewport', '390x844')).split('x').map(Number);
const outdir = path.resolve(arg('outdir', 'artifacts/hud-text-guards'));

(async () => {
  fs.mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--disable-gpu', ...(process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'])],
  });
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(({ vpW, vpH }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.__shared = null;
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-ci-payload',
      initDataUnsafe: { user: { id: 42, first_name: 'QA', last_name: 'Carrier' } },
      getViewportSize: async () => ({ width: String(vpW), height: String(vpH) }),
      shareMaxContent: async (params) => { window.__shared = params; },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { vpW: vw, vpH: vh });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), { timeout: 60000 });

  const { startCombatFixture } = require('./lib/combat-fixture.cjs');
  await startCombatFixture(page);
  await page.waitForFunction(() =>
    (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')) &&
    window.__game.scene.isActive('UI') &&
    window.__game.scene.getScene('Game').__combatFixture?.applied,
    { timeout: 60000 }
  );
  // Skip onboarding so the HUD strip is unobstructed in captures.
  await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    if (ui.onboarding) {
      ui.onboarding.skip();
      ui.persistOnboarding();
    }
  });
  // Keep the carrier effectively invincible during capture so the run cannot
  // end mid-sequence (explicit HP values below still render as designed).
  // NOTE: the HUD reads hp from runState.stage (GameScene.snapshot maps
  // stageProgress.hp), not runState.run.hp.
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.stage.hp = 100000; });
  await page.waitForFunction(() => !window.__game.scene.getScene('UI').onboarding, { timeout: 15000 });

  const tag = `${build}-${vw}x${vh}`;
  const shots = [];
  // Sleep the game loop around each capture so natural gameplay cannot change
  // the HUD value between the wait and the screenshot.
  async function sleepSnap(name) {
    await page.evaluate(() => window.__game.loop.sleep());
    await snap(name);
    await page.evaluate(() => window.__game.loop.wake());
  }
  async function snap(name) {
    const file = path.join(outdir, `${name}.png`);
    await page.locator('#game').screenshot({ path: file });
    const state = await page.evaluate(() => {
      const ui = window.__game.scene.getScene('UI');
      const run = window.__game.scene.getScene('Game').runState?.run;
      const lvl = ui.levelText, timer = ui.timerText;
      return {
        timeMs: Math.round(run?.timeMs ?? -1),
        kills: run?.kills ?? null,
        hp: run?.hp ?? null,
        boss: ui.bossLabel.visible ? { name: ui.bossLabel.text } : null,
        timer: timer.text,
        level: lvl.text,
        levelFits: lvl.width <= timer.x - timer.width / 2 - lvl.x - 8,
      };
    });
    fs.writeFileSync(path.join(outdir, `${name}.json`), JSON.stringify(state, null, 2));
    shots.push({ name, ...state });
  }

  // 1. Timer tick across a minute boundary (00:59 -> 01:00). The game loop is
  // slept before each capture so the canvas keeps the exact frame.
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.run.timeMs = 59400; });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').timerText.text === '00:59', { timeout: 30000 });
  await page.evaluate(() => window.__game.loop.sleep());
  await sleepSnap(`${tag}-timer-0059`);
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.run.timeMs = 59850; window.__game.loop.wake(); });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').timerText.text === '01:00', { timeout: 30000 });
  await page.evaluate(() => window.__game.loop.sleep());
  await sleepSnap(`${tag}-timer-0100`);
  await page.evaluate(() => window.__game.loop.wake());

  // 2. Kill counter growth.
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.run.kills = 12; });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').killsText.text === 'УНИЧТОЖЕНО 12', { timeout: 15000 });
  await sleepSnap(`${tag}-kills-12`);
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.run.kills = 13; });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').killsText.text === 'УНИЧТОЖЕНО 13', { timeout: 15000 });
  await sleepSnap(`${tag}-kills-13`);

  // 3. HP drop on damage.
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.stage.hp = 100; });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').hpText.text.trim().startsWith('100'), { timeout: 15000 });
  await sleepSnap(`${tag}-hp-100`);
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.stage.hp = 43; });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').hpText.text.trim().startsWith('43'), { timeout: 15000 });
  await sleepSnap(`${tag}-hp-43`);
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.stage.hp = 100000; });

  // 4. Forced boss state (deterministic substitution: the snapshot reads
  //    wave.boss for hp/max and the current stage definition for the name;
  //    getPhaseMode is required by the HUD phase ceremony).
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.wave.boss = { active: true, hp: 530, maxHp: 800, bossPhase: 0, getPhaseMode: () => 'armored' };
    gs.stageDirector.currentStage.boss.name = 'ИММУННЫЙ ПРАЙМ';
  });
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    return ui.bossLabel.visible && ui.bossLabel.text === 'ИММУННЫЙ ПРАЙМ';
  }, { timeout: 15000 });
  await sleepSnap(`${tag}-boss`);

  // 5. Level-label reflow near the shortening threshold, including a timer
  //    tick that changes the timer width while the label sits at the
  //    threshold (the 1.1 corner case).
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.wave.boss = null;
    gs.runState.stage.xp = 975; gs.runState.stage.xpNext = 1000;
    gs.runState.run.xp = 975; gs.runState.run.xpNext = 1000;
    gs.runState.run.timeMs = 59400;
  });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').timerText.text === '00:59', { timeout: 30000 });
  await page.evaluate(() => window.__game.loop.sleep());
  await sleepSnap(`${tag}-reflow-tick-0059`);
  await page.evaluate(() => { window.__game.scene.getScene('Game').runState.run.timeMs = 59850; window.__game.loop.wake(); });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').timerText.text === '01:00', { timeout: 30000 });
  await page.evaluate(() => window.__game.loop.sleep());
  await sleepSnap(`${tag}-reflow-tick-0100`);
  await page.evaluate(() => window.__game.loop.wake());

  await browser.close();
  console.log(JSON.stringify({ build, viewport: [vw, vh], shots, errors }, null, 1));
  if (errors.length) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

#!/usr/bin/env node
/*
 * MINIMAL RED TEST for OFELIYA PR #285 (P-04 run snapshot throttle).
 *
 * Target for Codex: copy to scripts/run-snapshot-publish-smoke.cjs, add
 *   "test:run-snapshot-publish": "node scripts/run-snapshot-publish-smoke.cjs"
 * to package.json, and wire it into the browser-smoke job in
 * .github/workflows/ci.yml (next to the hud-hierarchy-smoke step).
 *
 * WHAT IT PROVES (deterministically, no wall-clock race):
 *   The HUD combo badge is gated on `run.combo >= COMBO.showFrom`
 *   (UIScene.ts:448, COMBO.showFrom = 3 in src/game/config.ts:99), and `combo`
 *   is published through the same 250 ms counter cooldown as the kill counters.
 *   A combo change can therefore be withheld for up to 250 ms after the player
 *   actually reached the threshold. PR #285's own CI gate
 *   (scripts/hud-hierarchy-smoke.cjs:653-663) samples the combo badge 160 ms
 *   after the change and fails intermittently -- measured 6/25 runs on the PR
 *   head, 0/25 on main.
 *
 *   The test below arms the counter cooldown EXPLICITLY and then performs the
 *   exact per-frame publish call (`publishRunSnapshot(false)`), so the outcome
 *   does not depend on timing, frame rate or a second boundary.
 *
 * EXPECTED RESULTS
 *   PR head 8c0dec23ff3e2ed752a831cfc0d6270bc086a47d  -> FAIL (RED)
 *   main 2bd6320b1d7f8e1076e7dd70dfafb46800efd86a      -> PASS (GREEN)
 *   any fix that publishes `combo` outside the counter cooldown -> PASS (GREEN)
 *
 * Usage:
 *   node run-snapshot-publish-smoke.cjs [--base-url http://127.0.0.1:5173/]
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const BASE_URL = arg('base-url', process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
    .find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

async function contextFor(browser, size) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE_URL)) return route.continue();
    if (url.startsWith('https://st.max.ru/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.abort();
  });
  await ctx.addInitScript(({ width, height }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    sessionStorage.clear();
    window.__testAnalytics = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/event')) {
        window.__testAnalytics.push(JSON.parse(init.body));
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return originalFetch(input, init);
    };
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-run-snapshot-publish',
      initDataUnsafe: { user: { id: 42, first_name: 'QA', last_name: 'HUD' }, start_param: 'sz1_s_2n9c_26_4_9_l' },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      shareMaxContent: async () => {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, size);
  return ctx;
}

async function bootFrozen(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 45000 });
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() => {
    const game = window.__game;
    return Boolean(
      game &&
      (game.scene.isActive('Game') || game.scene.isPaused('Game')) &&
      game.scene.isActive('UI')
    );
  }, null, { timeout: 45000 });
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const ui = window.__game.scene.getScene('UI');
    gs.awaitingChoice = false;
    gs.pendingChoices = [];
    gs.queuedLevels = 0;
    gs.wave.update = () => {};
    gs.runState.stage.xp = 0;
    gs.runState.stage.xpNext = 1_000_000;
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;
    for (const enemy of gs.enemies.getChildren()) if (enemy.active) enemy.disableBody?.(true, true);
    ui.dismissProgressionForStageBoundary();
  });
  await sleep(220);
  await page.evaluate(() => {
    const game = window.__game;
    const ui = game.scene.getScene('UI');
    if (game.scene.isPaused('Game')) ui.dismissProgressionForStageBoundary();
  });
  await page.waitForFunction(() => {
    const game = window.__game;
    const ui = game?.scene.getScene('UI');
    return game?.scene.isActive('Game') && ui && !ui.modalOpen && !ui.transitionOverlay;
  }, null, { timeout: 4000 });
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await contextFor(browser, { width: 360, height: 600 });
  const page = await ctx.newPage();
  const failures = [];
  try {
    await bootFrozen(page);

    // Everything below happens inside ONE evaluate, with the per-frame publisher
    // stubbed out, so no background frame can publish behind our back.
    const result = await page.evaluate(async () => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const ui = game.scene.getScene('UI');

      const hasPublisher = typeof gs.publishRunSnapshot === 'function';
      const before = game.registry.get('run');

      // Neutralise the per-frame publisher: without this the running update
      // loop would publish the combo a few frames later and mask the defect.
      let publishOnce = null;
      if (hasPublisher) {
        publishOnce = gs.publishRunSnapshot.bind(gs);
        gs.publishRunSnapshot = () => {};
      }

      // 1) Arm the counter cooldown explicitly so the outcome cannot depend on
      //    wall-clock timing, frame rate or a second boundary.
      if (hasPublisher) gs.runCounterCooldownUntil = gs.time.now + 250;

      // 2) Drive the combo past COMBO.showFrom (3) the way a kill does.
      gs.runState.stage.combo = 24;
      gs.runState.stage.comboTimer = 5000;

      // 3) Perform the exact per-frame publish call.
      if (hasPublisher) publishOnce(false);
      else {
        // main has no publisher method: it publishes inline every frame.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }

      const published = game.registry.get('run');
      const publishedCombo = published?.combo;
      const runStateCombo = gs.runState.stage.combo;

      // 4) Let the UI scene render the freshly published snapshot (the UI scene
      //    is not paused, so it picks the registry value up on its next frame).
      //    The publisher stays stubbed, so nothing else can change the registry.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const out = {
        hasPublisher,
        beforeCombo: before?.combo,
        publishedCombo,
        runStateCombo,
        comboVisible: ui.comboText.visible,
        comboText: ui.comboText.text,
      };

      if (hasPublisher) {
        const originalSnapshot = gs.snapshot.bind(gs);
        let snapshots = 0;
        gs.snapshot = () => { snapshots++; return originalSnapshot(); };
        publishOnce(true);
        const previous = game.registry.get('run');
        snapshots = 0;
        for (let i = 0; i < 5; i++) publishOnce(false);
        out.idleAllocations = snapshots;
        gs.runCounterCooldownUntil = gs.time.now + 250;
        gs.runState.run.kills += 10;
        publishOnce(false);
        const changed = game.registry.get('run');
        out.killsPublished = changed.kills;
        out.killsLive = gs.runState.run.kills;
        out.oldSnapshotUnchanged = previous.kills !== changed.kills;
        out.newSnapshotIdentity = previous !== changed;
        snapshots = 0;
        publishOnce(true);
        out.forcedAllocations = snapshots;
        out.forcedNewIdentity = game.registry.get('run') !== changed;
        snapshots = 0;
        for (let i = 0; i < 60; i++) { gs.runState.run.kills++; publishOnce(false); }
        out.denseKillSnapshots = snapshots;
        let pickupForced = false;
        let xpAtNotification = null;
        const notify = ui.notifyRnaPickup.bind(ui);
        gs.publishRunSnapshot = (force) => { pickupForced = force; publishOnce(force); };
        ui.notifyRnaPickup = () => { xpAtNotification = game.registry.get('run').xp; };
        gs.onGemCollected(1);
        out.pickupForced = pickupForced;
        out.pickupXpAtNotification = xpAtNotification;
        out.pickupXpLive = gs.runState.stage.xp;
        ui.notifyRnaPickup = notify;
        gs.publishRunSnapshot = () => {};
        gs.snapshot = originalSnapshot;
      }

      // restore the real publisher so the rest of the run behaves normally
      if (hasPublisher) gs.publishRunSnapshot = publishOnce;
      return out;
    });

    const analytics = await page.evaluate(async () => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const ui = game.scene.getScene('UI');
      ui.onboardingArmed = false;
      ui.armOnboarding(game.registry.get('run'));
      if (!ui.onboarding?.active) throw new Error('onboarding fixture not active');
      if (typeof gs.publishRunSnapshot === 'function') {
        game.scene.pause('Game');
        gs.runState.run.timeMs = 7000;
        gs.publishRunSnapshot(true);
        gs.runState.run.timeMs = 7871;
      } else {
        // Main publishes from the regular game update; allow that real update
        // to reach the registry before pausing and testing the events.
        gs.runState.run.timeMs = 7871;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        game.scene.pause('Game');
      }
      const expectedTime = Math.round(gs.runState.run.timeMs);
      window.__testAnalytics.length = 0;
      ui.onboarding.advance();
      ui.renderOnboarding();
      const skip = ui.onboardingContainer.list.find(object => object.text === 'Пропустить');
      if (!skip) throw new Error('missing onboarding skip control');
      skip.emit('pointerup');
      return { expectedTime, events: window.__testAnalytics.filter(event => event.event === 'onboarding_step' || event.event === 'onboarding_exit') };
    });
    console.log(JSON.stringify({ result, analytics }, null, 2));
    for (const event of ['onboarding_step', 'onboarding_exit']) {
      const captured = analytics.events.find(item => item.event === event);
      if (!captured || captured.props.runTimeMs !== analytics.expectedTime) failures.push(`${event} did not use live run time: ${JSON.stringify(captured)}`);
    }

    if (result.publishedCombo !== result.runStateCombo) {
      failures.push(
        `combo not published while the counter cooldown was armed: published=${result.publishedCombo} live=${result.runStateCombo}`
      );
    }
    if (result.hasPublisher && result.idleAllocations !== 0) failures.push(`unchanged publish created ${result.idleAllocations} snapshots`);
    if (result.hasPublisher && result.killsPublished !== result.killsLive) failures.push(`kills not published: published=${result.killsPublished} live=${result.killsLive}`);
    if (result.hasPublisher && (!result.oldSnapshotUnchanged || !result.newSnapshotIdentity)) failures.push('published snapshot identity/immutability violated');
    if (result.hasPublisher && (result.forcedAllocations !== 1 || !result.forcedNewIdentity)) failures.push('forced publication did not produce a new snapshot');
    if (result.hasPublisher && (!result.pickupForced || result.pickupXpAtNotification !== result.pickupXpLive)) failures.push('pickup did not publish before notification');
    if (result.comboVisible !== true) {
      failures.push(
        `HUD combo badge not visible although combo=${result.runStateCombo} was published (comboText="${result.comboText}")`
      );
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  if (failures.length) {
    console.error('FAIL run-snapshot-publish contract:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log('PASS run-snapshot-publish contract');
})();

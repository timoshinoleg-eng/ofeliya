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
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-choice-integrity-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Choice', last_name: 'Integrity' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () =>
      (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')) &&
      window.__game.scene.isActive('UI')
  );

  const stale = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.queuedLevels = 1;
    gs.awaitingChoice = true;
    gs.legendaryRewardPending = true;
    gs.pendingChoices = [
      {
        id: 'smoke-stale-anchor',
        shortName: 'ANCHOR',
        name: 'anchor',
        desc: 'anchor',
        max: 1,
        family: 'weapon',
        rarity: 'standard',
        kind: 'upgrade',
        showProgress: false,
        apply() {},
      },
    ];
    const before = {
      queuedLevels: gs.queuedLevels,
      rewardPending: gs.legendaryRewardPending,
      ids: gs.pendingChoices.map((choice) => choice.id),
      pity: gs.runState.run.legendaryPity,
      offersSeen: gs.runState.run.legendaryOffersSeen,
    };
    const more = gs.chooseUpgrade('__stale_choice__');
    return {
      before,
      after: {
        queuedLevels: gs.queuedLevels,
        rewardPending: gs.legendaryRewardPending,
        ids: gs.pendingChoices.map((choice) => choice.id),
        pity: gs.runState.run.legendaryPity,
        offersSeen: gs.runState.run.legendaryOffersSeen,
      },
      more,
    };
  });

  if (
    stale.more !== true ||
    stale.after.queuedLevels !== stale.before.queuedLevels ||
    stale.after.rewardPending !== stale.before.rewardPending ||
    stale.after.pity !== stale.before.pity ||
    stale.after.offersSeen !== stale.before.offersSeen ||
    JSON.stringify(stale.after.ids) !== JSON.stringify(stale.before.ids)
  ) {
    throw new Error('stale mutation id changed progression state: ' + JSON.stringify(stale));
  }

  await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    const ui = game.scene.getScene('UI');
    // The stale-id probe intentionally leaves an awaiting choice. Tear down any modal that the
    // UI may have rendered for that probe so this scenario starts from the fresh offer it asserts.
    gs.awaitingChoice = false;
    ui.hideModal();
    if (game.scene.isPaused('Game')) game.scene.resume('Game');

    gs.queuedLevels = 1;
    gs.awaitingChoice = true;
    gs.legendaryRewardPending = false;
    gs.pendingChoices = [
      {
        id: 'smoke-first',
        shortName: 'ПЕРВЫЙ ВЫБОР',
        name: '+1 тестовый стек',
        desc: 'choice integrity smoke',
        max: 1,
        family: 'weapon',
        rarity: 'standard',
        kind: 'upgrade',
        showProgress: false,
        apply() {},
      },
    ];
  });

  await page.waitForFunction(() => {
    const game = window.__game;
    const ui = game.scene.getScene('UI');
    return ui.modalOpen && game.scene.isPaused('Game');
  });

  const result = await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    const ui = game.scene.getScene('UI');

    function firstChoiceHit() {
      const root = ui.modal;
      if (!root) return null;
      for (const child of root.list ?? []) {
        if (child?.type !== 'Container') continue;
        const hit = (child.list ?? []).find(
          (obj) => obj?.type === 'Rectangle' && obj.input?.enabled && obj.width > 200
        );
        if (hit) return hit;
      }
      return null;
    }

    const first = firstChoiceHit();
    if (!first) return { error: 'first hit missing' };
    // Both fingers press the old visible card. Finger 1 resolves the offer while finger 2 stays held.
    first.emit('pointerdown', { id: 101 });
    first.emit('pointerdown', { id: 202 });
    first.emit('pointerup', { id: 101 });

    const afterFirst = {
      stack: gs.runState.stackOf('smoke-first'),
      queuedLevels: gs.queuedLevels,
      awaitingChoice: gs.awaitingChoice,
      ids: gs.pendingChoices.map((choice) => choice.id),
      pity: gs.runState.run.legendaryPity,
      offersSeen: gs.runState.run.legendaryOffersSeen,
      modalOpen: ui.modalOpen,
    };

    // Hold finger 2 beyond the former 300 ms time gate. The fresh offer never received its
    // pointerdown, so this late release must remain inert regardless of elapsed time.
    const heldUntil = performance.now() + 360;
    while (performance.now() < heldUntil) {}
    const second = firstChoiceHit();
    if (!second) return { error: 'second hit missing', afterFirst };
    second.emit('pointerup', { id: 202 });

    return {
      afterFirst,
      afterSecond: {
        stack: gs.runState.stackOf('smoke-first'),
        queuedLevels: gs.queuedLevels,
        awaitingChoice: gs.awaitingChoice,
        ids: gs.pendingChoices.map((choice) => choice.id),
        pity: gs.runState.run.legendaryPity,
        offersSeen: gs.runState.run.legendaryOffersSeen,
        modalOpen: ui.modalOpen,
      },
    };
  });

  if (result.error) throw new Error('choice integrity setup failed: ' + JSON.stringify(result));
  const a = result.afterFirst;
  const b = result.afterSecond;
  if (
    a.stack !== 1 ||
    a.queuedLevels !== 0 ||
    a.awaitingChoice !== true ||
    a.modalOpen !== true ||
    a.ids.length !== 3
  ) {
    throw new Error('first mutation choice did not advance exactly one offer: ' + JSON.stringify(result));
  }
  if (
    b.stack !== a.stack ||
    b.queuedLevels !== a.queuedLevels ||
    b.awaitingChoice !== a.awaitingChoice ||
    b.modalOpen !== a.modalOpen ||
    b.pity !== a.pity ||
    b.offersSeen !== a.offersSeen ||
    JSON.stringify(b.ids) !== JSON.stringify(a.ids)
  ) {
    throw new Error('stale double-tap mutated the fresh offer: ' + JSON.stringify(result));
  }

  const recovered = await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    const ui = game.scene.getScene('UI');
    const root = ui.modal;
    if (!root) return { error: 'recovery modal missing' };
    let hit = null;
    for (const child of root.list ?? []) {
      if (child?.type !== 'Container') continue;
      hit = (child.list ?? []).find(
        (obj) => obj?.type === 'Rectangle' && obj.input?.enabled && obj.width > 200
      );
      if (hit) break;
    }
    if (!hit) return { error: 'recovery hit missing' };
    hit.emit('pointerdown', { id: 303 });
    hit.emit('pointerup', { id: 303 });
    return { awaitingChoice: gs.awaitingChoice, pendingCount: gs.pendingChoices.length };
  });
  if (recovered.error || recovered.awaitingChoice || recovered.pendingCount !== 0) {
    throw new Error('fresh press/release did not resolve the current offer: ' + JSON.stringify(recovered));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('mutation choice integrity browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

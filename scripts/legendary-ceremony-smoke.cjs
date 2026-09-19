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
      initData: 'signed-legendary-ceremony-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Legendary', last_name: 'Ceremony' } },
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

  // Drive the exact production path: Game exposes a real Legendary choice, UIScene naturally
  // opens showLevelUp(), and the test clicks the real interactive card.
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;
    gs.queuedLevels = 0;
    gs.legendaryRewardPending = false;
    gs.pendingChoices = [
      {
        id: 'smoke-zero-point',
        shortName: 'НУЛЕВАЯ ТОЧКА',
        name: 'Каждые 12 секунд опасная группа стягивается в сингулярность',
        desc: 'Runtime integration smoke',
        max: 1,
        family: 'weapon',
        rarity: 'legendary',
        kind: 'legendary',
        legendaryId: 'zero-point',
        showProgress: false,
        apply: (state) => state.addLegendary('zero-point'),
      },
    ];
    gs.awaitingChoice = true;
  });

  await page.waitForFunction(
    () => {
      const game = window.__game;
      const ui = game.scene.getScene('UI');
      return ui.modalOpen && game.scene.isPaused('Game');
    },
    null,
    { timeout: 2_500 }
  );

  const clicked = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const root = ui.modal;
    if (!root) return false;
    for (const child of root.list ?? []) {
      if (child?.type !== 'Container') continue;
      const hit = (child.list ?? []).find(
        (obj) => obj?.type === 'Rectangle' && obj.input?.enabled && obj.width > 200
      );
      if (hit) {
        hit.emit('pointerup');
        return true;
      }
    }
    return false;
  });
  if (!clicked) throw new Error('Legendary level-up card hit target not found');

  await page.waitForFunction(
    () => {
      const ui = window.__game.scene.getScene('UI');
      const texts = ui.modal?.list
        ?.filter((obj) => obj?.type === 'Text')
        .map((obj) => obj.text) ?? [];
      return texts.includes('ЛЕГЕНДАРНАЯ МУТАЦИЯ');
    },
    null,
    { timeout: 2_000 }
  );

  const contract = await page.evaluate(() => {
    const game = window.__game;
    const ui = game.scene.getScene('UI');
    const gs = game.scene.getScene('Game');
    const modal = ui.modal;
    const texts = modal?.list
      ?.filter((obj) => obj?.type === 'Text')
      .map((obj) => obj.text) ?? [];
    const graphicsCount = modal?.list?.filter((obj) => obj?.type === 'Graphics').length ?? 0;
    return {
      modalOpen: ui.modalOpen,
      uiBlocked: ui.uiBlocked,
      texts,
      graphicsCount,
      gamePaused: game.scene.isPaused('Game'),
      legendaryOwned: gs.runState.hasLegendary('zero-point'),
      awaitingChoice: gs.awaitingChoice,
    };
  });

  if (
    !contract.modalOpen ||
    !contract.uiBlocked ||
    !contract.gamePaused ||
    !contract.legendaryOwned ||
    contract.graphicsCount < 2 ||
    !contract.texts.includes('ЛЕГЕНДАРНАЯ МУТАЦИЯ') ||
    !contract.texts.includes('НУЛЕВАЯ ТОЧКА') ||
    !contract.texts.some((text) => text.includes('Каждые 12 секунд'))
  ) {
    throw new Error('Legendary cinematic production-flow contract failed: ' + JSON.stringify(contract));
  }

  await page.waitForTimeout(300);
  await page.locator('#game').screenshot({
    path: path.join(captureDir, '08-legendary-cinematic-reveal.png'),
  });

  await page.waitForFunction(
    () => {
      const game = window.__game;
      const ui = game.scene.getScene('UI');
      return (
        !ui.modalOpen &&
        !ui.uiBlocked &&
        game.scene.isActive('Game') &&
        !game.scene.isPaused('Game')
      );
    },
    null,
    { timeout: 4_000 }
  );

  const resumed = await page.evaluate(() => {
    const game = window.__game;
    const ui = game.scene.getScene('UI');
    const gs = game.scene.getScene('Game');
    return {
      modalOpen: ui.modalOpen,
      uiBlocked: ui.uiBlocked,
      gamePaused: game.scene.isPaused('Game'),
      gameActive: game.scene.isActive('Game'),
      legendaryOwned: gs.runState.hasLegendary('zero-point'),
      pendingCeremony: gs.pendingLegendaryCeremony,
    };
  });
  if (
    resumed.modalOpen ||
    resumed.uiBlocked ||
    resumed.gamePaused ||
    !resumed.gameActive ||
    !resumed.legendaryOwned ||
    resumed.pendingCeremony !== null
  ) {
    throw new Error('Legendary production flow did not resume cleanly: ' + JSON.stringify(resumed));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('Legendary cinematic production-flow browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

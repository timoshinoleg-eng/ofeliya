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

  const contract = await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    const ui = game.scene.getScene('UI');
    gs.scene.pause();
    ui.showLegendaryCeremony('zero-point', false);

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
    };
  });

  if (
    !contract.modalOpen ||
    !contract.uiBlocked ||
    !contract.gamePaused ||
    contract.graphicsCount < 2 ||
    !contract.texts.includes('ЛЕГЕНДАРНАЯ МУТАЦИЯ') ||
    !contract.texts.includes('НУЛЕВАЯ ТОЧКА') ||
    !contract.texts.some((text) => text.includes('Каждые 12 секунд'))
  ) {
    throw new Error('Legendary cinematic ceremony contract failed: ' + JSON.stringify(contract));
  }

  await page.waitForTimeout(300);
  await page.locator('#game').screenshot({
    path: path.join(captureDir, '08-legendary-cinematic-reveal.png'),
  });

  await page.waitForTimeout(1_350);
  const dismissed = await page.evaluate(() => {
    const game = window.__game;
    const ui = game.scene.getScene('UI');
    return {
      modalOpen: ui.modalOpen,
      uiBlocked: ui.uiBlocked,
      gamePaused: game.scene.isPaused('Game'),
      gameActive: game.scene.isActive('Game'),
    };
  });
  if (
    dismissed.modalOpen ||
    dismissed.uiBlocked ||
    dismissed.gamePaused ||
    !dismissed.gameActive
  ) {
    throw new Error('Legendary ceremony did not return cleanly to gameplay: ' + JSON.stringify(dismissed));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('Legendary cinematic ceremony browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

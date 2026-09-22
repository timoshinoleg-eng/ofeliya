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
    localStorage.setItem(
      'ofeliya_save_v1',
      JSON.stringify({
        bestTimeMs: 430000,
        bestSurvivalMs: 430000,
        bestWinTimeMs: 312000,
        bestBoss1ClearMs: 312000,
        bestCampaignClearMs: 555000,
        bestKills: 640,
        bestLevel: 18,
        runs: 7,
        muted: true,
        totalKills: 2110,
        achievements: ['first-contact', 'continuous-flow'],
        evolutionsSeen: ['prism', 'halo'],
        legendarySeen: ['zero-point', 'last-carrier'],
        standardCampaignClears: 2,
        strainedCampaignClears: 1,
        bestStrainedCampaignClearMs: 605000,
      })
    );
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-codex-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Codex', last_name: 'QA' } },
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

  const menuSummary = await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const codex = menu.children.list.find(
      (obj) => typeof obj.text === 'string' && obj.text.startsWith('КОДЕКС ')
    );
    return { text: codex?.text ?? null, interactive: Boolean(codex?.input?.enabled) };
  });
  if (menuSummary.text !== 'КОДЕКС 4/9' || !menuSummary.interactive) {
    throw new Error('Codex menu entry contract failed: ' + JSON.stringify(menuSummary));
  }

  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const codex = menu.children.list.find(
      (obj) => typeof obj.text === 'string' && obj.text.startsWith('КОДЕКС ')
    );
    if (!codex) throw new Error('Codex button missing');
    codex.emit('pointerup');
  });

  const textSnapshot = () => page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const root = menu.codexOverlay;
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    if (root) visit(root);
    return {
      open: Boolean(root),
      texts: flat.filter((obj) => typeof obj.text === 'string').map((obj) => obj.text),
      gameActive: window.__game.scene.isActive('Game'),
    };
  });

  let snapshot = await textSnapshot();
  if (
    !snapshot.open ||
    snapshot.gameActive ||
    !snapshot.texts.includes('КОДЕКС · STRAIN-0') ||
    !snapshot.texts.includes('ОТКРЫТО 4/9 · ДОСТИЖЕНИЯ 2/9') ||
    !snapshot.texts.some((text) => text.includes('ГИПЕРШИП')) ||
    !snapshot.texts.some((text) => text.includes('СВЕРХКАПСИД')) ||
    !snapshot.texts.some((text) => text.includes('НЕ ОТКРЫТО'))
  ) {
    throw new Error('Codex mutation page failed: ' + JSON.stringify(snapshot));
  }

  const clickTab = async (label) => {
    await page.evaluate((target) => {
      const menu = window.__game.scene.getScene('Menu');
      const root = menu.codexOverlay;
      const tab = root?.list?.find((obj) => obj?.type === 'Text' && obj.text === target);
      if (!tab) throw new Error('Codex tab missing: ' + target);
      tab.emit('pointerup');
    }, label);
    await page.waitForTimeout(40);
  };

  await clickTab('ЛЕГЕНДАРНЫЕ');
  snapshot = await textSnapshot();
  if (
    !snapshot.texts.some((text) => text.includes('НУЛЕВАЯ ТОЧКА')) ||
    !snapshot.texts.some((text) => text.includes('ПОСЛЕДНИЙ НОСИТЕЛЬ')) ||
    snapshot.texts.filter((text) => text.includes('???')).length < 4
  ) {
    throw new Error('Codex Legendary page failed: ' + JSON.stringify(snapshot));
  }

  await clickTab('МАСТЕРСТВО');
  snapshot = await textSnapshot();
  if (
    !snapshot.texts.some((text) => text.includes('СТАНДАРТ · пройдено 2 · рекорд 09:15')) ||
    !snapshot.texts.some((text) => text.includes('НАПРЯЖЕНИЕ · пройдено 1 · рекорд 10:05')) ||
    !snapshot.texts.some((text) => text.includes('ДОСТИЖЕНИЯ · 2/9')) ||
    !snapshot.texts.some((text) => text.includes('ПЕРВЫЙ КОНТАКТ')) ||
    !snapshot.texts.some((text) => text.includes('ЦЕПНАЯ РЕАКЦИЯ')) ||
    !snapshot.texts.some((text) => text.includes('ЦИКЛОВ: 7')) ||
    snapshot.gameActive
  ) {
    throw new Error('Codex mastery page failed: ' + JSON.stringify(snapshot));
  }

  await page.locator('#game').screenshot({
    path: path.join(captureDir, '09-codex-mastery.png'),
  });

  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const root = menu.codexOverlay;
    const close = root?.list?.find((obj) => obj?.type === 'Text' && obj.text === '×');
    if (!close) throw new Error('Codex close control missing');
    close.emit('pointerup');
  });
  await page.waitForTimeout(40);

  const closed = await page.evaluate(() => {
    const game = window.__game;
    const menu = game.scene.getScene('Menu');
    return {
      overlay: Boolean(menu.codexOverlay),
      menuActive: game.scene.isActive('Menu'),
      gameActive: game.scene.isActive('Game'),
    };
  });
  if (closed.overlay || !closed.menuActive || closed.gameActive) {
    throw new Error('Codex did not close back to menu safely: ' + JSON.stringify(closed));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('Codex + mastery browser smoke: ok');

  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, ['scripts/ui-readability-smoke.cjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
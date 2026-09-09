const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.__shared = null;
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-ci-payload',
      initDataUnsafe: {
        user: { id: 42, first_name: 'QA', last_name: 'Carrier' },
        start_param: 'sz1_s_2n9c_26_4_9_l',
      },
      getViewportSize: async () => ({ width: '360', height: '760' }),
      shareMaxContent: async (params) => { window.__shared = params; },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await sleep(250);

  const menuState = await page.evaluate(() => {
    const game = window.__game;
    const menu = game.scene.getScene('Menu');
    const texts = menu.children.list.filter((obj) => typeof obj.text === 'string').map((obj) => obj.text);
    const host = document.getElementById('game');
    return {
      scale: [game.scale.width, game.scale.height],
      host: [host.clientWidth, host.clientHeight],
      source: host.dataset.viewportSource,
      challenge: texts.includes('ВЫЗОВ ПОЛУЧЕН'),
      accept: texts.includes('ПРИНЯТЬ ВЫЗОВ'),
      legal: texts.includes('О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА'),
      greeting: texts.some((text) => text.includes('Носитель: QA Carrier')),
    };
  });
  if (JSON.stringify(menuState.scale) !== JSON.stringify([360, 760])) throw new Error(`MAX viewport not applied: ${JSON.stringify(menuState)}`);
  if (JSON.stringify(menuState.host) !== JSON.stringify([360, 760])) throw new Error(`host viewport mismatch: ${JSON.stringify(menuState)}`);
  if (menuState.source !== 'max' || !menuState.challenge || !menuState.accept || !menuState.legal || !menuState.greeting) {
    throw new Error(`MAX menu contract failed: ${JSON.stringify(menuState)}`);
  }
  fs.mkdirSync('/tmp/browser-smoke', { recursive: true });
  await page.screenshot({ path: '/tmp/browser-smoke/01-challenge-menu.png' });

  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const legal = menu.children.list.find((obj) => obj.text === 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА');
    if (!legal) throw new Error('legal footer missing');
    legal.emit('pointerup');
  });
  await page.waitForSelector('#ofeliya-legal-overlay');
  const legalState = await page.evaluate(() => {
    const overlay = document.getElementById('ofeliya-legal-overlay');
    const text = overlay?.innerText ?? '';
    return {
      developer: text.includes('CI Test Developer'),
      registration: text.includes('CI-REG-1'),
      privacy: text.includes('ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ'),
      terms: text.includes('УСЛОВИЯ ИСПОЛЬЗОВАНИЯ'),
      support: text.includes('qa@example.test'),
      warning: text.includes('Pre-release:'),
    };
  });
  if (!legalState.developer || !legalState.registration || !legalState.privacy || !legalState.terms || !legalState.support || legalState.warning) {
    throw new Error(`legal surface failed: ${JSON.stringify(legalState)}`);
  }
  await page.click('#ofeliya-legal-overlay .legal-close');
  await page.waitForSelector('#ofeliya-legal-overlay', { state: 'detached' });

  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.timeMs = 130000;
    gs.runState.kills = 90;
    gs.runState.hostCellsInfected = 5;
    gs.runState.level = 10;
    gs.runState.comboBest = 24;
    gs.finish(false);
  });
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    const texts = ui.children.list.filter((obj) => typeof obj.text === 'string').map((obj) => obj.text);
    return texts.some((text) => text.includes('ВЫЗОВ ПРЕВЗОЙДЁН')) && texts.includes('БРОСИТЬ ВЫЗОВ');
  });
  await sleep(120);

  const resultState = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const shareText = ui.children.list.find((obj) => obj.text === 'БРОСИТЬ ВЫЗОВ');
    const verdict = ui.children.list.find((obj) => typeof obj.text === 'string' && obj.text.includes('ВЫЗОВ ПРЕВЗОЙДЁН'));
    return { share: shareText ? { x: shareText.x, y: shareText.y } : null, verdict: verdict?.text ?? null };
  });
  if (!resultState.share || !resultState.verdict) throw new Error(`challenge result missing: ${JSON.stringify(resultState)}`);
  await page.screenshot({ path: '/tmp/browser-smoke/02-challenge-result.png' });
  await page.mouse.click(resultState.share.x, resultState.share.y);
  await page.waitForFunction(() => !!window.__shared);

  const shared = await page.evaluate(() => window.__shared);
  if (!shared.text || !shared.link || !shared.link.startsWith('https://max.ru/ofeliya_ci_bot?startapp=sz1_s_')) {
    throw new Error(`MAX challenge share failed: ${JSON.stringify(shared)}`);
  }
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

  await browser.close();
  console.log('MAX browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

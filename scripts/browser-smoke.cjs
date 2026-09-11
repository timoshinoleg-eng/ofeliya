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
  await sleep(300);

  const menuState = await page.evaluate(() => {
    const game = window.__game;
    const menu = game.scene.getScene('Menu');
    const host = document.getElementById('game');
    const textObjects = menu.children.list.filter(
      (obj) => typeof obj.text === 'string' && obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function'
    );
    const texts = textObjects.map((obj) => obj.text);
    const overflow = textObjects
      .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
      .filter(({ bounds }) => bounds.left < 2 || bounds.right > game.scale.width - 2)
      .map(({ text, bounds }) => ({ text, left: bounds.left, right: bounds.right, width: bounds.width }));
    const target = textObjects.find(
      (obj) => obj.text.startsWith('Подави IMMUNE PRIME') || obj.text.startsWith('Продержись дольше')
    );
    const accept = textObjects.find((obj) => obj.text === 'ПРИНЯТЬ ВЫЗОВ');
    const targetBounds = target?.getBounds?.();
    const acceptBounds = accept?.getBounds?.();
    return {
      scale: [game.scale.width, game.scale.height],
      host: [host.clientWidth, host.clientHeight],
      source: host.dataset.viewportSource,
      challenge: texts.includes('ВЫЗОВ ПОЛУЧЕН'),
      accept: texts.includes('ПРИНЯТЬ ВЫЗОВ'),
      legal: texts.includes('О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА'),
      greeting: texts.some((text) => text.includes('Носитель: QA Carrier')),
      overflow,
      targetAcceptGap:
        targetBounds && acceptBounds ? Math.round(acceptBounds.top - targetBounds.bottom) : null,
    };
  });
  if (JSON.stringify(menuState.scale) !== JSON.stringify([360, 760])) throw new Error(`MAX viewport not applied: ${JSON.stringify(menuState)}`);
  if (JSON.stringify(menuState.host) !== JSON.stringify([360, 760])) throw new Error(`host viewport mismatch: ${JSON.stringify(menuState)}`);
  if (
    menuState.source !== 'max' ||
    !menuState.challenge ||
    !menuState.accept ||
    !menuState.legal ||
    !menuState.greeting ||
    menuState.overflow.length > 0 ||
    menuState.targetAcceptGap === null ||
    menuState.targetAcceptGap < 18
  ) {
    throw new Error(`MAX menu layout contract failed: ${JSON.stringify(menuState)}`);
  }
  fs.mkdirSync('/tmp/browser-smoke', { recursive: true });
  await page.locator('#game').screenshot({ path: '/tmp/browser-smoke/01-challenge-menu.png' });

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
      privacy: /политика конфиденциальности/i.test(text),
      terms: /условия использования/i.test(text),
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
    const ui = window.__game.scene.getScene('UI');
    ui.update();
  });
  await sleep(180);

  const resultState = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);

    const normalize = (value) => String(value ?? '').replace(/\n/g, ' ');
    const title = flat.find(
      (obj) => typeof obj.text === 'string' && ['ШТАММ УНИЧТОЖЕН', 'ИММУНИТЕТ ПОДАВЛЕН'].includes(normalize(obj.text))
    );
    const container = title?.parentContainer;
    const modalTexts = container?.list?.filter(
      (obj) => typeof obj.text === 'string' && obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function'
    ) ?? [];
    const time = modalTexts.find((obj) => /^\d{2}:\d{2}$/.test(obj.text));
    const stats = modalTexts.find((obj) => obj.text.startsWith('ИММУНИТЕТ:') && obj.text.includes('Клеток:'));
    const shareText = modalTexts.find((obj) => obj.text === 'БРОСИТЬ ВЫЗОВ');
    const verdict = modalTexts.find((obj) => obj.text.includes('ВЫЗОВ ПРЕВЗОЙДЁН'));
    const buttons = modalTexts.filter((obj) => ['ЕЩЁ ОДИН ЦИКЛ', 'БРОСИТЬ ВЫЗОВ', 'В МЕНЮ'].includes(obj.text));
    const buttonSet = new Set(buttons);
    const details = modalTexts
      .filter((obj) => obj !== title && obj !== time && obj !== stats && !buttonSet.has(obj))
      .sort((a, b) => a.getBounds().top - b.getBounds().top);

    const overflow = modalTexts
      .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
      .filter(({ bounds }) =>
        bounds.left < 2 ||
        bounds.right > ui.scale.width - 2 ||
        bounds.top < 2 ||
        bounds.bottom > ui.scale.height - 2
      )
      .map(({ text, bounds }) => ({
        text,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      }));

    const titleBounds = title?.getBounds?.();
    const timeBounds = time?.getBounds?.();
    const statsBounds = stats?.getBounds?.();
    const keyOrderOk =
      !!titleBounds &&
      !!timeBounds &&
      !!statsBounds &&
      titleBounds.bottom + 4 <= timeBounds.top &&
      timeBounds.bottom + 4 <= statsBounds.top;

    let detailsOrderOk = true;
    for (let i = 1; i < details.length; i += 1) {
      if (details[i - 1].getBounds().bottom + 1 > details[i].getBounds().top) detailsOrderOk = false;
    }

    const buttonChecks = buttons.map((label) => {
      const bg = container?.list?.find(
        (obj) => obj !== label && obj.input?.enabled && Math.abs((obj.y ?? -9999) - label.y) < 1 && typeof obj.getBounds === 'function'
      );
      const lb = label.getBounds();
      const bb = bg?.getBounds?.();
      return {
        label: label.text,
        ok:
          !!bb &&
          lb.left >= bb.left + 6 &&
          lb.right <= bb.right - 6 &&
          lb.top >= bb.top + 2 &&
          lb.bottom <= bb.bottom - 2,
        top: bb?.top ?? null,
      };
    });
    const firstButtonTop = Math.min(...buttonChecks.map((item) => item.top ?? Infinity));
    const detailBottom = details.length ? Math.max(...details.map((obj) => obj.getBounds().bottom)) : statsBounds?.bottom ?? 0;
    const contentButtonGap = firstButtonTop - detailBottom;

    let shareControl = null;
    if (shareText?.parentContainer?.list) {
      shareControl = shareText.parentContainer.list.find((obj) =>
        obj !== shareText && obj.input?.enabled && Math.abs((obj.y ?? -9999) - shareText.y) < 1
      );
    }

    return {
      share: !!shareText,
      verdict: verdict?.text ?? null,
      control: !!shareControl,
      stats: stats?.text ?? null,
      overflow,
      keyOrderOk,
      detailsOrderOk,
      buttonChecks,
      contentButtonGap: Math.round(contentButtonGap),
      viewport: [ui.scale.width, ui.scale.height],
    };
  });
  if (
    !resultState.share ||
    !resultState.verdict ||
    !resultState.control ||
    !resultState.stats ||
    resultState.overflow.length > 0 ||
    !resultState.keyOrderOk ||
    !resultState.detailsOrderOk ||
    resultState.buttonChecks.length !== 3 ||
    resultState.buttonChecks.some((item) => !item.ok) ||
    resultState.contentButtonGap < 12
  ) {
    throw new Error(`challenge result layout failed: ${JSON.stringify(resultState)}`);
  }
  await page.locator('#game').screenshot({ path: '/tmp/browser-smoke/02-challenge-result.png' });

  await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    const shareText = flat.find((obj) => obj.text === 'БРОСИТЬ ВЫЗОВ');
    const control = shareText?.parentContainer?.list?.find((obj) =>
      obj !== shareText && obj.input?.enabled && Math.abs((obj.y ?? -9999) - shareText.y) < 1
    );
    if (!control) throw new Error('interactive share control missing');
    control.emit('pointerup');
  });
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

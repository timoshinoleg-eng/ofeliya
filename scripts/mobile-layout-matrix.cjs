const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const sizes = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 360, height: 760 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BUTTONS = ['ЕЩЁ ОДИН ЦИКЛ', 'БРОСИТЬ ВЫЗОВ', 'В МЕНЮ'];

function visibleTextOverflow(items, width, height) {
  return items
    .filter((obj) => typeof obj.text === 'string' && obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function')
    .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
    .filter(({ bounds }) => bounds.left < 1 || bounds.right > width - 1 || bounds.top < 1 || bounds.bottom > height - 1)
    .map(({ text, bounds }) => ({
      text,
      left: Math.round(bounds.left),
      right: Math.round(bounds.right),
      top: Math.round(bounds.top),
      bottom: Math.round(bounds.bottom),
    }));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  fs.mkdirSync('/tmp/browser-smoke', { recursive: true });

  for (const size of sizes) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    await ctx.route('https://st.max.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await ctx.addInitScript(({ width, height }) => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
      window.WebApp = {
        platform: 'android',
        version: '26.20.0',
        initData: 'signed-layout-matrix',
        initDataUnsafe: {
          user: { id: 42, first_name: 'QA', last_name: 'Matrix' },
          start_param: 'sz1_s_2n9c_26_4_9_l',
        },
        getViewportSize: async () => ({ width: String(width), height: String(height) }),
        shareMaxContent: async () => {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      };
    }, size);

    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    await sleep(180);

    const menu = await page.evaluate(({ width, height }) => {
      const game = window.__game;
      const scene = game.scene.getScene('Menu');
      const items = scene.children.list;
      const texts = items.filter((obj) => typeof obj.text === 'string');
      const overflow = items
        .filter((obj) => typeof obj.text === 'string' && obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function')
        .map((obj) => ({ text: obj.text, bounds: obj.getBounds(), resolution: obj.resolution }))
        .filter(({ bounds }) => bounds.left < 1 || bounds.right > width - 1 || bounds.top < 1 || bounds.bottom > height - 1)
        .map(({ text, bounds }) => ({ text, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }));
      const nonNativeResolution = texts
        .filter((obj) => typeof obj.resolution === 'number' && obj.resolution !== 1)
        .map((obj) => ({ text: obj.text, resolution: obj.resolution }));
      return {
        scale: [game.scale.width, game.scale.height],
        overflow,
        nonNativeResolution,
        hasTitle: texts.some((obj) => obj.text === 'OFELIYA'),
        hasChallenge: texts.some((obj) => obj.text === 'ВЫЗОВ ПОЛУЧЕН'),
        hasAction: texts.some((obj) => obj.text === 'ПРИНЯТЬ ВЫЗОВ'),
      };
    }, size);

    if (
      menu.scale[0] !== size.width ||
      menu.scale[1] !== size.height ||
      !menu.hasTitle ||
      !menu.hasChallenge ||
      !menu.hasAction ||
      menu.overflow.length ||
      menu.nonNativeResolution.length
    ) {
      throw new Error(`menu ${size.width}x${size.height} failed: ${JSON.stringify(menu)}`);
    }

    if (size.width === 320 && size.height === 568) {
      await page.locator('#game').screenshot({ path: '/tmp/browser-smoke/03-matrix-menu-320x568.png' });
    }

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
      window.__game.scene.getScene('UI').update();
    });
    await sleep(180);

    const result = await page.evaluate(({ width, height, buttonLabels }) => {
      const ui = window.__game.scene.getScene('UI');
      const normalize = (value) => String(value ?? '').replace(/\n/g, ' ');
      const container = ui.children.list.find(
        (obj) => Array.isArray(obj?.list) && obj.list.some(
          (child) => typeof child.text === 'string' && ['ШТАММ УНИЧТОЖЕН', 'ИММУНИТЕТ ПОДАВЛЕН'].includes(normalize(child.text))
        )
      );
      if (!container) return { missing: 'result container' };

      const texts = container.list.filter((obj) => typeof obj.text === 'string');
      const overflow = texts
        .filter((obj) => obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function')
        .map((obj) => ({ text: obj.text, bounds: obj.getBounds(), resolution: obj.resolution }))
        .filter(({ bounds }) => bounds.left < 1 || bounds.right > width - 1 || bounds.top < 1 || bounds.bottom > height - 1)
        .map(({ text, bounds }) => ({ text, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }));
      const nonNativeResolution = texts
        .filter((obj) => typeof obj.resolution === 'number' && obj.resolution !== 1)
        .map((obj) => ({ text: obj.text, resolution: obj.resolution }));

      const buttons = buttonLabels.map((label) => {
        const text = texts.find((obj) => obj.text === label);
        const bg = text && container.list.find(
          (obj) => obj !== text && obj.input?.enabled && Math.abs((obj.y ?? -9999) - text.y) < 1 && typeof obj.getBounds === 'function'
        );
        const tb = text?.getBounds?.();
        const bb = bg?.getBounds?.();
        return {
          label,
          ok: !!tb && !!bb && tb.left >= bb.left + 4 && tb.right <= bb.right - 4 && tb.top >= bb.top + 1 && tb.bottom <= bb.bottom - 1,
        };
      });

      const sorted = texts
        .filter((obj) => !buttonLabels.includes(obj.text) && obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function')
        .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
        .sort((a, b) => a.bounds.top - b.bounds.top);
      const overlaps = [];
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const current = sorted[i];
        if (prev.bounds.bottom > current.bounds.top + 1) {
          overlaps.push({ a: prev.text, b: current.text, amount: Math.round(prev.bounds.bottom - current.bounds.top) });
        }
      }

      return { overflow, nonNativeResolution, buttons, overlaps };
    }, { ...size, buttonLabels: BUTTONS });

    if (
      result.missing ||
      result.overflow?.length ||
      result.nonNativeResolution?.length ||
      result.buttons?.some((item) => !item.ok) ||
      result.overlaps?.length
    ) {
      throw new Error(`result ${size.width}x${size.height} failed: ${JSON.stringify(result)}`);
    }

    if (size.width === 320 && size.height === 568) {
      await page.locator('#game').screenshot({ path: '/tmp/browser-smoke/04-matrix-result-320x568.png' });
    }

    if (pageErrors.length) {
      throw new Error(`page errors ${size.width}x${size.height}: ${pageErrors.join(' | ')}`);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`MAX mobile layout matrix: ok (${sizes.map((s) => `${s.width}x${s.height}`).join(', ')})`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

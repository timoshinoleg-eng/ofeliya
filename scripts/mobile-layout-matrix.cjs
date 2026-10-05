const fs = require('fs');
const path = require('path');

const { chromium } = process.platform === 'win32' ? require('playwright') : require('playwright-core');

const chrome = process.platform === 'win32'
  ? undefined
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (process.platform !== 'win32' && !chrome) throw new Error('Chrome not found');
const appUrl = process.env.OFELIYA_URL || 'http://127.0.0.1:5173/';
const captureDir = process.platform === 'win32'
  ? path.join(process.cwd(), '.tmp-browser-smoke')
  : '/tmp/browser-smoke';

const sizes = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 360, height: 760 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];
const BUTTONS = ['ЕЩЁ ОДИН ЦИКЛ', 'БРОСИТЬ ВЫЗОВ', 'В МЕНЮ'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertCompactResumeMenu(browser) {
  const size = { width: 320, height: 568 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(({ width, height }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1, tutorialDone: true }));
    sessionStorage.clear();
    window.__matrixViewport = { width, height };
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-resume-layout-matrix',
      initDataUnsafe: { user: { id: 42, first_name: 'Resume', last_name: 'Matrix' } },
      getViewportSize: async () => ({
        width: String(window.__matrixViewport.width),
        height: String(window.__matrixViewport.height),
      }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, size);

  const page = await ctx.newPage();
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() =>
    window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')
  );
  await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    const ui = game.scene.getScene('UI');
    // An automatic first-frame level-up can pause the Game before Playwright
    // observes an active frame. It is unrelated to the resume-menu fixture.
    gs.awaitingChoice = false;
    gs.pendingChoices = [];
    gs.queuedLevels = 0;
    ui.hideModal();
    if (game.scene.isPaused('Game')) game.scene.resume('Game');
    if (!gs.saveCheckpointNow()) throw new Error('resume-menu fixture did not save a checkpoint');
  });
  await sleep(120);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await sleep(180);

  const layout = await page.evaluate(() => {
    const scene = window.__game.scene.getScene('Menu');
    const visible = scene.children.list.filter(
      (obj) => obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function'
    );
    const text = (predicate) => visible.find((obj) => typeof obj.text === 'string' && predicate(obj.text));
    const bounds = (obj) => {
      const b = obj?.getBounds?.();
      return b ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null;
    };
    return {
      action: bounds(text((value) => value === 'ПРОДОЛЖИТЬ ЗАБЕГ')),
      newRun: bounds(scene.children.getByName('ofeliya-menu-new-run')),
      sound: bounds(text((value) => value.startsWith('звук:'))),
      social: bounds(text((value) => value === 'СВОДКА')),
      codex: bounds(text((value) => value.startsWith('КОДЕКС '))),
      legal: bounds(text((value) => value === 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА')),
    };
  });

  const required = ['action', 'newRun', 'sound', 'social', 'codex', 'legal'];
  for (const key of required) {
    if (!layout[key]) throw new Error(`resume menu missing ${key}: ${JSON.stringify(layout)}`);
  }
  if (
    layout.action.bottom > layout.newRun.top + 1 ||
    layout.newRun.bottom + 2 > Math.min(layout.sound.top, layout.social.top, layout.codex.top) ||
    Math.max(layout.sound.bottom, layout.social.bottom, layout.codex.bottom) + 4 > layout.legal.top
  ) {
    throw new Error(`resume menu 320x568 overlap: ${JSON.stringify(layout)}`);
  }

  await page.locator('#game').screenshot({ path: path.join(captureDir, '03b-matrix-resume-menu-320x568.png') });

  // MenuScene.onResize() restarts the same Phaser Scene instance. The layout guard must
  // recognise each new display-list generation even when dimensions/text are identical.
  for (let restart = 0; restart < 3; restart += 1) {
    await page.evaluate(() => window.__game.scene.getScene('Menu').scene.restart());
    await sleep(220);
    const compactRestart = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('Menu');
      const carrier = scene.children.getByName('ofeliya-menu-carrier');
      const hook = scene.children.getByName('ofeliya-menu-hook');
      const subtitle = scene.children.getByName('ofeliya-menu-subtitle');
      const hookBounds = hook?.getBounds?.();
      const subtitleBounds = subtitle?.getBounds?.();
      return {
        active: scene.sys.isActive(),
        carrierExists: Boolean(carrier),
        carrierVisible: carrier?.visible ?? null,
        subtitleBelowHook:
          Boolean(hookBounds && subtitleBounds) && hookBounds.bottom + 10 <= subtitleBounds.top,
      };
    });
    if (
      !compactRestart.active ||
      !compactRestart.carrierExists ||
      compactRestart.carrierVisible !== false ||
      !compactRestart.subtitleBelowHook
    ) {
      throw new Error(
        `menu restart ${restart + 1} did not re-apply compact layout: ${JSON.stringify(compactRestart)}`
      );
    }
  }

  await ctx.close();
}


(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  fs.mkdirSync(captureDir, { recursive: true });

  for (const size of sizes) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    await ctx.route('https://st.max.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await ctx.addInitScript(({ width, height }) => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1, tutorialDone: true }));
      sessionStorage.clear();
      window.__matrixViewport = { width, height };
    window.WebApp = {
        platform: 'android',
        version: '26.20.0',
        initData: 'signed-layout-matrix',
        initDataUnsafe: {
          user: { id: 42, first_name: 'QA', last_name: 'Matrix' },
          start_param: 'sz1_s_2n9c_26_4_9_l',
        },
        getViewportSize: async () => ({
        width: String(window.__matrixViewport.width),
        height: String(window.__matrixViewport.height),
      }),
        shareMaxContent: async () => {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      };
    }, size);

    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    await sleep(180);

    const menu = await page.evaluate(async ({ width, height }) => {
      const { visibleTextBounds } = await import('/scripts/visible-text-bounds.js');
      const game = window.__game;
      const scene = game.scene.getScene('Menu');
      const measured = visibleTextBounds(scene);
      const texts = measured.map(({ object }) => object);
      const visible = texts;
      const overflow = visible
        .filter((obj) => !measured.find((entry) => entry.object === obj).masked)
        .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
        .filter(({ bounds }) => bounds.left < 1 || bounds.right > width - 1 || bounds.top < 1 || bounds.bottom > height - 1)
        .map(({ text, bounds }) => ({ text, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }));

      const isFlow = (text) =>
        text.startsWith('ОРГАНИЗМ ЕЩЁ НЕ ЗНАЕТ') ||
        text.startsWith('Мутируй быстрее') ||
        text.startsWith('Носитель:') ||
        text === 'ВЫЗОВ ПОЛУЧЕН' ||
        text.startsWith('Подави ИММУННОГО ПРАЙМА') ||
        text.startsWith('Продержись дольше') ||
        /иммун\.\s*·.*клеток.*мутация/i.test(text) ||
        text === 'ПРИНЯТЬ ВЫЗОВ' ||
        text.startsWith('атака автоматическая');
      const flow = visible
        .filter((obj) => isFlow(obj.text))
        .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
        .sort((a, b) => a.bounds.top - b.bounds.top);
      const overlaps = [];
      for (let i = 1; i < flow.length; i += 1) {
        if (flow[i - 1].bounds.bottom > flow[i].bounds.top + 1) {
          overlaps.push({ a: flow[i - 1].text, b: flow[i].text });
        }
      }

      const sound = visible.find((obj) => obj.text.startsWith('звук:'));
      const social = visible.find((obj) => obj.text === 'СВОДКА');
      const codex = visible.find((obj) => obj.text.startsWith('КОДЕКС '));
      const legal = visible.find((obj) => obj.text === 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА');
      const tagline = visible.find((obj) => obj.text === 'Двигай штамм · собирай РНК · выбирай мутации');
      const boundsOf = (obj) => {
        const bounds = obj?.getBounds?.();
        if (!bounds) return null;
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const utility = {
        sound: boundsOf(sound),
        social: boundsOf(social),
        codex: boundsOf(codex),
        legal: boundsOf(legal),
        tagline: boundsOf(tagline),
      };

      return {
        renderer: game.renderer?.constructor?.name ?? '',
        scale: [game.scale.width, game.scale.height],
        overflow,
        overlaps,
        utility,
        hasTitle: texts.some((obj) => obj.text === 'OFELIYA'),
        hasChallenge: texts.some((obj) => obj.text === 'ВЫЗОВ ПОЛУЧЕН'),
        hasAction: texts.some((obj) => obj.text === 'ПРИНЯТЬ ВЫЗОВ'),
      };
    }, size);

    const compactFooter = size.height < 720;
    const utility = menu.utility;
    const utilityRowOk =
      utility.sound &&
      utility.social &&
      utility.codex &&
      utility.legal &&
      utility.sound.right + 4 <= utility.social.left &&
      utility.social.right + 4 <= utility.codex.left &&
      utility.social.bottom + 4 <= utility.legal.top &&
      (!compactFooter || utility.tagline === null);

    if (
      menu.scale[0] !== size.width ||
      menu.scale[1] !== size.height ||
      !menu.hasTitle ||
      !menu.hasChallenge ||
      !menu.hasAction ||
      !utilityRowOk ||
      menu.overflow.length ||
      menu.overlaps.length
    ) {
      throw new Error(`menu ${size.width}x${size.height} failed: ${JSON.stringify(menu)}`);
    }

    if (size.width === 320 && size.height === 568) {
      await page.locator('#game').screenshot({ path: path.join(captureDir, '03-matrix-menu-320x568.png') });
    }

    await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
    await page.waitForFunction(() =>
      window.__game.scene.isActive('UI') &&
      (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game'))
    );
    await page.evaluate(() => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const ui = game.scene.getScene('UI');
      gs.awaitingChoice = false;
      gs.pendingChoices = [];
      gs.queuedLevels = 0;
      ui.hideModal();
      if (game.scene.isPaused('Game')) game.scene.resume('Game');
      gs.runState.run.timeMs = 130000;
      gs.runState.run.kills = 90;
      gs.runState.run.hostCellsInfected = 5;
      gs.runState.stage.level = 10;
      gs.runState.run.comboBest = 24;
      gs.finish(false);
      window.__game.scene.getScene('UI').update();
    });
    await sleep(180);

    const result = await page.evaluate(async ({ width, height, buttonLabels }) => {
      const { visibleTextBounds } = await import('/scripts/visible-text-bounds.js');
      const ui = window.__game.scene.getScene('UI');
      const normalize = (value) => String(value ?? '').replace(/\n/g, ' ');
      const container = ui.children.list.find(
        (obj) => Array.isArray(obj?.list) && obj.list.some(
          (child) => typeof child.text === 'string' && ['ШТАММ УНИЧТОЖЕН', 'ИММУНИТЕТ ПОДАВЛЕН'].includes(normalize(child.text))
        )
      );
      if (!container) return { missing: 'result container' };

      const measured = visibleTextBounds(container);
      const texts = measured.map(({ object }) => object);
      const visible = texts;
      const overflow = visible
        .filter((obj) => !measured.find((entry) => entry.object === obj).masked)
        .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
        .filter(({ bounds }) => bounds.left < 1 || bounds.right > width - 1 || bounds.top < 1 || bounds.bottom > height - 1)
        .map(({ text, bounds }) => ({ text, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }));

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

      const sorted = visible
        .filter((obj) => !buttonLabels.includes(obj.text))
        .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
        .sort((a, b) => a.bounds.top - b.bounds.top);
      const overlaps = [];
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i - 1].bounds.bottom > sorted[i].bounds.top + 1) {
          overlaps.push({ a: sorted[i - 1].text, b: sorted[i].text });
        }
      }

      return { overflow, buttons, overlaps };
    }, { ...size, buttonLabels: BUTTONS });

    if (
      result.missing ||
      result.overflow?.length ||
      result.buttons?.some((item) => !item.ok) ||
      result.overlaps?.length
    ) {
      throw new Error(`result ${size.width}x${size.height} failed: ${JSON.stringify(result)}`);
    }

    if (size.width === 390 && size.height === 844) {
      // Reproduce messenger rotation/viewport contraction while the result screen is open.
      // The same result container must be laid out again for the new logical viewport.
      await page.evaluate(() => {
        // A real MAX resize changes both the WebView's CSS viewport and the bridge's
        // authoritative viewport response. Keep the bridge response ready before the
        // browser resize signal so ViewportManager never observes a mixed generation.
        window.__matrixViewport = { width: 320, height: 568 };
        window.WebApp.getViewportSize = async () => ({ width: '320', height: '568' });
      });
      await page.setViewportSize({ width: 320, height: 568 });
      await page.evaluate(async () => {
        await window.__viewportManager.sync();
      });
      await page.waitForFunction(
        () => window.__game.scale.width === 320 && window.__game.scale.height === 568,
        null,
        { timeout: 3000 }
      );
      await sleep(120);
      const resizedResult = await page.evaluate(() => {
        const ui = window.__game.scene.getScene('UI');
        const container = ui.children.list.find((obj) => obj?.name === 'ofeliya-result');
        if (!container) return { missing: 'result container' };
        const byName = (name) => container.list.find((obj) => obj?.name === name);
        const names = [
          'ofeliya-result-retry-label',
          'ofeliya-result-share-label',
          'ofeliya-result-menu-label',
        ];
        const expectedYs = [402, 456, 510];
        const buttons = names.map((name, index) => {
          const text = byName(name);
          const bg = byName(name.replace('-label', '-bg'));
          const tb = text?.getBounds?.();
          const bb = bg?.getBounds?.();
          return {
            name,
            y: text?.y ?? null,
            expectedY: expectedYs[index],
            textInside:
              Boolean(tb && bb) &&
              tb.left >= bb.left + 4 &&
              tb.right <= bb.right - 4 &&
              tb.top >= bb.top + 1 &&
              tb.bottom <= bb.bottom - 1,
            bgWidth: bg?.width ?? null,
          };
        });
        const scrim = byName('ofeliya-result-scrim');
        return {
          scale: [ui.scale.width, ui.scale.height],
          buttons,
          scrim: scrim
            ? {
                x: scrim.x,
                y: scrim.y,
                width: scrim.displayWidth,
                height: scrim.displayHeight,
              }
            : null,
        };
      });
      if (
        resizedResult.missing ||
        resizedResult.scale?.[0] !== 320 ||
        resizedResult.scale?.[1] !== 568 ||
        resizedResult.buttons?.some(
          (item) =>
            Math.abs((item.y ?? -9999) - item.expectedY) > 1 ||
            !item.textInside ||
            (item.bgWidth ?? 9999) > 272
        ) ||
        !resizedResult.scrim ||
        Math.abs(resizedResult.scrim.x - 160) > 1 ||
        Math.abs(resizedResult.scrim.y - 284) > 1 ||
        Math.abs(resizedResult.scrim.width - 320) > 1 ||
        Math.abs(resizedResult.scrim.height - 568) > 1
      ) {
        throw new Error(`result resize 390x844 -> 320x568 failed: ${JSON.stringify(resizedResult)}`);
      }
    }

    if (size.width === 320 && size.height === 568) {
      await page.locator('#game').screenshot({ path: path.join(captureDir, '04-matrix-result-320x568.png') });
    }

    if (pageErrors.length) {
      throw new Error(`page errors ${size.width}x${size.height}: ${pageErrors.join(' | ')}`);
    }
    await ctx.close();
  }

  await assertCompactResumeMenu(browser);
  await browser.close();
  console.log(`MAX mobile layout matrix: ok (${sizes.map((s) => `${s.width}x${s.height}`).join(', ')} + restart-safe resume + result resize)`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

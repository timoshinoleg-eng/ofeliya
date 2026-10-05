// Focused manual browser probe. Run against this checkout's Vite server with
// OFELIYA_URL=http://127.0.0.1:5194/ node scripts/legendary-layout-probe.cjs
const fs = require('fs');

function browserDriver() {
  if (process.platform === 'win32') return { chromium: require('playwright').chromium };
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

const cases = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 740 },
];

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const reports = [];
  try {
    for (const size of cases) {
      const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
      await ctx.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await ctx.addInitScript(({ width, height }) => {
        localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
        window.WebApp = {
          platform: 'android', version: '26.20.0', initData: 'signed-layout-probe',
          initDataUnsafe: { user: { id: 42, first_name: 'Layout' } },
          getViewportSize: async () => ({ width: String(width), height: String(height) }),
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
        };
      }, size);
      const page = await ctx.newPage();
      await page.goto(process.env.OFELIYA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
      await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
      // First-run onboarding can pause Game behind an overlay before this probe
      // installs its own choice. UI must be running; Game may be active or paused.
      await page.waitForFunction(() =>
        window.__game.scene.isActive('UI') &&
        (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game'))
      );
      const definitions = await page.evaluate(async () => {
        // The live bundle exposes the same source module to Vite in development mode.
        const module = await import('/src/game/LegendarySystem.ts');
        return module.LEGENDARIES.map(({ id, title, effect, desc, family }) => ({ id, title, effect, desc, family }));
      });
      for (const def of definitions) {
        await page.evaluate((choice) => {
          const gs = window.__game.scene.getScene('Game');
          const ui = window.__game.scene.getScene('UI');
          ui.modal?.destroy(true);
          ui.modal = null;
          ui.modalOpen = false;
          if (window.__game.scene.isPaused('Game')) window.__game.scene.resume('Game');
          gs.runState.stage.hp = 1_000_000;
          gs.runState.stage.maxHp = 1_000_000;
          gs.nextFireAt = Number.MAX_SAFE_INTEGER;
          gs.queuedLevels = 0;
          gs.legendaryRewardPending = true;
          gs.pendingChoices = [{
            id: 'layout-' + choice.id, shortName: choice.title, name: choice.effect,
            desc: choice.desc, max: 1, family: choice.family, rarity: 'legendary',
            kind: 'legendary', legendaryId: choice.id, showProgress: false,
            apply: () => {},
          }];
          gs.awaitingChoice = true;
        }, def);
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
        const report = await page.evaluate(async ({ id, width, height }) => {
          const { visibleTextBounds } = await import('/scripts/visible-text-bounds.js');
          const ui = window.__game.scene.getScene('UI');
          const root = ui.modal;
          const measured = visibleTextBounds(root);
          const textObjects = measured.map(({ object }) => object);
          const bounds = (obj) => {
            const b = obj.getBounds();
            return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
          };
          const intersects = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
          const text = textObjects.find((obj) => obj.text === ui.gs.pendingChoices[0].name);
          const description = textObjects.find((obj) => obj.text === ui.gs.pendingChoices[0].desc);
          const footer = textObjects.find((obj) => obj.text === 'ИЗМЕНИТЬ ПРАВИЛА ЗАБЕГА');
          const plate = text?.parentContainer?.list.find((obj) => obj.type === 'Rectangle' && obj.width > 100 && obj.height <= 44 && Math.abs(obj.y - text.y) < 1);
          const lineCount = text?.getWrappedText(text.text).length ?? null;
          const maxLines = text?.style.maxLines ?? null;
          const effectBounds = text ? bounds(text) : null;
          const overlaps = effectBounds
            ? [
                !description ? 'missing description' : intersects(effectBounds, bounds(description)) ? 'description' : null,
                !footer ? 'missing footer' : intersects(effectBounds, bounds(footer)) ? 'footer' : null,
              ].filter(Boolean)
            : ['missing effect'];
          const overflow = measured
            .filter(({ masked, bounds: b }) => !masked && (b.left < 1 || b.right > width - 1 || b.top < 1 || b.bottom > height - 1))
            .map(({ object, bounds: b }) => ({ text: object.text, bounds: b }));
          return {
            id, width, height, textCount: textObjects.length,
            effect: text ? { text: text.text, linesNeeded: lineCount, maxLines, bounds: effectBounds } : null,
            descriptionBounds: description ? bounds(description) : null,
            footerBounds: footer ? bounds(footer) : null,
            overlaps,
            plate: plate ? bounds(plate) : null,
            overflow,
          };
        }, { ...size, id: def.id });
        reports.push(report);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(reports, null, 2));
  const failures = reports.filter((r) =>
    !r.effect || !r.plate || r.overlaps.length || r.overflow.length ||
    r.effect.linesNeeded > r.effect.maxLines ||
    r.effect.bounds.top < r.plate.top + 1 || r.effect.bounds.bottom > r.plate.bottom - 1
  );
  if (failures.length) {
    console.error(`Legendary layout probe found ${failures.length} failing cases`);
    process.exitCode = 1;
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

// DPR-canvas evidence capture: menu / battle / mutation modal / result.
// Screenshots the canvas element (compositor readback) at deviceScaleFactor 2,
// both renderers, 320x568 and 390x844. Also dumps backing-store metadata per shot.
// Usage: node scripts/dpr-capture.cjs [outDir] [baseUrl]
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.resolve('artifacts/dpr-capture');
const BASE = process.argv[3] || process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5188/';
const DSF = Number(process.env.OFELIYA_DSF || 2);
fs.mkdirSync(OUT, { recursive: true });

const CHOICE = {
  id: 'dpr-capture-choice', shortName: 'ТЕСТ-МУТАЦИЯ', name: '+1 тестовый стек',
  desc: 'dpr capture probe', max: 1, family: 'weapon', rarity: 'standard',
  kind: 'upgrade', showProgress: false, apply() {},
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader'] });
  const meta = [];
  try {
    for (const rendererName of ['webgl', 'canvas']) {
      for (const width of [320, 390]) {
        const height = width === 320 ? 568 : 844;
        const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: DSF });
        await ctx.route('https://st.max.ru/**', r => r.fulfill({ body: '' }));
        await ctx.addInitScript(() => {
          let seed = 7193; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
          localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1, tutorialDone: true }));
          sessionStorage.clear();
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        const tag = `${rendererName}-${width}`;
        const snap = async (name) => {
          const m = await page.evaluate(() => {
            const g = window.__game;
            return {
              canvasWidth: g.canvas.width, canvasHeight: g.canvas.height,
              cssWidth: g.canvas.getBoundingClientRect().width, cssHeight: g.canvas.getBoundingClientRect().height,
              scaleWidth: g.scale.width, scaleHeight: g.scale.height, dpr: window.devicePixelRatio,
            };
          });
          await page.locator('canvas').screenshot({ path: path.join(OUT, `${tag}-${name}.png`), animations: 'disabled', timeout: 120000 });
          meta.push({ tag, name, ...m });
        };

        await page.goto(`${BASE}?renderer=${rendererName}`);
        await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
        await page.evaluate(() => { const m = window.__game.scene.getScene('Menu'); m.tweens.pauseAll(); });
        await snap('menu');

        // Battle: start Game, deterministic pose (same recipe as continuation-capture).
        await page.evaluate(() => { const g = window.__game; g.events.once('step', () => g.scene.getScene('Game').scene.pause()); g.scene.getScene('Menu').scene.start('Game'); });
        await page.waitForFunction(() => window.__game?.scene.isPaused('Game') && window.__game.scene.isActive('UI'));
        await page.evaluate(() => {
          const g = window.__game, gs = g.scene.getScene('Game'), ui = g.scene.getScene('UI');
          const run = { ...g.registry.get('run'), combo: 1000, kills: 99999, bossName: 'CARDIAC TITAN', bossHp: 500, bossMax: 1000 };
          g.registry.set('run', run); ui.update(); ui.tweens.pauseAll();
          gs.atmosphere.update(600, 0, 600, 300000);
          gs.player.preUpdate(600, 0);
          const e = gs.enemies.getChildren()[0]; e.activate(gs, 'swarm', gs.player.x + 70, gs.player.y + 70, { hpScale: 1, dmgScale: 1 }); e.preUpdate(600, 0);
        });
        await snap('battle');

        // Mutation modal.
        await page.evaluate((choice) => {
          const g = window.__game, gs = g.scene.getScene('Game');
          if (g.scene.isPaused('Game')) g.scene.resume('Game');
          gs.queuedLevels = 1; gs.awaitingChoice = true; gs.legendaryRewardPending = false;
          gs.pendingChoices = [{ ...choice, apply() {} }];
        }, { ...CHOICE, apply: undefined });
        await page.waitForFunction(() => {
          const g = window.__game, ui = g.scene.getScene('UI');
          return ui.modalOpen && g.scene.isPaused('Game');
        });
        await page.evaluate(() => window.__game.scene.getScene('UI').tweens.pauseAll());
        await snap('mutation');

        // Result screen (victory report).
        await page.evaluate(() => {
          const g = window.__game, gs = g.scene.getScene('Game'), ui = g.scene.getScene('UI');
          gs.awaitingChoice = false; ui.hideModal();
          gs.finish(true);
        });
        await page.waitForFunction(() => {
          const g = window.__game, ui = g.scene.getScene('UI');
          return ui.modalOpen && g.scene.isPaused('Game');
        }, { timeout: 15000 }).catch(() => {});
        await page.evaluate(() => window.__game.scene.getScene('UI').tweens.pauseAll());
        await snap('result');

        if (errors.length) throw new Error(errors.join('\n'));
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ captures: meta.length, out: OUT }));
})().catch(e => { console.error(e); process.exitCode = 1 });

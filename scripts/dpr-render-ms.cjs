// Render-ms before/after at equal density, deterministic load:
// 200 enemies + boss fixture (recipe from render-density-paired-proof.cjs),
// frozen updates, manual renders, performance.now around each render pass.
// "before"  = main 2bd6320 at DSF=2 with ?renderDensity=2 (experiment density 2)
// "after"   = this branch at DSF=2 plain (dprCanvas density 2 automatic)
// Usage: node scripts/dpr-render-ms.cjs <outJson> [baseUrl] [query]
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.resolve('artifacts/dpr-render-ms.json');
const BASE = process.argv[3] || process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5188/';
const QUERY = process.argv[4] || '';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = {};
  try {
    for (const rendererName of ['webgl', 'canvas']) {
      const DSF = Number(process.env.OFELIYA_DSF || 2);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DSF });
      await ctx.addInitScript(() => {
        let seed = 7193; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1, tutorialDone: true }));
        localStorage.setItem('ofeliya_performance_tier', 'full');
      });
      await ctx.route('https://st.max.ru/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${BASE}?renderer=${rendererName}${QUERY}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 30000 });

      const meta = await page.evaluate(() => {
        const g = window.__game;
        return { canvas: [g.canvas.width, g.canvas.height], scale: [g.scale.width, g.scale.height], dpr: window.devicePixelRatio };
      });

      await page.evaluate(() => {
        const g = window.__game;
        g.registry.set('runSeedOverride', 'dpr-render-ms');
        g.scene.getScene('Game').update = () => {};
        g.scene.getScene('Menu').scene.start('Game');
      });
      await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));

      const fixture = await page.evaluate(() => {
        const g = window.__game, gs = g.scene.getScene('Game'), ui = g.scene.getScene('UI');
        gs.awaitingChoice = false; gs.pendingChoices = []; gs.queuedLevels = 0;
        ui.dismissProgressionForStageBoundary(); gs.physics.world.pause();
        for (const e of gs.enemies.getChildren()) if (e.active) e.deactivateForStageReset();
        for (let i = 0; i < 200; i++) {
          const a = i / 200 * Math.PI * 2, r = 86 + (i % 8) * 27;
          gs.spawnEnemy(['swarm', 'runner', 'brute'][i % 3], gs.player.x + Math.cos(a) * r, gs.player.y + Math.sin(a) * r, i === 7);
        }
        const boss = gs.enemies.get(gs.player.x + 90, gs.player.y - 100);
        boss.activate(gs, 'boss', gs.player.x + 90, gs.player.y - 100, { elite: false, hpScale: 1, dmgScale: 1, speedScale: 1, bossBehavior: 'pressure-wave' });
        gs.wave.boss = boss;
        for (const o of gs.children.list) if (o.active && typeof o.preUpdate === 'function') { o.preUpdate(1000, 0); o.preUpdate = () => {}; }
        gs.tweens.pauseAll(); g.loop.stop();
        gs.registry.set('run', gs.snapshot()); ui.update(1000, 0);
        return { enemies: gs.enemies.getChildren().filter(e => e.active).length };
      });

      // Warmup + measured renders: full pipeline render, timed.
      const timing = await page.evaluate(() => {
        const g = window.__game;
        const render = () => { g.renderer.preRender(); g.scene.render(g.renderer); g.renderer.postRender(); };
        render(); render(); render();
        const times = [];
        for (let i = 0; i < 60; i++) {
          const t0 = performance.now();
          render();
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const avg = times.reduce((s, t) => s + t, 0) / times.length;
        return { avg, p50: times[30], p90: times[54], min: times[0], max: times[59] };
      });

      // qaPerf overlay cross-check (render-ms only; fps label is unreliable per brief).
      const qaPerf = await page.evaluate(() => {
        const g = window.__game, gs = g.scene.getScene('Game');
        if (!gs.qaPerf) return null;
        g.loop.start(g.step.bind(g));
        return new Promise((resolve) => setTimeout(() => {
          const lines = gs.qaPerf.overlay ? gs.qaPerf.overlay.text?.text : null;
          g.loop.stop();
          resolve(lines);
        }, 2500));
      });

      results[rendererName] = { meta, fixture, timing, qaPerf, errors };
      await ctx.close();
    }
  } finally { await browser.close(); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  for (const [k, r] of Object.entries(results)) {
    console.log(k, 'canvas', r.meta.canvas.join('x'), 'density', r.meta.canvas[0] / r.meta.scale[0],
      '| render-ms avg', r.timing.avg.toFixed(2), 'p50', r.timing.p50.toFixed(2), 'p90', r.timing.p90.toFixed(2),
      '| qaPerf:', JSON.stringify(r.qaPerf)?.slice(0, 160), '| errors', r.errors.length);
  }
})().catch(e => { console.error(e); process.exitCode = 1 });

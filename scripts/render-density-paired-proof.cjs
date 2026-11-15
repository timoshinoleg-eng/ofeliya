// Paired density proof for the DPR-aware canvas (PR #282).
//
// The production path now owns framebuffer density (src/platform/dprCanvas.ts:
// backing = CSS x min(devicePixelRatio, 2)). The QA-only RenderDensityExperiment
// must NOT be stacked on top of it: in Canvas the two call-through resize
// wrappers fight (dprCanvas is innermost and wins, so the experiment's quality
// fallback cannot drop the buffer to 1x); in WebGL the double-wrapped
// viewport/scissor would scale GL calls 4x. The experiment is therefore retired
// from this proof; density is verified against the real configuration instead:
//
//   DSF=1 context -> dprCanvas passthrough (1x baseline)
//   DSF=2 context -> dprCanvas 2x
//   Logical geometry (camera + text bounds) must be IDENTICAL across the pair;
//   only the backing store differs (exactly 2x). Input, resize, quality and
//   large-viewport behaviour are verified in the 2x phase.
//
// Quality contract (new): density is DPR-driven only. Changing runtimeQuality
// or performanceTier must NOT change the backing store. There is no 4M pixel
// cap in dprCanvas (the cap was an experiment feature); at 1100x1000 CSS the
// backing is 2200x2000 by design.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5188/';
const dir = process.env.OFELIYA_DENSITY_DIR || path.resolve('artifacts/density-experiment');
fs.mkdirSync(dir, { recursive: true });

async function openGame(browser, renderer, dpr) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr });
  await context.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_performance_tier', 'full');
  });
  await context.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?renderer=' + renderer, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });
  return { context, page, errors };
}

// Logical geometry only: text CONTENT is excluded (the HUD timer freezes at
// different values across contexts, and the QA PERF overlay prints timings);
// bounds + resolution + line count are what density must preserve.
const geometry = (page) => page.evaluate(() => {
  const game = window.__game;
  const flatten = (objects) => objects.flatMap((o) => {
    let own = [];
    if (o.visible && o.alpha > 0) {
      if (o.type === 'Text') own.push({ bounds: o.getBounds(), resolution: o.style.resolution, lines: o.getWrappedText ? o.getWrappedText(o.text).length : 1 });
      if (o.type === 'Container') own.push(...flatten(o.list));
    }
    return own;
  });
  return {
    logical: [game.scale.width, game.scale.height],
    backing: [game.canvas.width, game.canvas.height],
    scale: [game.scale.displayScale.x, game.scale.displayScale.y],
    scenes: game.scene.getScenes(true).map((s) => ({
      key: s.scene.key,
      camera: [s.cameras.main.x, s.cameras.main.y, s.cameras.main.width, s.cameras.main.height, s.cameras.main.zoom],
      texts: flatten(s.children.list),
    })),
  };
});
const render = (page) => page.evaluate(() => {
  const g = window.__game;
  g.renderer.preRender(); g.scene.render(g.renderer); g.renderer.postRender();
});
const simplify = (o) => ({ logical: o.logical, scale: o.scale, scenes: o.scenes });

// Compares two geometries with a per-line tolerance on text y/height only.
// The browser measures every text line ~1px taller/shorter at DSF=2 than at
// DSF=1 (verified on clean main 2bd6320, without dprCanvas: same 5 menu texts,
// same deltas) — a font-metrics artifact of the device pixel ratio, not a
// layout change. It accumulates over lines: the 9-line QA PERF overlay differs
// by 9px in height. So the height tolerance is 2.5px per line (observed max
// 2px/line) and the y tolerance half of that (origin-0.5 centering); the line
// count itself must match exactly. x/width, logical size, scale, camera, text
// count and resolution must still match exactly; a real layout shift is 5px+.
function geometryDiff(a, b) {
  if (JSON.stringify({ logical: a.logical, scale: a.scale }) !== JSON.stringify({ logical: b.logical, scale: b.scale })) return 'logical size/scale';
  if (a.scenes.length !== b.scenes.length) return 'scene count';
  for (let i = 0; i < a.scenes.length; i++) {
    const sa = a.scenes[i], sb = b.scenes[i];
    if (sa.key !== sb.key) return 'scene key ' + sa.key;
    if (JSON.stringify(sa.camera) !== JSON.stringify(sb.camera)) return 'camera ' + sa.key;
    if (sa.texts.length !== sb.texts.length) return 'text count ' + sa.key + ' (' + sa.texts.length + ' vs ' + sb.texts.length + ')';
    for (let j = 0; j < sa.texts.length; j++) {
      const ta = sa.texts[j], tb = sb.texts[j];
      if (ta.resolution !== tb.resolution) return 'text[' + j + '] resolution ' + sa.key;
      if (ta.lines !== tb.lines) return 'text[' + j + '] lines ' + sa.key + ' (' + ta.lines + ' vs ' + tb.lines + ')';
      const ba = ta.bounds, bb = tb.bounds;
      if (ba.x !== bb.x || ba.width !== bb.width) return 'text[' + j + '] x/width ' + sa.key + ' (' + ba.x + ',' + ba.width + ' vs ' + bb.x + ',' + bb.width + ')';
      if (Math.abs(ba.y - bb.y) > 1.25 * ta.lines || Math.abs(ba.height - bb.height) > 2.5 * ta.lines) return 'text[' + j + '] y/height ' + sa.key + ' (' + ba.y + ',' + ba.height + ' vs ' + bb.y + ',' + bb.height + ', lines ' + ta.lines + ')';
    }
  }
  return null;
}

// 200 enemies + CARDIAC TITAN boss fixture, frozen (same recipe as before).
async function denseFixture(page) {
  await page.evaluate(() => {
    const g = window.__game;
    g.registry.set('runSeedOverride', 'hidpi-proof');
    g.scene.getScene('Game').update = () => {};
    g.scene.getScene('Menu').scene.start('Game');
    g.loop.start(g.step.bind(g));
  });
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
  const fixture = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('Game'), ui = g.scene.getScene('UI');
    gs.awaitingChoice = false; gs.pendingChoices = []; gs.queuedLevels = 0;
    ui.dismissProgressionForStageBoundary();
    gs.physics.world.pause();
    for (const e of gs.enemies.getChildren()) if (e.active) e.deactivateForStageReset();
    for (let i = 0; i < 200; i++) {
      const a = i / 200 * Math.PI * 2, r = 86 + (i % 8) * 27;
      gs.spawnEnemy(['swarm', 'runner', 'brute'][i % 3], gs.player.x + Math.cos(a) * r, gs.player.y + Math.sin(a) * r, i === 7);
    }
    const boss = gs.enemies.get(gs.player.x + 90, gs.player.y - 100);
    boss.activate(gs, 'boss', gs.player.x + 90, gs.player.y - 100, { elite: false, hpScale: 1, dmgScale: 1, speedScale: 1, bossBehavior: 'pressure-wave' });
    gs.wave.boss = boss;
    for (const o of gs.children.list) if (o.active && typeof o.preUpdate === 'function') { o.preUpdate(1000, 0); o.preUpdate = () => {}; }
    gs.tweens.pauseAll();
    g.loop.stop();
    gs.registry.set('run', gs.snapshot());
    ui.update(1000, 0);
    return { enemies: gs.enemies.getChildren().filter((e) => e.active).length, uiBlocked: ui.uiBlocked, boss: boss.hp, bossBarVisible: ui.bossBack.visible, bossFillCommands: ui.bossFill.commandBuffer.length };
  });
  return fixture;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const rows = [];
  try {
    for (const renderer of ['webgl', 'canvas']) {
      // Phase A: DSF=1, dprCanvas passthrough (1x baseline).
      const a = await openGame(browser, renderer, 1);
      await a.page.evaluate(() => window.__game.loop.stop());
      await render(a.page);
      const menu1 = await geometry(a.page);
      await a.page.locator('#game canvas').screenshot({ path: path.join(dir, renderer + '-menu-1x.png') });
      const fixture1 = await denseFixture(a.page);
      await render(a.page);
      const game1 = await geometry(a.page);
      await a.page.locator('#game canvas').screenshot({ path: path.join(dir, renderer + '-game-1x.png') });
      const errorsA = a.errors;
      await a.context.close();

      // Phase B: DSF=2, dprCanvas 2x.
      const b = await openGame(browser, renderer, 2);
      await b.page.evaluate(() => window.__game.loop.stop());
      await render(b.page);
      const menu2 = await geometry(b.page);
      await b.page.locator('#game canvas').screenshot({ path: path.join(dir, renderer + '-menu-2x.png') });
      const fixture2 = await denseFixture(b.page);
      await render(b.page);
      const game2 = await geometry(b.page);
      await b.page.locator('#game canvas').screenshot({ path: path.join(dir, renderer + '-game-2x.png') });

      // 1x vs 2x: logical geometry identical (within font-measurement noise),
      // backing exactly 2x.
      for (const [name, one, two] of [['menu', menu1, menu2], ['game', game1, game2]]) {
        const diff = geometryDiff(simplify(one), simplify(two));
        if (diff) throw new Error(renderer + ' ' + name + ' logical geometry changed between DSF=1 and DSF=2: ' + diff);
      }
      if (menu1.backing[0] !== 390 || menu1.backing[1] !== 844) throw new Error('DSF=1 baseline must be 1x ' + JSON.stringify(menu1.backing));
      if (game2.backing[0] !== 780 || game2.backing[1] !== 1688) throw new Error('paired density2 backing failed ' + JSON.stringify(game2.backing));

      // Real pointer input at DSF=2 must hit the exact CSS point.
      await b.page.evaluate(() => {
        const g = window.__game;
        g.scene.getScene('UI').add.rectangle(100, 200, 30, 30, 0xff00ff).setName('density-input-probe').setInteractive().setDepth(1000).on('pointerdown', (p) => window.__densityHit = { x: p.x, y: p.y });
        g.loop.start(g.step.bind(g));
      });
      // setInteractive queues insertion; await the real scene preUpdate before issuing DOM input.
      await b.page.waitForFunction(() => window.__game.scene.getScene('UI').input._list.some((o) => o.name === 'density-input-probe' && o.input.enabled));
      // Keep the physical press down until Phaser reports the hit, even under slow CI Canvas frames.
      await b.page.mouse.move(100, 200);
      await b.page.mouse.down();
      await b.page.waitForFunction(() => Boolean(window.__densityHit));
      await b.page.mouse.up();
      const rafTimes = await b.page.evaluate(() => new Promise((resolve) => {
        const gaps = []; let last = performance.now();
        const step = (now) => { gaps.push(now - last); last = now; if (gaps.length === 90) resolve(gaps); else requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }));
      const input = await b.page.evaluate(() => {
        const g = window.__game; g.loop.stop();
        return { css: [g.scale.transformX(100), g.scale.transformY(200)], hit: window.__densityHit };
      });
      if (!input.hit || input.hit.x !== 100 || input.hit.y !== 200) throw new Error(renderer + ' real input target failed ' + JSON.stringify(input));

      // Resize at DSF=2: backing tracks CSS x 2.
      await b.page.setViewportSize({ width: 390, height: 800 });
      await b.page.evaluate(async () => { window.dispatchEvent(new Event('resize')); await window.__viewportManager.sync(); });
      await b.page.waitForFunction(() => window.__game.scale.width === 390 && window.__game.scale.height === 800);
      await b.page.evaluate(() => {
        const g = window.__game;
        g.registry.set('runtimeQuality', { level: 'full' });
        g.scale.resize(390, 800); g.scale.resize(390, 800);
      });
      await render(b.page);
      const resized = await geometry(b.page);
      await b.page.locator('#game canvas').screenshot({ path: path.join(dir, renderer + '-resize-2x.png') });
      if (resized.backing[0] !== 780 || resized.backing[1] !== 1600) throw new Error('physical resize failed ' + JSON.stringify(resized));

      // Quality contract (new): density is DPR-driven only; quality changes
      // must NOT change the backing store.
      await b.page.evaluate(() => window.__game.registry.set('runtimeQuality', { level: 'low' }));
      const reduced = await geometry(b.page);
      if (reduced.backing[0] !== 780 || reduced.backing[1] !== 1600) throw new Error('quality change must not alter DPR density ' + JSON.stringify(reduced.backing));
      await b.page.evaluate(() => window.__game.registry.set('runtimeQuality', { level: 'full' }));
      await b.page.evaluate(() => window.__game.registry.set('performanceTier', 'reduced'));
      const staticReduced = await geometry(b.page);
      if (staticReduced.backing[0] !== 780 || staticReduced.backing[1] !== 1600) throw new Error('performanceTier must not alter DPR density ' + JSON.stringify(staticReduced.backing));
      await b.page.evaluate(() => {
        window.__game.registry.set('performanceTier', 'full');
        window.__game.registry.set('runtimeQuality', { level: 'full' });
      });

      // Large viewport: dprCanvas has no 4M pixel cap (that was an experiment
      // feature); backing is CSS x 2 by design.
      // RESIZE mode follows actual host bounds; establish a larger host before testing.
      await b.page.setViewportSize({ width: 1100, height: 1000 });
      await b.page.evaluate(async () => { await window.__viewportManager.sync(); });
      await b.page.waitForFunction(() => window.__game.scale.width === 1100 && window.__game.scale.height === 1000);
      await b.page.evaluate(() => { window.__game.scale.resize(1100, 1000); });
      const large = await geometry(b.page);
      if (large.backing[0] !== 2200 || large.backing[1] !== 2000) throw new Error('large viewport backing failed ' + JSON.stringify({ logical: large.logical, backing: large.backing }));

      const errors = [...errorsA, ...b.errors];
      if (errors.length) throw new Error('page errors ' + errors.join('\n'));
      rows.push({ renderer, fixture: fixture2, fixture1, menu1, menu2, game1, game2, input, resized, reduced, staticReduced, large, rafTimes, note: 'SwiftShader headless RAF intervals, not phone game FPS/thermals', errors });
      await b.context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(rows, null, 2));
  console.log('PASS actual OFELIYA paired menu/game Text+camera geometry, 200 enemies+boss, repeated resize. ' + dir);
})().catch((e) => { console.error(e); process.exit(1); });

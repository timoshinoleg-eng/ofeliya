const fs = require('fs');
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome && process.platform !== 'win32') throw new Error('Chrome not found');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openRenderer(browser, renderer, dpr) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: dpr,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    sessionStorage.clear(); localStorage.setItem('ofeliya_performance_tier', 'full');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-renderer-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'QA', last_name: 'Renderer' } },
      getViewportSize: async () => ({ width: String(innerWidth), height: String(innerHeight) }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${process.env.OFELIYA_URL || 'http://127.0.0.1:5173/'}?renderer=${renderer}&renderDensity=2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await sleep(250);

  assert.equal(await page.evaluate(() => typeof window.__renderSnapshot), 'function', 'QA render snapshot hook must be callable');
  const samples = [];
  const density = dpr >= 2 ? 2 : 1;
  async function sample(phase) {
    const snapshot = await page.evaluate(() => {
      const game = window.__game;
      const before = [game.canvas.width, game.canvas.height, game.input.activePointer.x, game.input.activePointer.y];
      const first = window.__renderSnapshot();
      const second = window.__renderSnapshot();
      const after = [game.canvas.width, game.canvas.height, game.input.activePointer.x, game.input.activePointer.y];
      if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error('snapshot must be read-only and detached');
      }
      first.canvas.intrinsic.width = -1;
      if (window.__renderSnapshot().canvas.intrinsic.width === -1) throw new Error('snapshot aliases live state');
      return second;
    });
    assert.equal(snapshot.dpr, dpr);
    const { width, height } = snapshot.host;
    // Explicit2x QA probe preserves logical sizes while validating physical framebuffer.
    assert.deepEqual(snapshot.canvas.intrinsic, { width: width * density, height: height * density });
    assert.equal(snapshot.canvas.bounds.width, width);
    assert.equal(snapshot.canvas.bounds.height, height);
    for (const size of [snapshot.renderer.size, snapshot.scale.gameSize, snapshot.scale.baseSize, snapshot.scale.displaySize]) {
      assert.deepEqual(size, { width, height });
    }
    assert.deepEqual(snapshot.scale.displayScale, { x: 1, y: 1 });
    if (renderer === 'webgl') {
      assert.deepEqual(snapshot.renderer.gl.drawingBuffer, { width: width * density, height: height * density });
      assert.deepEqual(snapshot.renderer.gl.viewport, [0, 0, width * density, height * density]);
    } else assert.equal(snapshot.renderer.gl, null);
    for (const scene of snapshot.scenes.filter((s) => s.active)) {
      assert.equal(scene.camera.width, width);
      assert.equal(scene.camera.height, height);
      assert.ok(scene.texts.length <= 4);
      for (const text of scene.texts) {
        assert.ok(text.bounds.width > 0 && text.bounds.height > 0);
        assert.ok(text.sourceResolution > 0, 'texture source resolution must be reported independently');
        if (renderer === 'canvas') assert.equal(text.resolution, 1);
        assert.equal('text' in text, false, 'snapshot must not expose text content');
      }
    }
    for (const [x, y] of [[2, 2], [width / 2, height / 2], [width - 2, height - 2]]) {
      await page.mouse.move(snapshot.canvas.bounds.x + x, snapshot.canvas.bounds.y + y);
      const point = await page.evaluate(() => {
        const game = window.__game;
        const p = game.input.activePointer;
        const camera = game.scene.getScene(game.scene.isActive('Menu') ? 'Menu' : 'Game').cameras.main;
        const world = camera.getWorldPoint(p.x, p.y);
        return { x: p.x, y: p.y, worldX: world.x, worldY: world.y,
          expectedX: camera.scrollX + camera.width / 2 + (p.x - camera.width / 2) / camera.zoom,
          expectedY: camera.scrollY + camera.height / 2 + (p.y - camera.height / 2) / camera.zoom };
      });
      assert.ok(Math.abs(point.x - x) < 1 && Math.abs(point.y - y) < 1, JSON.stringify(point));
      assert.ok(Math.abs(point.worldX - point.expectedX) < 1 && Math.abs(point.worldY - point.expectedY) < 1, JSON.stringify({ phase, point }));
    }
    samples.push({ phase, snapshot });
  }
  await sample('menu');

  const state = await page.evaluate(() => {
    const game = window.__game;
    const menu = game.scene.getScene('Menu');
    const title = menu.children.list.find((obj) => obj.text === 'OFELIYA');
    const titleResolution = title?.style?.resolution ?? title?.resolution ?? null;
    return {
      renderer: game.renderer?.constructor?.name ?? '',
      rendererType: game.renderer?.type ?? null,
      titleResolution,
      titleTextureWidth: title?.texture?.source?.[0]?.width ?? null,
      titleDisplayWidth: title?.displayWidth ?? null,
      canvas: [game.canvas.width, game.canvas.height],
      css: [game.canvas.clientWidth, game.canvas.clientHeight],
      dpr: window.devicePixelRatio,
    };
  });

  if (renderer === 'webgl') {
    // Phaser 3.90 constants: WEBGL=2, CANVAS=1; constructor names are minified.
    if (state.rendererType !== 2) {
      throw new Error(`WebGL path did not boot WebGL: ${JSON.stringify(state)}`);
    }
    if (state.titleResolution === null || state.titleResolution < 2) {
      throw new Error(`High-DPI WebGL text lost resolution: ${JSON.stringify(state)}`);
    }
  } else {
    if (state.rendererType !== 1) {
      throw new Error(`Canvas fallback did not boot Canvas: ${JSON.stringify(state)}`);
    }
    if (state.titleResolution !== 1) {
      throw new Error(`Canvas fallback text must stay resolution=1: ${JSON.stringify(state)}`);
    }
  }

  if (errors.length) throw new Error(`${renderer} page errors: ${errors.join(' | ')}`);

  await page.evaluate(() => {
    const game = window.__game;
    // Fixture-only: retain progression freeze for this entire QA context. Phaser captures
    // update before CREATE; restoring it later would invalidate the control-smoke isolation.
    // Game/resize/resume samples certify dimensions/input only, not live progression.
    game.scene.getScene('Game').update = () => {};
    game.scene.getScene('Menu').scene.start('Game');
  });
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
  await page.evaluate(() => {
    const game = window.__game;
    const ui = game.scene.getScene('UI');
    if (ui.uiBlocked || ui.modalOpen) throw new Error('fixture must be unblocked');
    const scene = game.scene.getScene('Game');
    scene.physics.pause(); // isolate camera/input checks from live collision shake
    const text = scene.add.text(10, 10, 'QA nested').setResolution(2);
    const container = scene.add.container(0, 0, [text]);
    scene.children.sendToBack(container);
    try {
      const nested = window.__renderSnapshot().scenes.find((s) => s.key === 'Game').texts[0];
      // Phaser 3.90 CANVAS=1; WebGL text retains the requested resolution=2.
      if (!nested || nested.resolution !== (game.renderer.type === 1 ? 1 : 2)) throw new Error('nested Text Canvas guard sample missing');
    } finally { container.destroy(); text.destroy(); }
  });
  await sample('game');
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 412, height: 915 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForFunction(({ width, height }) => window.__game.scale.width === width && window.__game.scale.height === height, viewport);
    await sleep(250);
    await sample('resize');
  }
  await page.evaluate(() => {
    window.__game.scene.pause('Game');
    window.__game.scene.resume('Game');
    // Already-visible handler dispatch; does not emulate hidden -> visible or OS resume.
    if (document.visibilityState !== 'visible') throw new Error('visible handler fixture required');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(250);
  await sample('resume');
  if (errors.length) throw new Error(`${renderer} page errors: ${errors.join(' | ')}`);

  const artifacts = process.env.OFELIYA_ARTIFACTS || join(tmpdir(), 'browser-smoke');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(`${artifacts}/render-${renderer}-dpr${dpr}.json`, JSON.stringify(samples, null, 2));
  await page.locator('#game').screenshot({
    path: `${artifacts}/render-${renderer}-dpr${dpr}.png`,
  });
  // Exercise real Game destruction: ScaleManager's earlier listener destroys logical sizes.
  await page.evaluate(() => window.__game.destroy(true));
  await page.waitForFunction(() => !document.querySelector('#game canvas'));
  if (errors.length) throw new Error(`${renderer} teardown errors: ${errors.join(' | ')}`);
  await ctx.close();
  return state;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome || undefined,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
    ],
  });

  try {
    for (const dpr of [1, 2, 3]) for (const renderer of ['webgl', 'canvas']) {
      await openRenderer(browser, renderer, dpr);
      console.log(`Density experiment smoke: ${renderer} DPR${dpr} ok`);
    }
  } finally { await browser.close(); }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

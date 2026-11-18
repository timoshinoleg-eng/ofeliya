// HUD texture-upload probe for the perf/hud-text-guards work (PR #301).
//
// Measures Phaser text texture uploads per frame by wrapping
// texImage2D/texSubImage2D on WebGL(2) contexts before page scripts run
// (addInitScript), sampling upload counts once per requestAnimationFrame tick.
// Paired runs (base vs guarded, HUD visible vs hidden) use the identical probe.
//
// Usage:
//   node scripts/hud-text-upload-probe.cjs --url http://127.0.0.1:4173/ \
//     --label guarded-visible [--hud hidden] [--viewport 390x844] \
//     [--frames 240] [--skip 20] [--trace-settext] [--no-kills] [--out result.json]
//
// The run starts via scripts/lib/combat-fixture.cjs (mechanic-only fixture:
// xpNext=1_000_000, no mutation modal). --hud hidden applies
// UIScene.setQaHudHidden(true) right after the run starts. --trace-settext
// additionally counts Phaser Text.setText calls by resulting string during the
// sampled window (logical writes; a new Text object also uploads on first
// render even without setText). --no-kills is a measurement-only runtime
// control: Enemy.takeDamage is patched to a no-op so no damage numbers or kill
// counters are produced. Neither flag changes any committed game code.
//
// These are headless Chromium + SwiftShader counters, not phone render ms.

const fs = require('fs');
const path = require('path');
const { chromium } = process.platform === 'win32' ? require('playwright') : require('playwright-core');

const chrome = process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (process.platform !== 'win32' && !chrome) throw new Error('Chrome not found');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const url = arg('url', process.env.OFELIYA_URL || 'http://127.0.0.1:4173/');
const label = arg('label', 'probe');
const hud = arg('hud', 'visible');
const [vw, vh] = String(arg('viewport', '390x844')).split('x').map(Number);
const FRAMES = Number(arg('frames', '240'));
const SKIP = Number(arg('skip', '20'));
const out = arg('out', null);
const traceSetText = flag('trace-settext');
const noKills = flag('no-kills');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--disable-gpu', ...(process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'])],
  });
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
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
      initDataUnsafe: { user: { id: 42, first_name: 'QA', last_name: 'Carrier' } },
      getViewportSize: async () => ({ width: '360', height: '760' }),
      shareMaxContent: async (params) => { window.__shared = params; },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
    // Texture-upload counters: wrap texImage2D/texSubImage2D on both WebGL
    // context prototypes, then sample the counter once per animation frame.
    window.__texFrames = [];
    let uploads = 0;
    const wrap = (proto) => {
      if (!proto) return;
      for (const name of ['texImage2D', 'texSubImage2D']) {
        const original = proto[name];
        if (typeof original !== 'function' || original.__texWrapped) continue;
        const wrapped = function (...args) {
          uploads += 1;
          return original.apply(this, args);
        };
        wrapped.__texWrapped = true;
        proto[name] = wrapped;
      }
    };
    wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    const sample = () => {
      window.__texFrames.push(uploads);
      uploads = 0;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));

  // Start the combat fixture run (Menu -> Game, xpNext isolated).
  const { startCombatFixture } = require('./lib/combat-fixture.cjs');
  await startCombatFixture(page);
  await page.waitForFunction(() =>
    (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')) &&
    window.__game.scene.isActive('UI') &&
    window.__game.scene.getScene('Game').__combatFixture?.applied
  );

  if (hud === 'hidden') {
    await page.evaluate(() => window.__game.scene.getScene('UI').setQaHudHidden(true));
  }

  if (noKills) {
    // Measurement-only control: no damage numbers / no kill counter growth.
    await page.waitForFunction(() => {
      const gs = window.__game.scene.getScene('Game');
      const alive = gs.enemies?.getChildren?.().find((e) => e?.active);
      if (!alive) return false;
      const proto = Object.getPrototypeOf(alive);
      if (!proto.takeDamage.__noKillPatched) {
        const original = proto.takeDamage;
        const patched = function () { return 0; };
        patched.__noKillPatched = true;
        proto.takeDamage = patched;
        void original;
      }
      return true;
    }, { timeout: 30000 });
  }

  if (traceSetText) {
    await page.evaluate(() => {
      const ui = window.__game.scene.getScene('UI');
      const proto = Object.getPrototypeOf(ui.timerText); // Phaser.GameObjects.Text.prototype
      if (proto.setText.__tracePatched) return;
      window.__setTextCalls = {};
      const original = proto.setText;
      const patched = function (value) {
        const key = String(typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 48);
        window.__setTextCalls[key] = (window.__setTextCalls[key] || 0) + 1;
        return original.call(this, value);
      };
      patched.__tracePatched = true;
      proto.setText = patched;
    });
  }

  // Reset the sampler and collect the requested window of frames.
  await page.evaluate(() => { window.__texFrames = []; });
  await page.waitForFunction(
    (n) => window.__texFrames.length >= n,
    FRAMES + SKIP,
    { timeout: 180000 }
  );

  const renderer = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas') || document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const frames = await page.evaluate((n) => window.__texFrames.slice(0, n), FRAMES + SKIP);
  const sample = frames.slice(SKIP);
  const sorted = [...sample].sort((a, b) => a - b);
  const total = sample.reduce((a, b) => a + b, 0);
  const setTextTrace = traceSetText
    ? await page.evaluate(() => window.__setTextCalls || {})
    : undefined;

  const result = {
    label,
    url,
    viewport: [vw, vh],
    hud,
    frames: sample.length,
    skip: SKIP,
    renderer,
    mean: Number((total / sample.length).toFixed(3)),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    total,
    perFrame: sample,
    ...(noKills ? { control: 'no-kills' } : {}),
    ...(setTextTrace ? { setTextTrace } : {}),
    pageErrors: errors,
  };
  await browser.close();

  const line = `${label}: mean=${result.mean} p50=${result.p50} p95=${result.p95} total=${result.total} ` +
    `frames=${result.frames} renderer=${renderer} errors=${errors.length}`;
  console.log(line);
  if (errors.length) console.error('page errors:', errors.join(' | '));
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
  }
  if (errors.length) process.exit(2);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

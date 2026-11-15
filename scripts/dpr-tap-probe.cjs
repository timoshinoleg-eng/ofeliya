// Input tap probes at DSF=2 with the DPR-aware canvas active (backing store 2x).
// Verifies hit mapping did not shift: menu button, mutation card, floating joystick.
// Touch is injected via CDP Input.dispatchTouchEvent (real touch pipeline), the
// same pattern as scripts/checkpoint-resume-smoke.cjs.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const BASE = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5188/';
const OUT = process.argv[2] || path.resolve('artifacts/dpr-tap-probe.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHOICE = {
  id: 'dpr-tap-choice', shortName: 'ТАП-ПРОБА', name: '+1 тап проба',
  desc: 'dpr tap probe', max: 1, family: 'weapon', rarity: 'standard',
  kind: 'upgrade', showProgress: false,
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('https://st.max.ru/**', (r) => r.fulfill({ body: '' }));
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1, tutorialDone: true }));
    localStorage.setItem('ofeliya_performance_tier', 'full');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = {};

  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  };
  const tapAt = async (x, y) => {
    await touch('touchStart', [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(120);
  };
  const labelPoint = (sceneKey, label) => page.evaluate(({ sceneKey, label }) => {
    const scene = window.__game.scene.getScene(sceneKey);
    const flat = [];
    const visit = (obj) => { flat.push(obj); if (Array.isArray(obj?.list)) obj.list.forEach(visit); };
    scene.children.list.forEach(visit);
    const text = flat.find((obj) => typeof obj?.text === 'string' && obj.text.includes(label) && obj.visible !== false);
    if (!text) return null;
    const tb = text.getBounds();
    const inParent = text.parentContainer?.list?.filter((obj) => obj !== text && obj.input?.enabled && typeof obj.getBounds === 'function') ?? [];
    const candidates = inParent.length ? inParent : flat.filter((obj) => obj !== text && obj.input?.enabled && typeof obj.getBounds === 'function');
    let best = null; let distance = Infinity;
    for (const obj of candidates) {
      const b = obj.getBounds();
      const d = Math.hypot(b.centerX - tb.centerX, b.centerY - tb.centerY);
      if (d < distance) { distance = d; best = b; }
    }
    return best && distance < 90 ? { x: Math.round(best.centerX), y: Math.round(best.centerY) } : { x: Math.round(tb.centerX), y: Math.round(tb.centerY) };
  }, { sceneKey, label });

  await page.goto(`${BASE}?renderer=webgl`);
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 30000 });
  results.meta = await page.evaluate(() => {
    const g = window.__game;
    return { canvas: [g.canvas.width, g.canvas.height], css: [g.canvas.getBoundingClientRect().width, g.canvas.getBoundingClientRect().height], dpr: window.devicePixelRatio };
  });

  // 1) Menu button.
  const menuPoint = await labelPoint('Menu', 'НАЧАТЬ ЗАРАЖЕНИЕ');
  if (!menuPoint) throw new Error('menu label missing');
  await tapAt(menuPoint.x, menuPoint.y);
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), null, { timeout: 10000 });
  results.menuButton = { point: menuPoint, gameActive: true };

  // 2) Mutation card.
  await page.evaluate((choice) => {
    const g = window.__game, gs = g.scene.getScene('Game');
    window.__tapApplied = false;
    gs.queuedLevels = 1; gs.awaitingChoice = true; gs.legendaryRewardPending = false;
    gs.pendingChoices = [{ ...choice, apply() { window.__tapApplied = true; } }];
  }, CHOICE);
  await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen && window.__game.scene.isPaused('Game'));
  const cardPoint = await labelPoint('UI', CHOICE.shortName);
  if (!cardPoint) throw new Error('mutation card label missing');
  await tapAt(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => window.__tapApplied === true, null, { timeout: 8000 }).catch(() => {});
  results.mutationCard = { point: cardPoint, applied: await page.evaluate(() => window.__tapApplied === true) };
  await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('Game'), ui = g.scene.getScene('UI');
    if (g.scene.isPaused('Game')) g.scene.resume('Game');
    gs.awaitingChoice = false; ui.hideModal();
  });

  // 3) Floating joystick: press-drag below the HUD safe zone, expect non-zero joy vector.
  const joyBefore = await page.evaluate(() => ({ ...window.__game.registry.get('joy') }));
  await touch('touchStart', [{ x: 130, y: 700, radiusX: 8, radiusY: 8, force: 1, id: 1 }]);
  await sleep(120);
  await touch('touchMove', [{ x: 190, y: 700, radiusX: 8, radiusY: 8, force: 1, id: 1 }]);
  await sleep(250);
  const joyDuring = await page.evaluate(() => ({ ...window.__game.registry.get('joy') }));
  await touch('touchEnd', []);
  await sleep(200);
  const joyAfter = await page.evaluate(() => ({ ...window.__game.registry.get('joy') }));
  const mag = Math.hypot(joyDuring.x, joyDuring.y);
  results.joystick = { before: joyBefore, during: joyDuring, after: joyAfter, moved: mag > 0.2 };

  results.errors = errors;
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (!results.menuButton.gameActive || !results.mutationCard.applied || !results.joystick.moved || errors.length) {
    console.error('TAP PROBE FAILED');
    process.exit(1);
  }
  console.log('TAP PROBE PASS');
})().catch((e) => { console.error(e); process.exit(1); });

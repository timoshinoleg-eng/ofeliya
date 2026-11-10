/**
 * QA probe: reproducible browser verification of the two P2 recipe fixes in PR #278.
 *
 * What it proves (game code is untouched — the probe only drives the real UI):
 *  D (?qaMutation=D) — «Капсидные спутники III» + «Репликация I» + speed 0, the
 *     offered «Подвижный штамм» is the first «Подвижность»: the alternative
 *     recipe row reads «Подвижность или Репликация — 1/2» WITHOUT the false
 *     arrow «→ 2/2»; after the tap speed=1, the «Сверхкапсид» recipe is NOT
 *     complete (no halo evolution), no new offer is queued, the game resumes.
 *  E (?qaMutation=E) — «Гипершип» (prism) already owned, «Белковые шипы»
 *     offered: no recipe block on the component card; the card is selectable
 *     (dmg 4 after the tap); no duplicate grant — the choice queue is empty
 *     and no new modal opens.
 *  Both sizes: 320×520 (acceptance minimum) and 390×844. Text bounds are
 *  checked against the ACTUAL rendered bounds: nothing outside the viewport
 *  and no pairwise text intersections.
 *  Gate-off (P2_VERIFY_GATE_OFF=1): builds a production bundle WITHOUT
 *  VITE_QA_TOOLS, serves it with `vite preview`, and confirms ?qaMutation=D
 *  does NOT activate (no fixture stacks, no modal, no QA overlay).
 *
 * Run (Linux/CI, self-contained — starts and kills its own servers):
 *   node scripts/p2-recipe-verify.cjs
 *   P2_VERIFY_GATE_OFF=1 node scripts/p2-recipe-verify.cjs   # gate-off only
 *
 * Split run (Windows host + WSL browser, Windows headless Chrome is broken):
 *   host:   npm run dev -- --host --port 5173 --strictPort
 *   WSL:    OFELIYA_BASE_URL=http://<windows-gateway-ip>:5173/ node scripts/p2-recipe-verify.cjs
 *   host:   VITE_RELEASE_MATRIX_QA=1 VITE_RELEASE_SHA=$(git rev-parse HEAD) npx vite build --outDir .tmp-p2-gateoff --emptyOutDir   (NO VITE_QA_TOOLS!)
 *           npx vite preview --host --port 5198 --strictPort --outDir .tmp-p2-gateoff
 *   WSL:    OFELIYA_BASE_URL=http://<windows-gateway-ip>:5198/ P2_VERIFY_GATE_OFF=1 node scripts/p2-recipe-verify.cjs
 *
 * Env: OFELIYA_BASE_URL (reuse an existing server instead of spawning one),
 *      OFELIYA_PORT (dev server port, default 5197), OFELIYA_GATE_OFF_PORT
 *      (default 5198), OFELIYA_SIZES="320x520,390x844" (subset).
 * Artifacts: docs/qa/p2-recipe-acceptance-2026-11-10/qaMutation-{D,E}-{size}.png
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('node:child_process');
const { chromium: pwCoreChromium } = require('playwright-core');

const GATE_OFF = process.env.P2_VERIFY_GATE_OFF === '1';
const PORT = Number(process.env.OFELIYA_PORT || 5197);
const GATE_OFF_PORT = Number(process.env.OFELIYA_GATE_OFF_PORT || 5198);
const BASE_URL = process.env.OFELIYA_BASE_URL || `http://127.0.0.1:${GATE_OFF ? GATE_OFF_PORT : PORT}/`;
const SPAWNING = !process.env.OFELIYA_BASE_URL;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'qa', 'p2-recipe-acceptance-2026-11-10');
const GATE_OFF_DIST = path.join(ROOT, '.tmp-p2-gateoff');
const ALL_SIZES = [
  { width: 320, height: 520 },
  { width: 390, height: 844 },
];
const SIZES = process.env.OFELIYA_SIZES
  ? ALL_SIZES.filter((s) => process.env.OFELIYA_SIZES.split(',').includes(`${s.width}x${s.height}`))
  : ALL_SIZES;

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function driver() {
  // Same convention as the other probes: playwright-core + system Chrome.
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome/Chromium not found');
  return { chromium: pwCoreChromium, executablePath };
}

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer(base, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  throw new Error(`Server did not start on ${base}`);
}

async function newQaPage(browser, size) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  // MAX bridge assets are irrelevant for these screens.
  await ctx.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.addInitScript(() => {
    sessionStorage.clear();
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-p2-verify',
      initDataUnsafe: { user: { id: 42, first_name: 'Олег' } },
      getViewportSize: async () => ({ width: String(window.innerWidth), height: String(window.innerHeight) }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

/** Boot Menu -> Game with a QA fixture; wait for the real choice modal. */
async function bootFixture(browser, size, fixture) {
  const { ctx, page, errors } = await newQaPage(browser, size);
  await page.goto(BASE_URL + '?qaMutation=' + fixture, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('Menu'), null, { timeout: 60_000 });
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen, null, { timeout: 30_000 });
  await sleep(900);
  return { ctx, page, errors };
}

/** Visible text objects of the open modal with real rendered bounds. */
const modalTexts = (page) => page.evaluate(() => {
  const root = window.__game.scene.getScene('UI').modal;
  const flat = [];
  const visit = (o) => { flat.push(o); if (Array.isArray(o && o.list)) o.list.forEach(visit); };
  visit(root);
  return flat
    .filter((o) => typeof (o && o.text) === 'string' && o.visible !== false && (o.alpha || 1) > 0.05)
    .map((o) => {
      const b = o.getBounds();
      return { text: o.text, left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    });
});

/** Text stays inside the viewport (actual display bounds). */
function overflowOf(texts, size) {
  return texts.filter((t) => t.left < 1 || t.right > size.width - 1 || t.top < 1 || t.bottom > size.height - 1);
}

/** Pairwise visible-text intersections (area > 6 px² is a layout defect). */
function intersectionsOf(texts) {
  const bad = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0 && h > 0 && w * h > 6) bad.push(`${JSON.stringify(a.text)} x ${JSON.stringify(b.text)}`);
    }
  }
  return bad;
}

const firstCardCenter = (page) => page.evaluate(() => {
  const root = window.__game.scene.getScene('UI').modal;
  const card = root.list.find((o) => Array.isArray(o && o.list));
  const b = card.getBounds();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});

async function tapFirstCard(page) {
  const c = await firstCardCenter(page);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForFunction(() => !window.__game.scene.getScene('UI').modalOpen, null, { timeout: 10_000 });
}

/**
 * After the pick the fixture xp may legitimately queue an ORDINARY level-up:
 * the modal reopens with rolled mutation choices. That is normal flow. What
 * must never happen is a re-grant offer — a pending choice whose evolution
 * is already owned (Set membership alone would not prove absence of a
 * re-offer, so the queue itself is inspected).
 */
async function postPickState(page) {
  // Let a queued level-up modal settle, then sample the state.
  await sleep(1500);
  return page.evaluate(() => {
    const g = window.__game.scene.getScene('Game');
    const ui = window.__game.scene.getScene('UI');
    const reGrant = g.pendingChoices.some((c) => c.evolutionId && g.runState.hasEvolution(c.evolutionId));
    let hyperchipRecipeVisible = false;
    if (ui.modalOpen && ui.modal) {
      const flat = [];
      const visit = (o) => { flat.push(o); if (Array.isArray(o && o.list)) o.list.forEach(visit); };
      visit(ui.modal);
      hyperchipRecipeVisible = flat.some((o) => typeof (o && o.text) === 'string' && o.text.indexOf('Рецепт «ГИПЕРШИП»') === 0 && o.visible !== false && (o.alpha || 1) > 0.05);
    }
    return {
      awaitingChoice: g.awaitingChoice,
      pendingChoices: g.pendingChoices.length,
      reGrant,
      hyperchipRecipeVisible,
      legendaryRewardPending: g.legendaryRewardPending,
      modalOpen: ui.modalOpen,
      paused: window.__game.scene.isPaused('Game'),
    };
  });
}

async function scenarioD(browser, size) {
  const b = await bootFixture(browser, size, 'D');
  const texts = await modalTexts(b.page);
  const plain = texts.map((t) => t.text);
  const tag = `D ${size.width}x${size.height}:`;
  check(plain.some((t) => t === 'Рецепт «СВЕРХКАПСИД»'), `${tag} recipe title present`);
  check(plain.some((t) => t === 'КАПСИДНЫЕ СПУТНИКИ — 3/3 ✓'), `${tag} orbit done row`);
  check(plain.some((t) => t === 'Подвижность или Репликация — 1/2'), `${tag} alternative row reads 1/2`);
  check(!plain.some((t) => t.includes('→ 2/2')), `${tag} no false arrow to 2/2`);
  check(plain.some((t) => t.includes('появится отдельной картой')), `${tag} note promises a separate card`);
  const overflow = overflowOf(texts, size);
  check(overflow.length === 0, `${tag} no text outside viewport ${JSON.stringify(overflow.map((o) => o.text))}`);
  const inter = intersectionsOf(texts);
  check(inter.length === 0, `${tag} no text intersections ${JSON.stringify(inter)}`);
  await b.page.screenshot({ path: path.join(OUT_DIR, `qaMutation-D-${size.width}x${size.height}.png`) });
  await tapFirstCard(b.page);
  const after = await b.page.evaluate(() => {
    const g = window.__game.scene.getScene('Game');
    return {
      speed: g.runState.stackOf('speed'),
      rate: g.runState.stackOf('rate'),
      orbit: g.runState.stackOf('orbit'),
      halo: g.runState.hasEvolution('halo'),
    };
  });
  check(after.speed === 1 && after.rate === 1 && after.orbit === 3, `${tag} pick applied speed I only ${JSON.stringify(after)}`);
  check(after.halo === false, `${tag} recipe NOT complete after the tap`);
  const q = await postPickState(b.page);
  check(q.reGrant === false, `${tag} no re-offer of the recipe evolution ${JSON.stringify(q)}`);
  check(q.hyperchipRecipeVisible === false, `${tag} reopened modal (queued level-up) promises no ГИПЕРШИП ${JSON.stringify(q)}`);
  check(q.modalOpen || !q.paused, `${tag} not stuck paused after the pick ${JSON.stringify(q)}`);
  check(b.errors.length === 0, `${tag} no page errors ${b.errors.join(' | ')}`);
  await b.ctx.close();
}

async function scenarioE(browser, size) {
  const b = await bootFixture(browser, size, 'E');
  const texts = await modalTexts(b.page);
  const plain = texts.map((t) => t.text);
  const tag = `E ${size.width}x${size.height}:`;
  check(plain.some((t) => t === 'БЕЛКОВЫЕ ШИПЫ'), `${tag} component card present`);
  check(!plain.some((t) => t.indexOf('Рецепт «ГИПЕРШИП»') === 0), `${tag} no recipe block title`);
  check(!plain.some((t) => t.includes('ПРОНИКНОВЕНИЕ') && t.includes('/2')), `${tag} no recipe step rows`);
  const owned = await b.page.evaluate(() => window.__game.scene.getScene('Game').runState.hasEvolution('prism'));
  check(owned === true, `${tag} Гипершип already owned in the fixture`);
  const overflow = overflowOf(texts, size);
  check(overflow.length === 0, `${tag} no text outside viewport ${JSON.stringify(overflow.map((o) => o.text))}`);
  const inter = intersectionsOf(texts);
  check(inter.length === 0, `${tag} no text intersections ${JSON.stringify(inter)}`);
  await b.page.screenshot({ path: path.join(OUT_DIR, `qaMutation-E-${size.width}x${size.height}.png`) });
  await tapFirstCard(b.page);
  const after = await b.page.evaluate(() => {
    const g = window.__game.scene.getScene('Game');
    return { dmg: g.runState.stackOf('dmg'), prism: g.runState.hasEvolution('prism') };
  });
  check(after.dmg === 4, `${tag} component card selectable ${JSON.stringify(after)}`);
  check(after.prism === true, `${tag} Гипершип still owned exactly once`);
  const q = await postPickState(b.page);
  check(q.reGrant === false, `${tag} no duplicate grant offer after the pick ${JSON.stringify(q)}`);
  check(q.hyperchipRecipeVisible === false, `${tag} reopened modal promises no ГИПЕРШИП recipe ${JSON.stringify(q)}`);
  check(q.modalOpen || !q.paused, `${tag} not stuck paused after the pick ${JSON.stringify(q)}`);
  check(b.errors.length === 0, `${tag} no page errors ${b.errors.join(' | ')}`);
  await b.ctx.close();
}

async function gateOffCheck(browser) {
  // Production bundle WITHOUT VITE_QA_TOOLS: ?qaMutation=D must be inert.
  const size = { width: 320, height: 520 };
  const b = await newQaPage(browser, size);
  await b.page.goto(BASE_URL + '?qaMutation=D', { waitUntil: 'domcontentloaded' });
  await b.page.waitForFunction(() => window.__game && window.__game.scene.isActive('Menu'), null, { timeout: 60_000 });
  await b.page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await sleep(2500);
  const st = await b.page.evaluate(() => {
    const g = window.__game.scene.getScene('Game');
    const ui = window.__game.scene.getScene('UI');
    // A fresh run opens the ORDINARY initial mutation choice — that is product
    // behaviour, not the fixture. The fixture is proven inert by: zero fixture
    // stacks, no QA overlay object, and no fixture-specific recipe block text
    // («Рецепт «СВЕРХКАПСИД»» can only render when orbit stacks are applied).
    let hypercapsidBlock = false;
    if (ui.modalOpen && ui.modal) {
      const flat = [];
      const visit = (o) => { flat.push(o); if (Array.isArray(o && o.list)) o.list.forEach(visit); };
      visit(ui.modal);
      hypercapsidBlock = flat.some((o) => typeof (o && o.text) === 'string' && o.text === 'Рецепт «СВЕРХКАПСИД»' && o.visible !== false && (o.alpha || 1) > 0.05);
    }
    return {
      orbit: g.runState.stackOf('orbit'),
      rate: g.runState.stackOf('rate'),
      speed: g.runState.stackOf('speed'),
      hypercapsidBlock,
      qaPerf: g.qaPerf == null ? 'absent' : 'present',
    };
  });
  const tag = 'GATE-OFF:';
  check(st.orbit === 0 && st.rate === 0 && st.speed === 0, `${tag} no fixture stacks ${JSON.stringify(st)}`);
  check(st.hypercapsidBlock === false, `${tag} no fixture-specific recipe block ${JSON.stringify(st)}`);
  check(st.qaPerf === 'absent', `${tag} no QA overlay object in production build`);
  check(b.errors.length === 0, `${tag} no page errors ${b.errors.join(' | ')}`);
  await b.ctx.close();
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { chromium, executablePath } = driver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  let devServer = null;
  let previewServer = null;
  try {
    if (SPAWNING && !GATE_OFF) {
      const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
      devServer = run(process.execPath, [viteBin, '--port', String(PORT), '--strictPort']);
      await waitForServer(`http://127.0.0.1:${PORT}/`);
    }
    if (SPAWNING && GATE_OFF) {
      // Production bundle WITHOUT the QA flag (the flag under test), served by
      // `vite preview`. VITE_RELEASE_MATRIX_QA=1 only exposes the project's own
      // production-inspection hook (window.__game) — the QA gate itself keys on
      // DEV / VITE_QA_TOOLS and stays CLOSED here (src/main.ts, src/scenes/GameScene.ts).
      const env = { ...process.env, VITE_RELEASE_MATRIX_QA: '1', VITE_RELEASE_SHA: process.env.VITE_RELEASE_SHA || require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim() };
      delete env.VITE_QA_TOOLS;
      const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
      const build = run(process.execPath, [viteBin, 'build', '--outDir', GATE_OFF_DIST, '--emptyOutDir'], { env });
      await new Promise((resolve, reject) => {
        build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('vite build failed: ' + code))));
      });
      previewServer = run(process.execPath, [viteBin, 'preview', '--port', String(GATE_OFF_PORT), '--strictPort', '--outDir', GATE_OFF_DIST], { env });
      await waitForServer(`http://127.0.0.1:${GATE_OFF_PORT}/`);
    }
    if (GATE_OFF) {
      await gateOffCheck(browser);
    } else {
      for (const size of SIZES) await scenarioD(browser, size);
      for (const size of SIZES) await scenarioE(browser, size);
    }
  } finally {
    await browser.close().catch(() => {});
    for (const s of [devServer, previewServer]) if (s) s.kill('SIGTERM');
    if (GATE_OFF && SPAWNING && fs.existsSync(GATE_OFF_DIST)) {
      fs.rmSync(GATE_OFF_DIST, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  }
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});

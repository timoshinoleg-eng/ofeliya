/**
 * Run result — combined screen: browser probe.
 *
 * Drives the real game (dev server, `window.__game`) through the joint
 * acceptance of the three result-screen patches at once: the nearest goal,
 * the real Codex openings, and the return from the Codex. One result
 * screen carries a long goal, two real openings and the action buttons.
 *
 * Scenarios (all on the combined branch):
 *  1. combined-390 — standard run, 390x844: mastery goal
 *     («Ближайшая цель: Цепь лизиса» + the long branch line) + two real
 *     openings (Сингулярность -> Синергии, Нулевая точка -> Легендарные).
 *     Full cycle: open both entries (each to its own tab, with the НОВОЕ
 *     badge), return twice, re-show identical except the hidden score
 *     status, goal preserved, no new video, no new score request, storage
 *     unchanged, then a fresh run from the retry.
 *  2. combined-320 — the same, at 320x520 (the tightest state): bounds
 *     checks (every text fits the width, buttons inside the viewport,
 *     opening zones >= 44 px and full width, goal and opening rows
 *     reachable by scrolling), plus the full cycle.
 *  3. daily-390 — a daily run with the same seeds: daily chip on the
 *     first show and on the re-show, score once, retry is a standard
 *     fresh run (not a new daily attempt).
 *  4. duel-390 — a duel with the same seeds: duel chip, one attempt,
 *     re-show keeps the duel, rematch carries the duel seed.
 *  5. ghost-390 — the day-best regression, two runs of one fake day:
 *     run 1 holds 40 s without damage, run 2 only 10 s; after run 2 the
 *     goal still reads «Лучшее сегодня: 00:40 / 01:00».
 *  6. swipe-320 — the out-and-back swipe regression, 320x520: a 38 px
 *     horizontal move with a return almost to the start must NOT open an
 *     entry; a normal tap opens; a fast double tap opens once.
 *
 * The rotation is controlled for the ghost scenario only (the real
 * `selectDailyQuests` compiled with tsc, the page clock faked to noon UTC
 * of a day whose rotation includes ghost). The other scenarios use
 * all-max quest metrics, so any rotation completes.
 *
 * Usage (from the repo root; the dev server must be running on 5173):
 *   node scripts/run-result-combined-probe.cjs [--shots-dir <dir>]
 *
 * Chrome resolution, in order:
 *   1. $CHROME_PATH — an explicit Chrome/Chromium executable path.
 *   2. System Chrome (Playwright channel "chrome").
 *   3. The Playwright-bundled Chromium (this VM's cache path, if present).
 *   4. Playwright's default bundled Chromium.
 * Windows (PowerShell, system Chrome):
 *   node scripts/run-result-combined-probe.cjs
 * Windows (explicit path):
 *   $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
 *   node scripts/run-result-combined-probe.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright-core');

const BUNDLED_CHROME = '/home/hatch/.cache/ms-playwright/chromium-1187/chrome-linux/chrome';

async function launchBrowser() {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.CHROME_PATH) {
    return chromium.launch({ ...opts, executablePath: process.env.CHROME_PATH });
  }
  try {
    return await chromium.launch({ ...opts, channel: 'chrome' });
  } catch (channelError) {
    if (fs.existsSync(BUNDLED_CHROME)) {
      return chromium.launch({ ...opts, executablePath: BUNDLED_CHROME });
    }
    try {
      return await chromium.launch(opts);
    } catch {
      throw channelError;
    }
  }
}

const argv = process.argv.slice(2);
const shotsDirArg = argv.indexOf('--shots-dir');
const SHOTS = path.resolve(shotsDirArg >= 0 ? argv[shotsDirArg + 1] : 'shots/run-result-combined');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The real rotation, compiled from the game's own sources. */
function loadRotation() {
  const temp = mkdtempSync(path.join(tmpdir(), 'ofeliya-combined-probe-'));
  writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  try {
    execFileSync(
      process.execPath,
      [
        path.resolve('node_modules/typescript/bin/tsc'),
        'src/quests/questRotation.ts',
        'src/quests/questCatalog.ts',
        '--target',
        'ES2020',
        '--module',
        'commonjs',
        '--moduleResolution',
        'node',
        '--rootDir',
        path.resolve('src'),
        '--outDir',
        temp,
        '--skipLibCheck',
        'true',
        '--esModuleInterop',
        'true',
      ],
      { stdio: 'inherit' }
    );
    const rotation = require(path.join(temp, 'quests/questRotation.js'));
    const catalog = require(path.join(temp, 'quests/questCatalog.js'));
    return { selectDailyQuests: rotation.selectDailyQuests, utcDayKey: rotation.utcDayKey, catalog: catalog.QUEST_CATALOG };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** First noon-UTC timestamp (ms) whose rotation satisfies `predicate`. */
function findDate(selectDailyQuests, utcDayKey, catalog, predicate) {
  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let d = 0; d < 120; d += 1) {
    const noon = todayStart + d * 86400000 + 12 * 3600000;
    const rotation = selectDailyQuests(utcDayKey(noon), catalog);
    if (predicate(rotation)) return { fakeNow: noon, rotation };
  }
  throw new Error('run-result-combined-probe: no rotation found in 120 days');
}

async function touchAt(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** A horizontal out-and-back swipe: 38 px out, back to ~2 px from the start. */
async function swipeOutAndBack(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  const at = (x, type) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [{ x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await at(point.x, 'touchStart');
  await sleep(30);
  for (let i = 1; i <= 4; i += 1) { await at(point.x + Math.round((38 * i) / 4), 'touchMove'); await sleep(25); }
  for (let i = 3; i >= 0; i -= 1) { await at(point.x + Math.round((38 * i) / 4) + 2, 'touchMove'); await sleep(25); }
  await at(point.x + 2, 'touchEnd');
}

/**
 * Out-and-back past the report's left edge: down on the row, out to x=4
 * (the report starts at x=16), back to the start, release. The gesture
 * leaves the hit rect mid-swipe, so only a scene-wide move listener can
 * see the excursion and cancel the tap.
 */
async function swipeOutLeftAndBack(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  const at = (x, type) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [{ x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  const out = point.x - 4;
  await at(point.x, 'touchStart');
  await sleep(30);
  for (let i = 1; i <= 4; i += 1) { await at(point.x - Math.round((out * i) / 4), 'touchMove'); await sleep(25); }
  for (let i = 3; i >= 0; i -= 1) { await at(point.x - Math.round((out * i) / 4), 'touchMove'); await sleep(25); }
  await at(point.x, 'touchEnd');
}

/** A vertical swipe inside the report, to scroll its rows down (content up). */
async function swipeUp(ctx, page, x, y, dy) {
  const cdp = await ctx.newCDPSession(page);
  const at = (yy, type) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [{ x, y: yy, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await at(y, 'touchStart');
  await sleep(30);
  for (let i = 1; i <= 4; i += 1) { await at(y - Math.round((dy * i) / 4), 'touchMove'); await sleep(25); }
  await at(y - dy, 'touchEnd');
}

/** A vertical swipe inside the report, to scroll its rows up (content down). */
async function swipeDown(ctx, page, x, y, dy) {
  const cdp = await ctx.newCDPSession(page);
  const at = (yy, type) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [{ x, y: yy, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await at(y, 'touchStart');
  await sleep(30);
  for (let i = 1; i <= 4; i += 1) { await at(y + Math.round((dy * i) / 4), 'touchMove'); await sleep(25); }
  await at(y + dy, 'touchEnd');
}

/** Bounds of a named display object in any scene, or null. */
async function objectBounds(page, name) {
  return page.evaluate((n) => {
    const g = window.__game;
    const flat = [];
    const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
    for (const key of ['Game', 'UI', 'Menu']) {
      const scene = g.scene.getScene(key);
      if (scene) scene.children.list.forEach(visit);
    }
    const o = flat.find((x) => x?.name === n);
    if (!o || typeof o.getBounds !== 'function') return null;
    const b = o.getBounds();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), cx: Math.round(b.centerX), cy: Math.round(b.centerY) };
  }, name);
}

async function objectCenter(page, name) {
  const b = await objectBounds(page, name);
  return b ? { x: b.cx, y: b.cy } : null;
}

/** Centre of a visible text in the Menu scene, matched by exact content. */
async function menuTextCenter(page, text) {
  return page.evaluate((wanted) => {
    const menu = window.__game.scene.getScene('Menu');
    if (!menu) return null;
    const flat = [];
    const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
    menu.children.list.forEach(visit);
    const t = flat.find((o) => o && typeof o.text === 'string' && o.text === wanted && o.visible !== false && typeof o.getBounds === 'function');
    if (!t) return null;
    const b = t.getBounds();
    return { x: Math.round(b.centerX), y: Math.round(b.centerY) };
  }, text);
}

/** Whether a visible text with this exact content exists in the Menu scene. */
async function menuHasText(page, text) {
  return (await menuTextCenter(page, text)) !== null;
}

async function sceneState(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const gs = g.scene.getScene('Game');
    const ui = g.scene.getScene('UI');
    const menu = g.scene.getScene('Menu');
    return {
      runResult: g.registry.get('runResult') ? 'present' : 'null',
      lastRunResult: g.registry.get('lastRunResult') ? 'present' : 'null',
      game: { active: g.scene.isActive('Game'), paused: g.scene.isPaused('Game'), status: gs?.sys?.settings?.status ?? null, runSeed: gs?.runSeed ?? null },
      ui: { active: g.scene.isActive('UI'), paused: g.scene.isPaused('UI'), status: ui?.sys?.settings?.status ?? null },
      menu: { active: g.scene.isActive('Menu'), codexOpen: !!menu?.codexOverlay },
      dailyIntent: g.registry.get('dailyIntent') ?? null,
      dailyTicket: g.registry.get('dailyTicket') ? 'present' : 'null',
      duelChallenge: g.registry.get('duelChallenge') ? 'present' : 'null',
      difficultyId: g.registry.get('difficultyId') ?? null,
      controlMode: g.registry.get('controlMode') ?? null,
      runSeedOverride: g.registry.get('runSeedOverride') ?? null,
      saveRuns: JSON.parse(localStorage.getItem('ofeliya_save_v1') || '{}').runs ?? null,
    };
  });
}

/** Whole localStorage as a sorted-key JSON string (byte-stable). */
async function storageSnapshot(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return JSON.stringify(out, Object.keys(out).sort());
  });
}

/** Every text on the result screen, in display-list order, with visibility and bounds. */
async function resultTexts(page) {
  return page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
    ui.children.list.forEach(visit);
    const result = flat.find((o) => o?.name === 'ofeliya-result');
    if (!result) return null;
    const rows = [];
    const collect = (o) => {
      if (o?.type === 'Text' && typeof o.text === 'string' && o.text.trim()) {
        const b = typeof o.getBounds === 'function' ? o.getBounds() : null;
        rows.push({ name: o.name || '', text: o.text.trim(), visible: !!o.visible, x: b ? Math.round(b.left) : null, y: b ? Math.round(b.top) : null, w: b ? Math.round(b.width) : null, h: b ? Math.round(b.height) : null });
      }
      if (Array.isArray(o?.list)) o.list.forEach(collect);
    };
    collect(result);
    return rows;
  });
}

async function resultFingerprint(page) {
  const rows = await resultTexts(page);
  return rows ? rows.map(({ text, visible }) => ({ text, visible })) : null;
}

/** The two goal lines, by name, from the UI scene. */
async function goalLines(page) {
  return page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    const pick = (name) => {
      const o = flat.find((obj) => obj?.name === name);
      if (!o) return null;
      const b = typeof o.getBounds === 'function' ? o.getBounds() : null;
      return { text: o.text, visible: o.visible !== false, cx: b ? Math.round(b.centerX) : null, cy: b ? Math.round(b.centerY) : null, bw: b ? Math.round(b.width) : null, bh: b ? Math.round(b.height) : null, interactive: Boolean(o.input) };
    };
    return { line1: pick('ofeliya-result-goal-line1'), line2: pick('ofeliya-result-goal-line2') };
  });
}

/** The submit-status vocabulary: the only row that may differ between shows. */
const STATUS_RE = /ОТПРАВКА|СОХРАНЁН|ТЕСТОВЫЙ|РЕЙТИНГ|МЕСТО #|ДУЭЛЬ|ДНЕВН|ЗАБЕГ ДНЯ|ЗАСЧИТАН|СРОК ЗАБЕГА|СЕРВЕР НЕ ОТВЕТИЛ|НЕТ СОЕДИНЕНИЯ|НЕ УДАЛОСЬ ОПРЕДЕЛИТЬ|НУЖЕН ЗАПУСК|ЗАБЛОКИР|ПРОДОЛЖЕН|НЕ ПОДТВЕРЖДЕНА/i;

/** Compare two fingerprints: identical except exactly one row (the status). */
function fingerprintDiff(a, b) {
  if (!a || !b) return 'one of the fingerprints is null (no result overlay)';
  if (a.length !== b.length) return `row count differs: ${a.length} vs ${b.length}`;
  const diffs = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text || a[i].visible !== b[i].visible) diffs.push(i);
  }
  if (diffs.length === 0) return 'fingerprints identical (status row should be hidden on the re-show)';
  if (diffs.length !== 1) return `fingerprints differ in ${diffs.length} rows: ${diffs.map((i) => JSON.stringify(a[i]) + ' -> ' + JSON.stringify(b[i])).join('; ')}`;
  const i = diffs[0];
  if (a[i].visible !== true || b[i].visible !== false) return `the differing row did not flip visible->hidden: ${JSON.stringify(a[i])} -> ${JSON.stringify(b[i])}`;
  if (!STATUS_RE.test(a[i].text)) return `the differing row is not the submit status: ${JSON.stringify(a[i])}`;
  return null;
}

const results = [];
function pass(label) { results.push(`PASS  ${label}`); console.log(`PASS  ${label}`); }
function fail(label, detail) { throw new Error(`FAIL ${label}: ${detail}`); }
function check(label, cond, detail) { if (cond) pass(label); else fail(label, detail); }

async function waitResult(page) {
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
    ui.children.list.forEach(visit);
    return !!flat.find((o) => o?.name === 'ofeliya-result');
  }, { timeout: 8000 });
}

async function waitStatusSettled(page) {
  // Let the async submit resolve so the status row shows its final text.
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
    ui.children.list.forEach(visit);
    const result = flat.find((o) => o?.name === 'ofeliya-result');
    if (!result) return false;
    const texts = [];
    const collect = (o) => { if (o?.type === 'Text' && o.text) texts.push(o.text); if (Array.isArray(o?.list)) o.list.forEach(collect); };
    collect(result);
    return texts.some((t) => /СОХРАНЁН|ТЕСТОВЫЙ|РЕЙТИНГ|ДУЭЛЬ|ДНЕВН|ЗАБЕГ ДНЯ|ЗАСЧИТАН|СЕРВЕР НЕ ОТВЕТИЛ|НЕТ СОЕДИНЕНИЯ|ЗАБЛОКИР|ПРОДОЛЖЕН/i.test(t));
  }, { timeout: 5000 }).catch(() => {});
  await sleep(400);
}

async function tapNamed(ctx, page, name) {
  const point = await objectCenter(page, name);
  if (!point) throw new Error(`object not found: ${name}`);
  await touchAt(ctx, page, point);
  return point;
}

/** Scroll the report until the named object's centre is inside the viewport. */
async function ensureVisible(ctx, page, name, viewport) {
  for (let i = 0; i < 5; i += 1) {
    const b = await objectBounds(page, name);
    if (!b) return null;
    // The visible area is the report clip, not the page: a row below the
    // report's bottom edge is masked out even though it sits inside the
    // page viewport, so the page check alone would call it visible without
    // ever scrolling.
    const hit = await objectBounds(page, 'ofeliya-result-report-hit');
    const top = hit ? hit.y + 4 : 0;
    const bottom = hit ? hit.y + hit.h - 4 : viewport.height;
    if (b.cy >= top && b.cy <= bottom) return b;
    const x = hit ? Math.round(hit.x + hit.w / 2) : Math.round(viewport.width / 2);
    const y = hit ? Math.round(hit.y + hit.h / 2) : Math.round(viewport.height / 2);
    if (b.cy < top) await swipeDown(ctx, page, x, y, 120);
    else await swipeUp(ctx, page, x, y, 120);
    await sleep(300);
  }
  return objectBounds(page, name);
}

async function boot(browser, viewport, opts) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.route('https://st.max.ru/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  let scoreRequests = 0;
  let duelAttempts = 0;
  let duelEvents = 0;
  await ctx.route('**/api/score', (r) => {
    scoreRequests += 1;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rank: null, ranked: false, rulesetVersion: 3, campaignVersion: 2 }) });
  });
  await ctx.route('**/api/duel/**', (r) => {
    if (r.request().url().includes('/attempt')) duelAttempts += 1; else duelEvents += 1;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ranked: false, valid: true, beaten: false, everBeaten: false, targetTimeMs: 120000, attemptCount: 1 }) });
  });
  await ctx.addInitScript(({ width, height, save, meta, fakeNow }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify(save));
    if (meta) localStorage.setItem('ofeliya.meta.v1', JSON.stringify(meta));
    if (fakeNow) {
      const OrigDate = Date;
      function FakeDate(...args) {
        return args.length === 0 ? new OrigDate(fakeNow) : new OrigDate(...args);
      }
      FakeDate.now = () => fakeNow;
      FakeDate.parse = OrigDate.parse;
      FakeDate.UTC = OrigDate.UTC;
      FakeDate.prototype = OrigDate.prototype;
      globalThis.Date = FakeDate;
    }
    window.__videoAdds = 0;
    const startVideoWatch = () => {
      if (!document.documentElement) { setTimeout(startVideoWatch, 10); return; }
      new MutationObserver((mutations) => {
        for (const m of mutations) for (const n of m.addedNodes) {
          if (n && n.nodeName === 'VIDEO') window.__videoAdds += 1;
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    startVideoWatch();
    window.WebApp = {
      platform: 'android', version: '26.20.0', initData: 'x',
      initDataUnsafe: { user: { id: 42 } },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      shareMaxContent: async () => {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { ...viewport, save: opts.save, meta: opts.meta || null, fakeNow: opts.fakeNow || null });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate((m) => {
    const menu = window.__game.scene.getScene('Menu');
    if (m === 'daily') {
      const now = Date.now();
      // The server issues tickets for the LOCAL day (localDayKey), so the
      // daily history lands on today and the reward becomes claimable.
      // A UTC dateKey would record the run under the wrong day whenever
      // the two differ.
      const d = new Date();
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const ticket = { runId: 'daily-test-1', runSeed: 'daily-seed-1', dateKey, issuedAt: now - 60000, expiresAt: now + 6 * 3600 * 1000, difficultyId: 'standard', rulesetVersion: 3, campaignVersion: 2 };
      menu.registry.set('dailyTicket', ticket);
      menu.registry.set('dailyIntent', { runId: ticket.runId });
      menu.registry.set('runSeedOverride', ticket.runSeed);
      menu.registry.set('difficultyId', 'standard');
      menu.registry.set('duelChallenge', null);
    } else if (m === 'duel') {
      const now = Date.now();
      const challenge = { challengeId: 'duel-test-01234567', rulesetVersion: 3, campaignVersion: 2, runSeed: 'duel-seed-42', difficultyId: 'standard', controlMode: 'touch', targetTimeMs: 120000, createdAt: now - 60000, expiresAt: now + 3600000 };
      menu.registry.set('duelChallenge', challenge);
      menu.registry.set('runSeedOverride', challenge.runSeed);
      menu.registry.set('difficultyId', 'standard');
      menu.registry.set('controlMode', 'touch');
    } else {
      menu.registry.set('difficultyId', 'strained');
    }
    menu.scene.start('Game');
  }, opts.mode);
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
  const runSeed = await page.evaluate(() => window.__game.scene.getScene('Game').runSeed);
  return {
    ctx, page, errors, runSeed,
    score: () => scoreRequests,
    duelAttempts: () => duelAttempts,
    duelEvents: () => duelEvents,
    videoAdds: () => page.evaluate(() => window.__videoAdds),
  };
}

/** Set the run state and the quest counters, then finish. Separated from boot so a scenario can finish twice. */
async function finishRun(page, quest, run, win) {
  await page.evaluate(({ quest, run, win }) => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    if (quest) {
      gs.quests.engine.restoreRunMetrics({
        kills: quest.kills,
        timeMs: quest.timeMs,
        rna: quest.rna,
        mutations: quest.mutations,
        elites: quest.elites,
      });
      gs.quests.engine.restoreNoDamageStreak(quest.noDamageMs, false);
      gs.runState.stage.noDamageMs = quest.noDamageMs;
    }
    const state = gs.runState.run;
    state.timeMs = run.timeMs;
    state.kills = run.kills;
    state.hostCellsInfected = run.hostCells;
    state.highestLevel = run.level;
    state.comboBest = run.combo;
    state.maxNoDamageMs = run.noDamageMs || 0;
    gs.runState.stage.level = run.level;
    state.legendaryIds = new Set(run.legendaryIds || []);
    state.evolutionsSeen = new Set(run.evolutions || []);
    if (run.bossClearMs) state.bossClearTimesMs = { 'immune-prime': run.bossClearMs };
    gs.finish(win);
    game.scene.getScene('UI').update();
  }, { quest, run, win });
  await waitResult(page);
  await waitStatusSettled(page);
}

/** Keys of two storage snapshots that differ. */
function storageDiffKeys(a, b) {
  const pa = JSON.parse(a);
  const pb = JSON.parse(b);
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  return [...keys].filter((k) => pa[k] !== pb[k]);
}

/** The combined seeds: a long mastery goal + two real openings. */
const COMBINED_SAVE = {
  muted: true, runs: 120, totalKills: 120000,
  achievements: ['first-contact', 'continuous-flow', 'stable-core', 'adaptation', 'deep-dive', 'epidemic', 'cleanup-500', 'restart-3', 'full-protocol'],
  evolutionsSeen: ['prism', 'halo'],
  legendarySeen: ['split-geometry'],
};
const COMBINED_META = { questsCompleted: 60, starsSpent: 600, maxStreak: 30, timeSecTotal: 40000, deaths: 120, rnaEarned: 50000 };
const COMBINED_QUEST = { kills: 1000, timeMs: 300000, rna: 2000, mutations: 3, elites: 5, noDamageMs: 150000 };
const COMBINED_RUN = { timeMs: 300000, kills: 1000, hostCells: 5, level: 10, combo: 120, noDamageMs: 150000, evolutions: ['singularity'], legendaryIds: ['zero-point'], bossClearMs: 90000 };
const GOAL_LINE1 = 'Ближайшая цель: Цепь лизиса';
const GOAL_LINE2 = 'Ветка «Инфекция / Лизис»: 1 / 2 · СИНГУЛЯРНОСТЬ + ЦЕПЬ ЛИЗИСА';

/** Bounds: every result text fits the width; buttons and zones inside the viewport. */
async function checkBounds(ctx, page, id, viewport) {
  const rows = await resultTexts(page);
  check(`${id}: result rendered`, !!rows && rows.length > 0, 'no result texts');
  const overflow = rows.filter((r) => r.x !== null && (r.x < -1 || r.x + r.w > viewport.width + 1));
  check(`${id}: every result text fits the width ${viewport.width}`,
    overflow.length === 0,
    overflow.map((r) => `${JSON.stringify(r.text)} x=${r.x} w=${r.w}`).join('; '));
  for (const btn of ['ofeliya-result-retry-bg', 'ofeliya-result-menu-bg']) {
    const b = await objectBounds(page, btn);
    check(`${id}: button ${btn} inside the viewport`, !!b && b.y >= 0 && b.y + b.h <= viewport.height + 1 && b.x >= 0 && b.x + b.w <= viewport.width + 1, JSON.stringify(b));
  }
  for (const zone of ['ofeliya-result-opening-zone-evolution-singularity', 'ofeliya-result-opening-zone-legendary-zero-point']) {
    const b = await objectBounds(page, zone);
    check(`${id}: tap zone ${zone} is >= 44 px tall and full width`,
      !!b && b.h >= 44 && b.w >= viewport.width - 40,
      JSON.stringify(b));
  }
  // The goal lines and the opening rows must be reachable: on a short
  // screen they may start below the fold, so scroll until they are in view.
  // The check is against the report clip, not the page: a masked row is
  // inside the page viewport but not actually readable.
  const hit = await objectBounds(page, 'ofeliya-result-report-hit');
  for (const name of ['ofeliya-result-goal-line1', 'ofeliya-result-goal-line2', 'ofeliya-result-opening-evolution-singularity-name', 'ofeliya-result-opening-legendary-zero-point-name']) {
    const b = await ensureVisible(ctx, page, name, viewport);
    check(`${id}: ${name} reachable and inside the report area`,
      !!b && !!hit && b.cy >= hit.y && b.cy <= hit.y + hit.h,
      JSON.stringify(b));
  }
}

/** Goal + both opening rows, exact text. */
async function checkGoalAndOpenings(page, id) {
  const goal = await goalLines(page);
  check(`${id}: goal line1 is the long mastery goal`, goal.line1?.text === GOAL_LINE1, `got ${JSON.stringify(goal.line1?.text)}`);
  check(`${id}: goal line2 is the long branch line`, goal.line2?.text === GOAL_LINE2, `got ${JSON.stringify(goal.line2?.text)}`);
  check(`${id}: goal lines visible and not interactive`, goal.line1?.visible && goal.line2?.visible && !goal.line1?.interactive && !goal.line2?.interactive, JSON.stringify(goal));
  const rows = await resultTexts(page);
  check(`${id}: opening row СИНГУЛЯРНОСТЬ present`, rows.some((r) => r.text.includes('СИНГУЛЯРНОСТЬ')), 'no singularity row');
  check(`${id}: opening row НУЛЕВАЯ ТОЧКА present`, rows.some((r) => r.text.includes('НУЛЕВАЯ ТОЧКА')), 'no zero-point row');
  check(`${id}: opening rows name their tabs`, rows.some((r) => r.text.includes('Синергии')) && rows.some((r) => r.text.includes('Легендарные')), 'tab subtitles missing');
}

/** Open one entry, check its tab + badge, close the Codex, return to the result. */
async function openAndReturn(env, viewport, id, entryName, badgeName, otherBadgeName) {
  const { ctx, page } = env;
  // The bounds check may have scrolled the report; bring the row back in view first.
  await ensureVisible(ctx, page, entryName, viewport);
  await tapNamed(ctx, page, entryName);
  await page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
  await sleep(400);
  const st = await sceneState(page);
  check(`${id}: Codex open on ${entryName}, Game and UI stopped, snapshot saved`,
    st.menu.active && st.menu.codexOpen && !st.game.active && st.game.status === 8 && !st.ui.active && st.lastRunResult === 'present' && st.runResult === 'null',
    JSON.stringify(st));
  const badge = await objectCenter(page, badgeName);
  const otherBadge = await objectCenter(page, otherBadgeName);
  check(`${id}: entry highlighted with НОВОЕ badge (${badgeName})`, !!badge, 'no badge');
  check(`${id}: the other entry's badge is not shown (its tab is not active)`, !otherBadge, 'other badge visible');
  await tapNamed(ctx, page, 'ofeliya-modal-close-hit');
  await page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
  await sleep(300);
  const returnBtn = await objectCenter(page, 'ofeliya-menu-return-result');
  check(`${id}: «← К РЕЗУЛЬТАТУ» button present`, !!returnBtn, 'no return button');
  await tapNamed(ctx, page, 'ofeliya-menu-return-result');
  await waitResult(page);
  await sleep(400);
}

/** One full combined cycle on a standard run: both openings, two returns, retry. */
async function combinedCycle(browser, viewport, id, shots) {
  console.log(`\n--- ${id} ---`);
  const env = await boot(browser, viewport, { mode: 'standard', save: COMBINED_SAVE, meta: COMBINED_META });
  const { ctx, page } = env;
  try {
    await finishRun(page, COMBINED_QUEST, COMBINED_RUN, true);
    const fp1 = await resultFingerprint(page);
    const st1 = await sceneState(page);
    const storage1 = await storageSnapshot(page);
    const video1 = await env.videoAdds();
    check(`${id}: result shown, score submitted once, run recorded once`,
      fp1 && st1.saveRuns === 121 && env.score() === 1 && st1.runResult === 'present',
      `runs=${st1.saveRuns} score=${env.score()} runResult=${st1.runResult}`);
    await checkGoalAndOpenings(page, id);
    // The first frame is the unscrolled state (what the player sees first).
    if (shots) await page.screenshot({ path: path.join(SHOTS, `${id}-first.png`) });
    await checkBounds(ctx, page, id, viewport);
    // The goal sits below the fold on a short screen: scroll to it and
    // keep that frame too, so the tightest state is shown in full.
    await ensureVisible(ctx, page, 'ofeliya-result-goal-line2', viewport);
    await sleep(300);
    if (shots) await page.screenshot({ path: path.join(SHOTS, `${id}-goal.png`) });

    await openAndReturn(env, viewport, `${id} singularity`, 'ofeliya-result-opening-evolution-singularity-name', 'ofeliya-codex-new-badge-singularity', 'ofeliya-codex-new-badge-zero-point');
    const fp2 = await resultFingerprint(page);
    const diff1 = fingerprintDiff(fp1, fp2);
    check(`${id}: return 1 re-shows the same result (only the hidden score status differs)`, diff1 === null, diff1 || '');
    const goal2 = await goalLines(page);
    check(`${id}: return 1 keeps the goal`, goal2.line1?.text === GOAL_LINE1 && goal2.line2?.text === GOAL_LINE2, JSON.stringify(goal2));
    check(`${id}: return 1 sends no score, plays no video, storage unchanged`,
      env.score() === 1 && (await env.videoAdds()) === video1 && (await storageSnapshot(page)) === storage1,
      `score=${env.score()} video=${video1}->${await env.videoAdds()}`);
    if (shots) await page.screenshot({ path: path.join(SHOTS, `${id}-reshow.png`) });

    await openAndReturn(env, viewport, `${id} zero-point`, 'ofeliya-result-opening-legendary-zero-point-name', 'ofeliya-codex-new-badge-zero-point', 'ofeliya-codex-new-badge-singularity');
    const fp3 = await resultFingerprint(page);
    const diff2 = fingerprintDiff(fp1, fp3);
    check(`${id}: return 2 re-shows the same result`, diff2 === null, diff2 || '');
    const goal3 = await goalLines(page);
    check(`${id}: return 2 keeps the goal`, goal3.line1?.text === GOAL_LINE1 && goal3.line2?.text === GOAL_LINE2, JSON.stringify(goal3));
    check(`${id}: return 2 sends no score, plays no video, storage unchanged`,
      env.score() === 1 && (await env.videoAdds()) === video1 && (await storageSnapshot(page)) === storage1,
      `score=${env.score()}`);

    await tapNamed(ctx, page, 'ofeliya-result-retry-bg');
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), { timeout: 5000 });
    await sleep(800);
    const st5 = await sceneState(page);
    const newRun = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      return { runSeed: gs.runSeed, kills: gs.runState.run.kills, timeMs: gs.runState.run.timeMs };
    });
    check(`${id}: retry starts a fresh run`,
      st5.game.active && st5.ui.active && !st5.menu.active && newRun.runSeed !== env.runSeed && newRun.kills <= 5 && newRun.timeMs < 5000 && st5.lastRunResult === 'null' && st5.runResult === 'null',
      `runSeed=${newRun.runSeed} (was ${env.runSeed}) kills=${newRun.kills} timeMs=${newRun.timeMs}`);
    const changedKeys = storageDiffKeys(storage1, await storageSnapshot(page));
    check(`${id}: retry sends no score, finished run not re-recorded`,
      env.score() === 1 && changedKeys.every((k) => k === 'ofeliya_run_checkpoint_v1' || k === 'ofeliya.quests.v1'),
      `score=${env.score()} changedKeys=${changedKeys.join(',')}`);
    check(`${id}: no page errors`, env.errors.length === 0, env.errors.join(' | '));
  } finally {
    await env.ctx.close();
  }
}

(async () => {
  const { selectDailyQuests, utcDayKey, catalog } = loadRotation();
  const browser = await launchBrowser();
  const failures = [];
  const checkSafe = (label, cond, detail) => {
    try { check(label, cond, detail); } catch (e) { failures.push(label); console.log(`FAIL  ${label}: ${detail || ''}`); }
  };
  try {
    // 1-2. Combined cycles, both viewports.
    await combinedCycle(browser, { width: 390, height: 844 }, 'combined-390', true);
    await combinedCycle(browser, { width: 320, height: 520 }, 'combined-320', true);

    // 3. Daily with the same seeds.
    console.log('\n--- daily-390 ---');
    {
      const env = await boot(browser, { width: 390, height: 844 }, { mode: 'daily', save: COMBINED_SAVE, meta: COMBINED_META });
      const { ctx, page } = env;
      try {
        await finishRun(page, COMBINED_QUEST, COMBINED_RUN, true);
        const fp1 = await resultFingerprint(page);
        const st1 = await sceneState(page);
        const storage1 = await storageSnapshot(page);
        const video1 = await env.videoAdds();
        checkSafe('daily-390: daily mode shown, score once, run recorded once',
          fp1.some((r) => r.text.includes('ЗАБЕГ ДНЯ')) && env.score() === 1 && st1.saveRuns === 121 && env.runSeed === 'daily-seed-1',
          `runSeed=${env.runSeed} score=${env.score()} runs=${st1.saveRuns}`);
        await checkGoalAndOpenings(page, 'daily-390');
        await openAndReturn(env, { width: 390, height: 844 }, 'daily-390 singularity', 'ofeliya-result-opening-evolution-singularity-name', 'ofeliya-codex-new-badge-singularity', 'ofeliya-codex-new-badge-zero-point');
        const fp2 = await resultFingerprint(page);
        const diff = fingerprintDiff(fp1, fp2);
        checkSafe('daily-390: return keeps the daily mode and the same result',
          diff === null && fp2.some((r) => r.text.includes('ЗАБЕГ ДНЯ')) && !fp2.some((r) => r.text.includes('В зачёт рейтинга')),
          diff || 'mode chip changed');
        checkSafe('daily-390: return sends no score, plays no video, storage unchanged',
          env.score() === 1 && (await env.videoAdds()) === video1 && (await storageSnapshot(page)) === storage1,
          `score=${env.score()}`);
        await tapNamed(ctx, page, 'ofeliya-result-retry-bg');
        await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), { timeout: 5000 });
        await sleep(800);
        const st2 = await sceneState(page);
        const dnew = await page.evaluate(() => window.__game.scene.getScene('Game').runSeed);
        checkSafe('daily-390: retry is a standard fresh run, not a new daily attempt',
          st2.game.active && st2.dailyIntent === null && st2.dailyTicket === 'null' && st2.difficultyId === 'standard' && dnew !== 'daily-seed-1',
          `runSeed=${dnew} dailyIntent=${JSON.stringify(st2.dailyIntent)} ticket=${st2.dailyTicket}`);
        checkSafe('daily-390: no page errors', env.errors.length === 0, env.errors.join(' | '));
      } finally {
        await env.ctx.close();
      }
    }

    // 4. Duel with the same seeds.
    console.log('\n--- duel-390 ---');
    {
      const env = await boot(browser, { width: 390, height: 844 }, { mode: 'duel', save: COMBINED_SAVE, meta: COMBINED_META });
      const { ctx, page } = env;
      try {
        await finishRun(page, COMBINED_QUEST, COMBINED_RUN, true);
        const fp1 = await resultFingerprint(page);
        const st1 = await sceneState(page);
        const storage1 = await storageSnapshot(page);
        checkSafe('duel-390: duel mode shown, one attempt, no score, run recorded once',
          fp1.some((r) => r.text.includes('ДУЭЛЬ')) && env.duelAttempts() === 1 && env.score() === 0 && st1.saveRuns === 121 && env.runSeed === 'duel-seed-42',
          `runSeed=${env.runSeed} attempts=${env.duelAttempts()} score=${env.score()} runs=${st1.saveRuns}`);
        await checkGoalAndOpenings(page, 'duel-390');
        await openAndReturn(env, { width: 390, height: 844 }, 'duel-390 zero-point', 'ofeliya-result-opening-legendary-zero-point-name', 'ofeliya-codex-new-badge-zero-point', 'ofeliya-codex-new-badge-singularity');
        const fp2 = await resultFingerprint(page);
        const diff = fingerprintDiff(fp1, fp2);
        checkSafe('duel-390: return keeps the duel mode and the same result, no new attempt',
          diff === null && fp2.some((r) => r.text.includes('ДУЭЛЬ')) && env.duelAttempts() === 1,
          diff || `attempts=${env.duelAttempts()}`);
        checkSafe('duel-390: return leaves storage unchanged',
          (await storageSnapshot(page)) === storage1, 'storage changed on the duel return');
        await tapNamed(ctx, page, 'ofeliya-result-retry-bg');
        await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), { timeout: 5000 });
        await sleep(800);
        const st2 = await sceneState(page);
        const unew = await page.evaluate(() => {
          const gs = window.__game.scene.getScene('Game');
          return { runSeed: gs.runSeed, difficultyId: window.__game.registry.get('difficultyId'), controlMode: window.__game.registry.get('controlMode'), duelChallenge: window.__game.registry.get('duelChallenge') ? 'present' : 'null' };
        });
        checkSafe('duel-390: rematch carries the duel data (same seed, standard, touch)',
          st2.game.active && unew.runSeed === 'duel-seed-42' && unew.difficultyId === 'standard' && unew.controlMode === 'touch' && unew.duelChallenge === 'present',
          JSON.stringify(unew));
        checkSafe('duel-390: no page errors', env.errors.length === 0, env.errors.join(' | '));
      } finally {
        await env.ctx.close();
      }
    }

    // 5. Ghost: two runs of one fake day, 40 s then 10 s without damage.
    console.log('\n--- ghost-390 ---');
    {
      const { fakeNow, rotation } = findDate(selectDailyQuests, utcDayKey, catalog, (r) => r.includes('ghost'));
      console.log(`rotation ${rotation.join(', ')} (fake day ${utcDayKey(fakeNow)})`);
      const env = await boot(browser, { width: 390, height: 844 }, {
        mode: 'standard',
        save: { muted: true, runs: 3, totalKills: 500, achievements: [] },
        fakeNow,
      });
      const { ctx, page } = env;
      try {
        // Run 1: 40 s without damage. The other metrics stay low so ghost
        // (40/60) wins against any rotation.
        await finishRun(page,
          { kills: 50, timeMs: 90000, rna: 100, mutations: 1, elites: 0, noDamageMs: 40000 },
          { timeMs: 90000, kills: 50, hostCells: 4, level: 3, combo: 25, noDamageMs: 40000 },
          false);
        const goal1 = await goalLines(page);
        checkSafe('ghost-390 run 1: goal names ghost with the day best 00:40',
          goal1.line1?.text === 'Следующий забег: Продержись 60 секунд подряд без урона' && goal1.line2?.text === 'Лучшее сегодня: 00:40 / 01:00',
          JSON.stringify(goal1));
        // Run 2: only 10 s without damage, same day. The day best (40 s)
        // must survive — the label says whose best it is.
        await tapNamed(ctx, page, 'ofeliya-result-retry-bg');
        await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), { timeout: 5000 });
        await sleep(800);
        await finishRun(page,
          { kills: 30, timeMs: 60000, rna: 50, mutations: 1, elites: 0, noDamageMs: 10000 },
          { timeMs: 60000, kills: 30, hostCells: 3, level: 3, combo: 20, noDamageMs: 10000 },
          false);
        const goal2 = await goalLines(page);
        checkSafe('ghost-390 run 2: the day best survives a weaker second run',
          goal2.line1?.text === 'Следующий забег: Продержись 60 секунд подряд без урона' && goal2.line2?.text === 'Лучшее сегодня: 00:40 / 01:00',
          JSON.stringify(goal2));
        checkSafe('ghost-390: score submitted once per run, no page errors',
          env.score() === 2 && env.errors.length === 0,
          `score=${env.score()} errors=${env.errors.join(' | ')}`);
        await page.screenshot({ path: path.join(SHOTS, 'ghost-390-run2.png') });
      } finally {
        await env.ctx.close();
      }
    }

    // 6. Swipe: out-and-back must not open, tap opens, fast double tap opens once.
    console.log('\n--- swipe-320 ---');
    {
      const env = await boot(browser, { width: 320, height: 520 }, { mode: 'standard', save: COMBINED_SAVE, meta: COMBINED_META });
      const { ctx, page } = env;
      try {
        await finishRun(page, COMBINED_QUEST, COMBINED_RUN, true);
        const row = await objectCenter(page, 'ofeliya-result-opening-evolution-singularity-name');
        checkSafe('swipe-320: opening row present', !!row, 'no singularity row');
        const scoreBefore = env.score();
        await swipeOutAndBack(ctx, page, row);
        await sleep(400);
        const st1 = await sceneState(page);
        checkSafe('swipe-320: 38 px out-and-back swipe does not open the Codex',
          st1.ui.active && !st1.menu.active && st1.runResult === 'present' && env.score() === scoreBefore,
          JSON.stringify(st1));
        // Out past the report's left edge and back: the gesture leaves the
        // hit rect mid-swipe, so the tap must be cancelled by the
        // scene-wide move listener, not by the release-point check.
        await swipeOutLeftAndBack(ctx, page, row);
        await sleep(400);
        const st1b = await sceneState(page);
        checkSafe('swipe-320: out past the left edge and back does not open the Codex',
          st1b.ui.active && !st1b.menu.active && st1b.runResult === 'present' && env.score() === scoreBefore,
          JSON.stringify(st1b));
        await tapNamed(ctx, page, 'ofeliya-result-opening-evolution-singularity-name');
        await page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
        await sleep(400);
        const st2 = await sceneState(page);
        checkSafe('swipe-320: a normal tap opens the Codex',
          st2.menu.active && st2.menu.codexOpen && st2.lastRunResult === 'present',
          JSON.stringify(st2));
        const badge = await objectCenter(page, 'ofeliya-codex-new-badge-singularity');
        checkSafe('swipe-320: the tap opened the right entry (Сингулярность, Синергии)', !!badge, 'no badge');
        await tapNamed(ctx, page, 'ofeliya-modal-close-hit');
        await page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
        await sleep(300);
        await tapNamed(ctx, page, 'ofeliya-menu-return-result');
        await waitResult(page);
        await sleep(400);
        // Fast double tap on the second entry: two taps 60 ms apart.
        const row2 = await objectCenter(page, 'ofeliya-result-opening-legendary-zero-point-name');
        await touchAt(ctx, page, row2);
        await sleep(60);
        await touchAt(ctx, page, row2);
        await page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
        await sleep(400);
        const st3 = await sceneState(page);
        const badge2 = await objectCenter(page, 'ofeliya-codex-new-badge-zero-point');
        checkSafe('swipe-320: a fast double tap opens the entry once, on the right tab',
          st3.menu.active && st3.menu.codexOpen && !!badge2 && env.score() === scoreBefore,
          `badge=${!!badge2} score=${env.score()} (was ${scoreBefore})`);
        checkSafe('swipe-320: no page errors', env.errors.length === 0, env.errors.join(' | '));
      } finally {
        await env.ctx.close();
      }
    }

    // 7. Daily with a claimable reward: the reward modal must not cover
    // the return button on a Codex entry, and the reward must survive.
    console.log('\n--- daily-reward-390 ---');
    {
      const env = await boot(browser, { width: 390, height: 844 }, { mode: 'daily', save: COMBINED_SAVE, meta: COMBINED_META });
      const { ctx, page } = env;
      try {
        await finishRun(page, COMBINED_QUEST, COMBINED_RUN, true);
        const fp1 = await resultFingerprint(page);
        const st1 = await sceneState(page);
        checkSafe('daily-reward-390: daily mode shown, score once, run recorded once',
          fp1.some((r) => r.text.includes('ЗАБЕГ ДНЯ')) && env.score() === 1 && st1.saveRuns === 121,
          `score=${env.score()} runs=${st1.saveRuns}`);
        // The finish recorded today's daily run, so the reward is
        // claimable (playedToday, not claimed).
        const canClaim = await page.evaluate(() => {
          const claims = JSON.parse(localStorage.getItem('ofeliya.daily.v1') || '{}');
          const d = new Date();
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const history = JSON.parse(localStorage.getItem('ofeliya_daily_history_v1') || '{}');
          return { playedToday: Boolean(history[key]), claimedToday: claims[key] !== undefined };
        });
        checkSafe('daily-reward-390: the reward is claimable after the daily run',
          canClaim.playedToday && !canClaim.claimedToday, JSON.stringify(canClaim));
        // Open the Codex and sit in it past the modal's 900 ms timer: on
        // a Codex entry the modal must not auto-show at all.
        await tapNamed(ctx, page, 'ofeliya-result-opening-evolution-singularity-name');
        await page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
        await sleep(1300);
        checkSafe('daily-reward-390: no reward modal on the Codex entry',
          (await sceneState(page)).menu.codexOpen && !(await menuHasText(page, 'ЕЖЕДНЕВНАЯ НАГРАДА')),
          'the daily modal appeared over the Codex');
        await tapNamed(ctx, page, 'ofeliya-modal-close-hit');
        await page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
        await sleep(300);
        const returnBtn = await objectCenter(page, 'ofeliya-menu-return-result');
        checkSafe('daily-reward-390: the return button is present after closing the Codex',
          !!returnBtn, 'no return button');
        await tapNamed(ctx, page, 'ofeliya-menu-return-result');
        await waitResult(page);
        await sleep(400);
        const fp2 = await resultFingerprint(page);
        const diff = fingerprintDiff(fp1, fp2);
        checkSafe('daily-reward-390: the return opens the same result with the reward available',
          diff === null && fp2.some((r) => r.text.includes('ЗАБЕГ ДНЯ')) && env.score() === 1,
          diff || `score=${env.score()}`);
        // The reward is not lost: on the next direct menu entry it shows.
        await tapNamed(ctx, page, 'ofeliya-result-menu-bg');
        await page.waitForFunction(() => !window.__game.scene.isActive('UI'), { timeout: 3000 });
        await page.waitForFunction(() => {
          const menu = window.__game.scene.getScene('Menu');
          if (!menu) return false;
          const flat = [];
          const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
          menu.children.list.forEach(visit);
          return flat.some((o) => o && typeof o.text === 'string' && o.text === 'ЕЖЕДНЕВНАЯ НАГРАДА' && o.visible !== false);
        }, { timeout: 4000 });
        checkSafe('daily-reward-390: the reward modal shows on the next direct menu entry',
          await menuHasText(page, 'ЕЖЕДНЕВНАЯ НАГРАДА'),
          'no daily modal on the direct entry');
        const claimBtn = await menuTextCenter(page, 'ЗАБРАТЬ');
        checkSafe('daily-reward-390: the claim button is present', !!claimBtn, 'no ЗАБРАТЬ button');
        await touchAt(ctx, page, claimBtn);
        await sleep(500);
        const claimed = await page.evaluate(() => {
          const claims = JSON.parse(localStorage.getItem('ofeliya.daily.v1') || '{}');
          const d = new Date();
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return claims[key] !== undefined;
        });
        checkSafe('daily-reward-390: the reward is claimed', claimed, 'no claim recorded');
        checkSafe('daily-reward-390: no page errors', env.errors.length === 0, env.errors.join(' | '));
      } finally {
        await env.ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  // The combined-cycle helper throws on its first failure; the other
  // scenarios collect failures so one bad scenario does not hide the rest.
  console.log(`\nrun-result-combined-probe: ${results.length} checks passed${failures.length ? `, ${failures.length} failures` : ''}`);
  console.log(failures.length === 0 ? 'run-result-combined-probe: ALL PASS' : `run-result-combined-probe: FAILURES: ${failures.join('; ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error(`\nrun-result-combined-probe: ${results.length} passed before failure`);
  console.error(error);
  process.exit(1);
});

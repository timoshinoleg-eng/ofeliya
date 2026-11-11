/**
 * Run result — return from the Codex: browser probe.
 *
 * Drives the real game (dev server, `window.__game`) through the full
 * cycle the brief asks for, and checks that the saved result can be
 * re-shown WITHOUT starting the Game scene:
 *
 *   finish -> open a Codex entry -> back to the same result
 *   -> open the Codex again -> back to the result again -> new run
 *
 * What it checks on the standard cycle (390x844, first trophy):
 *  - the finish submits the score exactly once (one /api/score request)
 *    and records the run once (save.runs 2 -> 3);
 *  - the opening tap saves `lastRunResult`, opens the Codex on the
 *    entry's tab with the entry highlighted, and stops Game + UI;
 *  - the menu shows the «← К РЕЗУЛЬТАТУ» button;
 *  - the return re-shows the SAME result: the fingerprint of every
 *    text on the result screen is identical to the first show except
 *    for exactly one row — the score status, which is hidden on the
 *    re-show (its outcome is not part of RunResult, and the re-show
 *    must not re-submit);
 *  - the return starts no Game scene, plays no video, and changes no
 *    storage: save, both outboxes and the daily history are
 *    byte-identical, and /api/score is not called again;
 *  - the second Codex visit and the second return work the same way;
 *  - «НОВЫЙ ЗАБЕГ» starts a fresh run: a new runSeed, kills 0, the
 *    menu gone, `lastRunResult` cleared, still one score request.
 *
 * What it checks on the daily cycle (separate boot, seeded ticket):
 *  - the first show renders the daily mode («ЗАБЕГ ДНЯ · СТАНДАРТ»),
 *    submits once, and records the daily history once;
 *  - the re-show keeps the daily mode (no ranked standard rendering),
 *    submits nothing, and records nothing;
 *  - the retry starts a standard fresh run (no daily intent/ticket,
 *    a new seed, not the ticket's).
 *
 * What it checks on the duel cycle (separate boot, seeded challenge):
 *  - the first show renders the duel mode («ДУЭЛЬ · СТАНДАРТ») and
 *    submits one duel attempt;
 *  - the re-show keeps the duel mode and submits nothing;
 *  - the retry starts the rematch: the new run carries the duel's
 *    runSeed, difficulty 'standard' and control mode.
 *
 * What it checks on the compact viewport (320x520):
 *  - the «← К РЕЗУЛЬТАТУ» button is present and tappable.
 *
 * The probe runs every check and prints a report; it exits non-zero
 * when any check fails.
 *
 * Usage (from the repo root; the dev server must be running on 5173):
 *   node scripts/run-result-return-probe.cjs [--video] [--shots-dir <dir>]
 *
 * Chrome resolution, in order:
 *   1. $CHROME_PATH — an explicit Chrome/Chromium executable path.
 *   2. System Chrome (Playwright channel "chrome").
 *   3. The Playwright-bundled Chromium (this VM's cache path, if present).
 *   4. Playwright's default bundled Chromium.
 * Windows (PowerShell, system Chrome):
 *   node scripts/run-result-return-probe.cjs --video
 * Windows (explicit path):
 *   $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
 *   node scripts/run-result-return-probe.cjs --video
 */
const fs = require('fs');
const path = require('path');
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
const VIDEO = argv.includes('--video');
const shotsDirArg = argv.indexOf('--shots-dir');
const SHOTS = path.resolve(shotsDirArg >= 0 ? argv[shotsDirArg + 1] : 'shots/run-result-return');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function touchAt(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Centre of a named display object in any scene, or null. */
async function objectCenter(page, name) {
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
    return { x: Math.round(b.centerX), y: Math.round(b.centerY) };
  }, name);
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
      ui: { active: g.scene.isActive('UI'), paused: g.scene.isPaused('UI'), status: ui?.sys?.settings?.status ?? null, overShown: ui?.overShown ?? null },
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

/** Every text on the result screen, in display-list order, with visibility. */
async function resultFingerprint(page) {
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
        rows.push({ text: o.text.trim(), visible: !!o.visible });
      }
      if (Array.isArray(o?.list)) o.list.forEach(collect);
    };
    collect(result);
    return rows;
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

async function boot(browser, viewport, mode) {
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
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 2, achievements: ['first-contact'] }));
    window.__videoAdds = 0;
    // addInitScript runs before <html> exists, so the observer has to wait
    // for the document element instead of assuming it is there already.
    const startVideoWatch = () => {
      if (!document.documentElement) { setTimeout(startVideoWatch, 10); return; }
      new MutationObserver((mutations) => {
        for (const m of mutations) for (const n of m.addedNodes) {
          if (n && n.nodeName === 'VIDEO') window.__videoAdds += 1;
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    startVideoWatch();
    window.WebApp = { platform: 'android', version: '26.20.0', initData: 'x', initDataUnsafe: { user: { id: 42 } }, getViewportSize: async () => ({ width: '390', height: '844' }), shareMaxContent: async () => {}, BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, HapticFeedback: { impactOccurred() {}, notificationOccurred() {} } };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate((m) => {
    const menu = window.__game.scene.getScene('Menu');
    if (m === 'daily') {
      const now = Date.now();
      const ticket = { runId: 'daily-test-1', runSeed: 'daily-seed-1', dateKey: new Date().toISOString().slice(0, 10), issuedAt: now - 60000, expiresAt: now + 6 * 3600 * 1000, difficultyId: 'standard', rulesetVersion: 3, campaignVersion: 2 };
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
  }, mode);
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
  const runSeed = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const run = gs.runState.run;
    run.timeMs = 130000; run.kills = 90; run.hostCellsInfected = 5; run.highestLevel = 10; run.comboBest = 10;
    gs.runState.stage.level = 10; run.legendaryIds = new Set(['core-predator']); run.evolutionsSeen = new Set([]);
    run.bossClearTimesMs = { 'immune-prime': 90000 };
    const seed = gs.runSeed;
    gs.finish(true); window.__game.scene.getScene('UI').update();
    return seed;
  });
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
    ui.children.list.forEach(visit);
    return !!flat.find((o) => o?.name === 'ofeliya-result');
  }, { timeout: 12000 });
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
  return {
    ctx, page, errors, runSeed,
    score: () => scoreRequests,
    duelAttempts: () => duelAttempts,
    duelEvents: () => duelEvents,
    videoAdds: () => page.evaluate(() => window.__videoAdds),
  };
}

/** Keys of two storage snapshots that differ. */
function storageDiffKeys(a, b) {
  const pa = JSON.parse(a);
  const pb = JSON.parse(b);
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  return [...keys].filter((k) => pa[k] !== pb[k]);
}

async function tapNamed(ctx, page, name) {
  const point = await objectCenter(page, name);
  if (!point) throw new Error(`object not found: ${name}`);
  await touchAt(ctx, page, point);
  return point;
}

async function waitResult(page) {
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (o) => { flat.push(o); if (Array.isArray(o?.list)) o.list.forEach(visit); };
    ui.children.list.forEach(visit);
    return !!flat.find((o) => o?.name === 'ofeliya-result');
  }, { timeout: 5000 });
}

(async () => {
  const browser = await launchBrowser();
  try {
    // ---- Standard cycle: finish -> Codex -> return -> Codex -> return -> new run
    const std = await boot(browser, { width: 390, height: 844 }, 'standard');
    const { ctx, page } = std;
    const fp1 = await resultFingerprint(page);
    const st1 = await sceneState(page);
    const storage1 = await storageSnapshot(page);
    const video1 = await std.videoAdds();
    check('standard finish: result shown, score submitted once, run recorded once',
      fp1 && st1.saveRuns === 3 && std.score() === 1 && st1.runResult === 'present',
      `runs=${st1.saveRuns} score=${std.score()} runResult=${st1.runResult}`);
    check('standard finish: opening row present',
      fp1.some((r) => r.text.includes('ХИЩНИК ЯДРА')),
      'no core-predator opening row');
    if (VIDEO) await page.screenshot({ path: path.join(SHOTS, 'cycle-00-result.png') });

    await tapNamed(ctx, page, 'ofeliya-result-opening-legendary-core-predator-name');
    await page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(400);
    const st2 = await sceneState(page);
    const storage2 = await storageSnapshot(page);
    check('open Codex: Menu + Codex on Legendary, Game and UI stopped, snapshot saved',
      st2.menu.active && st2.menu.codexOpen && !st2.game.active && st2.game.status === 8 && !st2.ui.active && st2.lastRunResult === 'present' && st2.runResult === 'null',
      JSON.stringify(st2));
    check('open Codex: no new score request, storage unchanged',
      std.score() === 1 && storage2 === storage1,
      `score=${std.score()} storageChanged=${storage2 !== storage1}`);
    const badge = await objectCenter(page, 'ofeliya-codex-new-badge-core-predator');
    check('open Codex: entry highlighted with НОВОЕ badge', !!badge, 'no badge');
    if (VIDEO) await page.screenshot({ path: path.join(SHOTS, 'cycle-01-codex.png') });

    await tapNamed(ctx, page, 'ofeliya-modal-close-hit');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(300);
    const returnBtn = await objectCenter(page, 'ofeliya-menu-return-result');
    check('Menu: «← К РЕЗУЛЬТАТУ» button present', !!returnBtn, 'no return button');
    if (VIDEO) await page.screenshot({ path: path.join(SHOTS, 'cycle-02-menu-return.png') });

    await tapNamed(ctx, page, 'ofeliya-menu-return-result');
    await waitResult(page);
    await sleep(400);
    const fp2 = await resultFingerprint(page);
    const st3 = await sceneState(page);
    const storage3 = await storageSnapshot(page);
    const video2 = await std.videoAdds();
    check('return 1: result re-shown without Game',
      fp2 && !st3.game.active && st3.ui.active && st3.menu.active && st3.runResult === 'null' && st3.lastRunResult === 'present',
      JSON.stringify(st3));
    const diff = fingerprintDiff(fp1, fp2);
    check('return 1: same result (only the hidden score status differs)', diff === null, diff || '');
    check('return 1: no new score request, no video, storage unchanged',
      std.score() === 1 && video2 === video1 && storage3 === storage1,
      `score=${std.score()} video=${video1}->${video2} storageChanged=${storage3 !== storage1}`);
    if (VIDEO) await page.screenshot({ path: path.join(SHOTS, 'cycle-03-reshow.png') });

    await tapNamed(ctx, page, 'ofeliya-result-opening-legendary-core-predator-name');
    await page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(400);
    const st4 = await sceneState(page);
    check('reopen Codex: second visit opens the same entry',
      st4.menu.active && st4.menu.codexOpen && st4.lastRunResult === 'present' && std.score() === 1,
      JSON.stringify(st4));
    const badge2 = await objectCenter(page, 'ofeliya-codex-new-badge-core-predator');
    check('reopen Codex: entry still highlighted', !!badge2, 'no badge on second visit');
    if (VIDEO) await page.screenshot({ path: path.join(SHOTS, 'cycle-04-codex-again.png') });

    await tapNamed(ctx, page, 'ofeliya-modal-close-hit');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(300);
    await tapNamed(ctx, page, 'ofeliya-menu-return-result');
    await waitResult(page);
    await sleep(400);
    const fp3 = await resultFingerprint(page);
    const diff2 = fingerprintDiff(fp1, fp3);
    check('return 2: second return re-shows the same result', diff2 === null, diff2 || '');
    check('return 2: still one score request, storage unchanged',
      std.score() === 1 && (await storageSnapshot(page)) === storage1,
      `score=${std.score()}`);
    if (VIDEO) await page.screenshot({ path: path.join(SHOTS, 'cycle-05-reshow-2.png') });

    await tapNamed(ctx, page, 'ofeliya-result-retry-bg');
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), { timeout: 5000 });
    await sleep(800);
    const st5 = await sceneState(page);
    const newRun = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      return { runSeed: gs.runSeed, kills: gs.runState.run.kills, timeMs: gs.runState.run.timeMs };
    });
    // The new run is live: it can score a kill in its first second, so the
    // freshness signal is the new seed and the early clock (the finished
    // run had kills 90 at 130000 ms), not kills === 0.
    check('new run: fresh run starts from the re-shown result',
      st5.game.active && st5.ui.active && !st5.menu.active && newRun.runSeed !== std.runSeed && newRun.kills <= 5 && newRun.timeMs < 5000 && st5.lastRunResult === 'null' && st5.runResult === 'null',
      `runSeed=${newRun.runSeed} (was ${std.runSeed}) kills=${newRun.kills} timeMs=${newRun.timeMs} ${JSON.stringify(st5)}`);
    // The new run writes its own checkpoint (ofeliya_run_checkpoint_v1) and
    // ticks its own quest progress (ofeliya.quests.v1) — that is the new
    // run's live state, not a re-recording of the finished one. The
    // finished run's record must be untouched: same save, same outboxes.
    const changedKeys = storageDiffKeys(storage1, await storageSnapshot(page));
    check('new run: no extra score request, finished run not re-recorded',
      std.score() === 1 && changedKeys.every((k) => k === 'ofeliya_run_checkpoint_v1' || k === 'ofeliya.quests.v1'),
      `score=${std.score()} changedKeys=${changedKeys.join(',')}`);
    if (std.errors.length) fail('standard cycle: page errors', std.errors.join(' | '));
    if (VIDEO) await page.screenshot({ path: path.join(SHOTS, 'cycle-06-new-run.png') });
    await std.ctx.close();

    // ---- Daily cycle
    const daily = await boot(browser, { width: 390, height: 844 }, 'daily');
    const dfp1 = await resultFingerprint(daily.page);
    const dst1 = await sceneState(daily.page);
    const dstorage1 = await storageSnapshot(daily.page);
    const dhistory1 = await daily.page.evaluate(() => localStorage.getItem('ofeliya_daily_history_v1'));
    check('daily finish: daily mode shown, score submitted once, run recorded once',
      dfp1.some((r) => r.text.includes('ЗАБЕГ ДНЯ')) && daily.score() === 1 && dst1.saveRuns === 3 && daily.runSeed === 'daily-seed-1',
      `runSeed=${daily.runSeed} score=${daily.score()} runs=${dst1.saveRuns}`);
    await tapNamed(daily.ctx, daily.page, 'ofeliya-result-opening-legendary-core-predator-name');
    await daily.page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(400);
    await tapNamed(daily.ctx, daily.page, 'ofeliya-modal-close-hit');
    await daily.page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(300);
    await tapNamed(daily.ctx, daily.page, 'ofeliya-menu-return-result');
    await waitResult(daily.page);
    await sleep(400);
    const dfp2 = await resultFingerprint(daily.page);
    const ddiff = fingerprintDiff(dfp1, dfp2);
    check('daily return: same result, daily mode kept (no ranked rendering)',
      ddiff === null && dfp2.some((r) => r.text.includes('ЗАБЕГ ДНЯ')) && !dfp2.some((r) => r.text.includes('В зачёт рейтинга')),
      ddiff || 'mode chip changed');
    check('daily return: no new score request, daily history unchanged, storage unchanged',
      daily.score() === 1 && (await daily.page.evaluate(() => localStorage.getItem('ofeliya_daily_history_v1'))) === dhistory1 && (await storageSnapshot(daily.page)) === dstorage1,
      `score=${daily.score()}`);
    if (VIDEO) await daily.page.screenshot({ path: path.join(SHOTS, 'daily-reshow.png') });
    await tapNamed(daily.ctx, daily.page, 'ofeliya-result-retry-bg');
    await daily.page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), { timeout: 5000 });
    await sleep(800);
    const dst2 = await sceneState(daily.page);
    const dnew = await daily.page.evaluate(() => window.__game.scene.getScene('Game').runSeed);
    check('daily new run: a standard fresh run, not a new daily attempt',
      dst2.game.active && dst2.dailyIntent === null && dst2.dailyTicket === 'null' && dst2.difficultyId === 'standard' && dnew !== 'daily-seed-1',
      `runSeed=${dnew} dailyIntent=${JSON.stringify(dst2.dailyIntent)} ticket=${dst2.dailyTicket}`);
    if (daily.errors.length) fail('daily cycle: page errors', daily.errors.join(' | '));
    await daily.ctx.close();

    // ---- Duel cycle
    const duel = await boot(browser, { width: 390, height: 844 }, 'duel');
    const ufp1 = await resultFingerprint(duel.page);
    const ust1 = await sceneState(duel.page);
    const ustorage1 = await storageSnapshot(duel.page);
    check('duel finish: duel mode shown, one duel attempt submitted, run recorded once',
      ufp1.some((r) => r.text.includes('ДУЭЛЬ')) && duel.duelAttempts() === 1 && duel.score() === 0 && ust1.saveRuns === 3 && duel.runSeed === 'duel-seed-42',
      `runSeed=${duel.runSeed} attempts=${duel.duelAttempts()} score=${duel.score()} runs=${ust1.saveRuns}`);
    await tapNamed(duel.ctx, duel.page, 'ofeliya-result-opening-legendary-core-predator-name');
    await duel.page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(400);
    await tapNamed(duel.ctx, duel.page, 'ofeliya-modal-close-hit');
    await duel.page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(300);
    await tapNamed(duel.ctx, duel.page, 'ofeliya-menu-return-result');
    await waitResult(duel.page);
    await sleep(400);
    const ufp2 = await resultFingerprint(duel.page);
    const udiff = fingerprintDiff(ufp1, ufp2);
    check('duel return: same result, duel mode kept, no new attempt',
      udiff === null && ufp2.some((r) => r.text.includes('ДУЭЛЬ')) && duel.duelAttempts() === 1,
      udiff || `attempts=${duel.duelAttempts()}`);
    check('duel return: storage unchanged',
      (await storageSnapshot(duel.page)) === ustorage1,
      'storage changed on the duel return');
    if (VIDEO) await duel.page.screenshot({ path: path.join(SHOTS, 'duel-reshow.png') });
    await tapNamed(duel.ctx, duel.page, 'ofeliya-result-retry-bg');
    await duel.page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), { timeout: 5000 });
    await sleep(800);
    const ust2 = await sceneState(duel.page);
    const unew = await duel.page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      return { runSeed: gs.runSeed, difficultyId: window.__game.registry.get('difficultyId'), controlMode: window.__game.registry.get('controlMode'), duelChallenge: window.__game.registry.get('duelChallenge') ? 'present' : 'null' };
    });
    check('duel rematch: the new run carries the duel data (same seed, standard, touch)',
      ust2.game.active && unew.runSeed === 'duel-seed-42' && unew.difficultyId === 'standard' && unew.controlMode === 'touch' && unew.duelChallenge === 'present',
      JSON.stringify(unew));
    if (duel.errors.length) fail('duel cycle: page errors', duel.errors.join(' | '));
    await duel.ctx.close();

    // ---- Compact viewport: the return button fits 320x520
    const small = await boot(browser, { width: 320, height: 520 }, 'standard');
    await tapNamed(small.ctx, small.page, 'ofeliya-result-opening-legendary-core-predator-name');
    await small.page.waitForFunction(() => window.__game.scene.isActive('Menu') && !!window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(400);
    await tapNamed(small.ctx, small.page, 'ofeliya-modal-close-hit');
    await small.page.waitForFunction(() => !window.__game.scene.getScene('Menu')?.codexOverlay, { timeout: 3000 });
    await sleep(300);
    const smallBtn = await objectCenter(small.page, 'ofeliya-menu-return-result');
    check('320x520: «← К РЕЗУЛЬТАТУ» button present and tappable', !!smallBtn, 'no return button at 320x520');
    await tapNamed(small.ctx, small.page, 'ofeliya-menu-return-result');
    await waitResult(small.page);
    await sleep(400);
    const sfp = await resultFingerprint(small.page);
    check('320x520: return re-shows the result', !!sfp && sfp.some((r) => r.text.includes('ХИЩНИК ЯДРА')), 'no opening row on the re-shown result');
    if (small.errors.length) fail('320x520: page errors', small.errors.join(' | '));
    await small.ctx.close();

    console.log(`\nrun-result-return-probe: ${results.length}/${results.length} checks passed`);
    console.log('run-result-return-probe: ok');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(`\nrun-result-return-probe: ${results.length} passed before failure`);
  console.error(e.message);
  process.exit(1);
});

/**
 * Run result — the nearest goal: browser probe.
 *
 * Drives the real game (dev server, `window.__game`) through the goal
 * categories and checks the two goal lines the result screen renders.
 * Same pattern as scripts/run-result-codex-probe.cjs: the save and the meta
 * wallet are seeded through localStorage, the quest run metrics are set
 * through the engine's resume seam (`restoreRunMetrics` /
 * `restoreNoDamageStreak` — the same functions the checkpoint resume uses),
 * and the run is finished directly with `gs.finish(...)`.
 *
 * The rotation is controlled, not left to chance: the probe compiles the
 * real `selectDailyQuests` with tsc, searches the next 120 UTC days for a
 * date whose rotation satisfies the scenario's predicate, and fakes the
 * page clock to noon UTC of that day (the quest rotation runs on Date).
 *
 * What it checks per scenario:
 *  - the two goal lines name exactly the expected goal (category, text);
 *  - both lines are visible and fit the report width;
 *  - a tap on the goal line does nothing (no navigation, no resubmission);
 *  - the score submission happened (at least one /api/score request);
 *  - no page errors.
 *
 * Usage (from the repo root; the dev server must be running on 5173):
 *   node scripts/run-result-next-goal-probe.cjs [--shots-dir <dir>]
 *
 * Chrome resolution, in order:
 *   1. $CHROME_PATH — an explicit Chrome/Chromium executable path.
 *   2. System Chrome (Playwright channel "chrome").
 *   3. The Playwright-bundled Chromium (this VM's cache path, if present).
 *   4. Playwright's default bundled Chromium.
 * Windows (PowerShell, system Chrome):
 *   node scripts/run-result-next-goal-probe.cjs
 * Windows (explicit path):
 *   $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
 *   node scripts/run-result-next-goal-probe.cjs
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
const SHOTS = path.resolve(shotsDirArg >= 0 ? argv[shotsDirArg + 1] : 'shots/run-result-next-goal');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The real rotation, compiled from the game's own sources. */
function loadRotation() {
  const temp = mkdtempSync(path.join(tmpdir(), 'ofeliya-next-goal-probe-'));
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
  throw new Error('run-result-next-goal-probe: no rotation found in 120 days');
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
      return {
        text: o.text,
        visible: o.visible !== false,
        color: o.style?.color || null,
        cx: b ? Math.round(b.centerX) : null,
        cy: b ? Math.round(b.centerY) : null,
        bw: b ? Math.round(b.width) : null,
        bh: b ? Math.round(b.height) : null,
        interactive: Boolean(o.input),
      };
    };
    return { line1: pick('ofeliya-result-goal-line1'), line2: pick('ofeliya-result-goal-line2') };
  });
}

async function bootGoal(browser, viewport, seed) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  let scoreRequests = 0;
  await ctx.route('**/api/score', (route) => {
    scoreRequests += 1;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, rank: null, ranked: false, rulesetVersion: 3, campaignVersion: 2 }),
    });
  });
  await ctx.addInitScript(({ width, height, save, meta, fakeNow }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify(save));
    if (meta) localStorage.setItem('ofeliya.meta.v1', JSON.stringify(meta));
    // Fake the UTC day: the quest rotation runs on Date.
    const OrigDate = Date;
    function FakeDate(...args) {
      return args.length === 0 ? new OrigDate(fakeNow) : new OrigDate(...args);
    }
    FakeDate.now = () => fakeNow;
    FakeDate.parse = OrigDate.parse;
    FakeDate.UTC = OrigDate.UTC;
    FakeDate.prototype = OrigDate.prototype;
    globalThis.Date = FakeDate;
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-run-result-next-goal-probe',
      initDataUnsafe: { user: { id: 42, first_name: 'Result', last_name: 'QA' } },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      shareMaxContent: async () => {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { ...viewport, save: seed.save, meta: seed.meta || null, fakeNow: seed.fakeNow });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));

  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    menu.registry.set('difficultyId', 'strained');
    menu.scene.start('Game');
  });
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  await page.evaluate(({ quest, run, win }) => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    if (quest) {
      // The resume-path seam: set the quest run counters directly.
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
  }, { quest: seed.quest, run: seed.run, win: seed.win });
  await sleep(400);

  return { ctx, page, errors, scoreCount: () => scoreRequests };
}

const SCENARIOS = [
  {
    id: 'quest-run-390',
    label: '1 · цель-квест одного забега, 390×844',
    viewport: { width: 390, height: 844 },
    rotationPredicate: (r) => r.includes('slayer_2') && !r.includes('survivor_1'),
    save: { muted: true, runs: 2, totalKills: 380, achievements: [] },
    quest: { kills: 214, timeMs: 132000, rna: 310, mutations: 2, elites: 0, noDamageMs: 38000 },
    run: { timeMs: 132000, kills: 214, hostCells: 6, level: 4, combo: 31, noDamageMs: 38000 },
    win: false,
    expectLine1: 'Следующий забег: Уничтожь 300 врагов за один забег',
    expectLine2: 'В этом забеге: 214 / 300',
    tapGoal: true,
  },
  {
    id: 'quest-run-320',
    label: '2 · цель-квест одного забега, 320×520',
    viewport: { width: 320, height: 520 },
    rotationPredicate: (r) => r.includes('slayer_2') && !r.includes('survivor_1'),
    save: { muted: true, runs: 2, totalKills: 380, achievements: [] },
    quest: { kills: 214, timeMs: 132000, rna: 310, mutations: 2, elites: 0, noDamageMs: 38000 },
    run: { timeMs: 132000, kills: 214, hostCells: 6, level: 4, combo: 31, noDamageMs: 38000 },
    win: false,
    expectLine1: 'Следующий забег: Уничтожь 300 врагов за один забег',
    expectLine2: 'В этом забеге: 214 / 300',
    tapGoal: false,
  },
  {
    id: 'milestone-390',
    label: '3 · веха (все квесты ротации выполнены), 390×844',
    viewport: { width: 390, height: 844 },
    rotationPredicate: (r) => !r.includes('marathon') && !r.includes('veteran'),
    save: { muted: true, runs: 1, totalKills: 100, achievements: [] },
    meta: { maxStreak: 1, timeSecTotal: 60, deaths: 1, rnaEarned: 100, questsCompleted: 0, starsSpent: 0 },
    quest: { kills: 1000, timeMs: 300000, rna: 2000, mutations: 3, elites: 5, noDamageMs: 60000 },
    run: { timeMs: 300000, kills: 1000, hostCells: 6, level: 4, combo: 5, noDamageMs: 60000 },
    win: false,
    expectLine1: 'РЕЦИДИВ — 2 / 3, осталось 1',
    expectLine2: 'Завершить 3 забега',
    tapGoal: false,
  },
  {
    id: 'mastery-390',
    label: '4 · мастерство (вехи и квесты закрыты), 390×844',
    viewport: { width: 390, height: 844 },
    rotationPredicate: (r) => !r.includes('marathon') && !r.includes('veteran'),
    save: {
      muted: true, runs: 120, totalKills: 120000,
      achievements: ['first-contact', 'continuous-flow', 'stable-core', 'adaptation', 'deep-dive', 'epidemic', 'cleanup-500', 'restart-3', 'full-protocol'],
      evolutionsSeen: ['prism', 'halo', 'singularity'],
      legendarySeen: ['split-geometry', 'zero-point'],
    },
    meta: { questsCompleted: 60, starsSpent: 600, maxStreak: 30, timeSecTotal: 40000, deaths: 120, rnaEarned: 50000 },
    quest: { kills: 1000, timeMs: 300000, rna: 2000, mutations: 3, elites: 5, noDamageMs: 150000 },
    run: { timeMs: 300000, kills: 1000, hostCells: 5, level: 10, combo: 120, noDamageMs: 150000 },
    win: true,
    expectLine1: 'Ближайшая цель: Цепь лизиса',
    expectLine2: 'Ветка «Инфекция / Лизис»: 1 / 2 · СИНГУЛЯРНОСТЬ + ЦЕПЬ ЛИЗИСА',
    tapGoal: false,
  },
  {
    id: 'neutral-320',
    label: '5 · нейтральная строка (всё закрыто), 320×520',
    viewport: { width: 320, height: 520 },
    rotationPredicate: (r) => !r.includes('marathon') && !r.includes('veteran'),
    save: {
      muted: true, runs: 120, totalKills: 120000,
      achievements: ['first-contact', 'continuous-flow', 'stable-core', 'adaptation', 'deep-dive', 'epidemic', 'cleanup-500', 'restart-3', 'full-protocol'],
      evolutionsSeen: ['prism', 'halo', 'singularity'],
      legendarySeen: ['split-geometry', 'lysis-chain', 'zero-point', 'core-predator', 'myocardial-rhythm', 'last-carrier'],
    },
    meta: { questsCompleted: 60, starsSpent: 600, maxStreak: 30, timeSecTotal: 40000, deaths: 120, rnaEarned: 50000 },
    quest: { kills: 1000, timeMs: 300000, rna: 2000, mutations: 3, elites: 5, noDamageMs: 150000 },
    run: { timeMs: 300000, kills: 1000, hostCells: 5, level: 10, combo: 120, noDamageMs: 150000 },
    win: true,
    expectLine1: 'Ближайшая цель: сегодня всё выполнено',
    expectLine2: 'Новые задания появятся завтра — или просто начни новый забег.',
    tapGoal: false,
  },
];

(async () => {
  const { selectDailyQuests, utcDayKey, catalog } = loadRotation();
  const browser = await launchBrowser();
  const failures = [];
  const check = (ok, label) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures.push(label);
  };
  try {
    for (const sc of SCENARIOS) {
      const { fakeNow, rotation } = findDate(selectDailyQuests, utcDayKey, catalog, sc.rotationPredicate);
      console.log(`\n--- ${sc.label} ---`);
      console.log(`rotation ${rotation.join(', ')} (fake day ${utcDayKey(fakeNow)})`);
      const { ctx, page, errors, scoreCount } = await bootGoal(browser, sc.viewport, { ...sc, fakeNow });
      try {
        const goal = await goalLines(page);
        check(goal.line1 && goal.line1.text === sc.expectLine1, `${sc.id}: line1 is the expected goal (got ${JSON.stringify(goal.line1?.text)})`);
        check(goal.line2 && goal.line2.text === sc.expectLine2, `${sc.id}: line2 is the expected goal (got ${JSON.stringify(goal.line2?.text)})`);
        check(Boolean(goal.line1?.visible) && Boolean(goal.line2?.visible), `${sc.id}: both lines visible`);
        check(
          Boolean(goal.line1) && goal.line1.bw <= sc.viewport.width - 28 && goal.line1.bh >= 10,
          `${sc.id}: line1 fits the report width (${goal.line1?.bw}×${goal.line1?.bh} at ${sc.viewport.width})`
        );
        check(
          Boolean(goal.line2) && goal.line2.bw <= sc.viewport.width - 28 && goal.line2.bh >= 10,
          `${sc.id}: line2 fits the report width (${goal.line2?.bw}×${goal.line2?.bh} at ${sc.viewport.width})`
        );
        check(!goal.line1?.interactive && !goal.line2?.interactive, `${sc.id}: goal lines are not interactive`);
        check(scoreCount() >= 1, `${sc.id}: score submitted (${scoreCount()} requests)`);
        check(errors.length === 0, `${sc.id}: no page errors${errors.length ? ` (${errors[0]})` : ''}`);
        await page.screenshot({ path: path.join(SHOTS, `${sc.id}.png`) });
        if (sc.tapGoal && goal.line1) {
          const before = scoreCount();
          await touchAt(ctx, page, { x: goal.line1.cx, y: goal.line1.cy });
          await sleep(300);
          const stillResult = await page.evaluate(() => {
            const scenes = window.__game.scene;
            return scenes.isActive('UI') && !scenes.isActive('Menu');
          });
          check(stillResult, `${sc.id}: tap on the goal line does nothing (still on the result)`);
          check(scoreCount() === before, `${sc.id}: tap on the goal line sends no score (${before} -> ${scoreCount()})`);
        }
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${failures.length === 0 ? 'run-result-next-goal probe: ALL PASS' : `run-result-next-goal probe: ${failures.length} FAILURES`}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

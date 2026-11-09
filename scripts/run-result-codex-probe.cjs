/**
 * Run result — real Codex openings: browser probe.
 *
 * Drives the real game (dev server, `window.__game`) through the five
 * states from the brief and checks the result screen and the UIScene ->
 * MenuScene Codex path. Same pattern as scripts/result-actions-smoke.cjs:
 * the save is seeded through localStorage, the run is finished directly
 * with `gs.finish(...)`, and the buttons are pressed with real touch.
 *
 * What it checks per state (base runs):
 *  - the opening rows name exactly the entries the run opened for the
 *    first time (never the achievement count);
 *  - the old plate «★ Открыто в Кодексе: +N записей» is gone;
 *  - achievements are shown on their own line, by name, and are not
 *    presented as Codex entries;
 *  - a re-chosen known card stays in the run list;
 *  - each opening has ONE tap zone (name + tab subtitle together):
 *    at least 44px tall and the full row width (W - 32);
 *  - both result buttons are 46px tall.
 *
 * What it checks on the tap runs (separate boots, one tap each):
 *  - tap on the zone centre, left edge and right edge opens the Codex
 *    on the entry's tab with the entry highlighted (a «НОВОЕ» badge);
 *  - both two-openings transitions, in separate runs: «Сингулярность»
 *    -> «Синергии», «Нулевая точка» -> «Легендарные»;
 *  - the save and the score outbox are unchanged (no re-recording);
 *  - the score submission happened exactly once: at least one
 *    /api/score request before the tap, and none after it.
 *
 * What it checks on the swipe run (320x520, first trophy):
 *  - a swipe through the row scrolls the report and does not open
 *    the Codex;
 *  - releasing outside the row (pointer down near the top edge, a
 *    short move up, release outside the zone) does not open the Codex;
 *  - after scrolling, a tap on the visible row still opens the Codex.
 *
 * The probe runs every check and prints a report; it exits non-zero
 * when any check fails, so the same script reproduces the defect on
 * the base and verifies the fix on the patched branch.
 *
 * Usage (from the repo root; the dev server must be running on 5173):
 *   node scripts/run-result-codex-probe.cjs [--video] [--shots-dir <dir>]
 *
 * Chrome resolution, in order:
 *   1. $CHROME_PATH — an explicit Chrome/Chromium executable path.
 *   2. System Chrome (Playwright channel "chrome").
 *   3. The Playwright-bundled Chromium (this VM's cache path, if present).
 *   4. Playwright's default bundled Chromium.
 * Windows (PowerShell, system Chrome):
 *   node scripts/run-result-codex-probe.cjs --video
 * Windows (explicit path):
 *   $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
 *   node scripts/run-result-codex-probe.cjs --video
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
const SHOTS = path.resolve(shotsDirArg >= 0 ? argv[shotsDirArg + 1] : 'shots/run-result-codex');
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

/** A touch drag: down at `from`, move through `points`, release at the last one. */
async function touchDrag(ctx, page, from, points) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(45);
  for (const p of points) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
    });
    await sleep(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Flatten a scene's display list into the text objects it holds. */
async function sceneTexts(page, sceneName) {
  return page.evaluate((name) => {
    const scene = window.__game.scene.getScene(name);
    if (!scene) return [];
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    scene.children.list.forEach(visit);
    return flat
      .filter((o) => o && typeof o.text === 'string')
      .map((o) => {
        const b = typeof o.getBounds === 'function' ? o.getBounds() : null;
        return {
          name: o.name || '',
          text: o.text,
          visible: o.visible !== false,
          color: o.style?.color || null,
          cx: b ? Math.round(b.centerX) : null,
          cy: b ? Math.round(b.centerY) : null,
          bw: b ? Math.round(b.width) : null,
          bh: b ? Math.round(b.height) : null,
        };
      });
  }, sceneName);
}

/** The opening tap zones: invisible rectangles named ofeliya-result-opening-zone-*. */
async function sceneZones(page, sceneName) {
  return page.evaluate((name) => {
    const scene = window.__game.scene.getScene(name);
    if (!scene) return [];
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    scene.children.list.forEach(visit);
    return flat
      .filter((o) => o && typeof o.name === 'string' && o.name.startsWith('ofeliya-result-opening-zone-'))
      .map((o) => {
        const b = typeof o.getBounds === 'function' ? o.getBounds() : null;
        if (!b) return null;
        return {
          name: o.name,
          left: Math.round(b.left),
          right: Math.round(b.right),
          top: Math.round(b.top),
          bottom: Math.round(b.bottom),
          cx: Math.round(b.centerX),
          cy: Math.round(b.centerY),
          width: Math.round(b.width),
          height: Math.round(b.height),
        };
      })
      .filter(Boolean);
  }, sceneName);
}

async function buttonHeight(page, label) {
  return page.evaluate((wanted) => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    const text = flat.find((obj) => obj?.text === wanted && obj.visible !== false);
    if (!text) return null;
    const container = text.parentContainer;
    const bg = container?.list?.find(
      (obj) =>
        obj !== text &&
        obj.input?.enabled &&
        Math.abs((obj.y ?? -9999) - text.y) < 1 &&
        typeof obj.getBounds === 'function'
    );
    const bounds = bg?.getBounds?.();
    return bounds ? { h: Math.round(bounds.height), cx: Math.round(bounds.centerX), cy: Math.round(bounds.centerY) } : null;
  }, label);
}

async function bootResult(browser, viewport, saveSeed, runSetup, win) {
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
  await ctx.addInitScript(({ width, height, seed }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify(seed));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-run-result-codex-probe',
      initDataUnsafe: { user: { id: 42, first_name: 'Result', last_name: 'QA' } },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      shareMaxContent: async () => {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { ...viewport, seed: saveSeed });

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

  await page.evaluate(({ setup, isWin }) => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    const run = gs.runState.run;
    run.timeMs = setup.timeMs;
    run.kills = setup.kills;
    run.hostCellsInfected = setup.hostCells;
    run.highestLevel = setup.level;
    run.comboBest = setup.combo;
    run.maxNoDamageMs = setup.noDamageMs || 0;
    gs.runState.stage.level = setup.level;
    run.legendaryIds = new Set(setup.legendaryIds || []);
    run.evolutionsSeen = new Set(setup.evolutions || []);
    if (setup.bossClearMs) run.bossClearTimesMs = { 'immune-prime': setup.bossClearMs };
    gs.finish(isWin);
    game.scene.getScene('UI').update();
  }, { setup: runSetup, isWin: win });
  await sleep(400);

  const scoreCount = () => scoreRequests;
  return { ctx, page, errors, scoreCount };
}

async function storageSnapshot(page) {
  return page.evaluate(() => ({
    save: localStorage.getItem('ofeliya_save_v1'),
    outbox: localStorage.getItem('ofeliya_score_outbox_v1'),
    dailyOutbox: localStorage.getItem('ofeliya_daily_score_outbox_v1'),
  }));
}

const SCENARIOS = [
  {
    id: 'achievement-only',
    label: '1 · новое достижение без открытия',
    win: false,
    save: { muted: true, runs: 1, achievements: [] },
    run: { timeMs: 30000, kills: 50, hostCells: 0, level: 3, combo: 1 },
    expectOpenings: [],
    expectAchievements: ['first-contact'],
  },
  {
    id: 'first-trophy',
    label: '2 · первое открытие легендарной',
    win: true,
    save: { muted: true, runs: 2, achievements: ['first-contact'] },
    run: { timeMs: 130000, kills: 90, hostCells: 5, level: 10, combo: 10, bossClearMs: 90000, legendaryIds: ['core-predator'] },
    expectOpenings: [{ kind: 'legendary', id: 'core-predator', tab: 'legendary' }],
    // recordRun bumps runs 2 -> 3 before captureAchievements, so the
    // run also unlocks the third-run achievement (not a Codex opening).
    expectAchievements: ['restart-3'],
  },
  {
    id: 'repeat-legendary',
    label: '3 · повторный выбор известной карты',
    win: false,
    save: { muted: true, runs: 2, achievements: ['first-contact'], legendarySeen: ['core-predator'] },
    run: { timeMs: 20000, kills: 10, hostCells: 0, level: 2, combo: 1, legendaryIds: ['core-predator'] },
    expectOpenings: [],
    // Same third-run achievement as in state 2; no Codex opening.
    expectAchievements: ['restart-3'],
    expectRunList: ['ХИЩНИК ЯДРА'],
  },
  {
    id: 'two-openings',
    label: '4 · два открытия в разных вкладках',
    win: false,
    save: { muted: true, runs: 2, achievements: ['first-contact'] },
    run: { timeMs: 20000, kills: 10, hostCells: 0, level: 2, combo: 1, legendaryIds: ['zero-point'], evolutions: ['singularity'] },
    expectOpenings: [
      { kind: 'evolution', id: 'singularity', tab: 'synergies' },
      { kind: 'legendary', id: 'zero-point', tab: 'legendary' },
    ],
    expectAchievements: ['adaptation', 'restart-3'],
  },
  {
    id: 'no-openings',
    label: '5 · отсутствие открытий',
    win: false,
    save: { muted: true, runs: 2, achievements: ['first-contact', 'adaptation'], legendarySeen: ['core-predator'], evolutionsSeen: ['singularity'] },
    run: { timeMs: 20000, kills: 10, hostCells: 0, level: 2, combo: 1, legendaryIds: ['core-predator'], evolutions: ['singularity'] },
    expectOpenings: [],
    // The third-run achievement unlocks here too; still no opening.
    expectAchievements: ['restart-3'],
  },
];

const VIEWPORTS = [
  { width: 390, height: 844, label: '390x844' },
  { width: 320, height: 520, label: '320x520' },
];

const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);

async function expectCodex(page, ctx, expected, beforeStorage, beforeScore, scoreCount, errors, fail) {
  try {
    await page.waitForFunction(
      () => {
        const g = window.__game;
        return g.scene.isActive('Menu') && !g.scene.isActive('Game') && !g.scene.isActive('UI');
      },
      { timeout: 3000 }
    );
  } catch {
    fail('Menu did not open after tapping the opening row');
    return;
  }
  await sleep(300);
  const menuTexts = await sceneTexts(page, 'Menu');
  const menuVisible = menuTexts.filter((t) => t.visible);
  const badge = menuVisible.find((t) => t.name === `ofeliya-codex-new-badge-${expected.id}`);
  if (!badge) fail(`Codex badge missing for ${expected.id}`);
  else if (badge.text !== 'НОВОЕ') fail(`Codex badge text is «${badge.text}», expected «НОВОЕ»`);
  const tabLabel = expected.tab === 'legendary' ? 'ЛЕГЕНДАРНЫЕ' : 'СИНЕРГИИ';
  const tab = menuVisible.find((t) => t.text === tabLabel);
  if (!tab) fail(`Codex tab missing: ${tabLabel}`);
  // The Codex active tab is VISUAL_TEXT.warning (#d9ba79); the other
  // tabs are muted (#9cacac). (The result screen's gold is #ffe066 —
  // a different gold; the tab must match the Codex palette, not the
  // result screen's.)
  else if (tab.color !== '#d9ba79') fail(`Codex tab ${tabLabel} not active (color ${tab.color})`);
  for (const other of ['СИНЕРГИИ', 'ЛЕГЕНДАРНЫЕ', 'МАСТЕРСТВО']) {
    if (other === tabLabel) continue;
    const otherTab = menuVisible.find((t) => t.text === other);
    if (otherTab && otherTab.color === '#d9ba79') fail(`Codex tab ${other} also active`);
  }
  const afterStorage = await storageSnapshot(page);
  if (JSON.stringify(afterStorage) !== JSON.stringify(beforeStorage)) {
    fail('storage changed on the Codex transition (re-recording?)');
  }
  // The submission must have happened exactly once: at least one request
  // before the tap (the original submit), and none after it.
  if (beforeScore < 1) fail(`no /api/score request before the tap (score=${beforeScore}); the original submission did not happen`);
  if (scoreCount() !== beforeScore) fail(`new /api/score request on the Codex transition (before=${beforeScore}, after=${scoreCount()})`);
  if (errors.length) fail(`page errors after transition: ${errors.join(' | ')}`);
}

async function expectStillResult(page, entry, fail) {
  // Still on the result screen: the UI scene is active, the Menu is not,
  // and the opening row is still visible. (The Game scene is PAUSED on
  // the result screen, so isActive('Game') is false there — it must not
  // be part of this check.)
  const onResult = await page.evaluate((entryId) => {
    const g = window.__game;
    if (!g.scene.isActive('UI') || g.scene.isActive('Menu')) return false;
    const ui = g.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => { flat.push(obj); if (Array.isArray(obj?.list)) obj.list.forEach(visit); };
    ui.children.list.forEach(visit);
    return flat.some((o) => o.name === `ofeliya-result-opening-${entryId}-name` && o.visible !== false);
  }, `${entry.kind}-${entry.id}`);
  if (!onResult) fail('left the result screen (Menu opened?)');
}

/** Base checks: rows, old plate, achievements, run list, buttons, zone geometry. No tap. */
async function runScenario(browser, scenario, viewport) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const { ctx, page, errors, scoreCount } = await bootResult(
    browser, viewport, scenario.save, scenario.run, scenario.win
  );
  const shot = (suffix) => page.screenshot({ path: path.join(SHOTS, `${scenario.id}-${viewport.label}-${suffix}.png`) });

  try {
    await shot('result');
    const texts = await sceneTexts(page, 'UI');
    const visible = texts.filter((t) => t.visible);

    // The old plate must be gone.
    const oldPlate = visible.find((t) => t.text.startsWith('★ Открыто в Кодексе'));
    if (oldPlate) fail(`old plate still present: «${oldPlate.text}»`);

    // The opening rows name exactly the expected entries.
    const openingNames = visible.filter((t) => t.name.startsWith('ofeliya-result-opening-') && t.name.endsWith('-name'));
    const openingSubs = visible.filter((t) => t.name.startsWith('ofeliya-result-opening-') && t.name.endsWith('-sub'));
    if (openingNames.length !== scenario.expectOpenings.length) {
      fail(`opening rows: expected ${scenario.expectOpenings.length}, got ${openingNames.length} (${openingNames.map((t) => t.text).join(' | ') || 'none'})`);
    }
    for (const expected of scenario.expectOpenings) {
      const nameRow = openingNames.find((t) => t.name === `ofeliya-result-opening-${expected.kind}-${expected.id}-name`);
      if (!nameRow) { fail(`opening row missing: ${expected.kind}/${expected.id}`); continue; }
      const subRow = openingSubs.find((t) => t.name === `ofeliya-result-opening-${expected.kind}-${expected.id}-sub`);
      if (!subRow) { fail(`opening sub-row missing: ${expected.kind}/${expected.id}`); continue; }
    }

    // One tap zone per opening: at least 44px tall, full row width.
    // (The old design had two 22px hit areas whose combined span depended
    // on font metrics: 44px on Linux, 43px on Windows Chrome.)
    // The row width is the game's scale width minus 32, read live so the
    // check does not assume the viewport equals the layout width.
    const scaleWidth = await page.evaluate(() => window.__game.scale.width);
    const zones = await sceneZones(page, 'UI');
    for (const expected of scenario.expectOpenings) {
      const zone = zones.find((z) => z.name === `ofeliya-result-opening-zone-${expected.kind}-${expected.id}`);
      if (!zone) { fail(`tap zone missing for ${expected.id} (no ofeliya-result-opening-zone object)`); continue; }
      if (zone.height < 44) fail(`tap zone for ${expected.id} is ${zone.height}px tall (< 44)`);
      if (zone.width !== scaleWidth - 32) fail(`tap zone for ${expected.id} is ${zone.width}px wide (expected ${scaleWidth - 32}, full row width)`);
    }
    if (zones.length !== scenario.expectOpenings.length) {
      fail(`tap zones: expected ${scenario.expectOpenings.length}, got ${zones.length}`);
    }

    // Achievements are a separate line, by name.
    const achLine = visible.find((t) => t.name === 'ofeliya-result-achievement');
    if (scenario.expectAchievements.length > 0) {
      if (!achLine) fail(`achievements line missing (expected ${scenario.expectAchievements.join(', ')})`);
    } else if (achLine) {
      fail(`achievements line present but none expected: «${achLine.text}»`);
    }

    // A re-chosen known card stays in the run list.
    for (const name of scenario.expectRunList || []) {
      if (!visible.some((t) => t.text.includes(name))) fail(`run list missing chosen card: ${name}`);
    }

    // Both result buttons are at least 44px tall.
    let newRunCy = null;
    for (const label of ['НОВЫЙ ЗАБЕГ', 'В МЕНЮ']) {
      const b = await buttonHeight(page, label);
      if (!b) fail(`button not found: ${label}`);
      else if (b.h < 44) fail(`button ${label} is ${b.h}px tall (< 44)`);
      if (label === 'НОВЫЙ ЗАБЕГ' && b) newRunCy = b.cy;
    }

    // On the tightest viewport the openings must be visible without
    // scrolling: above the first result button.
    if (viewport.label === '320x520' && newRunCy !== null) {
      for (const expected of scenario.expectOpenings) {
        const nameRow = openingNames.find((t) => t.name === `ofeliya-result-opening-${expected.kind}-${expected.id}-name`);
        if (nameRow && nameRow.cy !== null && nameRow.cy >= newRunCy) {
          fail(`opening ${expected.id} is below the fold at 320x520 (row y ${nameRow.cy}, first button y ${newRunCy})`);
        }
      }
    }

    if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
  } finally {
    await ctx.close();
  }
  return failures;
}

/** One tap on one entry's zone, at a chosen point. Verifies the Codex transition. */
async function runTap(browser, scenario, viewport, entry, pointName, videoPrefix) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const { ctx, page, errors, scoreCount } = await bootResult(
    browser, viewport, scenario.save, scenario.run, scenario.win
  );
  try {
    // The tap target: the zone object when it exists; otherwise the
    // row-width band around the name/sub texts (the old code has no
    // zone object, so the edge taps reproduce its failure this way).
    const zones = await sceneZones(page, 'UI');
    const zone = zones.find((z) => z.name === `ofeliya-result-opening-zone-${entry.kind}-${entry.id}`);
    let target;
    if (zone) {
      target = zone;
    } else {
      const texts = await sceneTexts(page, 'UI');
      const visible = texts.filter((t) => t.visible);
      const nameRow = visible.find((t) => t.name === `ofeliya-result-opening-${entry.kind}-${entry.id}-name`);
      const subRow = visible.find((t) => t.name === `ofeliya-result-opening-${entry.kind}-${entry.id}-sub`);
      if (!nameRow || !subRow) { fail(`opening rows missing for ${entry.id}`); return failures; }
      target = {
        left: 16, right: viewport.width - 16,
        top: nameRow.cy - Math.round(nameRow.bh / 2) - 4,
        bottom: subRow.cy + Math.round(subRow.bh / 2) + 4,
        cx: viewport.width / 2, cy: nameRow.cy,
      };
    }
    const point =
      pointName === 'center' ? { x: target.cx, y: target.cy } :
      pointName === 'left' ? { x: target.left + 6, y: target.cy } :
      { x: target.right - 6, y: target.cy };
    const beforeStorage = await storageSnapshot(page);
    const beforeScore = scoreCount();
    if (VIDEO && videoPrefix) {
      for (let i = 0; i < 6; i += 1) {
        await page.screenshot({ path: path.join(SHOTS, `${videoPrefix}-${String(i).padStart(2, '0')}.png`) });
        await sleep(120);
      }
    }
    await touchAt(ctx, page, point);
    if (VIDEO && videoPrefix) {
      for (let i = 6; i < 12; i += 1) {
        await page.screenshot({ path: path.join(SHOTS, `${videoPrefix}-${String(i).padStart(2, '0')}.png`) });
        await sleep(120);
      }
    }
    await page.screenshot({ path: path.join(SHOTS, `${scenario.id}-${viewport.label}-tap-${pointName}-${entry.id}-codex.png`) });
    await expectCodex(page, ctx, entry, beforeStorage, beforeScore, scoreCount, errors, fail);
  } finally {
    await ctx.close();
  }
  return failures;
}

/** Swipe run: release outside the row, swipe through it, then tap the visible row. */
async function runSwipe(browser, scenario, viewport) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const { ctx, page, errors, scoreCount } = await bootResult(
    browser, viewport, scenario.save, scenario.run, scenario.win
  );
  try {
    const entry = scenario.expectOpenings[0];
    const readZone = async () => {
      const zones = await sceneZones(page, 'UI');
      const zone = zones.find((z) => z.name === `ofeliya-result-opening-zone-${entry.kind}-${entry.id}`);
      if (zone) return zone;
      const texts = await sceneTexts(page, 'UI');
      const visible = texts.filter((t) => t.visible);
      const nameRow = visible.find((t) => t.name === `ofeliya-result-opening-${entry.kind}-${entry.id}-name`);
      const subRow = visible.find((t) => t.name === `ofeliya-result-opening-${entry.kind}-${entry.id}-sub`);
      if (!nameRow || !subRow) return null;
      return {
        left: 16, right: viewport.width - 16,
        top: nameRow.cy - Math.round(nameRow.bh / 2) - 4,
        bottom: subRow.cy + Math.round(subRow.bh / 2) + 4,
        cx: viewport.width / 2, cy: nameRow.cy,
      };
    };
    let zone = await readZone();
    if (!zone) { fail(`tap zone missing for ${entry.id}`); return failures; }
    const beforeStorage = await storageSnapshot(page);
    const beforeScore = scoreCount();

    // 1) Release outside the row: down near the bottom edge, a short
    // move down (the report is at its top limit, offset 0, so the zone
    // does not move), release outside the zone. Movement is 10px
    // (under the 12px swipe guard), so only the release-position
    // check can stop the navigation.
    const downPoint = { x: zone.cx, y: zone.bottom - 4 };
    const upPoint = { x: zone.cx, y: zone.bottom + 6 };
    await touchDrag(ctx, page, downPoint, [upPoint]);
    await sleep(300);
    await expectStillResult(page, entry, fail);

    // 2) Swipe through the row (up 80px): the report scrolls, no Codex.
    if (VIDEO) {
      for (let i = 0; i < 2; i += 1) {
        await page.screenshot({ path: path.join(SHOTS, `video-swipe-${String(i).padStart(2, '0')}.png`) });
        await sleep(120);
      }
    }
    const cyBefore = zone.cy;
    const swipePoints = [];
    for (let step = 1; step <= 8; step += 1) swipePoints.push({ x: zone.cx, y: zone.cy - step * 10 });
    await touchDrag(ctx, page, { x: zone.cx, y: zone.cy }, swipePoints);
    await sleep(300);
    await expectStillResult(page, entry, fail);
    zone = await readZone();
    if (!zone) { fail('tap zone gone after the swipe'); return failures; }
    if (zone.cy === cyBefore) fail('swipe did not scroll the report (zone did not move)');
    if (VIDEO) {
      for (let i = 2; i < 5; i += 1) {
        await page.screenshot({ path: path.join(SHOTS, `video-swipe-${String(i).padStart(2, '0')}.png`) });
        await sleep(120);
      }
    }

    // 3) After scrolling, a tap on the visible row still opens the Codex.
    if (VIDEO) {
      for (let i = 5; i < 8; i += 1) {
        await page.screenshot({ path: path.join(SHOTS, `video-swipe-${String(i).padStart(2, '0')}.png`) });
        await sleep(120);
      }
    }
    await touchAt(ctx, page, { x: zone.cx, y: zone.cy });
    await page.screenshot({ path: path.join(SHOTS, `${scenario.id}-${viewport.label}-swipe-codex.png`) });
    await expectCodex(page, ctx, entry, beforeStorage, beforeScore, scoreCount, errors, fail);
  } finally {
    await ctx.close();
  }
  return failures;
}

(async () => {
  const browser = await launchBrowser();
  const report = [];
  const run = async (key, fn) => {
    let failures;
    try {
      failures = await fn();
    } catch (error) {
      failures = [`probe error: ${error.message}`];
    }
    report.push({ key, failures });
    console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'}  ${key}${failures.length ? '\n      ' + failures.join('\n      ') : ''}`);
  };

  const firstTrophy = scenarioById('first-trophy');
  const twoOpenings = scenarioById('two-openings');

  // Base checks: every scenario at 390x844; first-trophy also at 320x520.
  for (const scenario of SCENARIOS) {
    const viewports = scenario.id === 'first-trophy' ? VIEWPORTS : [VIEWPORTS[0]];
    for (const viewport of viewports) {
      await run(`${scenario.id} @ ${viewport.label}`, () => runScenario(browser, scenario, viewport));
    }
  }

  // Tap matrix: centre and both edges, on both viewports.
  for (const viewport of VIEWPORTS) {
    for (const pointName of ['center', 'left', 'right']) {
      const videoPrefix = VIDEO && viewport.label === '320x520' && pointName === 'left'
        ? 'video-edge' : null;
      await run(
        `tap-${pointName} first-trophy @ ${viewport.label}`,
        () => runTap(browser, firstTrophy, viewport, firstTrophy.expectOpenings[0], pointName, videoPrefix)
      );
    }
  }

  // Both two-openings transitions, in separate runs.
  for (const entry of twoOpenings.expectOpenings) {
    await run(
      `tap-${entry.id} two-openings @ 390x844`,
      () => runTap(browser, twoOpenings, VIEWPORTS[0], entry, 'center', null)
    );
  }

  // Swipe behaviour on the tight viewport.
  await run('swipe first-trophy @ 320x520', () => runSwipe(browser, firstTrophy, VIEWPORTS[1]));

  await browser.close();
  const failed = report.filter((r) => r.failures.length > 0);
  console.log(`\nrun-result-codex-probe: ${report.length - failed.length}/${report.length} checks passed`);
  if (failed.length) process.exit(1);
  console.log('run-result-codex-probe: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

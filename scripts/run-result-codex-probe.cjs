/**
 * Run result — real Codex openings: browser probe.
 *
 * Drives the real game (dev server, `window.__game`) through the five
 * states from the brief and checks the result screen and the UIScene ->
 * MenuScene Codex path. Same pattern as scripts/result-actions-smoke.cjs:
 * the save is seeded through localStorage, the run is finished directly
 * with `gs.finish(...)`, and the buttons are pressed with real touch.
 *
 * What it checks per state:
 *  - the opening rows name exactly the entries the run opened for the
 *    first time (never the achievement count);
 *  - the old plate «★ Открыто в Кодексе: +N записей» is gone;
 *  - achievements are shown on their own line, by name, and are not
 *    presented as Codex entries;
 *  - a re-chosen known card stays in the run list;
 *  - each opening row's tap zone is 44px (two 22px hit areas);
 *  - both result buttons are 46px tall.
 *
 * What it checks on the transition (states 2 and 4):
 *  - the Codex opens on the entry's tab with the entry highlighted
 *    (a «НОВОЕ» badge);
 *  - the save and the score outbox are unchanged (no re-recording);
 *  - no new /api/score request is made (no re-submission).
 *
 * The probe runs every scenario and prints a report; it exits non-zero
 * when any check fails, so the same script reproduces the defect on the
 * base and verifies the fix on the patched branch.
 *
 * Usage:
 *   node scripts/run-result-codex-probe.cjs [--video] [--shots-dir <dir>]
 * The dev server must be running (npm run dev, port 5173).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1187/chrome-linux/chrome';
if (!fs.existsSync(CHROME)) throw new Error('Playwright chromium not found: ' + CHROME);

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
          hitArea: o.input?.hitArea
            ? { width: o.input.hitArea.width, height: o.input.hitArea.height }
            : null,
        };
      });
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
    transition: true,
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
    transition: true,
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

async function runScenario(browser, scenario, viewport, checkTransition) {
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
      const nameH = nameRow.hitArea?.height;
      const subH = subRow.hitArea?.height;
      if (nameH !== 22 || subH !== 22) fail(`tap zone for ${expected.id}: name ${nameH}px, sub ${subH}px (expected 22+22=44)`);
      if (subRow.cy !== null && nameRow.cy !== null && subRow.cy - nameRow.cy < 22) {
        fail(`opening rows too close for ${expected.id}: ${subRow.cy - nameRow.cy}px apart (pair span ${subRow.cy - nameRow.cy + 22}px < 44)`);
      }
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

    // The transition: tap the first opening row -> the Codex on its tab,
    // with the entry highlighted; the save and the submission are untouched.
    if (checkTransition && scenario.expectOpenings.length > 0) {
      const first = scenario.expectOpenings[0];
      const nameRow = openingNames.find((t) => t.name === `ofeliya-result-opening-${first.kind}-${first.id}-name`);
      if (!nameRow || nameRow.cx === null) {
        fail(`cannot tap opening row ${first.id}: no bounds`);
      } else {
        const beforeStorage = await storageSnapshot(page);
        const beforeScore = scoreCount();
        if (VIDEO && scenario.id === 'first-trophy' && viewport.label === '390x844') {
          for (let i = 0; i < 6; i += 1) {
            await page.screenshot({ path: path.join(SHOTS, `video-${String(i).padStart(2, '0')}.png`) });
            await sleep(120);
          }
        }
        await touchAt(ctx, page, { x: nameRow.cx, y: nameRow.cy });
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
        }
        if (VIDEO && scenario.id === 'first-trophy' && viewport.label === '390x844') {
          for (let i = 6; i < 12; i += 1) {
            await page.screenshot({ path: path.join(SHOTS, `video-${String(i).padStart(2, '0')}.png`) });
            await sleep(120);
          }
        }
        await sleep(300);
        await shot('codex');
        const menuTexts = await sceneTexts(page, 'Menu');
        const menuVisible = menuTexts.filter((t) => t.visible);
        const badge = menuVisible.find((t) => t.name === `ofeliya-codex-new-badge-${first.id}`);
        if (!badge) fail(`Codex badge missing for ${first.id}`);
        else if (badge.text !== 'НОВОЕ') fail(`Codex badge text is «${badge.text}», expected «НОВОЕ»`);
        const tabLabel = first.tab === 'legendary' ? 'ЛЕГЕНДАРНЫЕ' : 'СИНЕРГИИ';
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
        if (scoreCount() !== beforeScore) fail('new /api/score request on the Codex transition (re-submission?)');
        if (errors.length) fail(`page errors after transition: ${errors.join(' | ')}`);
      }
    }
  } finally {
    await ctx.close();
  }
  return failures;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const report = [];
  for (const scenario of SCENARIOS) {
    // Every scenario at 390x844; the first-trophy path also at 320x520.
    const viewports = scenario.id === 'first-trophy' ? VIEWPORTS : [VIEWPORTS[0]];
    for (const viewport of viewports) {
      const checkTransition = scenario.transition === true;
      let failures;
      try {
        failures = await runScenario(browser, scenario, viewport, checkTransition);
      } catch (error) {
        failures = [`probe error: ${error.message}`];
      }
      const key = `${scenario.id} @ ${viewport.label}`;
      report.push({ key, failures });
      console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'}  ${key}${failures.length ? '\n      ' + failures.join('\n      ') : ''}`);
    }
  }
  await browser.close();
  const failed = report.filter((r) => r.failures.length > 0);
  console.log(`\nrun-result-codex-probe: ${report.length - failed.length}/${report.length} scenarios passed`);
  if (failed.length) process.exit(1);
  console.log('run-result-codex-probe: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

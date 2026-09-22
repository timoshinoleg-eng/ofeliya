/**
 * Daily CTA runtime browser smoke (SLICE-DAILY-CTA-A).
 *
 * The Menu CTA is intentionally disabled in this core slice, so the daily path is entered
 * through a registry harness (never by editing MenuScene). The harness seeds the same
 * registry keys `launchDailyRun` would write, then starts the REAL Game scene, so the real
 * runtime / result-screen / checkpoint code is exercised end to end.
 *
 * Structure mirrors scripts/score-client-smoke.cjs (browserDriver + st.max.ru routing)
 * so it runs on Windows and in CI.
 */
const fs = require('fs');

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

const BASE = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';

const TICKET = {
  runId: 'dailyRun_smoketest0001',
  runSeed: 'dailysmokeseed001',
  dateKey: '2026-09-22',
  issuedAt: 1_000,
  expiresAt: 9_999_999_999_999,
  difficultyId: 'standard',
  rulesetVersion: 2,
  campaignVersion: 2,
};

const MAX_INIT_DATA = 'signed-daily-cta-smoke';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function newContext(browser, viewport) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-daily-cta-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Daily', last_name: 'QA' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  return ctx;
}

async function boot(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });
  return { page, errors };
}

async function startGameWith(page, registrySeed) {
  await page.evaluate((seed) => {
    const game = window.__game;
    for (const [key, value] of Object.entries(seed)) game.registry.set(key, value);
    game.scene.getScene('Menu').scene.start('Game');
  }, registrySeed);
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'),
    null,
    { timeout: 20000 }
  );
}

async function finishRun(page) {
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.run.timeMs = 145000;
    gs.runState.run.kills = 73;
    gs.runState.run.hostCellsInfected = 6;
    gs.runState.run.highestLevel = 11;
    gs.runState.stage.level = 11;
    gs.runState.run.comboBest = 19;
    gs.finish(false, 'dead');
    window.__game.scene.getScene('UI').update();
  });
}

async function readResultTexts(page) {
  return page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    return flat.filter((obj) => typeof obj.text === 'string').map((obj) => obj.text);
  });
}

async function waitForText(page, needle, timeout = 6000) {
  await page.waitForFunction(
    (text) => {
      const ui = window.__game.scene.getScene('UI');
      const flat = [];
      const visit = (obj) => {
        flat.push(obj);
        if (Array.isArray(obj?.list)) obj.list.forEach(visit);
      };
      ui.children.list.forEach(visit);
      return flat.some((obj) => typeof obj.text === 'string' && obj.text.includes(text));
    },
    needle,
    { timeout }
  );
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // ---- S1: daily happy path (MAX identity), real runtime + result + checkpoint --------
    {
      const ctx = await newContext(browser, { width: 390, height: 740 });
      let captured = null;
      let scoreRequests = 0;
      await ctx.route('**/api/score', async (route) => {
        scoreRequests += 1;
        captured = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, rank: 5, ranked: true, rulesetVersion: 2, campaignVersion: 2, dailyRunAccepted: true, top: [] }),
        });
      });
      const { page, errors } = await boot(ctx);
      await startGameWith(page, {
        dailyIntent: { runId: TICKET.runId },
        dailyTicket: TICKET,
        runSeedOverride: TICKET.runSeed,
        difficultyId: 'standard',
      });

      const live = await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        const saved = gs.saveCheckpointNow();
        return {
          saved,
          seed: gs.runSeed,
          difficulty: window.__game.registry.get('difficultyId'),
          checkpointKeys: Object.keys(localStorage).filter((k) => k.includes('checkpoint')),
        };
      });
      assert(live.seed === TICKET.runSeed, 'daily run did not adopt the ticket seed: ' + live.seed);
      assert(live.difficulty === 'standard', 'daily run is not on STANDARD: ' + live.difficulty);
      assert(live.saved === false, 'daily run wrote a checkpoint (option 1 violated)');
      assert(live.checkpointKeys.length === 0, 'checkpoint leaked to localStorage: ' + live.checkpointKeys.join(','));

      await finishRun(page);
      await waitForText(page, 'ЕЖЕДНЕВНЫЙ ЗАБЕГ');
      const texts = await readResultTexts(page);
      const joined = texts.join('\n');
      assert(texts.includes('РЕЖИМ: СТАНДАРТ · ежедневный забег'), 'daily mode line missing: ' + joined);
      assert(joined.includes('ЕЖЕДНЕВНЫЙ ЗАБЕГ'), 'daily status line missing');
      assert(!joined.includes('рейтинговый'), 'daily result rendered the global ranked mode: ' + joined);
      assert(!joined.includes('РЕЙТИНГ · МЕСТО'), 'daily result rendered the global ranking line: ' + joined);

      assert(captured, 'no /api/score request captured for the daily run');
      assert(scoreRequests === 1, 'expected exactly one /api/score request, got ' + scoreRequests);
      const p = captured.payload || {};
      assert(captured.platform === 'max', 'daily submission platform mismatch: ' + captured.platform);
      assert(p.daily === true, 'daily flag not set on submission');
      assert(p.dailyRunId === TICKET.runId, 'dailyRunId not submitted: ' + p.dailyRunId);
      assert(p.runSeed === TICKET.runSeed, 'daily runSeed not submitted: ' + p.runSeed);
      assert(p.dateKey === TICKET.dateKey, 'daily dateKey not submitted: ' + p.dateKey);

      const after = await page.evaluate(() => ({
        intent: window.__game.registry.get('dailyIntent') ?? null,
        ticket: window.__game.registry.get('dailyTicket') ?? null,
      }));
      assert(after.intent === null && after.ticket === null, 'daily markers were not cleared after settle');

      // PII scan over the rendered canvas text objects.
      const leaked = texts.filter(
        (t) =>
          t.includes(TICKET.runId) ||
          t.includes(TICKET.runSeed) ||
          t.includes(MAX_INIT_DATA) ||
          t.includes('user=') ||
          t.includes('http')
      );
      assert(leaked.length === 0, 'PII leaked into canvas text: ' + leaked.join(' | '));
      assert(errors.length === 0, 'page errors in daily happy path: ' + errors.join(' | '));
      await ctx.close();
    }

    // ---- S5: fail-closed (daily intent present, ticket missing) -> zero requests --------
    {
      const ctx = await newContext(browser, { width: 390, height: 740 });
      let scoreRequests = 0;
      await ctx.route('**/api/score', async (route) => {
        scoreRequests += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rank: 5, ranked: true, rulesetVersion: 2, campaignVersion: 2, dailyRunAccepted: true }) });
      });
      const { page, errors } = await boot(ctx);
      await startGameWith(page, {
        dailyIntent: { runId: TICKET.runId },
        runSeedOverride: 'stale-leak-seed',
        difficultyId: 'standard',
      });
      const blockedCheckpoint = await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        return {
          saved: gs.saveCheckpointNow(),
          keys: Object.keys(localStorage).filter((k) => k.includes('checkpoint')),
        };
      });
      assert(blockedCheckpoint.saved === false, 'fail-closed Daily intent wrote a checkpoint');
      assert(blockedCheckpoint.keys.length === 0, 'fail-closed Daily intent leaked checkpoint state: ' + blockedCheckpoint.keys.join(','));
      await finishRun(page);
      await waitForText(page, 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · РЕЗУЛЬТАТ НЕ СИНХРОНИЗИРОВАН');
      await page.waitForTimeout(400);
      assert(scoreRequests === 0, 'fail-closed daily branch sent ' + scoreRequests + ' /api/score request(s)');
      const after = await page.evaluate(() => ({
        intent: window.__game.registry.get('dailyIntent') ?? null,
        ticket: window.__game.registry.get('dailyTicket') ?? null,
      }));
      assert(after.intent === null && after.ticket === null, 'stale daily markers were not cleared');
      assert(errors.length === 0, 'page errors in fail-closed path: ' + errors.join(' | '));
      await ctx.close();
    }

    // ---- S9: ordinary non-regression (no daily markers) ---------------------------------
    {
      const ctx = await newContext(browser, { width: 390, height: 740 });
      let captured = null;
      let scoreRequests = 0;
      await ctx.route('**/api/score', async (route) => {
        scoreRequests += 1;
        captured = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rank: 7, ranked: true, rulesetVersion: 2, campaignVersion: 2, top: [] }) });
      });
      const { page, errors } = await boot(ctx);
      await startGameWith(page, { runSeedOverride: 'ordinary-smoke-seed', difficultyId: 'standard' });
      // Non-regression: an ordinary run still checkpoints (option 1 only disables DAILY runs).
      await page.waitForTimeout(3500);
      const ordinaryCheckpoint = await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        return {
          saved: gs.saveCheckpointNow(),
          keys: Object.keys(localStorage).filter((k) => k.includes('checkpoint')),
        };
      });
      assert(
        ordinaryCheckpoint.keys.length >= 1,
        'ordinary run did not checkpoint (regression): ' + JSON.stringify(ordinaryCheckpoint)
      );
      await finishRun(page);
      await waitForText(page, 'РЕЙТИНГ · МЕСТО #7');
      const texts = await readResultTexts(page);
      const joined = texts.join('\n');
      assert(joined.includes('РЕЙТИНГ · МЕСТО #7'), 'ordinary ranked result line missing: ' + joined);
      assert(!joined.includes('ЕЖЕДНЕВНЫЙ ЗАБЕГ'), 'ordinary run wrongly rendered daily copy');
      assert(captured && captured.payload && captured.payload.daily === false, 'ordinary run did not submit daily:false');
      assert(scoreRequests === 1, 'ordinary run request count mismatch: ' + scoreRequests);
      assert(errors.length === 0, 'page errors in ordinary path: ' + errors.join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log('daily cta browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
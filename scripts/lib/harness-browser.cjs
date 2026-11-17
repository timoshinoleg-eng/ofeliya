'use strict';
/**
 * Shared Playwright launch/page helpers for the Autonomous Campaign Harness
 * scripts (track E: time-parity, harness-acceptance, audio-diagnostics).
 *
 * Same launch pattern as the other *-smoke scripts: playwright-core +
 * system Chrome, viewport 390x844, MAX stub routed to an empty script, a
 * muted save + Telegram WebApp stub in an init script. The served build
 * must install the Test API (`window.__ofeliyaTest`, track A) and the QA
 * game hook (`window.__game`): vite dev, or a QA build with
 * VITE_QA_TOOLS=1 + VITE_RELEASE_MATRIX_QA=1.
 *
 * Zero-dep besides playwright-core (already a devDependency via
 * @playwright/test). CommonJS so the .cjs harness scripts can require it.
 */

const fs = require('fs');

const VIEWPORT = { width: 390, height: 844 };

/**
 * Append ?qaHide=gems,atmo,ui to a game URL. Visibility ONLY (qaHide.ts):
 * logic, physics and timers run identically, only pixels disappear — so
 * long stepped legs stay affordable in software rendering without
 * changing any compared time series. Used by the parity and acceptance
 * scripts; the audio probe does not need it.
 */
function withQaHide(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('qaHide', 'gems,atmo,ui');
  return url.toString();
}

function resolveChromeExecutable() {
  if (process.platform === 'win32') return undefined;
  const found = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(
    (candidate) => fs.existsSync(candidate)
  );
  if (!found) throw new Error('Chrome not found (checked /usr/bin/google-chrome{,-stable}, /usr/bin/chromium)');
  return found;
}

/** Launch headless Chromium the way the smoke scripts do. */
async function launchHarnessBrowser({ autoplay = false } = {}) {
  const { chromium } = require('playwright-core');
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  // Lets AudioContext start in 'running' without a user gesture; without it
  // headless audio probes measure the autoplay policy, not the environment.
  if (autoplay) args.push('--autoplay-policy=no-user-gesture-required');
  return chromium.launch({ executablePath: resolveChromeExecutable(), headless: true, args });
}

/**
 * Fresh browser context + page on `url` (localStorage isolation per page,
 * design §4.3). Returns { ctx, page, errors }; `errors` collects pageerror
 * strings for the caller to fail on.
 */
async function newHarnessPage(browser, url) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_difficulty_v1', 'standard');
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-harness-qa',
      initDataUnsafe: { user: { id: 42, first_name: 'Harness', last_name: 'QA' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
}

/** Wait for the track-A Test API; throws with code HARNESS_API_MISSING. */
async function waitForTestApi(page, timeoutMs = 30000) {
  try {
    await page.waitForFunction(
      () => typeof window.__ofeliyaTest?.startCampaign === 'function',
      null,
      { timeout: timeoutMs }
    );
  } catch {
    const error = new Error(
      'HARNESS_API_MISSING: window.__ofeliyaTest is not installed in the served build. ' +
        'Serve a build with the Test API (vite dev, or a QA build with VITE_QA_TOOLS=1).'
    );
    error.code = 'HARNESS_API_MISSING';
    throw error;
  }
  const version = await page.evaluate(() => window.__ofeliyaTest.version);
  if (version !== 1) throw new Error(`unsupported __ofeliyaTest version: ${version} (expected 1)`);
}

/**
 * Start a campaign with the RAF loop stopped FIRST, so Game.create runs on
 * synthetic steps from the deterministic epoch (installAutonomousHarness
 * header note 3b): no wall-clock RAF frame may ever touch the run, or the
 * runTimeMs prefix differs between legs by wall time.
 */
async function startSteppedCampaign(page, { seed, difficulty = 'standard' } = {}) {
  await page.evaluate(() => window.__ofeliyaTest.pause());
  await page.evaluate(
    ({ seed: s, difficulty: d }) => window.__ofeliyaTest.startCampaign({ seed: s, difficulty: d }),
    { seed, difficulty }
  );
}

/**
 * Survival probe: 1M HP, the same pattern scripts/stage-transition-smoke.cjs
 * uses. It isolates time/determinism properties from survival — the player
 * must stay alive for the whole measured segment — and touches no game
 * code. Call after startSteppedCampaign, before advancing.
 */
async function installSurvivalProbe(page) {
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
  });
}

/**
 * In-page auto-choice: a POST_STEP ('poststep', Phaser.Core.Events.POST_STEP)
 * handler that applies the first pending mutation choice on the exact frame
 * the modal opens. A Node-side poll would apply it at chunk boundaries, and
 * legs with different chunk sizes would desync. Errors are recorded to
 * window.__harnessAutoChooseErrors (never thrown inside the step loop);
 * read them back with readAutoChooseErrors(page) and fail the check if any.
 */
async function installAutoChoose(page) {
  await page.evaluate(() => {
    if (window.__harnessAutoChooseInstalled) return;
    window.__harnessAutoChooseInstalled = true;
    window.__harnessChoices = [];
    window.__harnessAutoChooseErrors = [];
    const api = window.__ofeliyaTest;
    // 'poststep' is Phaser.Core.Events.POST_STEP; window.Phaser is not
    // exposed (Phaser is bundled as a module), so the literal is used.
    window.__game.events.on('poststep', () => {
      try {
        const state = api.readState();
        if (state.awaitingChoice && state.pendingChoices.length > 0) {
          const id = state.pendingChoices[0];
          api.chooseUpgrade(id);
          window.__harnessChoices.push(id);
        }
      } catch (error) {
        window.__harnessAutoChooseErrors.push(String((error && error.message) || error));
      }
    });
  });
}

async function readAutoChooseErrors(page) {
  return page.evaluate(() => window.__harnessAutoChooseErrors || []);
}

async function readAutoChoices(page) {
  return page.evaluate(() => window.__harnessChoices || []);
}

module.exports = {
  VIEWPORT,
  withQaHide,
  resolveChromeExecutable,
  launchHarnessBrowser,
  newHarnessPage,
  waitForTestApi,
  startSteppedCampaign,
  installSurvivalProbe,
  installAutoChoose,
  readAutoChooseErrors,
  readAutoChoices,
};

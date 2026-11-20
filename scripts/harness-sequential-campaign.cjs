'use strict';

// Focused browser regression for a second campaign in the SAME Phaser scene.
// Run against a local Vite dev/QA server; no production endpoint is used.
const assert = require('node:assert/strict');
const {
  launchHarnessBrowser,
  newHarnessPage,
  waitForTestApi,
  startSteppedCampaign,
} = require('./lib/harness-browser.cjs');

const URL = process.env.OFELIYA_URL || 'http://127.0.0.1:5176/';
const TIMEOUT_MS = 15000;

function withTimeout(promise, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(label + ' timed out')), TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function startEvents(log) {
  return log.events.filter((event) => event.type === 'RUN_START');
}

async function main() {
  // Optional explicit Chrome/Edge binary for Windows machines with
  // playwright-core but no downloaded Chromium (CI uses the default).
  const browser = process.env.OFELIYA_CHROME_EXE
    ? await require('playwright-core').chromium.launch({
        executablePath: process.env.OFELIYA_CHROME_EXE,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      })
    : await launchHarnessBrowser();
  const { ctx, page, errors } = await newHarnessPage(browser, URL);
  try {
    await waitForTestApi(page);
    await startSteppedCampaign(page, { seed: 'sequential-A' });
    await page.evaluate(() => window.__ofeliyaTest.advance(8));
    const a = await page.evaluate(() => {
      const game = window.__game;
      const scene = game.scene.getScene('Game');
      window.__harnessPreviousRunState = scene.runState;
      return { seed: scene.runSeed, log: window.__ofeliyaTest.getRunLog() };
    });
    assert.equal(a.seed, 'sequential-A');
    assert.equal(startEvents(a.log).length, 1);
    assert.equal(startEvents(a.log)[0].seed, 'sequential-A');

    // A still has a live RunState. startCampaign must process the queued
    // restart and must NEVER return with this old RunState.
    await withTimeout(page.evaluate(
      () => window.__ofeliyaTest.startCampaign({ seed: 'sequential-B' }),
    ), 'second startCampaign');
    const b = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('Game');
      return {
        replaced: scene.runState !== window.__harnessPreviousRunState,
        seed: scene.runSeed,
        log: window.__ofeliyaTest.getRunLog(),
      };
    });
    assert.equal(b.replaced, true, 'startCampaign resolved on the OLD RunState');
    assert.equal(b.seed, 'sequential-B');
    assert.equal(startEvents(b.log).length, 1, 'new campaign needs exactly one RUN_START');
    assert.equal(startEvents(b.log)[0].seed, 'sequential-B');
    assert.equal(startEvents(b.log)[0].tick, 0);
    assert.equal(b.log.events.some((event) => event.type === 'RUN_END'), false);
    console.log('PASS: startCampaign waits for new RunState, observer starts clean log');

    // Pausing the Game scene is not a run boundary.
    await page.evaluate(async () => {
      const game = window.__game;
      game.scene.pause('Game');
      await window.__ofeliyaTest.advance(2);
      game.scene.resume('Game');
      await window.__ofeliyaTest.advance(2);
    });
    const paused = await page.evaluate(() => window.__ofeliyaTest.getRunLog());
    assert.equal(startEvents(paused).length, 1, 'pause/resume must not restart log');
    assert.equal(paused.events.some((event) => event.type === 'RUN_END'), false);
    console.log('PASS: scene pause/resume does not cause false run boundary');

    // Bypass startCampaign to isolate the POST_STEP observer bug.
    await page.evaluate(() => {
      const game = window.__game;
      game.registry.set('runSeedOverride', 'sequential-C');
      game.scene.getScene('Game').scene.start('Game');
    });
    await page.evaluate(() => window.__ofeliyaTest.advance(1));
    const c = await page.evaluate(() => ({
      seed: window.__game.scene.getScene('Game').runSeed,
      log: window.__ofeliyaTest.getRunLog(),
    }));
    assert.equal(c.seed, 'sequential-C');
    assert.equal(startEvents(c.log).length, 1);
    assert.equal(startEvents(c.log)[0].seed, 'sequential-C');
    assert.equal(startEvents(c.log)[0].tick, 0);
    console.log('PASS: POST_STEP detects direct Game scene restart');

    // Existing abandonment rule must remain exactly once when exiting to Menu.
    await page.evaluate(() => window.__game.scene.getScene('Game').scene.start('Menu'));
    await page.evaluate(() => window.__ofeliyaTest.advance(3));
    const abandoned = await page.evaluate(() => window.__ofeliyaTest.getRunLog());
    const ends = abandoned.events.filter((event) => event.type === 'RUN_END');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].reason, 'abandoned');
    assert.equal(ends[0].win, false);
    assert.deepEqual(errors, []);
    console.log('PASS: exiting to Menu emits one abandoned RUN_END');
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

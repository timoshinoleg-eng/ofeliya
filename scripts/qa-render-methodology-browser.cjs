// Manual integration probe: start VITE_QA_TOOLS=1 Vite on port 5430, then run
// node scripts/qa-render-methodology-browser.cjs. Uses SwiftShader and mocks APIs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await context.route('**/api/**', route => route.abort());
    await context.route('https://st.max.ru/**', route => route.fulfill({ status: 200, body: '' }));
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__qaCopied = text; } } });
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5430/?qaCompare=render', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 60000 });
    async function startGame() {
      await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
      await page.waitForFunction(() => window.__game.scene.isActive('UI') && (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')));
      await page.evaluate(() => {
        const game = window.__game.scene.getScene('Game');
        const ui = window.__game.scene.getScene('UI');
        ui.modal?.destroy(true); ui.modal = null; ui.modalOpen = false; ui.uiBlocked = false;
        game.runState.stage.hp = game.runState.stage.maxHp = 1000000;
        game.runState.stage.xpNext = Number.MAX_SAFE_INTEGER;
        game.queuedLevels = 0; game.awaitingChoice = false; game.pendingChoices = [];
        if (window.__game.scene.isPaused('Game')) window.__game.scene.resume('Game');
      });
    }
    await startGame();
    await page.evaluate(() => window.__game.scene.getScene('Game').startQaRenderComparison());
    console.log('Waiting for initial warmup and nine real rendered windows...');
    await page.waitForFunction(() => window.__game.scene.getScene('Game').qaComparison?.snapshot().phases.length >= 9, null, { timeout: 300000, polling: 1000 });
    const snap = await page.evaluate(() => window.__game.scene.getScene('Game').qaComparison.snapshot());
    assert.equal(snap.initialWarmupCompleted, 300);
    assert.deepEqual(snap.phases.slice(0, 9).map(p => p.group), ['gems','gems','gems','atmo','atmo','atmo','ui','ui','ui']);
    assert.ok(snap.phases.slice(0, 9).every(p => p.complete && p.frames === 120 && p.warmupFrames === 30));
    assert.ok(snap.metadata.renderer && snap.metadata.dpr && snap.metadata.canvas.width && snap.metadata.canvas.height);
    await page.evaluate(() => { const game = window.__game.scene.getScene('Game'); game.runState.stage.hp = 0; game.finish(false); });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ofeliya_qa_render_comparison_v2')));
    assert.equal(saved.status, 'interrupted'); assert.equal(saved.stopReason, 'player-death');
    await page.evaluate(() => window.__game.scene.getScene('Game').exitToMenu());
    await page.waitForFunction(() => window.__game.scene.isActive('Menu'));
    await startGame();
    await page.evaluate(() => window.__game.scene.getScene('Game').qaRenderReportButton.emit('pointerup'));
    const area = page.locator('[data-qa-render-report] textarea');
    await area.waitFor();
    assert.equal(JSON.parse(await area.inputValue()).stopReason, 'player-death');
    assert.equal(JSON.parse(await page.evaluate(() => window.__qaCopied)).stopReason, 'player-death');
    await page.getByText('Закрыть', { exact: true }).click();
    await page.evaluate(() => window.__game.scene.getScene('Game').startQaRenderComparison());
    const previous = await page.evaluate(() => JSON.parse(localStorage.getItem('ofeliya_qa_render_comparison_previous_v2')));
    assert.equal(previous.stopReason, 'player-death');
    await page.evaluate(() => window.__game.scene.getScene('Game').qaRenderReportButton.emit('pointerup'));
    await page.getByText('Показать предыдущий отчёт').click();
    assert.equal(JSON.parse(await area.inputValue()).stopReason, 'player-death');
    console.log('PASS 9 SwiftShader windows, death, restart, report copy and previous report', JSON.stringify(snap.metadata));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

/**
 * EASY difficulty visual + UI contracts.
 *
 * Verifies the beginner tier in the real build across the required visual
 * matrix (320 / 390 / 768 / 1080): the Menu selector exposes it, its copy
 * fits without clipping, the selector cycle is ЛЁГКИЙ → СТАНДАРТ → НАПРЯЖЕНИЕ,
 * the result screen names the tier as unranked, and "ЕЩЁ ОДИН ЦИКЛ" restarts
 * in the same tier.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const MATRIX = [
  [320, 568],
  [390, 740],
  [390, 844],
  [768, 1024],
  [1080, 1920],
];
const OUT = process.env.OFELIYA_EASY_VISUAL_EVIDENCE;

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
if (OUT) mkdirSync(OUT, { recursive: true });
let browser;
try {
  await server.listen();
  const executablePath = process.env.OFELIYA_CHROME_PATH
    || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync)
    || chromium.executablePath();
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  for (const [width, height] of MATRIX) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      serviceWorkers: 'block',
    });
    await context.route('https://st.max.ru/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await context.route('**/api/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"entries":[],"ranked":false}' })
    );
    await context.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
      localStorage.setItem('ofeliya_difficulty_v1', 'easy');
      window.WebApp = {
        platform: 'android',
        version: '26.20.0',
        initData: 'signed-easy-visual',
        initDataUnsafe: { user: { id: 92, first_name: 'Easy', last_name: 'QA' } },
        getViewportSize: async () => ({ width: window.innerWidth, height: window.innerHeight }),
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      };
    });

    const page = await context.newPage();
    const errors = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => { errors.push(String(e)); console.log('page error', String(e)); });
    await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 30000 });

    // --- The selector exposes the tier and its copy -------------------------
    const selector = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const panel = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector');
      const value = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector-value');
      const texts = [];
      const visit = (o) => {
        if (o.type === 'Text') texts.push(o);
        o.list?.forEach(visit);
      };
      menu.children.list.forEach(visit);
      const description = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector-desc');
      const steps = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector-steps');
      const panelBounds = panel.getBounds();
      const descBounds = description ? description.getBounds() : null;
      return {
        difficultyId: window.__game.registry.get('difficultyId'),
        stored: localStorage.getItem('ofeliya_difficulty_v1'),
        valueText: value ? value.text : null,
        descriptionText: description ? description.text : null,
        steps: steps?.text ?? null,
        panelWidth: panelBounds.width,
        panel: { left: panelBounds.left, right: panelBounds.right, top: panelBounds.top, bottom: panelBounds.bottom },
        description: descBounds
          ? { left: descBounds.left, right: descBounds.right, top: descBounds.top, bottom: descBounds.bottom }
          : null,
        overflow: descBounds ? Math.round(descBounds.bottom - panelBounds.bottom) : 0,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });

    assert.equal(selector.difficultyId, 'easy', `${width}: the Menu did not select Easy`);
    assert.equal(selector.stored, 'easy', `${width}: the Easy selection was not persisted`);
    assert.ok(selector.valueText && selector.valueText.toLocaleUpperCase('ru-RU').includes('ЛЁГКИЙ'), `${width}: the selector does not show ЛЁГКИЙ (${selector.valueText})`);
    assert.ok(selector.descriptionText, `${width}: the Easy description is missing`);
    assert.equal(selector.steps, '• ◦ ◦', `${width}: the Easy indicator is wrong`);
    assert.ok(['спокойнее', 'Более спокойный\nрежим для основ'].includes(selector.descriptionText), `${width}: the Easy description is wrong`);
    assert.ok(
      selector.description && selector.description.left >= selector.panel.left - 1 &&
        selector.description.right <= selector.panel.right + 1 &&
        selector.description.top >= selector.panel.top - 1 &&
        selector.description.bottom <= selector.panel.bottom + 1,
      `${width}: the Easy description is clipped by the selector panel: ${JSON.stringify(selector)}`
    );
    assert.ok(
      selector.description.right <= selector.viewport.width &&
        selector.description.bottom <= selector.viewport.height,
      `${width}: the Easy description leaves the viewport: ${JSON.stringify(selector.description)}`
    );
    if (OUT) await page.screenshot({ path: resolve(OUT, `easy-menu-${width}.png`) });

    // --- The cycle is ЛЁГКИЙ → СТАНДАРТ → НАПРЯЖЕНИЕ → ЛЁГКИЙ --------------
    const labels = [selector.valueText.replace(/\s*›\s*$/, '').trim().toLocaleUpperCase('ru-RU')];
    const overflows = [{ tier: 'easy', overflow: selector.overflow }];
    let lastState = null;
    for (let i = 0; i < 3; i += 1) {
      const point = await page.evaluate(() => {
        const menu = window.__game.scene.getScene('Menu');
        const panel = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector');
        const b = panel.getBounds();
        return { x: b.centerX, y: b.centerY };
      });
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(160);
      const state = await page.evaluate(() => {
        const menu = window.__game.scene.getScene('Menu');
        const value = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector-value');
        const panel = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector');
        const pb = panel.getBounds();
        const texts = [];
        const visit = (o) => { if (o.type === 'Text') texts.push(o); o.list?.forEach(visit); };
        menu.children.list.forEach(visit);
        const description = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector-desc');
        const steps = menu.children.list.find((o) => o.name === 'ofeliya-menu-difficulty-selector-steps');
        const db = description ? description.getBounds() : null;
        return {
          valueText: value ? value.text : null,
          difficultyId: window.__game.registry.get('difficultyId'),
          stored: localStorage.getItem('ofeliya_difficulty_v1'),
          steps: steps?.text ?? null,
          descriptionText: description ? description.text : null,
          // Horizontal fit, vertical start inside the panel, and how far the
          // copy reaches past the panel bottom (the shipped Strained tier is
          // the baseline every tier has to stay within).
          horizontalFits: db
            ? db.left >= pb.left - 1 && db.right <= pb.right + 1
            : true,
          topInside: db ? db.top >= pb.top - 1 : true,
          overflow: db ? Math.round(db.bottom - pb.bottom) : 0,
        };
      });
      assert.ok(state.horizontalFits, `${width}: the difficulty description leaves the panel (${JSON.stringify(state)})`);
      assert.ok(state.topInside, `${width}: the difficulty description overlaps the tier label (${JSON.stringify(state)})`);
      assert.equal(state.steps, {easy: '• ◦ ◦', standard: '• • ◦', strained: '• • •'}[state.difficultyId], `${width}: difficulty indicator mismatch`);
      overflows.push({ tier: state.difficultyId, overflow: state.overflow });
      lastState = state;
      labels.push(state.valueText.replace(/\s*›\s*$/, '').trim().toLocaleUpperCase('ru-RU'));
    }
    // Every tier must fit inside its panel. There is no accepted baseline: the
    // Strained description used to overflow the card, and that overflow is not a
    // budget any more — the one-line variant of the copy takes its place.
    for (const row of overflows) {
      assert.ok(
        row.overflow <= 0,
        `${width}: the ${row.tier} description overflows the panel by ${row.overflow}px`
      );
    }
    const easyOverflow = overflows.filter((row) => row.tier === 'easy').map((row) => row.overflow);
    assert.ok(
      easyOverflow.every((overflow) => overflow <= 0),
      `${width}: the Easy description must fit inside the panel (${easyOverflow.join(', ')})`
    );
    // The Strained tier is named explicitly: its description is the longest of
    // the three and must not be the one that breaks the card.
    const strainedRows = overflows.filter((row) => row.tier === 'strained');
    assert.ok(strainedRows.length > 0, `${width}: the Strained tier was never rendered`);
    for (const row of strainedRows) {
      assert.ok(
        row.overflow <= 0,
        `${width}: the Strained description overflows the panel by ${row.overflow}px`
      );
    }
    assert.deepEqual(
      labels,
      ['ЛЁГКИЙ', 'СТАНДАРТ', 'НАПРЯЖЕНИЕ', 'ЛЁГКИЙ'],
      `${width}: the difficulty cycle is wrong: ${labels.join(' → ')}`
    );
    assert.equal(lastState.stored, 'easy', `${width}: the cycle did not persist the selection`);

    // --- The control card obeys the same contract ----------------------------
    // The control card is the second run-configuration card of the menu. Its
    // description must stay inside the card in every control mode, and the
    // one-hand mode is named explicitly: its copy is the longest of the three.
    const controlRows = [];
    for (let i = 0; i < 3; i += 1) {
      const point = await page.evaluate(() => {
        const menu = window.__game.scene.getScene('Menu');
        const panel = menu.children.list.find((o) => o.name === 'ofeliya-menu-control-selector');
        const b = panel.getBounds();
        return { x: b.centerX, y: b.centerY };
      });
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(160);
      const state = await page.evaluate(() => {
        const menu = window.__game.scene.getScene('Menu');
        const panel = menu.children.list.find((o) => o.name === 'ofeliya-menu-control-selector');
        const description = menu.children.list.find((o) => o.name === 'ofeliya-menu-control-selector-desc');
        const value = menu.children.list.find((o) => o.name === 'ofeliya-menu-control-selector-value');
        const pb = panel.getBounds();
        const db = description ? description.getBounds() : null;
        return {
          valueText: value ? value.text : null,
          descriptionText: description ? description.text : null,
          overflow: db ? Math.round(db.bottom - pb.bottom) : 0,
        };
      });
      controlRows.push(state);
    }
    for (const row of controlRows) {
      assert.ok(
        row.overflow <= 0,
        `${width}: the control description "${row.descriptionText}" overflows the panel by ${row.overflow}px`
      );
    }
    // The one-hand mode is the one the player meets first, and its copy is the
    // longest: it must fit the card like every other mode.
    const oneHand = controlRows[0];
    assert.ok(oneHand, `${width}: the control card was never rendered`);
    assert.ok(
      oneHand.overflow <= 0,
      `${width}: the one-hand control description overflows the panel by ${oneHand.overflow}px`
    );
    const twoHand = controlRows[1];
    assert.ok(twoHand, `${width}: the control card did not reach the two-hand mode`);
    assert.ok(
      twoHand.overflow <= 0,
      `${width}: the two-hand control description overflows the panel by ${twoHand.overflow}px`
    );

    // --- The result screen names the tier and its unranked state ------------
    await page.evaluate(() => {
      const game = window.__game;
      const menu = game.scene.getScene('Menu');
      game.registry.set('difficultyId', 'easy');
      menu.scene.start('Game');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('UI'), null, { timeout: 30000 });
    const result = await page.evaluate(() => {
      const ui = window.__game.scene.getScene('UI');
      const gs = window.__game.scene.getScene('Game');
      if (ui.dismissProgressionForStageBoundary) ui.dismissProgressionForStageBoundary();
      if (gs && gs.scene) gs.scene.pause();
      ui.renderGameOver({
        win: false,
        reason: 'death',
        difficultyId: 'easy',
        runSeed: 'easy-visual-seed',
        controlMode: 'one-hand',
        resumed: false,
        timeMs: 42_000,
        kills: 120,
        hostCellsInfected: 3,
        level: 9,
        highestLevel: 9,
        comboBest: 12,
        stageId: 'bloodstream',
        stageOrder: 1,
        bossesDefeated: 0,
        boss1ClearMs: 0,
        stacks: {},
        evolutions: [],
        legendaryIds: [],
        stageBuilds: {},
        newAchievements: [],
        records: { timeRecord: false, killsRecord: false, levelRecord: false },
      });
      const overlay = ui.resultOverlay;
      const texts = [];
      const visit = (o) => { if (o.type === 'Text') texts.push(o); o.list?.forEach(visit); };
      overlay.list.forEach(visit);
      const mode = texts.filter((o) => o.text === 'ЛЁГКИЙ · Тренировка');
      const share = overlay.getByName('ofeliya-result-share-label');
      const shareBg = overlay.getByName('ofeliya-result-share-bg');
      const modeBounds = mode[0] ? mode[0].getBounds() : null;
      const shareBounds = share ? share.getBounds() : null;
      const shareBgBounds = shareBg ? shareBg.getBounds() : null;
      return {
        modeText: mode[0] ? mode[0].text : null,
        modeFits: modeBounds
          ? modeBounds.left >= 0 && modeBounds.right <= window.innerWidth &&
            modeBounds.top >= 0 && modeBounds.bottom <= window.innerHeight
          : false,
        shareText: share ? share.text : null,
        shareFits: shareBounds && shareBgBounds
          ? shareBounds.left >= shareBgBounds.left + 4 && shareBounds.right <= shareBgBounds.right - 4
          : false,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    assert.equal(result.modeText, 'ЛЁГКИЙ · Тренировка', `${width}: the Easy result label is wrong`);
    assert.ok(result.modeFits, `${width}: the Easy result line leaves the viewport`);
    assert.equal(result.shareText, 'ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ', `${width}: an Easy result must not offer a ranked challenge`);
    assert.ok(result.shareFits, `${width}: the share action does not fit its target`);
    if (OUT) await page.screenshot({ path: resolve(OUT, `easy-result-${width}.png`) });

    // --- "ЕЩЁ ОДИН ЦИКЛ" restarts in the same tier -------------------------
    const restarted = await page.evaluate(async () => {
      const game = window.__game;
      const ui = game.scene.getScene('UI');
      const retry = ui.resultOverlay.getByName('ofeliya-result-retry-bg');
      const b = retry.getBounds();
      return { x: b.centerX, y: b.centerY };
    });
    await page.mouse.click(restarted.x, restarted.y);
    await page.waitForTimeout(1200);
    const afterRestart = await page.evaluate(() => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      return {
        registry: game.registry.get('difficultyId'),
        sceneDifficulty: gs && gs.difficulty ? gs.difficulty.id : null,
      };
    });
    assert.equal(afterRestart.registry, 'easy', `${width}: the retry changed the selected tier`);
    assert.equal(afterRestart.sceneDifficulty, 'easy', `${width}: the retry did not restart in Easy`);

    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`easy difficulty visual ${width}x${height}: selector, cycle, result label and retry PASS`);
    await context.close();
  }

  // --- The result chip names the tier the player actually ran --------------
  // A browser host has no rating board behind it, but the chip must still name
  // the tier of the run. A fresh STRAINED run in a browser is a STRAINED run,
  // not a standard one: the chip used to read "СТАНДАРТ · Тренировка" because
  // the platform was asked before the tier.
  {
    const context = await browser.newContext({
      viewport: { width: 320, height: 568 },
      hasTouch: true,
      serviceWorkers: 'block',
    });
    await context.route('https://st.max.ru/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await context.route('**/api/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"entries":[],"ranked":false}' })
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 60000 });
    const host = await page.evaluate(() => ({
      telegram: typeof window.Telegram?.WebApp?.initData === 'string' && window.Telegram.WebApp.initData.length > 0,
      webApp: typeof window.WebApp !== 'undefined',
    }));
    assert.equal(host.telegram, false, 'the browser result context must not boot the Telegram host');
    assert.equal(host.webApp, false, 'the browser result context must not fake a host bridge');

    const renderResult = async (difficultyId) => page.evaluate((difficultyId) => {
      const ui = window.__game.scene.getScene('UI');
      const gs = window.__game.scene.getScene('Game');
      if (ui.dismissProgressionForStageBoundary) ui.dismissProgressionForStageBoundary();
      if (gs && gs.scene) gs.scene.pause();
      ui.renderGameOver({
        win: false,
        reason: 'death',
        difficultyId,
        runSeed: 'result-identity-seed',
        controlMode: 'one-hand',
        resumed: false,
        timeMs: 42_000,
        kills: 120,
        hostCellsInfected: 3,
        level: 9,
        highestLevel: 9,
        comboBest: 12,
        stageId: 'bloodstream',
        stageOrder: 1,
        bossesDefeated: 0,
        boss1ClearMs: 0,
        stacks: {},
        evolutions: [],
        legendaryIds: [],
        stageBuilds: {},
        newAchievements: [],
        records: { timeRecord: false, killsRecord: false, levelRecord: false },
      });
      const overlay = ui.resultOverlay;
      const texts = [];
      const visit = (o) => { if (o.type === 'Text') texts.push(o); o.list?.forEach(visit); };
      overlay.list.forEach(visit);
      const chip = texts
        .map((o) => o.text)
        .find((t) => typeof t === 'string' && (t.includes('Тренировка') || t.includes('зачёт')));
      const share = overlay.getByName('ofeliya-result-share-label');
      return { chip: chip ?? null, share: share ? share.text : null };
    }, difficultyId);

    await page.evaluate(() => {
      const game = window.__game;
      game.registry.set('difficultyId', 'strained');
      game.scene.getScene('Menu').scene.start('Game');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('UI'), null, { timeout: 30000 });
    const strained = await renderResult('strained');
    assert.equal(
      strained.chip,
      'НАПРЯЖЕНИЕ · Тренировка',
      `a fresh Strained run in a browser must name the Strained tier (${JSON.stringify(strained.chip)})`
    );
    // The share text of a browser Strained run names no tier: the canonical
    // share contract names the tier only for the beginner tier.
    assert.ok(
      strained.share && !strained.share.includes('ЛЁГКИЙ'),
      `the Strained share text names the wrong tier (${JSON.stringify(strained.share)})`
    );
    console.log('result identity browser PASS: a fresh Strained run names the Strained tier');
    assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
console.log('easy difficulty visual matrix: ok');

const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const URL = 'http://127.0.0.1:5173/';
const KEY = 'ofeliya_run_checkpoint_v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message, detail) {
  if (!condition) throw new Error(detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`);
}

async function makeContext(browser, checkpointRaw = null) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const score = { count: 0, payloads: [] };
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.route('**/api/score', async (route) => {
    score.count += 1;
    try { score.payloads.push(JSON.parse(route.request().postData() || '{}')); }
    catch { score.payloads.push(null); }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true, rank: 11, ranked: true, rulesetVersion: 2, campaignVersion: 2, top: [],
      }),
    });
  });
  await ctx.addInitScript(({ checkpointRaw: raw }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_difficulty_v1', 'standard');
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    if (raw !== null) localStorage.setItem('ofeliya_run_checkpoint_v1', raw);
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-checkpoint-resume-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Resume', last_name: 'QA' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { checkpointRaw });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return { ctx, page, score, errors };
}

async function waitMenu(page) {
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
}

async function sceneTexts(page, sceneKey) {
  return page.evaluate((sceneKey) => {
    const scene = window.__game.scene.getScene(sceneKey);
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    scene.children.list.forEach(visit);
    return flat.filter((obj) => typeof obj?.text === 'string' && obj.visible !== false).map((obj) => obj.text);
  }, sceneKey);
}

async function touchLabel(ctx, page, sceneKey, label) {
  const point = await page.evaluate(({ sceneKey, label }) => {
    const scene = window.__game.scene.getScene(sceneKey);
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    scene.children.list.forEach(visit);
    const text = flat.find((obj) => obj?.text === label && obj.visible !== false);
    if (!text) return null;
    const tb = text.getBounds();
    const inParent = text.parentContainer?.list?.filter(
      (obj) => obj !== text && obj.input?.enabled && typeof obj.getBounds === 'function'
    ) ?? [];
    const candidates = inParent.length
      ? inParent
      : flat.filter((obj) => obj !== text && obj.input?.enabled && typeof obj.getBounds === 'function');
    let best = null;
    let distance = Infinity;
    for (const obj of candidates) {
      const b = obj.getBounds();
      const d = Math.hypot(b.centerX - tb.centerX, b.centerY - tb.centerY);
      if (d < distance) { distance = d; best = b; }
    }
    return best && distance < 90 ? { x: Math.round(best.centerX), y: Math.round(best.centerY) } : null;
  }, { sceneKey, label });
  if (!point) throw new Error(`touch target missing: ${sceneKey}/${label}`);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function startFresh(ctx, page, seed) {
  await waitMenu(page);
  await page.evaluate((seed) => window.__game.registry.set('runSeedOverride', seed), seed);
  await touchLabel(ctx, page, 'Menu', 'НАЧАТЬ ЗАРАЖЕНИЕ');
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  let reusableCheckpointRaw = null;

  {
    const { ctx, page, score, errors } = await makeContext(browser);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await startFresh(ctx, page, 'resume-browser-seed');

    const fresh = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
    assert(fresh?.schemaVersion === 1, 'fresh run did not create checkpoint', fresh);

    const prepared = await page.evaluate((key) => {
      const game = window.__game;
      game.scene.pause('Game');
      const gs = game.scene.getScene('Game');
      const st = gs.runState.stage;
      const run = gs.runState.run;
      run.timeMs = 88_000;
      st.timeMs = 88_000;
      run.kills = st.kills = 40;
      run.hostCellsInfected = st.hostCellsInfected = 3;
      run.comboBest = 14;
      st.combo = 7;
      st.comboTimer = 1_200;
      run.maxNoDamageMs = st.noDamageMs = 5_000;
      st.level = run.highestLevel = 9;
      st.xp = 21;
      st.xpNext = 70;
      st.maxHp = 125;
      st.hp = 87;
      st.stacks = { dmg: 2, hp: 1 };
      st.damageMul = 1.5625;
      st.evolutions = new Set(['prism']);
      run.evolutionsSeen = new Set(['prism']);
      run.legendaryIds = new Set(['last-carrier']);
      run.legendaryPity = 4;
      run.legendaryOffersSeen = 7;
      run.stageBuilds = {
        bloodstream: { level: 9, stacks: { dmg: 2, hp: 1 }, evolutions: ['prism'] },
      };
      gs.lastCarrierUsed = true;
      gs.player.setPosition(211, 399);
      gs.player.body.reset(211, 399);
      gs.stageDirector.update(88_000);
      gs.wave.spawnAcc = 0;
      gs.hostCells.spawnAcc = 0;
      gs.hostCells.firstSpawned = true;
      const streams = ['progression', 'enemy-kind', 'enemy-spawn', 'elite', 'host-cell', 'loot'];
      streams.forEach((stream, index) => {
        for (let i = 0; i <= index; i++) gs.gameplayRng.next(stream);
      });
      if (!gs.saveCheckpointNow()) throw new Error('forced stable checkpoint save failed');
      const raw = localStorage.getItem(key);
      const checkpoint = JSON.parse(raw);
      const Probe = gs.gameplayRng.constructor;
      const probe = new Probe(checkpoint.runSeed);
      probe.restore(checkpoint.rng);
      const expectedNext = Object.fromEntries(streams.map((stream) => [stream, probe.next(stream)]));
      return { raw, checkpoint, expectedNext };
    }, KEY);
    reusableCheckpointRaw = prepared.raw;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitMenu(page);
    const menuTexts = await sceneTexts(page, 'Menu');
    assert(menuTexts.includes('ПРОДОЛЖИТЬ ЗАБЕГ'), 'reload menu has no Continue', menuTexts);
    assert(menuTexts.includes('НАЧАТЬ НОВЫЙ'), 'reload menu has no New Run', menuTexts);
    assert(menuTexts.some((text) => text.includes('НЕЗАВЕРШЁННЫЙ ЗАБЕГ') && text.includes('МУТАЦИЯ 9')), 'resume summary missing', menuTexts);

    await touchLabel(ctx, page, 'Menu', 'ПРОДОЛЖИТЬ ЗАБЕГ');
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
    await page.evaluate(() => window.__game.scene.pause('Game'));

    const restored = await page.evaluate((key) => {
      const gs = window.__game.scene.getScene('Game');
      const cp = JSON.parse(localStorage.getItem(key) || 'null');
      const rngBefore = gs.gameplayRng.snapshot();
      const next = Object.fromEntries(
        ['progression', 'enemy-kind', 'enemy-spawn', 'elite', 'host-cell', 'loot']
          .map((stream) => [stream, gs.gameplayRng.next(stream)])
      );
      return {
        resumed: gs.resumed,
        seed: gs.runSeed,
        difficulty: gs.difficulty.id,
        controlMode: gs.controlMode,
        stageId: gs.runState.stage.id,
        runTimeMs: gs.runState.run.timeMs,
        stageTimeMs: gs.runState.stage.timeMs,
        hp: gs.runState.stage.hp,
        maxHp: gs.runState.stage.maxHp,
        level: gs.runState.stage.level,
        xp: gs.runState.stage.xp,
        stacks: { ...gs.runState.stage.stacks },
        evolutions: [...gs.runState.stage.evolutions],
        legendaryIds: [...gs.runState.run.legendaryIds],
        pity: gs.runState.run.legendaryPity,
        offers: gs.runState.run.legendaryOffersSeen,
        kills: gs.runState.run.kills,
        hostCells: gs.runState.run.hostCellsInfected,
        comboBest: gs.runState.run.comboBest,
        stageBuildLevel: gs.runState.run.stageBuilds.bloodstream?.level,
        player: [gs.player.x, gs.player.y],
        lastCarrierUsed: gs.lastCarrierUsed,
        rngBefore,
        next,
        persistedResumed: cp?.resumed,
      };
    }, KEY);

    assert(restored.resumed && restored.persistedResumed, 'resume marker missing', restored);
    assert(restored.seed === 'resume-browser-seed' && restored.stageId === 'bloodstream', 'seed/stage restore failed', restored);
    assert(Math.abs(restored.runTimeMs - 88_000) < 1_000 && Math.abs(restored.stageTimeMs - 88_000) < 1_000, 'time restore failed', restored);
    assert(restored.hp === 87 && restored.maxHp === 125, 'HP restore failed', restored);
    assert(restored.level === 9 && restored.xp === 21, 'progression restore failed', restored);
    assert(restored.stacks.dmg === 2 && restored.stacks.hp === 1, 'build restore failed', restored);
    assert(restored.evolutions.includes('prism') && restored.legendaryIds.includes('last-carrier'), 'evolution/Legendary restore failed', restored);
    assert(restored.pity === 4 && restored.offers === 7, 'Legendary offer state restore failed', restored);
    assert(restored.kills === 40 && restored.hostCells === 3 && restored.comboBest === 14, 'run-wide stats restore failed', restored);
    assert(restored.stageBuildLevel === 9 && restored.lastCarrierUsed, 'stage build/one-shot state restore failed', restored);
    assert(JSON.stringify(restored.rngBefore.states) === JSON.stringify(prepared.checkpoint.rng.states), 'RNG states changed during restore', restored.rngBefore);
    for (const [stream, expected] of Object.entries(prepared.expectedNext)) {
      assert(restored.next[stream] === expected, `RNG continuation diverged: ${stream}`, restored.next);
    }

    const beforeContinue = restored.runTimeMs;
    await page.evaluate(() => window.__game.scene.resume('Game'));
    await sleep(320);
    const afterContinue = await page.evaluate(() => window.__game.scene.getScene('Game').runState.run.timeMs);
    assert(afterContinue > beforeContinue, 'resumed gameplay did not continue');

    await page.evaluate(() => {
      const game = window.__game;
      game.scene.getScene('Game').finish(false, 'defeat');
      game.scene.getScene('UI').update();
    });
    await sleep(300);
    assert(score.count === 0, 'resumed Standard reached score API', score.payloads);
    assert(await page.evaluate((key) => localStorage.getItem(key), KEY) === null, 'death did not clear checkpoint');
    const resultTexts = await sceneTexts(page, 'UI');
    assert(resultTexts.some((text) => text.includes('ВОЗОБНОВЛЁН') && text.includes('ВНЕ РЕЙТИНГА')), 'resumed result not visibly unranked', resultTexts);

    await touchLabel(ctx, page, 'UI', 'ЕЩЁ ОДИН ЦИКЛ');
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && !window.__game.scene.isPaused('Game'));
    const freshRestart = await page.evaluate((key) => {
      const gs = window.__game.scene.getScene('Game');
      return { resumed: gs.resumed, checkpoint: JSON.parse(localStorage.getItem(key) || 'null') };
    }, KEY);
    assert(!freshRestart.resumed && freshRestart.checkpoint?.resumed === false, 'fresh Standard inherited resume marker', freshRestart);

    await page.evaluate(() => {
      const game = window.__game;
      game.scene.getScene('Game').finish(false, 'defeat');
      game.scene.getScene('UI').update();
    });
    await sleep(350);
    assert(score.count === 1 && score.payloads[0]?.payload?.difficultyId === 'standard', 'fresh Standard lost ranked path', score.payloads);
    assert(errors.length === 0, 'page errors in resume/ranking flow', errors);
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await makeContext(browser, reusableCheckpointRaw);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitMenu(page);
    await page.evaluate(() => window.__game.registry.set('runSeedOverride', 'replacement-seed'));
    await touchLabel(ctx, page, 'Menu', 'НАЧАТЬ НОВЫЙ');
    await page.waitForFunction(() => window.__game.scene.isActive('Game'));
    await page.evaluate(() => window.__game.scene.pause('Game'));
    const state = await page.evaluate((key) => {
      const gs = window.__game.scene.getScene('Game');
      const cp = JSON.parse(localStorage.getItem(key) || 'null');
      return { resumed: gs.resumed, seed: gs.runSeed, timeMs: gs.runState.run.timeMs, checkpointSeed: cp?.runSeed, checkpointResumed: cp?.resumed };
    }, KEY);
    assert(!state.resumed && state.seed === 'replacement-seed' && state.timeMs < 2_000, 'NEW RUN restored old checkpoint', state);
    assert(state.checkpointSeed === 'replacement-seed' && state.checkpointResumed === false, 'NEW RUN did not replace old checkpoint', state);
    assert(errors.length === 0, 'page errors in new-run flow', errors);
    await ctx.close();
  }

  for (const [name, raw] of [
    ['corrupt', '{bad-json'],
    ['incompatible', JSON.stringify({ ...JSON.parse(reusableCheckpointRaw), schemaVersion: 999 })],
  ]) {
    const { ctx, page, errors } = await makeContext(browser, raw);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitMenu(page);
    const texts = await sceneTexts(page, 'Menu');
    assert(!texts.includes('ПРОДОЛЖИТЬ ЗАБЕГ'), `${name} checkpoint exposed Continue`, texts);
    assert(await page.evaluate((key) => localStorage.getItem(key), KEY) === null, `${name} checkpoint was not removed`);
    assert(errors.length === 0, `page errors after ${name} checkpoint`, errors);
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await makeContext(browser);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await startFresh(ctx, page, 'victory-clear-seed');
    assert(await page.evaluate((key) => localStorage.getItem(key), KEY), 'victory setup has no checkpoint');
    await page.evaluate(() => window.__game.scene.getScene('Game').finish(true, 'campaign-complete'));
    assert(await page.evaluate((key) => localStorage.getItem(key), KEY) === null, 'victory did not clear checkpoint');
    assert(errors.length === 0, 'page errors in victory-clear flow', errors);
    await ctx.close();
  }

  await browser.close();
  console.log('checkpoint resume mobile reload smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

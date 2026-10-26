/**
 * OFELIYA — UI redesign v1 contract.
 *
 * A browser regression over the redesigned surfaces. It drives the real menu in a
 * real viewport and asserts the copy contract, the hierarchy and the touch
 * targets of the redesign — not a mock.
 *
 * Run with: node tests/ui-redesign.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 740 },
  { width: 768, height: 1024 },
  { width: 1080, height: 1920 },
];

const EVIDENCE_DIR = process.env.OFELIYA_UI_EVIDENCE || resolve('docs/qa/ui-redesign-v1-evidence');

/** Capture a surface. The timeout is generous: a 1080x1920 WebGL canvas can need
 *  more than the default action timeout on a slow renderer. */
async function shot(page, name) {
  await page.screenshot({ path: resolve(EVIDENCE_DIR, name), timeout: 120000 });
}
const CHROME = [
  process.env.OFELIYA_CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));

/** Words that must never reach a player-facing surface of the redesign. */
const FORBIDDEN_PLAYER_COPY = [
  'локально',
  'без наград',
  '00:00 UTC',
  'tdesktop',
  'КРИТ.',
  'СТРАН-0',
  'Двигай штамм',
  'НЕЗАВЕРШЁННЫЙ ЗАБЕГ',
  'ПЕРВЫЙ ЦИКЛ',
  'STRAIN-0',
];

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      hasTouch: true,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    await context.route('https://st.max.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await context.route('**/api/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"entries":[],"ranked":false}' })
    );

    // ---- Fresh menu -------------------------------------------------------
    const page = await context.newPage();
    const errors = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem(
        'ofeliya_save_v1',
        JSON.stringify({
          runs: 3,
          muted: false,
          musicVolume: 1,
          sfxVolume: 1,
          bestSurvivalMs: 920000,
          bestKills: 2617,
        })
      );
      localStorage.removeItem('ofeliya_run_checkpoint_v1');
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });
    await page.waitForTimeout(400);

    const menu = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('Menu');
      const texts = scene.children.list.filter((o) => o.type === 'Text');
      const rects = scene.children.list.filter((o) => o.type === 'Rectangle');
      const byName = (name) => scene.children.list.find((o) => o.name === name);
      const bounds = (o) => (o ? JSON.parse(JSON.stringify(o.getBounds())) : null);
      return {
        allText: texts.map((o) => o.text),
        named: Object.fromEntries(
          texts.filter((o) => o.name).map((o) => [o.name, { text: o.text, bounds: bounds(o) }])
        ),
        nav: rects
          .filter((o) => o.name && o.name.startsWith('ofeliya-menu-nav-'))
          .map((o) => ({ name: o.name, bounds: bounds(o) })),
        audio: rects
          .filter((o) => o.name && o.name.startsWith('ofeliya-menu-audio-'))
          .map((o) => ({ name: o.name, bounds: bounds(o) })),
        action: { bounds: bounds(byName('ofeliya-menu-action-bg')) },
        newRun: { bounds: bounds(byName('ofeliya-menu-new-run')) },
        legal: { bounds: bounds(byName('ofeliya-menu-legal')) },
        body: document.body.innerText,
      };
    });

    // Hierarchy: the statement, the record and the primary action are present.
    assert.ok(
      menu.allText.some((t) => t.includes('СИНТЕТИЧЕСКИЙ ВИРУС.') && t.includes('ЖИВОЙ ОРГАНИЗМ.')),
      `the product statement is missing at ${viewport.width}x${viewport.height}`
    );
    assert.ok(
      menu.allText.some((t) => t.includes('Выживай. Поглощай РНК. Эволюционируй.')),
      `the tagline is missing at ${viewport.width}x${viewport.height}`
    );
    assert.ok(
      menu.allText.some((t) => t.includes('Рекорд: 15:20') && t.includes('Уничтожено: 2')),
      `the record line is missing at ${viewport.width}x${viewport.height}`
    );
    assert.ok(
      menu.allText.includes('НАЧАТЬ ЗАРАЖЕНИЕ'),
      `the fresh primary action is missing at ${viewport.width}x${viewport.height}`
    );
    assert.ok(
      menu.allText.some((t) => t.includes('Кровоток') && t.includes('Стандарт')),
      `the run configuration line is missing at ${viewport.width}x${viewport.height}`
    );

    // The record line never merges counters of different windows.
    assert.ok(
      !menu.allText.some((t) => /Клеток:\s*\d/.test(t)),
      'the ambiguous "Клеток: N" counter must be gone'
    );

    // Navigation: a 2x2 grid, not a cramped row of four.
    assert.equal(menu.nav.length, 4, `the navigation grid must have four cells at ${viewport.width}`);
    const navRows = new Set(menu.nav.map((n) => Math.round(n.bounds.y / 8)));
    assert.equal(navRows.size, 2, `the navigation grid must have two rows at ${viewport.width}`);
    const navWidths = menu.nav.map((n) => n.bounds.width);
    assert.ok(
      Math.min(...navWidths) >= 43.9,
      `every navigation cell must be at least 44 wide at ${viewport.width}`
    );
    assert.ok(
      menu.nav.every((n) => n.bounds.height >= 43.9),
      `every navigation cell must be at least 44 tall at ${viewport.width}`
    );

    // The audio row is three switches, never a percentage.
    assert.equal(menu.audio.length, 3, `the audio row must have three switches at ${viewport.width}`);
    const audioLabels = menu.allText.filter((t) => /^(Музыка|Звук|Эффекты):/.test(t));
    assert.equal(audioLabels.length, 3, 'the audio row must name three switches');
    assert.ok(
      audioLabels.every((t) => / (вкл|выкл)$/.test(t)),
      'the audio row must show on/off, never a percentage'
    );
    assert.ok(!menu.allText.some((t) => /%.{0,3}(музыка|эффект)/i.test(t)), 'no audio percentage on the menu');

    // The footer is separated from the navigation and carries no technical data.
    assert.ok(menu.legal, 'the legal row must exist');
    assert.ok(
      menu.legal.bounds.y > Math.max(...menu.nav.map((n) => n.bounds.y)),
      'the legal row must sit below the navigation grid'
    );
    assert.ok(
      menu.allText.some((t) => t === 'О приложении · Политика · Поддержка'),
      'the legal row copy is missing'
    );
    assert.ok(!menu.body.includes('tdesktop'), 'no host platform token on the menu');
    assert.ok(
      !/ofeliya-[0-9a-f]{7}/i.test(menu.body) && !/\b[0-9a-f]{7,40}\b/.test(menu.body),
      'no build SHA on the menu'
    );

    // The primary action respects the touch minimum.
    assert.ok(menu.action.bounds.height >= 43.9, 'the primary action must be at least 44 tall');
    assert.ok(menu.action.bounds.width >= 44, 'the primary action must be at least 44 wide');

    for (const forbidden of FORBIDDEN_PLAYER_COPY) {
      assert.ok(
        !menu.allText.some((t) => t.includes(forbidden)),
        `forbidden player copy "${forbidden}" at ${viewport.width}x${viewport.height}`
      );
    }
    assert.deepEqual(errors, [], `page errors at ${viewport.width}x${viewport.height}`);

    await shot(page, `menu-fresh-${viewport.width}x${viewport.height}.png`);
    await page.close();

    // ---- Resume menu ------------------------------------------------------
    const resumePage = await context.newPage();
    const resumeErrors = [];
    resumePage.on('pageerror', (error) => resumeErrors.push(String(error)));
    await resumePage.addInitScript(() => {
      localStorage.setItem(
        'ofeliya_save_v1',
        JSON.stringify({ runs: 3, muted: false, musicVolume: 1, sfxVolume: 1, bestSurvivalMs: 920000, bestKills: 2617 })
      );
    });
    await resumePage.goto(base, { waitUntil: 'domcontentloaded' });
    await resumePage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });
    // Start a run so the game writes a real checkpoint, then come back to the menu.
    await resumePage.evaluate(() => {
      const scene = window.__game.scene.getScene('Menu');
      scene.children.list.find((o) => o.name === 'ofeliya-menu-action-bg').emit('pointerup');
    });
    await resumePage.waitForFunction(() => window.__game?.scene.isActive('Game'), null, { timeout: 20000 });
    await resumePage.waitForFunction(
      () => Boolean(localStorage.getItem('ofeliya_run_checkpoint_v1')),
      null,
      { timeout: 20000 }
    );
    await resumePage.reload({ waitUntil: 'domcontentloaded' });
    await resumePage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });
    await resumePage.waitForTimeout(400);

    const resume = await resumePage.evaluate(() => {
      const scene = window.__game.scene.getScene('Menu');
      const texts = scene.children.list.filter((o) => o.type === 'Text');
      const byName = (name) => scene.children.list.find((o) => o.name === name);
      const bounds = (o) => (o ? JSON.parse(JSON.stringify(o.getBounds())) : null);
      return {
        allText: texts.map((o) => o.text),
        action: { bounds: bounds(byName('ofeliya-menu-action-bg')) },
        newRun: { bounds: bounds(byName('ofeliya-menu-new-run')) },
        actionLabel: texts.find((o) => o.name === 'ofeliya-menu-action')?.text,
        hint: texts.find((o) => o.name === 'ofeliya-menu-action-hint')?.text,
      };
    });

    assert.equal(resume.actionLabel, 'ПРОДОЛЖИТЬ ЗАБЕГ', 'the resume primary action copy is wrong');
    assert.ok(resume.newRun, 'the resume secondary action must exist');
    assert.ok(resume.newRun.bounds.height >= 43.9, 'the resume secondary action must be a real touch target');
    assert.ok(
      resume.allText.includes('НОВЫЙ ЗАБЕГ'),
      'the resume secondary action copy is wrong'
    );
    assert.ok(
      /Кровоток · \d\d:\d\d · Уровень \d+ · Стандарт/.test(resume.hint || ''),
      `the checkpoint summary is wrong: ${resume.hint}`
    );
    assert.ok(
      !resume.allText.some((t) => t.includes('НЕЗАВЕРШЁННЫЙ ЗАБЕГ')),
      'the duplicated resume banner must be gone'
    );
    assert.equal(
      resume.allText.filter((t) => t === 'ПРОДОЛЖИТЬ ЗАБЕГ').length,
      1,
      'the resume label must not be duplicated'
    );
    assert.deepEqual(resumeErrors, [], `page errors in the resume menu at ${viewport.width}`);

    await shot(resumePage, `menu-resume-${viewport.width}x${viewport.height}.png`);
    await resumePage.close();
    // ---- Result screen -----------------------------------------------------
    const resultPage = await context.newPage();
    const resultErrors = [];
    resultPage.on('pageerror', (error) => resultErrors.push(String(error)));
    await resultPage.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 3, muted: true, bestSurvivalMs: 920000, bestKills: 2617 }));
    });
    await resultPage.goto(base, { waitUntil: 'domcontentloaded' });
    await resultPage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });

    const renderResult = async (res) => {
      await resultPage.evaluate(() => {
        const game = window.__game;
        if (!game.scene.isActive('Game')) game.scene.getScene('Menu').scene.start('Game');
      });
      await resultPage.waitForFunction(() => window.__game?.scene.isActive('UI'), null, { timeout: 20000 });
      await resultPage.evaluate((result) => {
        const game = window.__game;
        const gs = game.scene.getScene('Game');
        const ui = game.scene.getScene('UI');
        gs.scene.pause();
        ui.renderGameOver(result);
      }, res);
      await resultPage.waitForTimeout(400);
      return resultPage.evaluate(() => {
        const ui = window.__game.scene.getScene('UI');
        const overlay = ui.resultOverlay;
        const report = overlay.list.find((o) => o.name === 'ofeliya-result-report');
        const texts = [
          ...overlay.list.filter((o) => o.type === 'Text'),
          ...(report ? report.list.filter((o) => o.type === 'Text') : []),
        ];
        const hud = ui.children.list
          .filter((o) => o.type === 'Text')
          .filter((o) => ['ofeliya-menu-title'].includes(o.name) === false)
          .filter((o) => /^(МУТАЦИЯ \d+|\d\d:\d\d$)/.test(o.text));
        return {
          overlayTexts: texts.map((o) => o.text),
          hudVisible: hud.filter((o) => o.visible !== false && (o.alpha ?? 1) > 0.01).map((o) => o.text),
          labels: {
            retry: texts.find((o) => o.name === 'ofeliya-result-retry-label')?.text,
            share: texts.find((o) => o.name === 'ofeliya-result-share-label')?.text,
            menu: texts.find((o) => o.name === 'ofeliya-result-menu-label')?.text,
            title: texts.find((o) => o.name === 'ofeliya-result-title')?.text,
            stats: texts.find((o) => o.name === 'ofeliya-result-stats')?.text,
          },
        };
      });
    };

    const baseResult = {
      win: false,
      reason: 'defeat',
      difficultyId: 'standard',
      runSeed: 'ui-redesign',
      controlMode: 'one-hand',
      resumed: false,
      timeMs: 920000,
      kills: 2617,
      hostCellsInfected: 61,
      level: 23,
      highestLevel: 23,
      comboBest: 460,
      stageId: 'bloodstream',
      stageOrder: 0,
      bossesDefeated: 0,
      boss1ClearMs: 0,
      stacks: { multi: 3, pierce: 2 },
      evolutions: [],
      legendaryIds: [],
      stageBuilds: {},
      newAchievements: [],
      records: { timeRecord: true, killsRecord: true, levelRecord: true },
    };

    const defeat = await renderResult(baseResult);
    assert.ok(defeat.overlayTexts.includes('ИТОГ ЗАБЕГА'), 'the result header is wrong');
    assert.ok(defeat.overlayTexts.includes('ШТАММ УНИЧТОЖЕН'), 'the defeat outcome is wrong');
    assert.ok(defeat.labels.retry === 'НОВЫЙ ЗАБЕГ', 'the primary result action is wrong');
    assert.ok(defeat.labels.share === 'БРОСИТЬ ВЫЗОВ ДРУГУ', 'the challenge action is wrong');
    assert.ok(defeat.labels.menu === 'В МЕНЮ', 'the menu action is wrong');
    assert.ok(
      defeat.labels.stats.includes('Уничтожено: 2\u00a0617') && defeat.labels.stats.includes('Комбо ×460'),
      `the result stats are wrong: ${defeat.labels.stats}`
    );
    assert.ok(!defeat.labels.stats.includes('2 617 '), 'the thousands separator must be non-breaking');
    assert.ok(
      !defeat.overlayTexts.some((t) => t.includes('КРИТ.')),
      'the abbreviated critical label must be gone'
    );
    assert.ok(
      !defeat.overlayTexts.some((t) => t.includes('нет')),
      'an absent critical or legendary mutation must render nothing'
    );
    assert.ok(
      defeat.overlayTexts.some((t) => t.startsWith('Архетип: ')),
      'the build must be named as an archetype'
    );
    assert.deepEqual(defeat.hudVisible, [], 'the gameplay HUD must be hidden under the result');

    const victory = await renderResult({ ...baseResult, win: true, reason: 'campaign-clear', bossesDefeated: 2, stageId: 'heart', stageOrder: 1, evolutions: ['prism'] });
    assert.ok(victory.overlayTexts.includes('НОСИТЕЛЬ ЗАРАЖЁН'), 'the victory outcome is wrong');
    assert.ok(
      victory.overlayTexts.some((t) => t.includes('◆ КРИТИЧЕСКАЯ МУТАЦИЯ:')),
      'a present critical mutation must use the full copy'
    );

    const legendary = await renderResult({
      ...baseResult,
      evolutions: ['prism'],
      legendaryIds: ['zero-point'],
    });
    assert.ok(
      legendary.overlayTexts.some((t) => t.includes('◆ ЛЕГЕНДАРНАЯ МУТАЦИЯ:')),
      'a present legendary mutation must use the full copy'
    );

    // A resumed run is never ranked and never invents a board.
    const resumed = await renderResult({ ...baseResult, resumed: true });
    assert.ok(
      resumed.overlayTexts.some((t) => t.includes('Тренировка') && t.includes('продолженный забег')),
      'a resumed run must state its neutral status'
    );
    assert.ok(
      !resumed.overlayTexts.some((t) => /МЕСТО #/.test(t)),
      'a resumed run must never show a place'
    );
    assert.ok(
      !resumed.overlayTexts.some((t) => /В СЕЗОНЕ/.test(t)),
      'no board identity may be invented'
    );

    for (const forbidden of FORBIDDEN_PLAYER_COPY) {
      assert.ok(
        !defeat.overlayTexts.some((t) => t.includes(forbidden)),
        `forbidden player copy "${forbidden}" on the result screen`
      );
    }
    assert.deepEqual(resultErrors, [], 'page errors on the result screen');
    await shot(resultPage, `result-defeat-${viewport.width}x${viewport.height}.png`);
    await renderResult({
      ...baseResult,
      win: true,
      reason: 'campaign-clear',
      bossesDefeated: 2,
      stageId: 'heart',
      stageOrder: 1,
      evolutions: ['prism', 'halo'],
      legendaryIds: ['zero-point', 'core-predator'],
    });
    await shot(resultPage, `result-legendary-${viewport.width}x${viewport.height}.png`);
    await resultPage.close();

    // ---- Daily tasks, codex and collection ---------------------------------
    const metaPage = await context.newPage();
    const metaErrors = [];
    metaPage.on('pageerror', (error) => metaErrors.push(String(error)));
    await metaPage.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 3, muted: true, bestSurvivalMs: 920000, bestKills: 2617 }));
    });
    await metaPage.goto(base, { waitUntil: 'domcontentloaded' });
    await metaPage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });

    const openMeta = async (target) => {
      await metaPage.evaluate((name) => {
        const menu = window.__game.scene.getScene('Menu');
        // One meta surface at a time: close the previous one first.
        menu.questBoard?.destroy();
        menu.collectionBoard?.destroy();
        if (menu.codexOverlay) { menu.codexOverlay.destroy(); menu.codexOverlay = null; }
        if (name === 'tasks') menu.showQuestBoard();
        else if (name === 'codex') menu.showCodex();
        else menu.showCollectionBoard();
      }, target);
      await metaPage.waitForTimeout(350);
      return metaPage.evaluate(() => {
        const menu = window.__game.scene.getScene('Menu');
        const board = menu.children.list.find((o) => o.name === 'ofeliya-quests')
          ?? menu.children.list.find((o) => o.name === 'ofeliya-collection')
          ?? menu.children.list.find((o) => o.name === 'ofeliya-codex');
        const texts = board ? board.list.filter((o) => o.type === 'Text').map((o) => o.text) : [];
        const names = board ? board.list.map((o) => o.name).filter(Boolean) : [];
        const overlay = menu.children.list.find((o) => o.name === 'ofeliya-codex');
        const overlayTexts = overlay ? overlay.list.filter((o) => o.type === 'Text').map((o) => o.text) : [];
        const collect = (node, into) => {
          for (const child of node.list ?? []) {
            if (child.name) into.push(child.name);
            collect(child, into);
          }
          return into;
        };
        const overlayNames = overlay ? collect(overlay, []) : [];
        return { texts, names, overlayTexts, overlayNames };
      });
    };

    const tasks = await openMeta('tasks');
    assert.ok(tasks.texts.includes('ЗАДАЧИ ДНЯ'), 'the daily tasks title is wrong');
    assert.ok(
      tasks.texts.some((t) => t.startsWith('Выполнено: ') && t.includes('Обновление через ')),
      `the daily tasks summary is wrong: ${tasks.texts.join(' | ')}`
    );
    assert.ok(!tasks.texts.some((t) => t.includes('локально')), 'no local language on the daily tasks');
    assert.ok(!tasks.texts.some((t) => t.includes('00:00 UTC')), 'no UTC string on the daily tasks');
    assert.ok(!tasks.texts.some((t) => t.includes('без наград')), 'no reward disclaimer on the daily tasks');
    assert.ok(
      tasks.texts.some((t) => /^\d+\s\/\s\d+ · осталось \d+$/.test(t) || t === '◆ ВЫПОЛНЕНО'),
      `a task must show its fraction or its completed state: ${tasks.texts.join(' | ')}`
    );

    await shot(metaPage, `daily-tasks-${viewport.width}x${viewport.height}.png`);

    const codex = await openMeta('codex');
    await shot(metaPage, `codex-${viewport.width}x${viewport.height}.png`);
    assert.ok(codex.overlayTexts.includes('КОДЕКС'), 'the codex title is wrong');
    assert.ok(!codex.overlayTexts.some((t) => t.includes('STRAIN-0')), 'no strain code in the codex');
    assert.ok(
      codex.overlayNames.includes('ofeliya-meta-dock-tasks') && codex.overlayNames.includes('ofeliya-meta-dock-codex')
        && codex.overlayNames.includes('ofeliya-meta-dock-collection'),
      'the codex must own the internal meta dock'
    );
    assert.ok(
      !codex.overlayNames.includes('ofeliya-meta-dock-rating'),
      'the rating must not be part of the internal meta dock'
    );

    const collection = await openMeta('collection');
    // The shells tab carries the one explanation of the cosmetic tab.
    await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const board = menu.children.list.find((o) => o.name === 'ofeliya-collection');
      board.list.find((o) => o.name === 'ofeliya-collection-shells')?.emit('pointerup');
    });
    await metaPage.waitForTimeout(250);
    const shells = await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const board = menu.children.list.find((o) => o.name === 'ofeliya-collection');
      const collect = (node, into) => {
        for (const child of node.list ?? []) {
          if (child.name) into.push(child.name);
          collect(child, into);
        }
        return into;
      };
      const collectInteractive = (node, into) => {
        for (const child of node.list ?? []) {
          if (child.name && child.input?.enabled) into.push(child.name);
          collectInteractive(child, into);
        }
        return into;
      };
      return {
        texts: board.list.filter((o) => o.type === 'Text').map((o) => o.text),
        names: collect(board, []),
        interactiveNames: collectInteractive(board, []),
      };
    });
    assert.ok(collection.texts.includes('КОЛЛЕКЦИЯ'), 'the collection title is wrong');
    assert.ok(collection.texts.includes('ОБОЛОЧКИ'), 'the shells tab is wrong');
    assert.ok(collection.texts.includes('ВЕХИ'), 'the milestones tab is wrong');
    assert.ok(collection.texts.includes('ЛАБОРАТОРИЯ'), 'the lab tab is wrong');
    assert.ok(
      !collection.texts.some((t) => t.includes('серия') || t.includes('Посещений')),
      'the collection must not carry the streak or the visit line'
    );
    assert.ok(
      shells.texts.some((t) => t.includes('Оболочки меняют только внешний вид')),
      'the shells need one explanation'
    );
    assert.ok(
      !shells.texts.some((t) => t === 'Только внешний вид'),
      'the shells must not repeat the explanation'
    );
    // The paginator controls appear together or not at all.
    assert.equal(
      shells.names.includes('ofeliya-collection-prev'),
      shells.names.includes('ofeliya-collection-next'),
      'the paginator controls must appear together'
    );
    // Every shell row keeps a named handle, so the board can be probed; a locked
    // shell must never be an interactive control.
    assert.ok(
      !shells.interactiveNames.some((n) => n.startsWith('ofeliya-skin-') && n.endsWith('skin.gilded-prime')),
      'a locked shell must not offer a select action'
    );
    assert.ok(
      shells.names.includes('ofeliya-skin-strain-zero'),
      'the owned shell keeps a named handle'
    );

    for (const forbidden of ['локально', 'без наград', '00:00 UTC', 'tdesktop', 'КРИТ.']) {
      assert.ok(
        ![...tasks.texts, ...codex.overlayTexts, ...collection.texts].some((t) => t.includes(forbidden)),
        `forbidden player copy "${forbidden}" in the meta surfaces`
      );
    }
    assert.deepEqual(metaErrors, [], 'page errors in the meta surfaces');
    await shot(metaPage, `collection-${viewport.width}x${viewport.height}.png`);
    await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const board = menu.children.list.find((o) => o.name === 'ofeliya-collection');
      board.list.find((o) => o.name === 'ofeliya-collection-milestones')?.emit('pointerup');
    });
    await metaPage.waitForTimeout(200);
    await shot(metaPage, `collection-milestones-${viewport.width}x${viewport.height}.png`);
    await metaPage.close();

    // ---- Rating surface ---------------------------------------------------
    const ratingPage = await context.newPage();
    const ratingErrors = [];
    ratingPage.on('pageerror', (error) => ratingErrors.push(String(error)));
    await ratingPage.goto(base, { waitUntil: 'domcontentloaded' });
    await ratingPage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });
    await ratingPage.evaluate(() => window.__game.scene.getScene('Menu').showSocialHub());
    await ratingPage.waitForTimeout(900);
    const rating = await ratingPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const hub = menu.children.list.find((o) => o.name === 'ofeliya-social-hub');
      const texts = hub ? hub.list.filter((o) => o.type === 'Text').map((o) => o.text) : [];
      const find = (node, name) => {
        for (const child of node.list ?? []) {
          if (child.name === name) return child;
          const hit = find(child, name);
          if (hit) return hit;
        }
        return null;
      };
      const close = hub ? find(hub, 'ofeliya-social-close-hit') : null;
      return {
        texts,
        close: close ? { width: close.width, height: close.height } : null,
      };
    });
    assert.ok(rating.texts.includes('РЕЙТИНГ'), 'the rating title is wrong');
    assert.ok(rating.texts.some((t) => t.includes('ЗАБЕГ ДНЯ')), 'the rating has no daily-run band');
    assert.ok(
      !rating.texts.some((t) => t.includes('СЕРИЯ 0')),
      'a zero streak must never be rendered'
    );
    assert.ok(
      !rating.texts.some((t) => /#\d+ · (TG|MAX|WEB)$/.test(t)),
      'a table row without a name must name the player neutrally'
    );
    assert.ok(
      rating.close && rating.close.width >= 44 && rating.close.height >= 44,
      'the rating close control is a real touch target'
    );
    assert.deepEqual(ratingErrors, [], 'page errors on the rating surface');
    await shot(ratingPage, `rating-${viewport.width}x${viewport.height}.png`);
    await ratingPage.close();
    await context.close();
    console.log(`ui redesign surfaces PASS ${viewport.width}x${viewport.height}`);
    console.log(`ui redesign menu PASS ${viewport.width}x${viewport.height}`);
  }
} finally {
  await browser?.close();
  await server.close();
}
console.log('ui redesign contract: ok');

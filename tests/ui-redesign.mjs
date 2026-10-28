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
  // The calque of the projectile branch and the achievement counter of the codex
  // are gone for good.
  'ПРОЕКТИЛЬНЫЙ',
  'ДОСТИЖЕНИЯ',
  // The daily run has one canonical call to action.
  'НАЧАТЬ ЕЖЕДНЕВНЫЙ ЗАБЕГ',
  'СЕГОДНЯ РЕЗУЛЬТАТА ЕЩЁ НЕТ',
  // A ranking disclaimer is an internal flag, never a player-facing word.
  'вне рейтинга',
  'вне рейтинга'.toUpperCase(),
];

/** Every text of a surface, including the texts of its nested containers. */
function collectTexts(node) {
  const out = [];
  const visit = (child) => {
    if (child?.type === 'Text' && typeof child.text === 'string') out.push(child.text);
    for (const grand of child?.list ?? []) visit(grand);
  };
  visit(node);
  return out;
}

// ---------------------------------------------------------------------------
// Pure menu geometry.
//
// The hero of the menu may shrink, but a control may never move out of the
// viewport and two controls may never share a slot. The contract is asserted
// on the production layout module itself, without a browser: a geometry
// regression must fail here, not only in a screenshot.
// ---------------------------------------------------------------------------
const layoutModule = await (async () => {
  const { buildSync } = await import('esbuild');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve: resolvePath, sep } = await import('node:path');
  const temp = mkdtempSync(join(tmpdir(), 'ofeliya-ui-redesign-layout-'));
  const entry = join(temp, 'entry.ts');
  const bundle = join(temp, 'bundle.cjs');
  writeFileSync(
    entry,
    `export * from '${resolvePath('src/ui/menuLayout.ts').split(sep).join('/')}';`
  );
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'warning',
  });
  return import(bundle);
})();

/**
 * The states the menu can be in. The challenge state carries the most controls.
 *
 * `resume+challenge+record2` is the tightest combination of the flags: a
 * checkpoint to continue, an incoming challenge and a record that needs two
 * lines. The product never shows a checkpoint and an incoming challenge at the
 * same time, so this state is a contract of the layout module, not of the
 * shipped menu — but the layout must survive it all the same.
 */
const MENU_STATES = {
  fresh: { hasCheckpoint: false, hasRecord: true, recordLines: 1, hasChallenge: false },
  resume: { hasCheckpoint: true, hasRecord: true, recordLines: 1, hasChallenge: false },
  'resume+record': { hasCheckpoint: true, hasRecord: true, recordLines: 2, hasChallenge: false },
  challenge: { hasCheckpoint: false, hasRecord: true, recordLines: 1, hasChallenge: true },
  'resume+challenge': { hasCheckpoint: true, hasRecord: true, recordLines: 1, hasChallenge: true },
  'resume+challenge+record2': { hasCheckpoint: true, hasRecord: true, recordLines: 2, hasChallenge: true },
};

/**
 * The states the product can actually render. The brand text may only give up
 * its room in a state the product never produces.
 */
const PRODUCT_STATES = [
  'fresh',
  'resume',
  'resume+record',
  'challenge',
];

/** The boxes of the interactive bands, in the order the menu stacks them. */
function menuBandBoxes(layout) {
  const touch = 44;
  const boxes = [
    { key: 'art', top: layout.artTop, bottom: layout.artTop + layout.artHeight },
  ];
  if (layout.challengeHeight > 0) {
    boxes.push({
      key: 'challenge',
      top: layout.challengeY - layout.challengeHeight / 2,
      bottom: layout.challengeY + layout.challengeHeight / 2,
    });
  }
  boxes.push(
    { key: 'cards', top: layout.cardY - layout.cardHeight / 2, bottom: layout.cardY + layout.cardHeight / 2 },
    { key: 'cta', top: layout.ctaY - layout.ctaHeight / 2, bottom: layout.ctaY + layout.ctaHeight / 2 }
  );
  if (layout.secondaryY > 0) {
    boxes.push({
      key: 'secondary',
      top: layout.secondaryY - layout.secondaryHeight / 2,
      bottom: layout.secondaryY + layout.secondaryHeight / 2,
    });
  }
  boxes.push(
    {
      key: 'grid',
      top: layout.gridTop,
      bottom: layout.gridTop + layout.gridRowHeight * 2 + layout.gridGap,
    },
    { key: 'audio', top: layout.audioY - touch / 2, bottom: layout.audioY + touch / 2 },
    { key: 'legal', top: layout.legalY - touch / 2, bottom: layout.legalY + touch / 2 }
  );
  return boxes;
}

for (const viewport of VIEWPORTS) {
  for (const [state, flags] of Object.entries(MENU_STATES)) {
    const layout = layoutModule.computeMenuLayout(viewport.width, viewport.height, flags);
    const where = `${state} at ${viewport.width}x${viewport.height}`;

    // The hero never collapses to a sliver, in any state.
    assert.ok(
      layout.artHeight >= 40,
      `the hero of the menu collapsed to ${layout.artHeight.toFixed(1)}px in the ${where}`
    );
    // The content never leaves the viewport.
    const boxes = menuBandBoxes(layout);
    for (const box of boxes) {
      assert.ok(
        box.top >= -0.01 && box.bottom <= viewport.height + 0.01,
        `the ${box.key} band leaves the viewport in the ${where}: ${box.top.toFixed(1)}..${box.bottom.toFixed(1)}`
      );
    }
    // Two controls never share a slot.
    for (let i = 1; i < boxes.length; i += 1) {
      assert.ok(
        boxes[i].top >= boxes[i - 1].bottom - 0.01,
        `the ${boxes[i - 1].key} and ${boxes[i].key} bands overlap in the ${where}`
      );
    }
  }

  // The returning player keeps a real hero at the smallest viewport: this is the
  // state that used to collapse the hero to a 34px sliver.
  const resume = layoutModule.computeMenuLayout(viewport.width, viewport.height, MENU_STATES.resume);
  if (viewport.width === 320 && viewport.height === 568) {
    assert.ok(
      resume.artHeight >= 64,
      `the resume hero collapsed to ${resume.artHeight.toFixed(1)}px at 320x568`
    );
  }

  // The brand text is a promise of the menu, not a luxury: it gives up its room
  // only in a state the product never renders.
  for (const state of PRODUCT_STATES) {
    const layout = layoutModule.computeMenuLayout(viewport.width, viewport.height, MENU_STATES[state]);
    assert.ok(layout.showStrain, `the strain eyebrow is gone in the ${state} at ${viewport.width}x${viewport.height}`);
    assert.ok(layout.showTagline, `the promise line is gone in the ${state} at ${viewport.width}x${viewport.height}`);
  }
}
console.log('ui redesign menu geometry: ok (pure layout contract)');

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
    // The run configuration is the caption of the primary action, inside the
    // button: the menu spends no separate band on it.
    const freshCaption = menu.named['ofeliya-menu-action-caption'];
    assert.ok(freshCaption, `the primary action has no caption at ${viewport.width}`);
    assert.ok(
      /Кровоток · Стандарт/.test(freshCaption.text || ''),
      `the fresh run configuration is wrong: ${freshCaption?.text}`
    );
    assert.ok(
      freshCaption.bounds.y >= menu.action.bounds.y &&
        freshCaption.bounds.y + freshCaption.bounds.height <=
          menu.action.bounds.y + menu.action.bounds.height,
      'the run configuration must sit inside the primary action'
    );
    assert.ok(
      !menu.named['ofeliya-menu-action-hint'],
      'the separate run configuration band must be gone'
    );

    // The record line never merges counters of different windows.
    assert.ok(
      !menu.allText.some((t) => /Клеток:\s*\d/.test(t)),
      'the ambiguous "Клеток: N" counter must be gone'
    );

    // Navigation: a 3x2 grid (six cells since the menu redesign: the lab and
    // the strains entries joined the four meta destinations), not a cramped
    // row, and still two rows — the third row was rejected on geometry.
    assert.equal(menu.nav.length, 6, `the navigation grid must have six cells at ${viewport.width}`);
    const navNames = menu.nav.map((n) => n.name);
    assert.ok(navNames.includes('ofeliya-menu-nav-lab'), `the lab entry is missing at ${viewport.width}`);
    assert.ok(navNames.includes('ofeliya-menu-nav-strains'), `the strains entry is missing at ${viewport.width}`);
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
    const audioLabels = menu.allText.filter((t) => /^(♪ )?(Музыка|Звук|Эффекты):/.test(t));
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
        // The run configuration is the caption of the primary action: the menu
        // spends no separate band on it.
        caption: texts.find((o) => o.name === 'ofeliya-menu-action-caption')?.text,
        captionBounds: bounds(byName('ofeliya-menu-action-caption')),
        hasLegacyHint: Boolean(byName('ofeliya-menu-action-hint')),
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
      /Кровоток · \d\d:\d\d · Уровень \d+ · Стандарт/.test(resume.caption || ''),
      `the checkpoint summary is wrong: ${resume.caption}`
    );
    // The configuration lives inside the button, and the dead hint band is gone.
    assert.ok(
      resume.captionBounds &&
        resume.captionBounds.y >= resume.action.bounds.y &&
        resume.captionBounds.y + resume.captionBounds.height <=
          resume.action.bounds.y + resume.action.bounds.height,
      'the run configuration must sit inside the primary action'
    );
    assert.ok(!resume.hasLegacyHint, 'the separate run configuration band must be gone');
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
      // The share action of the result screen is the real product path: capture
      // the text it hands to the messenger.
      window.__shared = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => { window.__shared.push(data); },
      });
    });
    await resultPage.goto(base, { waitUntil: 'domcontentloaded' });
    await resultPage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 20000 });

    const renderResult = async (res, registryPatch = null) => {
      await resultPage.evaluate(() => {
        const game = window.__game;
        if (!game.scene.isActive('Game')) game.scene.getScene('Menu').scene.start('Game');
      });
      await resultPage.waitForFunction(() => window.__game?.scene.isActive('UI'), null, { timeout: 20000 });
      await resultPage.evaluate(
        ({ result, patch }) => {
          const game = window.__game;
          const gs = game.scene.getScene('Game');
          const ui = game.scene.getScene('UI');
          gs.scene.pause();
          if (patch) {
            for (const [key, value] of Object.entries(patch)) game.registry.set(key, value);
          }
          ui.renderGameOver(result);
        },
        { result: res, patch: registryPatch }
      );
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
    // The challenge button states what the challenge is about.
    assert.ok(
      defeat.overlayTexts.some((t) => t.startsWith('Побить результат 15:20') && t.includes('2\u00a0617 кл.')),
      `the challenge caption is wrong: ${defeat.overlayTexts.join(' | ')}`
    );
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
    assert.ok(
      defeat.overlayTexts.some((t) => t.startsWith('Архетип: Снарядный штамм (')),
      `the archetype must be named in full: ${defeat.overlayTexts.join(' | ')}`
    );
    assert.ok(
      defeat.overlayTexts.some((t) => t.startsWith('НОВЫЕ РЕКОРДЫ: ')),
      'the records of the run must be named'
    );
    assert.ok(
      !defeat.overlayTexts.some((t) => t.startsWith('НОВЫЕ ЗАПИСИ')),
      'a record is a record, not a codex entry'
    );
    // The mode chip names the mode; it never uses a ranking disclaimer.
    assert.ok(
      defeat.overlayTexts.some((t) => t === 'СТАНДАРТ · Тренировка'),
      `the mode chip is wrong: ${defeat.overlayTexts.join(' | ')}`
    );
    assert.ok(
      !defeat.overlayTexts.some((t) => t.startsWith('РЕЖИМ:')),
      'the mode chip must not be a prefixed line'
    );
    assert.deepEqual(defeat.hudVisible, [], 'the gameplay HUD must be hidden under the result');

    // The capture belongs to the state that is on the screen: it is taken
    // before the next render replaces the overlay.
    await shot(resultPage, `result-defeat-${viewport.width}x${viewport.height}.png`);

    // The share action hands the canonical text to the messenger.
    await resultPage.evaluate(() => {
      const ui = window.__game.scene.getScene('UI');
      // The button is armed by a pointerdown: the synthetic pair keeps the
      // product's own guard intact.
      const bg = ui.resultOverlay.getByName('ofeliya-result-share-bg');
      bg.emit('pointerdown', { id: 1 });
      bg.emit('pointerup', { id: 1 });
    });
    await resultPage.waitForTimeout(250);
    const shared = await resultPage.evaluate(() => window.__shared ?? []);
    assert.ok(shared.length > 0, 'the share action must hand a text to the messenger');
    const shareText = shared[0].text ?? '';
    assert.ok(shareText.startsWith('OFELIYA · Вызов в кровотоке'), `the share title is wrong: ${shareText}`);
    assert.ok(shareText.includes('продержался'), 'a defeat says "продержался"');
    assert.ok(!shareText.includes('выжил'), 'a defeat never says "выжил"');
    assert.ok(shareText.includes('@ofeliya_game_bot'), 'the share names the bot');
    for (const forbidden of ['STRAIN-0', 'Профиль штамма', 'вне рейтинга', 'тот же штамм', 'тот же забег']) {
      assert.ok(!shareText.includes(forbidden), `the share must not carry "${forbidden}"`);
    }

    // The records the run opened are named once, and the plate is a way into
    // the codex.
    const withEntries = await renderResult({ ...baseResult, newAchievements: ['first-contact'] });
    assert.ok(
      withEntries.overlayTexts.some((t) => t.startsWith('★ Открыто в Кодексе: +1 запись')),
      `the codex plate is wrong: ${withEntries.overlayTexts.join(' | ')}`
    );
    assert.ok(
      !withEntries.overlayTexts.some((t) => t.includes('ДОСТИЖЕНИЕ')),
      'the player UI does not say "достижение"'
    );

    await shot(resultPage, `result-codex-entries-${viewport.width}x${viewport.height}.png`);

    const victory = await renderResult({ ...baseResult, win: true, reason: 'campaign-clear', bossesDefeated: 2, stageId: 'heart', stageOrder: 1, evolutions: ['prism'] });
    assert.ok(victory.overlayTexts.includes('НОСИТЕЛЬ ЗАРАЖЁН'), 'the victory outcome is wrong');
    assert.ok(
      victory.overlayTexts.some((t) => t.includes('◆ Критические мутации:')),
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

    // A daily run that could not be sent states it in one plain sentence: the
    // player never reads a synchronization report.
    const dailyBlocked = await renderResult(baseResult, {
      dailyIntent: { runId: 'ui-redesign-daily' },
      dailyTicket: {
        runId: 'ui-redesign-other',
        runSeed: 'ui-redesign-other',
        dateKey: '2026-10-27',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        difficultyId: 'standard',
        rulesetVersion: 1,
        campaignVersion: 1,
      },
    });
    assert.ok(
      dailyBlocked.overlayTexts.includes('Забег дня не засчитан'),
      `the daily status is wrong: ${dailyBlocked.overlayTexts.join(' | ')}`
    );
    assert.ok(
      !dailyBlocked.overlayTexts.some((t) => /синхрониз/i.test(t)),
      'the daily status must not talk about synchronization'
    );
    assert.ok(
      !dailyBlocked.overlayTexts.some((t) => t.includes('ЕЖЕДНЕВНЫЙ ЗАБЕГ ·')),
      'the daily status must not be a prefixed technical label'
    );

    for (const forbidden of FORBIDDEN_PLAYER_COPY) {
      assert.ok(
        !defeat.overlayTexts.some((t) => t.includes(forbidden)),
        `forbidden player copy "${forbidden}" on the result screen`
      );
    }
    assert.deepEqual(resultErrors, [], 'page errors on the result screen');
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
      tasks.texts.some((t) => /^\d+\s\/\s\d+ · остал(ся|ось) \d+$/.test(t) || t === '◆ ВЫПОЛНЕНО'),
      `a task must show its fraction or its completed state: ${tasks.texts.join(' | ')}`
    );

    await shot(metaPage, `daily-tasks-${viewport.width}x${viewport.height}.png`);

    const codex = await openMeta('codex');
    await shot(metaPage, `codex-${viewport.width}x${viewport.height}.png`);
    assert.ok(codex.overlayTexts.includes('КОДЕКС'), 'the codex title is wrong');
    assert.ok(!codex.overlayTexts.some((t) => t.includes('STRAIN-0')), 'no strain code in the codex');

    // The codex body lives in a nested container: read the whole surface.
    const codexBody = await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const overlay = menu.children.list.find((o) => o.name === 'ofeliya-codex');
      const visit = (node, out) => {
        for (const child of node.list ?? []) {
          if (child.type === 'Text' && typeof child.text === 'string') out.push(child.text);
          visit(child, out);
        }
        return out;
      };
      return overlay ? visit(overlay, []) : [];
    });
    // The tab is named after its content: it shows the critical mutations.
    const codexTabs = await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const overlay = menu.children.list.find((o) => o.name === 'ofeliya-codex');
      return overlay
        ? overlay.list.filter((o) => o.type === 'Text' && o.input?.enabled).map((o) => o.text)
        : [];
    });
    assert.deepEqual(
      codexTabs,
      ['СИНЕРГИИ', 'ЛЕГЕНДАРНЫЕ', 'МАСТЕРСТВО'],
      'the codex tabs must be named after their content'
    );
    // The header names the open records and the runs; the achievement counter is
    // not a codex record and does not belong into the codex.
    assert.ok(
      codexBody.some((t) => /^Открыто записей: \d+\/9 · Забегов: \d+$/.test(t)),
      `the codex header is wrong: ${codexBody.join(' | ')}`
    );
    assert.ok(!codexBody.some((t) => t.includes('ДОСТИЖЕНИЯ')), 'the achievement counter must be gone');
    // Every locked synergy names its own recipe.
    assert.ok(
      codexBody.some((t) => t.includes('ЗАКРЫТАЯ СИНЕРГИЯ')),
      'a locked synergy must be named'
    );
    for (const recipe of [
      'БЕЛКОВЫЕ ШИПЫ III + ПРОНИКНОВЕНИЕ II',
      'КАПСИДНЫЕ СПУТНИКИ III + ПОДВИЖНОСТЬ/РЕПЛИКАЦИЯ II',
      'МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II',
    ]) {
      assert.ok(codexBody.some((t) => t.includes(recipe)), `the Codex is missing the real recipe: ${recipe}`);
    }
    assert.ok(
      codexBody.some((t) => t.includes('Открываются при совмещении двух совместимых ветвей')),
      'the synergy section must explain itself'
    );
    assert.ok(!codexBody.some((t) => t.includes('НЕ ОТКРЫТО')), 'three identical locked cards must be gone');
    assert.ok(!codexBody.includes('КВЕСТЫ'), 'the codex must not carry a stray quest link');
    assert.ok(
      codex.overlayNames.includes('ofeliya-meta-dock-tasks') && codex.overlayNames.includes('ofeliya-meta-dock-codex')
        && codex.overlayNames.includes('ofeliya-meta-dock-collection'),
      'the codex must own the internal meta dock'
    );
    assert.ok(
      !codex.overlayNames.includes('ofeliya-meta-dock-rating'),
      'the rating must not be part of the internal meta dock'
    );

    // The mastery tab: the branch rows and the mode rows.
    await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const overlay = menu.children.list.find((o) => o.name === 'ofeliya-codex');
      const tab = overlay.list.find((o) => o.type === 'Text' && o.text === 'МАСТЕРСТВО');
      tab.emit('pointerup');
    });
    await metaPage.waitForTimeout(250);
    const mastery = await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const overlay = menu.children.list.find((o) => o.name === 'ofeliya-codex');
      const visit = (node, out) => {
        for (const child of node.list ?? []) {
          if (child.type === 'Text' && typeof child.text === 'string') out.push(child.text);
          visit(child, out);
        }
        return out;
      };
      return overlay ? visit(overlay, []) : [];
    });
    assert.ok(mastery.includes('ПРОХОЖДЕНИЕ РЕЖИМОВ'), 'the mastery section must be named');
    assert.ok(
      mastery.some((t) => /^(◆ )?(Стандарт|Напряжение) — (пройдено: \d+ · рекорд: |ещё не пройдена)/.test(t)),
      `the mode rows are wrong: ${mastery.join(' | ')}`
    );
    assert.ok(
      mastery.some((t) => /Снарядный штамм · \d\/2 — /.test(t)),
      `the branch rows are wrong: ${mastery.join(' | ')}`
    );
    assert.ok(
      mastery.some((t) => /— (дальше: |Выполнено)/.test(t)),
      'a branch row must state its state in words'
    );
    assert.ok(
      !mastery.some((t) => /Открой |Найди /.test(t)),
      'a branch row must never be a bare imperative'
    );
    // The lifetime counters of the profile do not live in the codex: the
    // codex is the record of what the collection has unlocked, and every
    // counter keeps its own window instead of being merged into one number.
    assert.ok(
      !mastery.some((t) => /^Забегов: \d+ · Уничтожено клеток:/.test(t)),
      `the codex must not carry the lifetime counters: ${mastery.join(' | ')}`
    );
    assert.ok(
      !mastery.some((t) => t.includes('Уничтожено клеток')),
      `the codex must not carry a lifetime kill counter: ${mastery.join(' | ')}`
    );
    assert.ok(
      mastery.some((t) => /^Открыто записей: \d+\/9 · Забегов: \d+$/.test(t)),
      `the codex must keep its own progress line: ${mastery.join(' | ')}`
    );

    const collection = await openMeta('collection');

    // The paginator of a multi-page list must never share a tap with the
    // internal dock: the real Phaser hit areas are measured, not estimated.
    const pagination = await metaPage.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      const board = menu.children.list.find((o) => o.name === 'ofeliya-collection');
      const find = (node, name) => {
        for (const child of node.list ?? []) {
          if (child.name === name) return child;
          const hit = find(child, name);
          if (hit) return hit;
        }
        return null;
      };
      const bounds = (o) => (o ? JSON.parse(JSON.stringify(o.getBounds())) : null);
      const dockItems = ['ofeliya-meta-dock-tasks', 'ofeliya-meta-dock-codex', 'ofeliya-meta-dock-collection']
        .map((name) => bounds(find(board, name)))
        .filter(Boolean);
      return {
        prev: bounds(find(board, 'ofeliya-collection-prev')),
        next: bounds(find(board, 'ofeliya-collection-next')),
        dockTop: dockItems.length ? Math.min(...dockItems.map((b) => b.y)) : null,
      };
    });
    assert.ok(
      pagination.prev && pagination.next,
      `the collection of a multi-page list needs a paginator at ${viewport.width}`
    );
    for (const target of [pagination.prev, pagination.next]) {
      assert.ok(
        target.width >= 44 && target.height >= 44,
        `a paginator control must be a real touch target at ${viewport.width}: ${target.width}x${target.height}`
      );
    }
    const paginatorBottom = Math.max(
      pagination.prev.y + pagination.prev.height,
      pagination.next.y + pagination.next.height
    );
    assert.ok(
      paginatorBottom + 4 <= pagination.dockTop,
      `the paginator overlaps the internal dock at ${viewport.width}x${viewport.height}: ` +
        `paginator bottom ${paginatorBottom.toFixed(1)} + 4 > dock top ${pagination.dockTop?.toFixed(1)}`
    );

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
    // A shell names its kind and the way to open it; a locked shell never
    // offers a select action.
    assert.ok(
      shells.texts.some((t) => t.includes('Штамм «Нулевой»') && t.includes('Базовая оболочка')),
      `the shell must name its kind: ${shells.texts.join(' | ')}`
    );
    assert.ok(
      shells.texts.some((t) => t.includes('Био-оболочка')),
      'a bio shell must name its kind'
    );
    assert.ok(
      shells.texts.some((t) => t.startsWith('Чтобы открыть: выполни веху «')),
      'a locked shell must name the milestone that opens it'
    );
    assert.ok(
      shells.texts.includes('ЗАКРЫТО'),
      'a locked shell must state that it is locked'
    );
    assert.ok(
      !shells.texts.some((t) => t.includes('Открывает:')),
      'a locked shell must not use the "opens:" wording'
    );
    // The kill milestones share one group header and one target wording. The
    // counter of the group is the progress of the milestones, never a lifetime
    // total: the collection does not keep one.
    assert.ok(
      collection.texts.some((t) => t.startsWith('Уничтожение иммунных клеток (в прогрессе вех: ')),
      `the milestone group needs one header: ${collection.texts.join(' | ')}`
    );
    assert.ok(
      !collection.texts.some((t) => t.includes('Уничтожение иммунных клеток (всего:')),
      'the milestone group must not promise a lifetime total'
    );
    assert.ok(
      collection.texts.some((t) => t === '500 противников всего'),
      'a kill milestone must name its target once'
    );
    assert.ok(
      !collection.texts.some((t) => t.includes('уничтоженных противников суммарно')),
      'the repeated kill phrase must be gone'
    );
    assert.ok(
      collection.texts.some((t) => / · остал(ся|ось) \d+$/.test(t)),
      'an open milestone must state its rest'
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
      const visit = (node, out) => {
        for (const child of node.list ?? []) {
          if (child.type === 'Text' && typeof child.text === 'string') out.push(child.text);
          visit(child, out);
        }
        return out;
      };
      const texts = hub ? visit(hub, []) : [];
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
    // The title is not a tab strip: the sections are the only structure.
    assert.ok(
      !rating.texts.some((t) => t === 'ЗАБЕГ ДНЯ · СЕЗОН · ДРУЗЬЯ'),
      'the rating must not fake a tab strip under the title'
    );
    assert.ok(
      rating.texts.some((t) => t === 'СЕЗОН' || t.startsWith('СЕЗОН ')),
      'the rating must name the season section'
    );
    assert.ok(
      rating.texts.some((t) => t === 'ДРУЗЬЯ'),
      'the rating must name the friends section'
    );
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

// Focused manual browser probe for the measured «Био-мембрана» level-up layout.
// Run against this checkout's Vite server; override OFELIYA_URL for a non-default port.
//
// Every legendary is offered through the synthetic modal. The «Последний носитель»
// card renders the structured form (условие / эффект / цена / облик) and carries
// no generic effect plate; every other legendary keeps the generic ceremony card
// (description + full effect plate + footer). The probe asserts measured-layout
// invariants: expected copy present, no text overlap inside a card, every text
// inside its card plate, cards clear the subtitle, nothing leaves the screen.
const fs = require('fs');

function browserDriver() {
  if (process.platform === 'win32') return { chromium: require('playwright').chromium };
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

const cases = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 740 },
];
const shortPortrait = { width: 320, height: 520 };

const STRUCTURED_CONDITION = 'Условие: один раз за забег при смертельном уроне';
const STRUCTURED_EFFECT = 'Эффект: останется 1 прочности, исчезают все враги, кроме боссов';
const STRUCTURED_PRICE = 'При срабатывании: −25% прогресса текущего уровня';
const STRUCTURED_LOOK = 'Облик штамма меняется на 8 с (только визуально)';

function makeLegendaryChoice(choice, suffix = '') {
  return {
    id: `layout-${choice.id}${suffix}`, shortName: choice.title, name: choice.effect,
    desc: choice.desc, max: 1, family: choice.family, rarity: 'legendary',
    kind: 'legendary', legendaryId: choice.id, showProgress: false,
  };
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const reports = [];
  try {
    for (const size of [...cases, shortPortrait]) {
      const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
      await ctx.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await ctx.addInitScript(({ width, height }) => {
        localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
        window.WebApp = {
          platform: 'android', version: '26.20.0', initData: 'signed-layout-probe',
          initDataUnsafe: { user: { id: 42, first_name: 'Layout' } },
          getViewportSize: async () => ({ width: String(width), height: String(height) }),
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
        };
      }, size);
      const page = await ctx.newPage();
      await page.goto(process.env.OFELIYA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
      await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
      await page.waitForFunction(() => window.__game.scene.isActive('UI') &&
        (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')));
      const definitions = await page.evaluate(async () => {
        const module = await import('/src/game/LegendarySystem.ts');
        return module.LEGENDARIES.map(({ id, title, effect, desc, family }) => ({ id, title, effect, desc, family }));
      });

      const scenarios = [];
      for (const def of definitions) scenarios.push({ kind: 'single', choices: [def], reward: true });
      for (let i = 0; i < definitions.length; i++) {
        for (let j = i + 1; j < definitions.length; j++) {
          scenarios.push({ kind: 'trophy-pair', choices: [definitions[i], definitions[j]], reward: true });
        }
      }
      if (size.height !== shortPortrait.height) {
        // Layout robustness fixture only: the guaranteed trophy path offers two choices.
        // Three legendary cards never fit a 568px portrait without the squeeze pass —
        // that pass intentionally drops the decorative footer, so expect it here.
        scenarios.push({ kind: 'synthetic-three-legendary', choices: [definitions[0], definitions[1], definitions[2]], reward: true, expectCompact: true });
      } else {
        // Short-portrait guard: the stack must compact, not clip. Mix structured
        // (last-carrier) and generic legendaries; index 5 is the last-life-saving one.
        scenarios.push({ kind: 'short-portrait-guard', choices: [definitions[0], definitions[2], definitions[5]], reward: true, expectCompact: true });
      }

      for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
        const scenario = scenarios[scenarioIndex];
        const choices = scenario.choices.map((choice, index) => makeLegendaryChoice(choice, `-${scenarioIndex}-${index}`));
        await page.evaluate(({ choices, reward }) => {
          const gs = window.__game.scene.getScene('Game');
          const ui = window.__game.scene.getScene('UI');
          ui.modal?.destroy(true);
          ui.modal = null;
          ui.modalOpen = false;
          if (window.__game.scene.isPaused('Game')) window.__game.scene.resume('Game');
          gs.runState.stage.hp = 1_000_000;
          gs.runState.stage.maxHp = 1_000_000;
          gs.nextFireAt = Number.MAX_SAFE_INTEGER;
          gs.queuedLevels = 0;
          gs.legendaryRewardPending = reward;
          gs.pendingChoices = choices.map((choice) => ({ ...choice, apply: () => {} }));
          gs.awaitingChoice = true;
        }, { choices, reward: scenario.reward });
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
        // Let the modal entrance tweens settle before taking geometry snapshots.
        await page.waitForTimeout(600);
        const report = await page.evaluate(async ({ kind, width, height, expected, expectCompact, expectedStructured }) => {
          const { visibleTextBounds } = await import('/scripts/visible-text-bounds.js');
          const ui = window.__game.scene.getScene('UI');
          const root = ui.modal;
          const measured = visibleTextBounds(root);
          const bounds = (obj) => {
            const b = obj.getBounds();
            return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
          };
          const intersects = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
          const texts = measured.map(({ object }) => object);
          const subtitle = texts.find((obj) => obj.text.includes('выбери мутацию для СЕРДЦА'));
          const cards = root.list.filter((obj) => obj.type === 'Container' &&
            obj.list?.some((child) => child.type === 'Rectangle' && child.width > 100 && child.height > 100));
          const cardReports = cards.map((card) => {
            const cardMeasured = visibleTextBounds(card).filter(({ masked }) => !masked);
            const cardTextObjs = cardMeasured.map(({ object }) => object);
            const cardTexts = cardMeasured.map(({ object }) => ({ text: object.text, bounds: bounds(object) }));
            const bg = card.list.find((obj) => obj.type === 'Rectangle' && obj.width > 100 && obj.height > 100);
            const bgBounds = bg ? bounds(bg) : null;
            const plates = card.list.filter((obj) => obj.type === 'Rectangle' && obj !== bg && obj.width > 100 && obj.height <= 64);
            const plateBounds = plates.map(bounds);
            const structured = cardTextObjs.some((obj) => obj.text === expectedStructured.condition);
            const matched = expected.filter((choice) =>
              choice.legendaryId === 'last-carrier'
                ? structured && cardTextObjs.some((obj) => obj.text === choice.shortName)
                : cardTextObjs.some((obj) => obj.text === choice.name) &&
                  cardTextObjs.some((obj) => obj.text === choice.desc)
            );
            const missing = [];
            if (structured) {
              for (const line of [expectedStructured.condition, expectedStructured.effect, expectedStructured.price, expectedStructured.look]) {
                if (!cardTextObjs.some((obj) => obj.text === line)) missing.push(line);
              }
            } else {
              for (const choice of matched) {
                if (!cardTextObjs.some((obj) => obj.text === choice.name)) missing.push(choice.name);
                if (!cardTextObjs.some((obj) => obj.text === choice.desc)) missing.push(choice.desc);
              }
              // В squeeze-проходе служебный футер убирается намеренно (декор).
              if (!expectCompact && !cardTextObjs.some((obj) => obj.text === 'ИЗМЕНИТЬ ПРАВИЛА ЗАБЕГА')) missing.push('footer');
              if (!plates.length) missing.push('effect plate');
            }
            const overlaps = [];
            for (let i = 0; i < cardTexts.length; i++) {
              for (let j = i + 1; j < cardTexts.length; j++) {
                if (intersects(cardTexts[i].bounds, cardTexts[j].bounds)) {
                  overlaps.push([cardTexts[i].text, cardTexts[j].text]);
                }
              }
            }
            const outOfBounds = bgBounds
              ? cardTexts.filter(({ bounds: b }) =>
                  b.left < bgBounds.left + 1 || b.right > bgBounds.right - 1 || b.top < bgBounds.top + 1 || b.bottom > bgBounds.bottom - 1)
                .map(({ text }) => text)
              : ['missing background'];
            const plateOverflow = [];
            for (const plate of plateBounds) {
              for (const { text, bounds: b } of cardTexts) {
                if (b.top < plate.top - 1 && b.bottom > plate.bottom + 1) plateOverflow.push(text);
              }
            }
            return {
              structured,
              background: bgBounds,
              cardHeight: bg?.height ?? null,
              plates: plateBounds.length,
              found: matched.length,
              missing,
              overlaps,
              outOfBounds: [...outOfBounds, ...plateOverflow],
            };
          });
          const cardIntersections = [];
          for (let i = 0; i < cardReports.length; i++) for (let j = i + 1; j < cardReports.length; j++) {
            if (cardReports[i].background && cardReports[j].background && intersects(cardReports[i].background, cardReports[j].background)) cardIntersections.push([i, j]);
          }
          const overflow = measured.filter(({ masked, bounds: b }) => !masked &&
            (b.left < 1 || b.right > width - 1 || b.top < 1 || b.bottom > height - 1))
            .map(({ object }) => object.text);
          const subtitleBounds = subtitle ? bounds(subtitle) : null;
          return {
            kind, width, height, expectedCards: expected.length, actualCards: cards.length,
            expectedCompact: !!expectCompact,
            subtitleBounds,
            cards: cardReports,
            cardIntersections,
            subtitleGap: cardReports.map(({ background }) => background && subtitleBounds ? background.top - subtitleBounds.bottom : null),
            overflow,
          };
        }, { kind: scenario.kind, ...size, expected: choices, expectCompact: scenario.expectCompact,
          expectedStructured: { condition: STRUCTURED_CONDITION, effect: STRUCTURED_EFFECT, price: STRUCTURED_PRICE, look: STRUCTURED_LOOK } });
        reports.push(report);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(reports, null, 2));
  const failures = reports.filter((r) =>
    !r.subtitleBounds || r.actualCards !== r.expectedCards ||
    r.cardIntersections.length > 0 || r.overflow.length > 0 ||
    r.cards.some((card) =>
      !card.background || card.missing.length > 0 || card.overlaps.length > 0 ||
      card.outOfBounds.length > 0 || card.found === 0 ||
      card.cardHeight < 90 || card.cardHeight > 260) ||
    r.subtitleGap.some((gap) => gap == null || gap < 8.5)
  );
  if (failures.length) {
    console.error(`Legendary layout probe found ${failures.length} failing cases`);
    process.exitCode = 1;
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

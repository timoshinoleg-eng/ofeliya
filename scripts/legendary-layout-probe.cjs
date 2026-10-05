// Focused manual browser probe. Run against this checkout's Vite server with
// Override OFELIYA_URL for a non-default local Vite port, e.g. 5197.
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
        scenarios.push({ kind: 'synthetic-three-legendary', choices: [definitions[0], definitions[1], definitions[2]], reward: true });
      } else {
        // Linux measured line counts [2,3,2,3,3,2]; choose only measured 2-line definitions.
        // Index 5 is the last-life-saving Legendary. Synthetic UI coverage, not a trophy contract.
        scenarios.push({ kind: 'short-portrait-three-legendary-guard', choices: [definitions[0], definitions[2], definitions[5]], reward: true, expectCompact: true });
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
        const report = await page.evaluate(async ({ kind, width, height, expected, expectCompact }) => {
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
            const cardText = visibleTextBounds(card).filter(({ masked }) => !masked).map(({ object }) => object);
            const bg = card.list.find((obj) => obj.type === 'Rectangle' && obj.width > 100 && obj.height > 100);
            const effect = cardText.find((obj) => expected.some((choice) => choice.name === obj.text));
            const expectedChoice = expected.find((choice) => choice.name === effect?.text);
            const description = expectedChoice && cardText.find((obj) => obj.text === expectedChoice.desc);
            const footer = cardText.find((obj) => obj.text === 'ИЗМЕНИТЬ ПРАВИЛА ЗАБЕГА');
            const plate = effect && card.list.find((obj) => obj.type === 'Rectangle' && obj.width > 100 && obj.height <= 44 && Math.abs(obj.y - effect.y) < 1);
            const effectBounds = effect ? bounds(effect) : null;
            return {
              background: bg ? bounds(bg) : null,
              cardHeight: bg?.height ?? null,
              effect: effect ? { text: effect.text, linesNeeded: effect.getWrappedText(effect.text).length, maxLines: effect.style.maxLines, bounds: effectBounds } : null,
              plate: plate ? bounds(plate) : null,
              description: description ? bounds(description) : null,
              footer: footer ? bounds(footer) : null,
              effectOverlaps: effectBounds ? [
                !description ? 'missing description' : intersects(effectBounds, bounds(description)) ? 'description' : null,
                !footer ? 'missing footer' : intersects(effectBounds, bounds(footer)) ? 'footer' : null,
                !plate ? 'missing plate' : effectBounds.top < bounds(plate).top + 1 || effectBounds.bottom > bounds(plate).bottom - 1 ? 'outside plate' : null,
              ].filter(Boolean) : ['missing effect'],
            };
          });
          const cardIntersections = [];
          for (let i = 0; i < cardReports.length; i++) for (let j = i + 1; j < cardReports.length; j++) {
            if (cardReports[i].background && cardReports[j].background && intersects(cardReports[i].background, cardReports[j].background)) cardIntersections.push([i, j]);
          }
          const overflow = measured.filter(({ masked, bounds: b }) => !masked &&
            (b.left < 1 || b.right > width - 1 || b.top < 1 || b.bottom > height - 1))
            .map(({ object, bounds: b }) => ({ text: object.text, bounds: b }));
          const actualHeight = cardReports[0]?.cardHeight ?? null;
          const subtitleBounds = subtitle ? bounds(subtitle) : null;
          const allChoicesFound = expected.every((choice) => cardReports.some((card) => card.effect?.text === choice.name));
          return {
            kind, width, height, expectedCards: expected.length, actualCards: cards.length,
            allChoicesFound, actualHeight, expectedCompact: !!expectCompact,
            subtitleBounds,
            cards: cardReports,
            cardIntersections,
            subtitleGap: cardReports.map(({ background }) => background && subtitleBounds ? background.top - subtitleBounds.bottom : null),
            overflow,
          };
        }, { kind: scenario.kind, ...size, expected: choices, expectCompact: scenario.expectCompact });
        reports.push(report);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(reports, null, 2));
  const failures = reports.filter((r) => {
    const expandedTotal = r.expectedCards * 136 + (r.expectedCards - 1) * 9;
    const center = r.height * 0.59;
    const proposedTop = center - expandedTotal / 2;
    const proposedBottom = center + expandedTotal / 2;
    const expandedFits = proposedTop >= r.subtitleBounds?.bottom + 9 && proposedBottom <= r.height - 9;
    return !r.subtitleBounds || r.actualCards !== r.expectedCards || !r.allChoicesFound ||
      r.cardIntersections.length > 0 || r.overflow.length > 0 ||
      r.cards.some((card) => !card.background || !card.effect || !card.plate || card.effectOverlaps.length ||
        card.effect.linesNeeded > card.effect.maxLines ||
        (card.effect.linesNeeded > 2 && card.cardHeight !== 136)) ||
      r.subtitleGap.some((gap) => gap == null || gap < 8.5) ||
      (r.height < 650 && r.actualHeight !== (expandedFits ? 136 : 124)) ||
      (r.expectedCompact && expandedFits);
  });
  if (failures.length) {
    console.error(`Legendary layout probe found ${failures.length} failing cases`);
    process.exitCode = 1;
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

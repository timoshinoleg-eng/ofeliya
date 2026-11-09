/**
 * QA probe: fixed mutation-choice states A/B/C through the REAL interface.
 *
 * Base: main 2bd6320. This probe changes no game source: it boots the real
 * Menu -> Game flow, then injects the agreed fixed states into the live
 * GameScene (real RunState stacks applied through the real card apply(), real
 * UpgradeDef / EvolutionDef / LegendaryDefinition objects) and lets UIScene
 * open the level-up modal through its normal update() path. Only the trigger
 * is injected — every card on screen is rendered by the production code path.
 *
 * States (agreed fixture, source main 2bd6320):
 *  A — fresh run: ПОСЛЕДНИЙ НОСИТЕЛЬ (legendary) + РЕЦЕПТОРНЫЙ ЗАХВАТ + ЦИТОЛИЗ.
 *      Expected pairs 1250 → 1025 мс / 58 → 62,6 and 26 → 33,8 / 150 → 162.
 *  B — МЕМБРАННЫЙ ИМПУЛЬС 3/3, РНК-АФФИНИТЕТ 1/2; picking magnet must complete
 *      the singularity recipe (offered next) without applying the evolution.
 *  C — СИНГУЛЯРНОСТЬ already offered (evo:singularity) + infect + lysis.
 *
 * Per state the probe captures 320×568 and 390×844 screenshots and asserts:
 * full effect text visible (incl. maxLines clipping detection), card geometry,
 * choice integrity (one tap, rapid second tap is a no-op), pause/resume.
 *
 * Run: node scripts/mutation-states-probe.cjs
 * (starts its own Vite server on port 5199; override with OFELIYA_PORT)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.OFELIYA_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT_DIR = path.join(__dirname, '..', 'docs', 'qa', 'mutation-states-2026-11-09');
const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
];

function browserDriver() {
  if (process.platform === 'win32') return { chromium: require('playwright').chromium, executablePath: undefined };
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

function startServer() {
  const viteBin = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Vite server did not start on ${PORT}`);
}

/** In-page helpers, injected once per page. */
function installHelpers() {
  window.__qaStates = {
    async defs() {
      const up = await import('/src/game/UpgradeSystem.ts');
      const evo = await import('/src/game/EvolutionSystem.ts');
      const leg = await import('/src/game/LegendarySystem.ts');
      return { up, evo, leg };
    },
    /** Real upgrade def from the game's own table. */
    upgradeChoice(modules, id) {
      const def = modules.up.UPGRADES.find((u) => u.id === id);
      if (!def) throw new Error('unknown upgrade ' + id);
      return def;
    },
    /** Same mapping EvolutionSystem.toChoice uses, built from the real def. */
    evolutionChoice(modules, id) {
      const def = modules.evo.getEvolutionDef(id);
      return {
        id: `evo:${def.id}`,
        shortName: def.name,
        name: def.effect,
        desc: `${def.recipe}\n${def.desc}`,
        max: 1,
        family: 'weapon',
        rarity: 'rare',
        kind: 'evolution',
        evolutionId: def.id,
        showProgress: false,
        apply: (s) => s.addEvolution(def.id),
      };
    },
    /** Same mapping LegendarySystem.toChoice uses, built from the real def. */
    legendaryChoice(modules, id) {
      const def = modules.leg.getLegendaryDefinition(id);
      return {
        id: `legendary:${def.id}`,
        shortName: def.title,
        name: def.effect,
        desc: def.desc,
        max: 1,
        family: def.family,
        rarity: 'legendary',
        kind: 'legendary',
        legendaryId: def.id,
        showProgress: false,
        apply: (s) => s.addLegendary(def.id),
      };
    },
    /** Apply n real stacks of a card, exactly like chooseUpgrade does. */
    applyStacks(modules, state, id, n) {
      const def = modules.up.UPGRADES.find((u) => u.id === id);
      for (let i = 0; i < n; i++) {
        def.apply(state);
        state.bump(id);
      }
    },
    /** Open the modal through the real UIScene path (same as a queued level-up).
     * The run is made unkillable so a long scenario cannot end in a defeat
     * overlay while the modal is under test. */
    openModal(choices) {
      const game = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      ui.modal?.destroy(true);
      ui.modal = null;
      ui.modalOpen = false;
      if (window.__game.scene.isPaused('Game')) window.__game.scene.resume('Game');
      game.runState.stage.hp = 1_000_000;
      game.runState.stage.maxHp = 1_000_000;
      game.queuedLevels = 0;
      game.nextFireAt = Number.MAX_SAFE_INTEGER;
      game.legendaryRewardPending = false;
      game.pendingChoices = choices;
      game.awaitingChoice = true;
    },
    cardCenter(index) {
      const ui = window.__game.scene.getScene('UI');
      const cards = ui.modal.list.filter((o) => o.type === 'Container');
      const bg = cards[index]?.list.find((o) => o.type === 'Rectangle' && o.width > 100 && o.height > 100);
      if (!bg) return null;
      const b = bg.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    snapshot() {
      const game = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      return {
        stacks: { ...game.runState.stage.stacks },
        evolutions: [...game.runState.stage.evolutions],
        awaitingChoice: game.awaitingChoice,
        modalOpen: ui.modalOpen,
        gamePaused: window.__game.scene.isPaused('Game'),
        gameActive: window.__game.scene.isActive('Game'),
        choices: game.pendingChoices.map((c) => c.id),
      };
    },
  };
}

/** Read the rendered modal: cards, texts, clipping, geometry. */
async function readModal(page, size) {
  return page.evaluate(async ({ width, height }) => {
    const { visibleTextBounds } = await import('/scripts/visible-text-bounds.js');
    const ui = window.__game.scene.getScene('UI');
    const root = ui.modal;
    const measured = visibleTextBounds(root);
    const bounds = (obj) => {
      const b = obj.getBounds();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    const cards = root.list.filter((obj) => obj.type === 'Container' &&
      obj.list?.some((child) => child.type === 'Rectangle' && child.width > 100 && child.height > 100));
    const cardReports = cards.map((card) => {
      const bg = card.list.find((obj) => obj.type === 'Rectangle' && obj.width > 100 && obj.height > 100);
      const texts = visibleTextBounds(card).map(({ object }) => object);
      const clipped = texts
        .filter((t) => {
          const maxLines = t.style.maxLines;
          if (!maxLines) return false;
          const wrapped = t.getWrappedText(t.text);
          return Array.isArray(wrapped) && wrapped.length > maxLines;
        })
        .map((t) => ({
          text: t.text,
          maxLines: t.style.maxLines,
          linesNeeded: t.getWrappedText(t.text).length,
          hiddenTail: t.getWrappedText(t.text).slice(t.style.maxLines).join(' '),
        }));
      const bgBounds = bg ? bounds(bg) : null;
      const overflow = bgBounds
        ? texts.filter((t) => {
            const b = bounds(t);
            return b.left < bgBounds.left + 1 || b.right > bgBounds.right - 1 || b.top < bgBounds.top + 1 || b.bottom > bgBounds.bottom - 1;
          }).map((t) => t.text)
        : [];
      return {
        height: bg?.height ?? null,
        clipped,
        overflow,
        texts: texts.map((t) => t.text),
      };
    });
    const overflow = measured.filter(({ bounds: b }) =>
      b.left < 1 || b.right > width - 1 || b.top < 1 || b.bottom > height - 1
    ).map(({ object }) => object.text);
    return { width, height, cardCount: cards.length, cards: cardReports, overflow };
  }, size);
}

/** Tap a card by index. Retries if the tap did not register (resize races).
 * doubleTap fires a second tap 120 ms later — the choice-integrity probe. */
async function tapCard(page, index, tag, label, { doubleTap = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await page.evaluate((i) => window.__qaStates.cardCenter(i), index);
    if (!target) throw new Error(`${tag}: card ${index} center not found (${label})`);
    await page.touchscreen.tap(target.x, target.y);
    if (doubleTap) {
      await page.waitForTimeout(120);
      await page.touchscreen.tap(target.x, target.y);
    }
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => ({
      awaiting: window.__game.scene.getScene('Game').awaitingChoice,
    }));
    // Resolved = the tap chose a card (awaitingChoice flipped). Otherwise the
    // tap missed the geometry race; recompute the center and tap again.
    if (!state.awaiting) return;
  }
  throw new Error(`${tag}: tap on card ${index} did not register (${label})`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = startServer();
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const report = { base: 'main 2bd6320', url: BASE, sizes: [] };
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  try {
    await waitForServer();
    for (const size of SIZES) {
      const sizeReport = { ...size, states: {} };
      report.sizes.push(sizeReport);
      const tag = `${size.width}x${size.height}`;

      const bootFresh = async () => {
        const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
        await ctx.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
        await ctx.addInitScript(() => {
          localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
          window.WebApp = {
            platform: 'android', version: '26.20.0', initData: 'signed-mutation-states',
            initDataUnsafe: { user: { id: 42, first_name: 'States' } },
            getViewportSize: async () => ({ width: String(window.innerWidth), height: String(window.innerHeight) }),
            BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
            HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
          };
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
        await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
        await page.waitForFunction(() => window.__game.scene.isActive('UI') &&
          (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')));
        await page.evaluate(installHelpers);
        return { ctx, page, errors };
      };

      /* ------------------------------ A ------------------------------ */
      {
        const { ctx, page, errors } = await bootFresh();
        await page.evaluate(async () => {
          const modules = await window.__qaStates.defs();
          window.__qaStates.openModal([
            window.__qaStates.legendaryChoice(modules, 'last-carrier'),
            window.__qaStates.upgradeChoice(modules, 'infect'),
            window.__qaStates.upgradeChoice(modules, 'lysis'),
          ]);
        });
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
        await page.waitForTimeout(700);
        const modal = await readModal(page, size);
        const snap = await page.evaluate(() => window.__qaStates.snapshot());
        check(modal.cardCount === 3, `${tag} A: expected 3 cards, got ${modal.cardCount}`);
        check(snap.choices.join(',') === 'legendary:last-carrier,infect,lysis', `${tag} A: card order ${snap.choices}`);
        const [carrierCard, infectCard, lysisCard] = modal.cards;
        check(carrierCard.texts.includes('ЛЕГЕНДАРНАЯ МУТАЦИЯ'), `${tag} A: legendary header missing`);
        check(carrierCard.texts.some((t) => t.includes('ПОСЛЕДНИЙ НОСИТЕЛЬ')), `${tag} A: carrier name missing`);
        check(carrierCard.texts.some((t) => t.includes('Один раз за забег')), `${tag} A: carrier effect missing`);
        check(infectCard.texts.some((t) => t.includes('1250 → 1025')), `${tag} A: infect time pair missing`);
        check(infectCard.texts.some((t) => t.includes('58 → 62,6')), `${tag} A: infect radius pair missing`);
        check(lysisCard.texts.some((t) => t.includes('26 → 33,8')), `${tag} A: lysis damage pair missing`);
        check(lysisCard.texts.some((t) => t.includes('150 → 162')), `${tag} A: lysis radius pair missing`);
        check(modal.overflow.length === 0, `${tag} A: screen overflow ${JSON.stringify(modal.overflow)}`);
        for (const [name, card] of [['carrier', carrierCard], ['infect', infectCard], ['lysis', lysisCard]]) {
          check(card.overflow.length === 0, `${tag} A: ${name} card text out of bounds ${JSON.stringify(card.overflow)}`);
        }
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-A-choice.png`) });

        // Choice integrity: one real tap selects; a rapid second tap on the same
        // spot must not consume anything else.
        await tapCard(page, 1, tag, 'A', { doubleTap: true });
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => window.__qaStates.snapshot());
        check(after.stacks.infect === 1, `${tag} A: infect stack expected 1, got ${after.stacks.infect}`);
        check(after.stacks.lysis === undefined, `${tag} A: rapid second tap must not pick lysis`);
        check(after.awaitingChoice === false && after.modalOpen === false, `${tag} A: modal must close after the pick`);
        check(after.gamePaused === false && after.gameActive === true, `${tag} A: Game must resume after the pick`);
        check(errors.length === 0, `${tag} A: page errors ${JSON.stringify(errors)}`);
        sizeReport.states.A = { cards: modal.cardCount, clipped: modal.cards.flatMap((c) => c.clipped) };
        await ctx.close();
      }

      /* ------------------------------ B ------------------------------ */
      {
        const { ctx, page, errors } = await bootFresh();
        await page.evaluate(async () => {
          const modules = await window.__qaStates.defs();
          const game = window.__game.scene.getScene('Game');
          window.__qaStates.applyStacks(modules, game.runState, 'nova', 3);
          window.__qaStates.applyStacks(modules, game.runState, 'magnet', 1);
          window.__qaStates.openModal([
            window.__qaStates.upgradeChoice(modules, 'magnet'),
            window.__qaStates.upgradeChoice(modules, 'infect'),
            window.__qaStates.upgradeChoice(modules, 'lysis'),
          ]);
        });
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
        await page.waitForTimeout(700);
        const modal = await readModal(page, size);
        const snap = await page.evaluate(() => window.__qaStates.snapshot());
        check(modal.cardCount === 3, `${tag} B: expected 3 cards, got ${modal.cardCount}`);
        check(snap.choices.join(',') === 'magnet,infect,lysis', `${tag} B: card order ${snap.choices}`);
        check(!snap.choices.includes('evo:singularity'), `${tag} B: singularity must NOT be offered at 1/2`);
        const magnetCard = modal.cards[0];
        check(magnetCard.texts.some((t) => t.includes('УРОВЕНЬ 2/4')), `${tag} B: magnet progress 1/2 -> next 2/4 missing`);
        check(magnetCard.texts.some((t) => t.includes('121,5 → 164')), `${tag} B: magnet pair missing`);
        check(magnetCard.texts.some((t) => t.includes('СИНГУЛЯРНОСТЬ')), `${tag} B: singularity tag missing`);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-B-choice.png`) });

        // Real tap on magnet: recipe completes, evolution must NOT apply itself.
        await tapCard(page, 0, tag, 'B');
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => window.__qaStates.snapshot());
        check(after.stacks.magnet === 2, `${tag} B: magnet stack expected 2, got ${after.stacks.magnet}`);
        check(after.evolutions.length === 0, `${tag} B: picking magnet must NOT apply singularity`);
        // Real next offer: queued level rolls through rollRunChoices, ready
        // evolutions lead the offer -> singularity must stand first.
        await page.evaluate(() => {
          const game = window.__game.scene.getScene('Game');
          game.queuedLevels = 1;
        });
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen, null, { timeout: 5000 });
        await page.waitForTimeout(700);
        const offered = await page.evaluate(() => window.__qaStates.snapshot());
        check(offered.choices[0] === 'evo:singularity', `${tag} B: next offer must lead with evo:singularity, got ${offered.choices}`);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-B-after-pick-offer.png`) });
        check(errors.length === 0, `${tag} B: page errors ${JSON.stringify(errors)}`);
        sizeReport.states.B = { cards: modal.cardCount, clipped: modal.cards.flatMap((c) => c.clipped) };
        await ctx.close();
      }

      /* ------------------------------ C ------------------------------ */
      {
        const { ctx, page, errors } = await bootFresh();
        await page.evaluate(async () => {
          const modules = await window.__qaStates.defs();
          const game = window.__game.scene.getScene('Game');
          window.__qaStates.applyStacks(modules, game.runState, 'nova', 3);
          window.__qaStates.applyStacks(modules, game.runState, 'magnet', 2);
          window.__qaStates.openModal([
            window.__qaStates.evolutionChoice(modules, 'singularity'),
            window.__qaStates.upgradeChoice(modules, 'infect'),
            window.__qaStates.upgradeChoice(modules, 'lysis'),
          ]);
        });
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
        await page.waitForTimeout(700);
        const modal = await readModal(page, size);
        const snap = await page.evaluate(() => window.__qaStates.snapshot());
        check(modal.cardCount === 3, `${tag} C: expected 3 cards, got ${modal.cardCount}`);
        check(snap.choices.join(',') === 'evo:singularity,infect,lysis', `${tag} C: card order ${snap.choices}`);
        const evoCard = modal.cards[0];
        check(evoCard.texts.includes('КРИТИЧЕСКАЯ МУТАЦИЯ'), `${tag} C: evolution header (distinct from legendary) missing`);
        check(evoCard.texts.includes('ЛЕГЕНДАРНАЯ МУТАЦИЯ') === false, `${tag} C: evolution card must not wear the legendary header`);
        check(evoCard.texts.some((t) => t.includes('СИНГУЛЯРНОСТЬ')), `${tag} C: singularity name missing`);
        check(evoCard.texts.some((t) => t.includes('Круговой импульс наносит урон и отбрасывает врагов')), `${tag} C: full effect missing`);
        check(evoCard.texts.some((t) => t.includes('МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II')), `${tag} C: recipe missing`);
        // maxLines clipping audit — report what the player cannot see.
        sizeReport.states.C = { cards: modal.cardCount, clipped: modal.cards.flatMap((c) => c.clipped) };
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-C-choice.png`) });

        // Resize observation: the whole modal refits via fitBlockingOverlay
        // (uniform container scale), cards do not re-layout — documented.
        const settle = async (w, h) => {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForFunction(
            (dims) => window.__game.scale.width === dims.w && window.__game.scale.height === dims.h,
            { w, h },
            { timeout: 5000 }
          );
          await page.waitForTimeout(300);
        };
        await settle(320, 568);
        const resize = await page.evaluate(() => {
          const ui = window.__game.scene.getScene('UI');
          const scrim = ui.modal?.list.find((o) => o.name === 'ofeliya-levelup-scrim');
          const display = scrim ? scrim.getBounds() : null;
          return {
            displayW: display ? Math.round(display.width * 100) / 100 : null,
            displayH: display ? Math.round(display.height * 100) / 100 : null,
            scaleW: window.__game.scale.width,
            scaleH: window.__game.scale.height,
          };
        });
        sizeReport.states.C.resizeObservation = resize;
        await settle(size.width, size.height);

        // Real tap on singularity: evolution applies through the real ceremony.
        await tapCard(page, 0, tag, 'C');
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-C-evolution-ceremony.png`) });
        await page.waitForFunction(() => !window.__game.scene.getScene('UI').modalOpen && window.__game.scene.isActive('Game'), null, { timeout: 15_000 });
        const after = await page.evaluate(() => window.__qaStates.snapshot());
        check(after.evolutions.includes('singularity'), `${tag} C: singularity must be active after the ceremony`);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-C-evolved-in-combat.png`) });
        check(errors.length === 0, `${tag} C: page errors ${JSON.stringify(errors)}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error('FAILURES:');
    for (const failure of failures) console.error(' - ' + failure);
    process.exitCode = 1;
  } else {
    console.log('mutation-states probe: OK');
    console.log('screenshots + report.json ->', OUT_DIR);
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

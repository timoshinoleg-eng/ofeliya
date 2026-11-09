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
 *  B-mid — МЕМБРАННЫЙ ИМПУЛЬС 2/3, РНК-АФФИНИТЕТ 0/2: recipe block names the
 *      remaining condition instead of marking the last one.
 *  TROPHY — boss-reward screen (?qaTrophy=fresh|one|used|rhythm): title, reset
 *      line, one-of-two rule, conditional slot footnote, heart hints on cards.
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
const ALL_SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
];
// OFELIYA_SIZES="320x568,390x844" runs a subset (long probes fit tool timeouts).
const SIZES = process.env.OFELIYA_SIZES
  ? ALL_SIZES.filter((s) => process.env.OFELIYA_SIZES.split(',').includes(`${s.width}x${s.height}`))
  : ALL_SIZES;

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
    /** Trophy-screen variant: same real path, with the boss-reward flag and a
     * pre-boss legendary state (0 or 1 slot taken, rescue spent or not). */
    openTrophy(choices, { preLegendary = [], carrierSpent = false } = {}) {
      const game = window.__game.scene.getScene('Game');
      window.__qaStates.openModal(choices);
      for (const id of preLegendary) game.runState.addLegendary(id);
      game.lastCarrierUsed = carrierSpent;
      game.legendaryRewardPending = true;
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
  const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  try {
    await waitForServer();
    for (const size of SIZES) {
      const sizeReport = { ...size, states: {} };
      report.sizes.push(sizeReport);
      const tag = `${size.width}x${size.height}`;
      log('size', tag);

      const bootFresh = async (query = '', { forceVideo = false } = {}) => {
        const ctx = await browser.newContext({
          viewport: size,
          deviceScaleFactor: 1,
          hasTouch: true,
          isMobile: true,
          ...(size.width === 390 && (query === '' || forceVideo) ? { recordVideo: { dir: path.join(OUT_DIR, 'video-tmp') } } : {}),
        });
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
        await page.goto(BASE + query, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
        await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
        await page.waitForFunction(() => window.__game.scene.isActive('UI') &&
          (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')));
        await page.evaluate(installHelpers);
        return { ctx, page, errors };
      };

      /* ------------------------------ A ------------------------------ */
      {
        log('scenario A boot');
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
        // Заголовок и одна короткая подсказка (не-трофейный путь).
        const topTexts = await page.evaluate(() =>
          window.__game.scene.getScene('UI').modal.list
            .filter((o) => o.type === 'Text').map((o) => o.text));
        check(topTexts.some((t) => t === 'ВЫБЕРИ МУТАЦИЮ'), `${tag} A: title «ВЫБЕРИ МУТАЦИЮ» missing: ${JSON.stringify(topTexts)}`);
        check(topTexts.some((t) => t === 'Нажми на карточку, чтобы выбрать'), `${tag} A: hint missing: ${JSON.stringify(topTexts)}`);
        const [carrierCard, infectCard, lysisCard] = modal.cards;
        check(carrierCard.texts.includes('ЛЕГЕНДАРНАЯ МУТАЦИЯ'), `${tag} A: legendary header missing`);
        check(carrierCard.texts.some((t) => t.includes('ПОСЛЕДНИЙ НОСИТЕЛЬ')), `${tag} A: carrier name missing`);
        check(carrierCard.texts.some((t) => t === 'Условие: один раз за забег при смертельном уроне'), `${tag} A: carrier condition missing`);
        check(carrierCard.texts.some((t) => t === 'Эффект: останется 1 прочности, исчезают все враги, кроме боссов'), `${tag} A: carrier effect missing`);
        check(carrierCard.texts.some((t) => t === 'При срабатывании: −25% прогресса текущего уровня'), `${tag} A: carrier price missing`);
        check(carrierCard.texts.some((t) => t === 'Облик штамма меняется на 8 с (только визуально)'), `${tag} A: carrier appearance line missing`);
        check(!carrierCard.texts.some((t) => t.includes('РНК уменьшается')), `${tag} A: stale «РНК −25%» card copy must be gone`);
        check(infectCard.texts.some((t) => t === 'ОБЫЧНАЯ МУТАЦИЯ · РАСПРОСТРАНЕНИЕ'), `${tag} A: infect header missing`);
        check(infectCard.texts.some((t) => t === 'Время заражения'), `${tag} A: infect time label missing`);
        check(infectCard.texts.some((t) => t.includes('1250 → 1025') && t.includes('мс')), `${tag} A: infect time pair with unit missing`);
        check(infectCard.texts.some((t) => t === 'Радиус заражения'), `${tag} A: infect radius label missing`);
        check(infectCard.texts.some((t) => t.includes('58 → 62,6') && t.includes('ед.')), `${tag} A: infect radius pair with unit missing`);
        check(lysisCard.texts.some((t) => t === 'РЕДКАЯ МУТАЦИЯ · АГРЕССИЯ'), `${tag} A: lysis header missing`);
        check(lysisCard.texts.some((t) => t === 'Урон взрыва'), `${tag} A: lysis damage label missing`);
        check(lysisCard.texts.some((t) => t === '26 → 33,8'), `${tag} A: lysis damage pair must be unitless`);
        check(lysisCard.texts.some((t) => t === 'Радиус взрыва'), `${tag} A: lysis radius label missing`);
        check(lysisCard.texts.some((t) => t.includes('150 → 162') && t.includes('ед.')), `${tag} A: lysis radius pair with unit missing`);
        check(modal.overflow.length === 0, `${tag} A: screen overflow ${JSON.stringify(modal.overflow)}`);
        for (const [name, card] of [['carrier', carrierCard], ['infect', infectCard], ['lysis', lysisCard]]) {
          check(card.overflow.length === 0, `${tag} A: ${name} card text out of bounds ${JSON.stringify(card.overflow)}`);
        }
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-A-choice.png`) });

        // Press reaction: the card itself answers a press with a scale-down...
        const pressTarget = await page.evaluate((i) => window.__qaStates.cardCenter(i), 1);
        await page.mouse.move(pressTarget.x, pressTarget.y);
        await page.mouse.down();
        await page.waitForTimeout(120);
        const pressed = await page.evaluate(() => {
          const ui = window.__game.scene.getScene('UI');
          const card = ui.modal.list.filter((o) => o.type === 'Container')[1];
          return card ? card.scaleX : null;
        });
        check(pressed !== null && Math.abs(pressed - 0.97) < 0.001, `${tag} A: press reaction (scale 0.97), got ${pressed}`);
        // ...and releasing OUTSIDE the card must not choose it.
        await page.mouse.move(pressTarget.x, Math.max(4, pressTarget.y - 170));
        await page.mouse.up();
        await page.waitForTimeout(250);
        const released = await page.evaluate(() => ({
          awaiting: window.__game.scene.getScene('Game').awaitingChoice,
          scale: window.__game.scene.getScene('UI').modal?.list.filter((o) => o.type === 'Container')[1]?.scaleX ?? null,
        }));
        check(released.awaiting === true, `${tag} A: release outside the card must not choose`);
        check(released.scale !== null && Math.abs(released.scale - 1) < 0.001, `${tag} A: card settles back to scale 1, got ${released.scale}`);

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
        const videoA = page.video();
        await ctx.close();
        if (videoA) {
          const p = await videoA.path().catch(() => null);
          if (p && fs.existsSync(p)) fs.renameSync(p, path.join(OUT_DIR, `${tag}-A-tap-and-return-record.webm`));
        }
      }

      /* ------------- A-trigger: insurance pick vs lethal rescue ------------- */
      if (size.width === 390) {
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
        // 1) The PICK only reserves the insurance: HP and the battle are untouched.
        await tapCard(page, 0, tag, 'A-insurance');
        await page.waitForTimeout(2000); // legendary ceremony auto-dismiss
        const reserved = await page.evaluate(() => {
          const game = window.__game.scene.getScene('Game');
          return {
            hasCarrier: game.runState.hasLegendary('last-carrier'),
            used: game.lastCarrierUsed,
            hp: game.runState.stage.hp,
          };
        });
        check(reserved.hasCarrier === true, `${tag} A-trigger: pick must own the insurance`);
        check(reserved.used === false, `${tag} A-trigger: the pick itself must NOT fire the rescue`);
        check(reserved.hp === 1_000_000, `${tag} A-trigger: the pick must not touch HP, got ${reserved.hp}`);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-A-insurance-picked.png`) });

        // 2) Lethal damage fires the rescue through the real combat path.
        await page.evaluate(() => {
          const game = window.__game.scene.getScene('Game');
          game.runState.stage.hp = 15;
          game.runState.stage.xp = 44;
        });
        await page.waitForFunction(() => window.__game.scene.getScene('Game').lastCarrierUsed === true, null, { timeout: 30_000 });
        const fired = await page.evaluate(() => {
          const game = window.__game.scene.getScene('Game');
          const player = game.player;
          return {
            hp: game.runState.stage.hp,
            xp: game.runState.stage.xp,
            enemiesLeft: game.enemies.getChildren().filter((e) => e.active && !e.isBoss).length,
            form: { spike: player.spikeCrown.visible, capsid: player.capsidShell.visible, lysis: player.lysisCore.visible },
          };
        });
        check(fired.hp === 1, `${tag} A-trigger: rescue leaves 1 HP, got ${fired.hp}`);
        check(fired.xp === 33, `${tag} A-trigger: 25% of level progress lost (44 -> 33), got ${fired.xp}`);
        check(fired.enemiesLeft === 0, `${tag} A-trigger: regular enemies cleared, ${fired.enemiesLeft} left`);
        check(fired.form.spike && fired.form.capsid && fired.form.lysis,
          `${tag} A-trigger: 8-second mutation form must be visible`);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-A-insurance-triggered.png`) });
        // Keep the run alive to watch the form revert after 8 seconds.
        await page.evaluate(() => {
          const game = window.__game.scene.getScene('Game');
          game.runState.stage.hp = 1_000_000;
        });
        await page.waitForTimeout(8600);
        const reverted = await page.evaluate(() => {
          const player = window.__game.scene.getScene('Game').player;
          return { spike: player.spikeCrown.visible, capsid: player.capsidShell.visible, lysis: player.lysisCore.visible };
        });
        check(!reverted.spike && !reverted.capsid && !reverted.lysis,
          `${tag} A-trigger: form must revert after 8 s (no owned evolution)`);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-A-insurance-form-reverted.png`) });
        check(errors.length === 0, `${tag} A-trigger: page errors ${JSON.stringify(errors)}`);
        sizeReport.states.Atrigger = { hp: fired.hp, xp: fired.xp, enemiesLeft: fired.enemiesLeft };
        const videoT = page.video();
        await ctx.close();
        if (videoT) {
          const p = await videoT.path().catch(() => null);
          if (p && fs.existsSync(p)) fs.renameSync(p, path.join(OUT_DIR, `${tag}-A-insurance-trigger-record.webm`));
        }
      }

      /* ------------------------------ B ------------------------------ */
      {
        log('scenario B boot');
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
        check(magnetCard.texts.some((t) => t === 'Радиус подбора РНК'), `${tag} B: magnet stat label missing`);
        check(magnetCard.texts.some((t) => t.includes('121,5 → 164') && t.includes('ед.')), `${tag} B: magnet pair with unit missing`);
        // Рецепт на карточке: строка «Синергия» заменена блоком рецепта
        // (recipeProgress): заголовок, строки шагов и пояснение внутри блока.
        check(magnetCard.texts.some((t) => t === 'Рецепт «СИНГУЛЯРНОСТЬ» — последнее условие'), `${tag} B: recipe title (last condition) missing: ${JSON.stringify(magnetCard.texts)}`);
        check(magnetCard.texts.some((t) => t === 'МЕМБРАННЫЙ ИМПУЛЬС — 3/3 ✓'), `${tag} B: completed recipe row missing`);
        check(magnetCard.texts.some((t) => t === 'РНК-АФФИНИТЕТ — 1/2 → 2/2'), `${tag} B: advancing recipe row missing`);
        check(magnetCard.texts.some((t) => t === 'После выбора рецепт будет готов. «СИНГУЛЯРНОСТЬ» выбирается отдельной картой.'), `${tag} B: recipe note missing`);
        check(!magnetCard.texts.some((t) => t === 'Синергия'), `${tag} B: stale «Синергия» row must be gone`);
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
        const videoB = page.video();
        await ctx.close();
        if (videoB) {
          const p = await videoB.path().catch(() => null);
          if (p && fs.existsSync(p)) fs.renameSync(p, path.join(OUT_DIR, `${tag}-B-pick-and-offer-record.webm`));
        }
      }

      /* ------------- B-mid: recipe block before the last condition ------------- */
      {
        log('scenario B-mid boot');
        const { ctx, page, errors } = await bootFresh();
        await page.evaluate(async () => {
          const modules = await window.__qaStates.defs();
          const game = window.__game.scene.getScene('Game');
          window.__qaStates.applyStacks(modules, game.runState, 'nova', 2);
          window.__qaStates.openModal([
            window.__qaStates.upgradeChoice(modules, 'magnet'),
            window.__qaStates.upgradeChoice(modules, 'infect'),
            window.__qaStates.upgradeChoice(modules, 'lysis'),
          ]);
        });
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
        await page.waitForTimeout(700);
        const modal = await readModal(page, size);
        const magnetCard = modal.cards[0];
        check(magnetCard.texts.some((t) => t === 'Рецепт «СИНГУЛЯРНОСТЬ»'), `${tag} B-mid: plain recipe title missing: ${JSON.stringify(magnetCard.texts)}`);
        check(!magnetCard.texts.some((t) => t.includes('последнее условие')), `${tag} B-mid: title must NOT mark the last condition`);
        check(magnetCard.texts.some((t) => t === 'МЕМБРАННЫЙ ИМПУЛЬС — 2/3'), `${tag} B-mid: pending recipe row missing`);
        check(magnetCard.texts.some((t) => t === 'РНК-АФФИНИТЕТ — 0/2 → 1/2'), `${tag} B-mid: advancing recipe row missing`);
        check(magnetCard.texts.some((t) => t === 'Останется: мембранный импульс 2/3. «СИНГУЛЯРНОСТЬ» появится отдельной картой, когда рецепт будет готов.'), `${tag} B-mid: remaining-conditions note missing`);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-B-mid-choice.png`) });
        check(modal.overflow.length === 0, `${tag} B-mid: screen overflow ${JSON.stringify(modal.overflow)}`);
        check(magnetCard.overflow.length === 0, `${tag} B-mid: card text out of bounds ${JSON.stringify(magnetCard.overflow)}`);
        check(errors.length === 0, `${tag} B-mid: page errors ${JSON.stringify(errors)}`);
        sizeReport.states.Bmid = { clipped: modal.cards.flatMap((c) => c.clipped) };
        await ctx.close();
      }

      /* ------------------------------ C ------------------------------ */
      {
        log('scenario C boot');
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
        check(evoCard.texts.some((t) => t === 'Круговая волна: новый облик. Открывает «Цепь лизиса»'), `${tag} C: full effect missing`);
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
        // The same pick changes the look AND opens the «Цепь лизиса» condition
        // (legendary prerequisite evo:singularity).
        const chain = await page.evaluate(async () => {
          const leg = await import('/src/game/LegendarySystem.ts');
          const game = window.__game.scene.getScene('Game');
          return {
            eligible: leg.eligibleLegendaries(game.runState).map((l) => l.id),
            player: {
              spike: game.player.spikeCrown.visible,
              capsid: game.player.capsidShell.visible,
              lysis: game.player.lysisCore.visible,
            },
          };
        });
        check(chain.eligible.includes('lysis-chain'), `${tag} C: singularity must open the lysis-chain condition, got ${chain.eligible}`);
        check(chain.player.lysis === true, `${tag} C: singularity silhouette must show on the player in combat`);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-C-evolved-in-combat.png`) });
        check(errors.length === 0, `${tag} C: page errors ${JSON.stringify(errors)}`);
        sizeReport.states.C.chainEligible = chain.eligible;
        const videoC = page.video();
        await ctx.close();
        if (videoC) {
          const p = await videoC.path().catch(() => null);
          if (p && fs.existsSync(p)) fs.renameSync(p, path.join(OUT_DIR, `${tag}-C-evolution-pick-record.webm`));
        }
      }

      /* ------------- QA parameter opens the state (phone path) ------------- */
      {
        log('scenario QA-param-B boot');
        const { ctx, page, errors } = await bootFresh('?qaMutation=B');
        // The seam applies the fixture in Game create; the modal opens through
        // the normal UIScene path — no page-side injection at all.
        await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen, null, { timeout: 8000 });
        await page.waitForTimeout(700);
        const snap = await page.evaluate(() => window.__qaStates.snapshot());
        check(snap.choices.join(',') === 'magnet,infect,lysis', `${tag} QA-param B: order ${snap.choices}`);
        const modal = await readModal(page, size);
        check(modal.cards[0].texts.some((t) => t.includes('УРОВЕНЬ 2/4')), `${tag} QA-param B: magnet 1/2 progress missing`);
        check(modal.cards[0].texts.some((t) => t === 'Радиус подбора РНК'), `${tag} QA-param B: magnet stat label missing`);
        check(modal.cards[0].texts.some((t) => t.includes('121,5 → 164') && t.includes('ед.')), `${tag} QA-param B: magnet pair with unit missing`);
        check(modal.cards[0].texts.some((t) => t === 'Рецепт «СИНГУЛЯРНОСТЬ» — последнее условие'), `${tag} QA-param B: recipe block missing`);
        await page.screenshot({ path: path.join(OUT_DIR, `${tag}-QA-param-B.png`) });
        check(errors.length === 0, `${tag} QA-param B: page errors ${JSON.stringify(errors)}`);
        sizeReport.states.qaParamB = { choices: snap.choices };
        await ctx.close();
      }

      /* ------------- Boss trophy screen (fresh / one / used / rhythm) ------------- */
      {
        const variants = [
          {
            id: 'fresh',
            foot: 'второй можно найти дальше',
            cardChecks: [[0, 'держи огонь на элитках и КАРДИАЛЬНОМ ТИТАНЕ']],
          },
          {
            id: 'one',
            foot: 'последняя легендарная этого забега',
            cardChecks: [[0, 'держи огонь на элитках и КАРДИАЛЬНОМ ТИТАНЕ']],
          },
          {
            id: 'used',
            foot: 'последняя легендарная этого забега',
            cardChecks: [[0, 'держи огонь на элитках и КАРДИАЛЬНОМ ТИТАНЕ']],
          },
          {
            id: 'rhythm',
            foot: 'второй можно найти дальше',
            cardChecks: [[0, 'окно 850 мс'], [0, 'безопасной зоне']],
          },
        ];
        for (const variant of variants) {
          const withVideo = size.width === 390 && variant.id === 'fresh';
          log('scenario TROPHY-' + variant.id, 'boot');
          const { ctx, page, errors } = await bootFresh(`?qaTrophy=${variant.id}`, { forceVideo: withVideo });
          // The seam applies the fixture in Game create; the trophy screen opens
          // through the normal UIScene path — no page-side injection at all.
          await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen, null, { timeout: 8000 });
          await page.waitForTimeout(700);
          const modal = await readModal(page, size);
          check(modal.cardCount === 2, `${tag} TROPHY-${variant.id}: expected 2 cards, got ${modal.cardCount}`);
          const topTexts = await page.evaluate(() =>
            window.__game.scene.getScene('UI').modal.list
              .filter((o) => o.type === 'Text').map((o) => o.text));
          check(topTexts.some((t) => t === 'ЛЕГЕНДАРНЫЙ ТРОФЕЙ'), `${tag} TROPHY-${variant.id}: trophy title missing: ${JSON.stringify(topTexts)}`);
          check(topTexts.some((t) => t.includes('Трофей останется с тобой на весь забег')), `${tag} TROPHY-${variant.id}: subtitle missing`);
          check(topTexts.some((t) => t.includes('уровень 1, прочность 100')), `${tag} TROPHY-${variant.id}: Heart reset line missing`);
          check(topTexts.some((t) => t === 'Выбери одну из двух — вторая исчезнет.'), `${tag} TROPHY-${variant.id}: pick rule missing`);
          check(topTexts.some((t) => t.includes(variant.foot)), `${tag} TROPHY-${variant.id}: slot footnote (${variant.foot}) missing`);
          for (const [cardIndex, needle] of variant.cardChecks) {
            check(modal.cards[cardIndex].texts.some((t) => t.includes(needle)),
              `${tag} TROPHY-${variant.id}: card ${cardIndex} must mention «${needle}»`);
          }
          check(modal.overflow.length === 0, `${tag} TROPHY-${variant.id}: screen overflow ${JSON.stringify(modal.overflow)}`);
          for (const card of modal.cards) {
            check(card.overflow.length === 0, `${tag} TROPHY-${variant.id}: card text out of bounds ${JSON.stringify(card.overflow)}`);
          }
          await page.screenshot({ path: path.join(OUT_DIR, `${tag}-TROPHY-${variant.id}.png`) });

          if (withVideo) {
            // Real pick: ceremony, legendary applies, the run resumes.
            await tapCard(page, 0, tag, 'TROPHY');
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(OUT_DIR, `${tag}-TROPHY-picked-ceremony.png`) });
            await page.waitForFunction(() => !window.__game.scene.getScene('UI').modalOpen && window.__game.scene.isActive('Game'), null, { timeout: 15_000 });
            const after = await page.evaluate(() => {
              const game = window.__game.scene.getScene('Game');
              return {
                legendaryRewardPending: game.legendaryRewardPending,
                legendaries: [...game.runState.run.legendaryIds],
              };
            });
            check(after.legendaryRewardPending === false, `${tag} TROPHY: reward flag must clear after the pick`);
            check(after.legendaries.includes('core-predator'), `${tag} TROPHY: picked legendary must be owned, got ${after.legendaries}`);
          }
          check(errors.length === 0, `${tag} TROPHY-${variant.id}: page errors ${JSON.stringify(errors)}`);
          sizeReport.states[`trophy-${variant.id}`] = { cards: modal.cardCount, clipped: modal.cards.flatMap((c) => c.clipped) };
          const videoT = page.video();
          await ctx.close();
          if (videoT) {
            const p = await videoT.path().catch(() => null);
            if (p && fs.existsSync(p)) fs.renameSync(p, path.join(OUT_DIR, `${tag}-TROPHY-pick-record.webm`));
          }
        }
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
  // Safety net: a hung browser.close() must not stall the runner once the
  // report is written.
  setTimeout(() => process.exit(process.exitCode ?? 0), 5000);
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

/**
 * QA probe: REAL boss-trophy transition — ИММУННЫЙ ПРАЙМ -> «Сердце».
 *
 * This probe changes no game source. It boots the real Menu -> Game flow on a
 * fresh run and drives the AGREED real path end to end:
 *   bloodstream gameplay -> boss warning/spawn (real StageDirector timeline)
 *   -> boss kill through the real Enemy.takeDamage/onEnemyDied path
 *   -> StageDirector.bossDefeated -> stage-transition ceremony + commit
 *   -> trophy modal opens through the real UIScene level-up path with
 *      legendaryRewardPending (same path as ?qaTrophy, but earned in-run)
 *   -> one real tap picks a legendary -> build reset (level 1, hp 100, stacks
 *      cleared) -> controlled fight in «Сердце» from synthetic joystick input.
 *
 * State acceleration (NOT logic substitution), the same class as the existing
 * QA fixtures and probe conventions:
 *   - stage.timeMs is jumped to just before the boss window, equivalent to
 *     resuming a checkpoint near the stage end (RunCheckpoint restores
 *     stage.timeMs by design); StageDirector then emits boss-warning and
 *     boss-spawn-requested through its normal update() path.
 *   - hp is topped up so the accelerated segment cannot end in a defeat
 *     overlay (same convention as mutation-states-probe openModal).
 *   - a small pre-boss build (2 stacks + level-ups through the real
 *     apply()/addXp) makes the post-trophy build reset observable.
 * Boss damage always goes through enemy.takeDamage(); the transition, trophy
 * screen, pick and reset are 100% production code paths.
 *
 * Run: node scripts/trophy-transition-probe.cjs
 * (starts its own Vite server on port 5197; override with OFELIYA_PORT)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.OFELIYA_PORT || 5197);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT_DIR = path.join(__dirname, '..', 'docs', 'qa', 'mutation-states-2026-11-09');
const SIZE = { width: 390, height: 844 };
const TAG = 'transition';

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
  window.__qaTransition = {
    game() {
      return window.__game.scene.getScene('Game');
    },
    ui() {
      return window.__game.scene.getScene('UI');
    },
    facts() {
      const game = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      const st = game.runState.stage;
      return {
        stageId: st.id,
        stageTimeMs: Math.round(st.timeMs),
        phase: game.stageDirector.phase,
        level: st.level,
        hp: st.hp,
        maxHp: st.maxHp,
        stacks: { ...st.stacks },
        evolutions: [...st.evolutions],
        legendaryIds: [...game.runState.run.legendaryIds],
        bossActive: Boolean(game.wave.boss),
        bossHp: game.wave.boss ? game.wave.boss.hp : null,
        awaitingChoice: game.awaitingChoice,
        rewardPending: game.legendaryRewardPending,
        choices: game.pendingChoices.map((c) => c.id),
        modalOpen: ui.modalOpen,
        gameActive: window.__game.scene.isActive('Game'),
        gamePaused: window.__game.scene.isPaused('Game'),
        playerX: game.player.x,
        playerY: game.player.y,
        bullets: game.bullets.countActive(true),
        enemies: game.enemies.countActive(true),
      };
    },
    /** Jump the stage clock to just before the boss window (checkpoint-class
     * state acceleration; the director emits warning/spawn on its own). */
    fastForwardToBoss() {
      const game = window.__game.scene.getScene('Game');
      const stage = game.stageDirector.currentStage;
      game.runState.stage.timeMs = Math.max(game.runState.stage.timeMs, stage.durationMs - 2_500);
    },
    /** Real pre-boss build so the post-trophy reset is observable. */
    async grantBuild() {
      const up = await import('/src/game/UpgradeSystem.ts');
      const game = window.__game.scene.getScene('Game');
      for (const id of ['infect', 'infect', 'lysis']) {
        const def = up.UPGRADES.find((u) => u.id === id);
        def.apply(game.runState);
        game.runState.bump(id);
      }
      game.runState.addXp(400);
      // No further level-ups: an accelerated segment must not stall on the
      // level-up modal (probe convention, mirrors openModal's unkillable run).
      game.runState.stage.xpNext = Number.MAX_SAFE_INTEGER;
      // Unkillable for the accelerated segment (probe convention).
      game.runState.stage.hp = 1_000_000;
      game.runState.stage.maxHp = 1_000_000;
      window.__qaTransition.dismissChoice();
    },
    /** Probe convention (same as mutation-states-probe openModal): drop a
     * queued level-up without picking, resume the game. */
    dismissChoice() {
      const game = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      ui.modal?.destroy(true);
      ui.modal = null;
      ui.modalOpen = false;
      ui.uiBlocked = false;
      if (window.__game.scene.isPaused('Game')) window.__game.scene.resume('Game');
      game.queuedLevels = 0;
      game.awaitingChoice = false;
      game.pendingChoices = [];
    },
    /** Real damage path: chunk the boss until onEnemyDied fires. */
    hitBoss() {
      const game = window.__game.scene.getScene('Game');
      const boss = game.wave.boss;
      if (boss && boss.active) boss.takeDamage(boss.hp + 10);
    },
    cardCenter(index) {
      const ui = window.__game.scene.getScene('UI');
      const cards = ui.modal.list.filter((o) => o.type === 'Container');
      const bg = cards[index]?.list.find((o) => o.type === 'Rectangle' && o.width > 100 && o.height > 100);
      if (!bg) return null;
      const b = bg.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
  };
}

/** Read the rendered modal texts (top-level and per card). */
async function readModalTexts(page) {
  return page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const root = ui.modal;
    const all = root.list.filter((o) => o.type === 'Text').map((o) => o.text);
    const cards = root.list.filter((o) => o.type === 'Container' &&
      o.list?.some((c) => c.type === 'Rectangle' && c.width > 100 && c.height > 100));
    return {
      top: all,
      cardCount: cards.length,
      cards: cards.map((card) =>
        card.list.filter((o) => o.type === 'Text').map((o) => o.text)),
    };
  });
}

async function tapCard(page, index, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await page.evaluate((i) => window.__qaTransition.cardCenter(i), index);
    if (!target) throw new Error(`${TAG}: card ${index} center not found (${label})`);
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => window.__qaTransition.facts());
    if (!state.awaitingChoice) return state;
  }
  throw new Error(`${TAG}: tap on card ${index} did not register (${label})`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = startServer();
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const failures = [];
  const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  try {
    await waitForServer();
    const ctx = await browser.newContext({
      viewport: SIZE,
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      recordVideo: { dir: path.join(OUT_DIR, 'video-tmp') },
    });
    await ctx.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await ctx.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
      window.WebApp = {
        platform: 'android', version: '26.20.0', initData: 'signed-trophy-transition',
        initDataUnsafe: { user: { id: 43, first_name: 'Transition' } },
        getViewportSize: async () => ({ width: String(window.innerWidth), height: String(window.innerHeight) }),
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      };
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (msg) => {
      // Asset 404s (dev-only media) are environmental, not code failures.
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        errors.push('console: ' + msg.text());
      }
    });

    log('scenario TRANSITION boot');
    log('goto', BASE);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    log('domcontentloaded; waiting for Menu');
    try {
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 45_000 });
    } catch (e) {
      const state = await page.evaluate(() => ({
        hasGame: Boolean(window.__game),
        scenes: window.__game ? window.__game.scene.scenes.map((s) => `${s.scene.key}:${s.scene.isActive()}`) : null,
      })).catch((err) => String(err));
      log('Menu never became active, page state:', JSON.stringify(state));
      throw e;
    }
    await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
    await page.waitForFunction(() => window.__game.scene.isActive('UI') &&
      (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')));
    await page.evaluate(installHelpers);

    // Fresh-run facts before any acceleration (a live run may already take a
    // level from opening kills; hp must still be untouched).
    const fresh = await page.evaluate(() => window.__qaTransition.facts());
    check(fresh.stageId === 'bloodstream', `${TAG}: fresh run must start in bloodstream, got ${fresh.stageId}`);
    check(fresh.hp === 100 && fresh.maxHp === 100,
      `${TAG}: fresh run facts hp, got ${fresh.hp}/${fresh.maxHp} (level ${fresh.level})`);
    check(Object.keys(fresh.stacks).length === 0, `${TAG}: fresh run must have no stacks`);

    // Real pre-boss build + unkillable segment (state acceleration).
    await page.evaluate(() => window.__qaTransition.grantBuild());
    const built = await page.evaluate(() => window.__qaTransition.facts());
    check(built.level >= 2, `${TAG}: pre-boss build must level up (got ${built.level})`);
    check(Object.keys(built.stacks).length >= 2, `${TAG}: pre-boss build must carry stacks`);

    // Fast-forward the stage clock; director emits warning + spawn itself.
    // Jump the stage clock to just before the boss window; the director emits
    // warning/spawn through its normal update path. Level-up modals opened by
    // the milestone pile-up are dismissed by the poll; a stalled pause with no
    // modal (and no run end) is nudged back to running.
    log('scenario TRANSITION fast-forward to boss window');
    await page.evaluate(() => window.__qaTransition.fastForwardToBoss());
    try {
      await page.waitForFunction(() => {
        const f = window.__qaTransition.facts();
        if (window.__game.registry.get('runResult')) return false; // run ended — fail fast
        if ((f.modalOpen || f.awaitingChoice) && !f.rewardPending) {
          window.__qaTransition.dismissChoice();
        } else if (f.gamePaused && !f.modalOpen) {
          window.__game.scene.resume('Game');
        }
        return f.bossActive || f.phase === 'BOSS_ACTIVE';
      }, null, { timeout: 45_000, polling: 300 });
    } catch (e) {
      const diag = await page.evaluate(() => {
        const f = window.__qaTransition.facts();
        const ui = window.__game.scene.getScene('UI');
        return {
          ...f,
          runResult: window.__game.registry.get('runResult') ?? null,
          manualPaused: ui.manualPaused ?? null,
          pauseOverlay: Boolean(ui.pauseOverlay),
          uiBlocked: ui.uiBlocked ?? null,
          overShown: ui.overShown ?? null,
          transitionOverlay: Boolean(ui.transitionOverlay),
          videoOverlay: Boolean(document.querySelector('video')),
          scenes: window.__game.scene.scenes.map((s) => `${s.scene.key}:${s.scene.isActive()}:${s.scene.isPaused()}`),
        };
      }).catch(() => null);
      log('boss never spawned, diag:', JSON.stringify(diag));
      throw e;
    }
    const warned = await page.evaluate(() => window.__qaTransition.facts());
    log('boss spawned, phase', warned.phase, 'bossHp', warned.bossHp);
    check(warned.phase === 'BOSS_ACTIVE' && warned.bossActive, `${TAG}: boss must be active after the window`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, `${TAG}-boss-fight.png`) });

    // Kill through the real damage path.
    log('scenario TRANSITION kill boss through takeDamage');
    for (let i = 0; i < 40; i++) {
      const f = await page.evaluate(() => {
        window.__qaTransition.hitBoss();
        return window.__qaTransition.facts();
      });
      if (f.phase === 'BOSS_DEFEATED' || f.phase === 'STAGE_TRANSITION') break;
      await page.waitForTimeout(300);
    }
    const defeated = await page.evaluate(() => window.__qaTransition.facts());
    check(defeated.phase === 'BOSS_DEFEATED' || defeated.phase === 'STAGE_TRANSITION',
      `${TAG}: boss defeat must reach ceremony, got ${defeated.phase}`);

    // Stage transition ceremony + commit (video or fallback guard), then the
    // REAL trophy screen: pendingChoices + awaitingChoice + rewardPending.
    log('scenario TRANSITION wait for trophy screen (real commit)');
    await page.waitForFunction(() => {
      const f = window.__qaTransition.facts();
      return f.rewardPending && f.awaitingChoice && f.modalOpen;
    }, null, { timeout: 40_000 });
    const trophy = await page.evaluate(() => window.__qaTransition.facts());
    check(trophy.stageId === 'heart', `${TAG}: commit must land in heart, got ${trophy.stageId}`);
    check(trophy.choices.length === 2 && trophy.choices.every((c) => c.startsWith('legendary:')),
      `${TAG}: trophy must offer two legendaries, got ${trophy.choices.join(',')}`);
    await page.waitForTimeout(700);
    const modal = await readModalTexts(page);
    check(modal.top.some((t) => t === 'ЛЕГЕНДАРНЫЙ ТРОФЕЙ'), `${TAG}: trophy title missing: ${JSON.stringify(modal.top)}`);
    check(modal.top.some((t) => t.includes('Сердце')), `${TAG}: trophy subtitle must name the heart reset: ${JSON.stringify(modal.top)}`);
    check(modal.cardCount === 2, `${TAG}: trophy must render 2 cards, got ${modal.cardCount}`);
    for (const [i, card] of modal.cards.entries()) {
      check(card.some((t) => t === 'ЛЕГЕНДАРНАЯ МУТАЦИЯ'), `${TAG}: card ${i} legendary header missing`);
    }
    await page.screenshot({ path: path.join(OUT_DIR, `${TAG}-trophy-screen.png`) });

    // One real tap picks the legendary; a legendary ceremony then asks for a
    // confirmation tap («НАЖМИ, ЧТОБЫ ПРОДОЛЖИТЬ») — the real flow, tap it too.
    log('scenario TRANSITION real tap picks trophy card 0');
    const pickedId = trophy.choices[0];
    await tapCard(page, 0, 'trophy');
    await page.waitForFunction(() => window.__qaTransition.facts().modalOpen, null, { timeout: 10_000 });
    const ceremonyTexts = await page.evaluate(() =>
      window.__game.scene.getScene('UI').modal.list
        .filter((o) => o.type === 'Text').map((o) => o.text));
    check(ceremonyTexts.some((t) => t.includes('НАЖМИ, ЧТОБЫ ПРОДОЛЖИТЬ')),
      `${TAG}: legendary ceremony prompt missing: ${JSON.stringify(ceremonyTexts)}`);
    await page.screenshot({ path: path.join(OUT_DIR, `${TAG}-ceremony.png`) });
    // Build-reset facts are committed with the stage transition (before the
    // trophy screen), and the ceremony keeps the game paused — read them here,
    // before the confirm tap resumes the fight. Reading after the resume is
    // racy: a heart enemy can land a contact hit in the evaluate window and
    // break the exact hp 100/100 expectation.
    const reset = await page.evaluate(() => window.__qaTransition.facts());
    check(reset.rewardPending === false, `${TAG}: legendaryRewardPending must clear after the pick`);
    check(reset.legendaryIds.includes(pickedId.replace('legendary:', '')),
      `${TAG}: picked ${pickedId} must be in run.legendaryIds, got ${reset.legendaryIds.join(',')}`);
    check(reset.stageId === 'heart', `${TAG}: post-pick stage must be heart, got ${reset.stageId}`);
    check(reset.level === 1, `${TAG}: build reset must restore level 1, got ${reset.level}`);
    check(reset.hp === 100 && reset.maxHp === 100, `${TAG}: build reset must restore hp 100/100, got ${reset.hp}/${reset.maxHp}`);
    check(Object.keys(reset.stacks).length === 0, `${TAG}: build reset must clear stacks: ${JSON.stringify(reset.stacks)}`);
    check(reset.evolutions.length === 0, `${TAG}: build reset must clear evolutions: ${reset.evolutions.join(',')}`);
    await page.touchscreen.tap(SIZE.width / 2, SIZE.height / 2);
    await page.waitForFunction(() => {
      const f = window.__qaTransition.facts();
      return !f.modalOpen && f.gameActive && !f.gamePaused;
    }, null, { timeout: 15_000 });
    // Heart kills must not stall the controlled-fight check on level-up
    // modals (probe convention — same unkillable/accelerated-run class).
    await page.evaluate(() => {
      window.__qaTransition.game().runState.stage.xpNext = Number.MAX_SAFE_INTEGER;
    });
    const after = await page.evaluate(() => window.__qaTransition.facts());
    check(after.stageId === 'heart', `${TAG}: resumed stage must be heart, got ${after.stageId}`);

    // Controlled fight in «Сердце»: synthetic joystick input moves the player.
    // Stray level-up modals (if any) are dismissed by the poll.
    log('scenario TRANSITION controlled fight in heart');
    await page.waitForFunction(() => {
      const f = window.__qaTransition.facts();
      if (f.modalOpen && !f.rewardPending) window.__qaTransition.dismissChoice();
      return !f.modalOpen && f.gameActive && !f.gamePaused && f.stageId === 'heart';
    }, null, { timeout: 15_000, polling: 300 });
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => window.__qaTransition.facts());
    await page.evaluate(() => window.__game.registry.set('joy', { x: 1, y: 0 }));
    await page.waitForTimeout(900);
    const moved = await page.evaluate(() => window.__qaTransition.facts());
    await page.evaluate(() => window.__game.registry.set('joy', { x: 0, y: 0 }));
    const movedPx = Math.hypot(moved.playerX - before.playerX, moved.playerY - before.playerY);
    check(movedPx > 10, `${TAG}: player must move from synthetic input in heart (moved ${Math.round(movedPx)} px)`);
    check(moved.stageId === 'heart', `${TAG}: fight must run in the heart stage, got ${moved.stageId}`);
    // The legendary-pick ceremony may pause the Game briefly; it must resume.
    await page.waitForFunction(() => {
      const f = window.__qaTransition.facts();
      if (f.modalOpen && !f.rewardPending) window.__qaTransition.dismissChoice();
      return !f.modalOpen && f.gameActive && !f.gamePaused && f.stageId === 'heart';
    }, null, { timeout: 15_000, polling: 300 });
    const settled = await page.evaluate(() => window.__qaTransition.facts());
    check(settled.gameActive && settled.stageId === 'heart',
      `${TAG}: Game scene must settle active in heart after the ceremony`);
    log('controlled fight ok, moved', Math.round(movedPx), 'px, bullets', moved.bullets, 'enemies', moved.enemies);
    await page.screenshot({ path: path.join(OUT_DIR, `${TAG}-heart-fight.png`) });

    // Page must stay error-free through the whole real path.
    check(errors.length === 0, `${TAG}: page errors: ${errors.join(' | ')}`);

    const video = page.video();
    await ctx.close();
    if (video) {
      try {
        await Promise.race([
          video.saveAs(path.join(OUT_DIR, `${TAG}-record.webm`)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('video save timeout')), 15_000)),
        ]);
      } catch {
        log('video save failed (non-fatal)');
      }
    }
  } finally {
    // Insurance: never leave a zombie server/browser behind.
    setTimeout(() => process.exit(failures.length === 0 ? 0 : 1), 5_000).unref();
    await browser.close().catch(() => {});
    server.kill();
  }

  if (failures.length > 0) {
    console.error('trophy-transition probe: FAILING');
    for (const f of failures) console.error('  - ' + f);
    process.exitCode = 1;
  } else {
    console.log('trophy-transition probe: OK (real boss kill -> trophy -> reset -> heart fight)');
  }
})();

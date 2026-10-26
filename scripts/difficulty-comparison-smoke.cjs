/**
 * Real-game difficulty comparison: EASY vs STANDARD vs STRAINED.
 *
 * Every tier runs the real Phaser build with the SAME run seed and the SAME
 * scripted input policy, so the only variable is the difficulty profile. The
 * numbers come from the shipped gameplay code: the damage ledger, the spawn
 * pipeline, the real level curve and the real host-cell schedule.
 *
 * These are deterministic automated scenarios, not human usability tests.
 *
 *   OFELIYA_DIFFICULTY_WINDOW_MS  game-time window per tier (default 170000)
 *   OFELIYA_DIFFICULTY_SEED        run seed shared by every tier
 */
const fs = require('fs');
const path = require('path');

const WINDOW_MS = Number(process.env.OFELIYA_DIFFICULTY_WINDOW_MS || 170_000);
const SEED = process.env.OFELIYA_DIFFICULTY_SEED || 'difficulty-cmp-seed-01';
const TIERS = ['easy', 'standard', 'strained'];
const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  // Prefer the browser Playwright itself installed; fall back to a system Chrome
  // so the same script runs on CI images that ship google-chrome.
  const candidates = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    /* playwright has no registered browser yet */
  }
  candidates.push(
    ...['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].filter(fs.existsSync)
  );
  const executablePath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = {};
  try {
    for (const tier of TIERS) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      await ctx.route('https://st.max.ru/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
      );
      await ctx.addInitScript((difficulty) => {
        localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
        localStorage.setItem('ofeliya_difficulty_v1', difficulty);
        localStorage.removeItem('ofeliya_run_checkpoint_v1');
        window.WebApp = {
          platform: 'android',
          version: '26.20.0',
          initData: 'signed-difficulty-comparison',
          initDataUnsafe: { user: { id: 91, first_name: 'Diff', last_name: 'QA' } },
          getViewportSize: async () => ({ width: 390, height: 844 }),
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
        };
      }, tier);

      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));

      const menuMode = await page.evaluate(() => ({
        difficultyId: window.__game.registry.get('difficultyId'),
        stored: localStorage.getItem('ofeliya_difficulty_v1'),
      }));
      assert(menuMode.difficultyId === tier, `${tier}: menu did not select the tier (${JSON.stringify(menuMode)})`);

      await page.evaluate((seed) => {
        const game = window.__game;
        game.registry.set('runSeedOverride', seed);
        game.scene.getScene('Menu').scene.start('Game');
      }, SEED);
      await page.waitForFunction(
        () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
      );

      // --- Instrumentation on the real scene --------------------------------
      await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        const metrics = {
          damageTaken: 0,
          hits: 0,
          spawns: 0,
          elites: 0,
          bossAtMs: null,
          anomalyAtMs: null,
          bossMinions: 0,
          mutations: 0,
        };
        window.__diffMetrics = metrics;

        // The canonical player-damage ledger. Every damage path in the game
        // funnels through it, so this counts real incoming damage.
        const wave = gs.wave;
        const originalRecord = wave.recordPlayerDamage.bind(wave);
        wave.recordPlayerDamage = (damage, maxHp) => {
          metrics.damageTaken += damage;
          metrics.hits += 1;
          return originalRecord(damage, maxHp);
        };

        // The real spawn pipeline.
        const originalSpawn = gs.spawnEnemy.bind(gs);
        gs.spawnEnemy = (kind, x, y, elite) => {
          const enemy = originalSpawn(kind, x, y, elite);
          if (!enemy) return enemy;
          metrics.spawns += 1;
          if (elite) metrics.elites += 1;
          if (kind === 'boss' && metrics.bossAtMs === null) metrics.bossAtMs = gs.runState.run.timeMs;
          if (kind === 'anomaly' && metrics.anomalyAtMs === null) metrics.anomalyAtMs = gs.runState.run.timeMs;
          if (kind === 'swarm' && wave.boss) metrics.bossMinions += 1;
          return enemy;
        };

        // Scripted input policy: the player hovers around a slowly drifting
        // anchor, the way someone who is still learning the controls plays —
        // it keeps moving, collects nearby RNA and reaches host cells. The
        // policy is identical in every tier, so every difference in the outcome
        // is attributable to the difficulty profile alone.
        const originalUpdate = gs.update.bind(gs);
        const anchorX = gs.player.x;
        const anchorY = gs.player.y;
        gs.update = (time, delta) => {
          const clock = gs.runState.run.timeMs;
          const phase = (clock / 12000) * Math.PI * 2;
          const targetX = anchorX + Math.cos(phase) * 60;
          const targetY = anchorY + Math.sin(phase) * 60;
          const dx = targetX - gs.player.x;
          const dy = targetY - gs.player.y;
          const distance = Math.hypot(dx, dy);
          gs.registry.set(
            'joy',
            distance > 6 ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 }
          );
          originalUpdate(time, delta);
        };
      });

      // --- Drive the run ----------------------------------------------------
      // Headless software rendering can be far slower than real time, so the
      // wall-clock budget is scaled from the game-time window.
      const deadline = Date.now() + WINDOW_MS * 20 + 120_000;
      let finished = false;
      let iterations = 0;
      while (Date.now() < deadline) {
        iterations += 1;
        const probe = await page.evaluate(() => {
          const game = window.__game;
          const gs = game.scene.getScene('Game');
          const ui = game.scene.getScene('UI');
          if (gs.awaitingChoice && ui && ui.modalOpen) {
            const card = ui.modal?.list.find(
              (object) => Array.isArray(object.list) && object.list.some((child) => child.input?.enabled)
            );
            const bg = card?.list.find((object) => object.input?.enabled);
            const bounds = bg?.getBounds();
            if (bounds) {
              return { click: { x: bounds.centerX, y: bounds.centerY } };
            }
          }
          return {
            timeMs: gs.runState.run.timeMs,
            awaitingChoice: gs.awaitingChoice,
            modalOpen: Boolean(ui && ui.modalOpen),
            paused: game.scene.isPaused('Game'),
            done: Boolean(game.registry.get('runResult')),
          };
        });
        if (probe.click) {
          await page.touchscreen.tap(probe.click.x, probe.click.y);
          await page.waitForTimeout(120);
          continue;
        }
        if (iterations % 40 === 0) {
          console.log(`  [${tier}] t=${Math.round(probe.timeMs)}ms awaiting=${probe.awaitingChoice} modal=${probe.modalOpen} paused=${probe.paused}`);
        }
        if (probe.done || probe.timeMs >= WINDOW_MS) {
          finished = true;
          break;
        }
        await page.waitForTimeout(250);
      }

      const final = await page.evaluate(() => {
        const game = window.__game;
        const gs = game.scene.getScene('Game');
        const metrics = window.__diffMetrics;
        const result = game.registry.get('runResult');
        return {
          ...metrics,
          difficultyId: gs.difficulty.id,
          runSeed: gs.runSeed,
          timeMs: gs.runState.run.timeMs,
          hp: gs.runState.stage.hp,
          maxHp: gs.runState.stage.maxHp,
          kills: gs.runState.run.kills,
          hostCellsInfected: gs.runState.run.hostCellsInfected,
          level: gs.runState.stage.level,
          highestLevel: gs.runState.run.highestLevel,
          elitesSeen: gs.runState.run.elitesSeen ?? null,
          dead: result ? !result.win : false,
          win: result ? result.win : false,
          ended: Boolean(result),
        };
      });

      assert(final.difficultyId === tier, `${tier}: the run played a different tier (${final.difficultyId})`);
      assert(final.runSeed === SEED, `${tier}: the run seed drifted (${final.runSeed})`);
      assert(errors.length === 0, `${tier}: page errors: ${errors.join(' | ')}`);
      assert(finished, `${tier}: the comparison window did not complete`);

      results[tier] = final;
      await ctx.close();
      console.log(
        `${tier}: t=${final.timeMs}ms dmg=${final.damageTaken.toFixed(1)} hits=${final.hits} ` +
          `spawns=${final.spawns} elites=${final.elites} kills=${final.kills} lvl=${final.highestLevel} ` +
          `infect=${final.hostCellsInfected} hp=${final.hp.toFixed(0)}/${final.maxHp} dead=${final.dead}`
      );
    }
  } finally {
    await browser.close();
  }

  // --- The comparison -------------------------------------------------------
  const easy = results.easy;
  const standard = results.standard;
  const strained = results.strained;

  console.log('');
  console.log('real-game difficulty comparison (same seed, same scripted input)');
  console.log(['metric', 'EASY', 'STANDARD', 'STRAINED'].join(' | '));
  const rows = [
    ['damage taken', (r) => r.damageTaken.toFixed(1)],
    ['hits absorbed', (r) => r.hits],
    ['enemies spawned', (r) => r.spawns],
    ['elites spawned', (r) => r.elites],
    ['kills', (r) => r.kills],
    ['mutation level', (r) => r.highestLevel],
    ['host cells infected', (r) => r.hostCellsInfected],
    ['survival ms', (r) => Math.round(r.timeMs)],
    ['ended dead', (r) => r.dead],
  ];
  for (const [label, read] of rows) {
    console.log([label, read(easy), read(standard), read(strained)].join(' | '));
  }

  // The hard invariants hold at every window length.
  assert(easy.kills > 0, 'Easy produced no kills — the run would not teach anything');
  assert(standard.kills > 0, 'Standard produced no kills');
  assert(strained.kills > 0, 'Strained produced no kills');
  assert(easy.highestLevel >= 2, 'Easy never reached a mutation — the first mutation must stay reachable');
  assert(standard.highestLevel >= 2, 'Standard never reached a mutation');
  assert(strained.highestLevel >= 2, 'Strained never reached a mutation');
  assert(easy.hostCellsInfected > 0, 'Easy never infected a host cell — infection must stay reachable');
  assert(easy.spawns < standard.spawns, `Easy must face fewer enemies than Standard: ${easy.spawns} vs ${standard.spawns}`);
  assert(easy.timeMs >= standard.timeMs, `Easy must survive at least as long as Standard: ${easy.timeMs} vs ${standard.timeMs}`);

  // The strict pressure ordering needs a window long enough to produce signal:
  // inside the first seconds no tier has been hit hard enough to separate.
  if (WINDOW_MS >= 60_000) {
    assert(
      easy.damageTaken < standard.damageTaken,
      `Easy must take less damage than Standard: ${easy.damageTaken} vs ${standard.damageTaken}`
    );
    assert(
      standard.damageTaken < strained.damageTaken,
      `Standard must take less damage than Strained: ${standard.damageTaken} vs ${strained.damageTaken}`
    );
  } else {
    assert(
      easy.damageTaken <= standard.damageTaken,
      `Easy must not take more damage than Standard: ${easy.damageTaken} vs ${standard.damageTaken}`
    );
    assert(
      standard.damageTaken <= strained.damageTaken,
      `Standard must not take more damage than Strained: ${standard.damageTaken} vs ${strained.damageTaken}`
    );
  }
  assert(easy.elites <= standard.elites, `Easy must not face more elites than Standard: ${easy.elites} vs ${standard.elites}`);
  assert(standard.elites <= strained.elites, `Standard must not face more elites than Strained: ${standard.elites} vs ${strained.elites}`);

  const report = {
    seed: SEED,
    windowMs: WINDOW_MS,
    tiers: results,
  };
  const outDir = path.join(process.cwd(), 'docs', 'qa');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'EASY_DIFFICULTY_COMPARISON.json'),
    JSON.stringify(report, null, 2) + '\n'
  );

  console.log('');
  console.log('real-game difficulty comparison: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

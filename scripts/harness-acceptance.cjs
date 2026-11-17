'use strict';
/**
 * Harness acceptance criteria (track E, design §7 + Appendix C).
 *
 * The four spike questions, reformulated as acceptance checks for tracks
 * A+B (implementation was already underway when the spike was proposed):
 *
 *   (1) stable delta 1000/60 through loop.stop() + loop.step(t), 1000 steps;
 *   (2) TimerEvents / TweenManager / Arcade / SceneManager correct under
 *       stepping — proven observably, not assumed;
 *   (3) 3600 steps with yield (advance() chunks) without logical-time drift;
 *   (4) two runs, one seed + one input log -> identical state.
 *
 * Plus check (0): the advance() re-entrancy guard (Appendix C, track E).
 *
 * Every check prints an explicit PASS/FAIL with numbers. A failing check is
 * reported WITH its diagnosis — never worked around with a hack. In
 * particular, two Phaser 3.90 mechanisms do NOT follow synthetic time and
 * the checks are written to expose that rather than hide it:
 *
 * - TweenManager.getDelta() runs on Date.now() (wall clock,
 *   TweenManager.js getDelta + gap 1000/240) — a tween completes after
 *   ~its duration in WALL time, spanning a machine-dependent number of
 *   stepped frames. Sub-check (2b) measures the completion step AND the
 *   wall ms at completion, so a fail names the mechanism.
 * - Juice hit-stop dips scene.time.timeScale and the physics world
 *   timeScale on tween.js wall-clock timers (Juice.ts). The TimerEvent
 *   and physics expectations are therefore computed from the RECORDED
 *   per-frame deltas/timeScales (and the physics step counts), not from
 *   ideal arithmetic: the checks verify that each subsystem follows
 *   (synthetic delta x the game's own timeScale), which is the exact
 *   property — a wall-clock-driven timer would still fail it.
 *   Cross-run determinism under those dips is check (4)'s job.
 * - Arcade uses fixed-step (World.js: fixedStep defaults true): each
 *   physics step moves a body by velocity x 1/60s, and the number of
 *   steps per frame comes from an accumulator over synthetic deltas
 *   against msPerFrame = 16.6667 x timeScale. The physics expectation
 *   therefore uses the recorded stepsLastFrame per frame (0 while the
 *   world is paused by a hit-stop freeze), not a flat 1 step/frame.
 * - GameScene.update early-returns during a hit-stop hard freeze
 *   (GameScene.ts: hitStopUntil, scene-time based), so runState.tick is
 *   skipped for frozen frames. Check (3) counts frozen frames from the
 *   recorded per-frame runTimeMs and accounts for them explicitly; the
 *   naive 3600 x FIXED_DT number is reported alongside.
 *
 * Each check runs on a fresh browser context (localStorage isolation).
 * Runs use the survival probe (1M HP, stage-transition-smoke pattern)
 * and the in-page auto-choice handler (see scripts/lib/harness-browser.cjs)
 * so long legs are not cut short by death or a stuck modal.
 *
 * A JSON summary is written to artifacts/harness-acceptance/summary.json.
 * Exit 0 iff every check passes, 1 otherwise, 2 when the Test API is absent.
 *
 * Usage:
 *   node scripts/harness-acceptance.cjs [--url <base>] [--seed <seed>]
 * Default URL: $OFELIYA_URL or http://127.0.0.1:5176/ (port 5176: 5173 is
 * round 4, 5175 is track C). The dev server is NOT started here.
 */

const fs = require('fs');
const path = require('path');
const {
  launchHarnessBrowser,
  newHarnessPage,
  waitForTestApi,
  startSteppedCampaign,
  installSurvivalProbe,
  installAutoChoose,
  readAutoChooseErrors,
  readAutoChoices,
} = require('./lib/harness-browser.cjs');

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_API_MISSING = 2;

const FIXED_DT = 1000 / 60;
const REL_TOL = 1e-9;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const ARTIFACT_DIR = path.join(process.cwd(), 'artifacts', 'harness-acceptance');

function usageError(message) {
  console.error(`harness-acceptance: ${message}\n`);
  console.error('Usage: node scripts/harness-acceptance.cjs [--url <base>] [--seed <seed>]');
  process.exit(EXIT_FAIL);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        'harness-acceptance: run the A+B acceptance criteria (design §7/App. C).\n\n' +
          'Options:\n' +
          '  --url <base>   game URL (default: $OFELIYA_URL or http://127.0.0.1:5176/)\n' +
          '  --seed <seed>  run seed base (default: harness-acceptance)\n\n' +
          'Exit codes: 0 all checks pass · 1 any check fails · 2 Test API absent.'
      );
      process.exit(EXIT_PASS);
    }
    const match = arg.match(/^--([a-z-]+)$/);
    if (!match) usageError(`unexpected argument: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) usageError(`--${match[1]} needs a value`);
    args[match[1]] = value;
    i += 1;
  }
  return args;
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** First 1-based step where the cumulative sum of increments reaches target. */
function firstStepAtOrAfter(increments, target) {
  let sum = 0;
  for (let i = 0; i < increments.length; i++) {
    sum += increments[i];
    if (sum >= target) return i + 1;
  }
  return -1;
}

function failIfPageErrors(errors, label) {
  if (errors.length > 0) {
    throw new Error(`${label}: pageerror(s): ${errors.slice(0, 3).join(' | ')}`);
  }
}

// ---------------------------------------------------------------------------
// (0) advance() re-entrancy guard
// ---------------------------------------------------------------------------

async function check0Guard(browser, url, seed) {
  const { ctx, page, errors } = await newHarnessPage(browser, url);
  try {
    await waitForTestApi(page);
    await startSteppedCampaign(page, { seed: `${seed}-guard` });
    await installSurvivalProbe(page);
    const result = await page.evaluate(async () => {
      const api = window.__ofeliyaTest;
      const out = {};
      const first = api.advance(600);
      try {
        await api.advance(60);
        out.secondRejected = false;
        out.secondError = null;
      } catch (error) {
        out.secondRejected = true;
        out.secondError = String((error && error.message) || error);
      }
      await first;
      // Sequential calls still work after the rejected one.
      await api.advance(60);
      await api.advance(60);
      // A validation error must not wedge the guard either.
      try {
        await api.advance(-1);
        out.validationRejected = false;
      } catch {
        out.validationRejected = true;
      }
      await api.advance(60);
      out.sequentialOk = true;
      out.runTimeMs = api.readState().runTimeMs;
      out.frames = 780;
      return out;
    });
    failIfPageErrors(errors, 'check (0)');
    const pass =
      result.secondRejected === true &&
      /already in progress/.test(result.secondError || '') &&
      result.sequentialOk === true &&
      result.validationRejected === true;
    return {
      id: 0,
      name: 'advance() re-entrancy guard',
      status: pass ? 'PASS' : 'FAIL',
      details: {
        secondCallRejected: result.secondRejected,
        secondError: result.secondError,
        sequentialCallsOk: result.sequentialOk,
        validationErrorRejected: result.validationRejected,
        framesStepped: result.frames,
        runTimeMs: result.runTimeMs,
      },
      notes: pass
        ? []
        : ['Second parallel advance() must reject with "already in progress"; sequential calls must keep working.'],
    };
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// (1) Stable delta 1000/60 over 1000 manual loop.step(t) calls
// ---------------------------------------------------------------------------

async function check1Delta(browser, url) {
  const { ctx, page, errors } = await newHarnessPage(browser, url);
  try {
    await waitForTestApi(page);
    const result = await page.evaluate(() => {
      const game = window.__game;
      const loop = game.loop;
      const fixedDt = 1000 / 60;
      const n = 1000;
      const deltas = [];
      const savedSmooth = loop.smoothStep;
      if (loop.running) loop.stop();
      loop.smoothStep = false;
      loop.lastTime = 0;
      let t = 0;
      for (let i = 0; i < n; i++) {
        t += fixedDt;
        loop.step(t);
        deltas.push(loop.delta);
      }
      loop.smoothStep = savedSmooth;
      // The loop is left stopped; this page is discarded after the check.
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let maxRelErr = 0;
      for (const d of deltas) {
        if (d < min) min = d;
        if (d > max) max = d;
        sum += d;
        maxRelErr = Math.max(maxRelErr, Math.abs(d - fixedDt) / fixedDt);
      }
      return { n, min, max, mean: sum / n, expected: fixedDt, maxRelErr };
    });
    failIfPageErrors(errors, 'check (1)');
    const pass = result.maxRelErr <= REL_TOL;
    return {
      id: 1,
      name: 'stable delta 1000/60 over 1000 loop.step(t)',
      status: pass ? 'PASS' : 'FAIL',
      details: {
        steps: result.n,
        expectedDeltaMs: result.expected,
        minDeltaMs: result.min,
        maxDeltaMs: result.max,
        meanDeltaMs: result.mean,
        maxRelativeError: result.maxRelErr,
        toleranceRelative: REL_TOL,
      },
      notes: pass ? [] : [`loop.delta deviated from 1000/60 by up to ${result.maxRelErr} relative.`],
    };
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// (2) TimerEvents / TweenManager / Arcade / SceneManager under stepping
// ---------------------------------------------------------------------------

async function check2Subsystems(browser, url, seed) {
  const { ctx, page, errors } = await newHarnessPage(browser, url);
  try {
    await waitForTestApi(page);
    await startSteppedCampaign(page, { seed: `${seed}-subsystems` });
    await installSurvivalProbe(page);
    await installAutoChoose(page);

    // 2a. TimerEvent: delayedCall(1000) must fire on the synthetic tick
    // where the cumulative (delta x clock timeScale) reaches 1000ms.
    // Clock.update runs on the UPDATE event, BEFORE GameScene.update
    // (where Juice sets the next timeScale) — so frame j's increment uses
    // the timeScale recorded at the END of frame j-1 (ts0 for frame 1).
    const timer = await page.evaluate(async () => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const api = window.__ofeliyaTest;
      const frames = [];
      let count = 0;
      let firedAt = -1;
      const onPost = () => {
        count += 1;
        frames.push({ d: game.loop.delta, ts: gs.time.timeScale });
      };
      game.events.on('poststep', onPost);
      const ts0 = gs.time.timeScale;
      gs.time.delayedCall(1000, () => {
        firedAt = count + 1; // callback runs during the step, before its poststep
      });
      await api.advance(120);
      game.events.off('poststep', onPost);
      return { firedAt, frames, ts0, count };
    });
    const timerIncrements = timer.frames.map((f, j) => f.d * (j === 0 ? timer.ts0 : timer.frames[j - 1].ts));
    const timerExpected = firstStepAtOrAfter(timerIncrements, 1000);
    const timerMinTs = Math.min(timer.ts0, ...timer.frames.map((f) => f.ts));
    const timerPass = timer.firedAt > 0 && timer.firedAt === timerExpected;

    // 2b. Tween: duration 500 must complete on the synthetic tick where the
    // cumulative (delta x tween-manager timeScale) reaches 500ms — IF the
    // TweenManager followed synthetic time. It does NOT (getDelta uses
    // Date.now()); this sub-check measures the real completion step and
    // the wall ms at completion, and fails honestly when they disagree
    // with the synthetic expectation.
    const tween = await page.evaluate(async () => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const api = window.__ofeliyaTest;
      const frames = [];
      let count = 0;
      let completedAt = -1;
      let wallMsAtComplete = -1;
      const obj = { x: 0 };
      const onPost = () => {
        count += 1;
        frames.push({ d: game.loop.delta, tm: gs.tweens.timeScale });
      };
      game.events.on('poststep', onPost);
      const tm0 = gs.tweens.timeScale;
      const startedWall = Date.now();
      gs.tweens.add({
        targets: obj,
        x: 100,
        duration: 500,
        ease: 'Linear',
        onComplete: () => {
          completedAt = count + 1;
          wallMsAtComplete = Date.now() - startedWall;
        },
      });
      for (let i = 0; i < 10 && completedAt < 0; i++) {
        await api.advance(60);
      }
      game.events.off('poststep', onPost);
      return { completedAt, wallMsAtComplete, x: obj.x, frames, tm0, count };
    });
    const tweenIncrements = tween.frames.map((f, j) => f.d * (j === 0 ? tween.tm0 : tween.frames[j - 1].tm));
    const tweenExpected = firstStepAtOrAfter(tweenIncrements, 500);
    const tweenPass = tween.completedAt === tweenExpected && tween.x === 100;

    // 2c. Arcade physics: a probe body at velocity 120 px/s must move by
    // velocity x (total physics steps / 60). Steps per frame come from the
    // fixed-step accumulator (World.js); stepsLastFrame is the recorded
    // count (0 while the world is paused by a hit-stop freeze).
    const physics = await page.evaluate(async () => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const api = window.__ofeliyaTest;
      const frames = [];
      const onPost = () => {
        frames.push({
          steps: gs.physics.world.isPaused ? 0 : gs.physics.world.stepsLastFrame,
          paused: gs.physics.world.isPaused,
          ws: gs.physics.world.timeScale,
        });
      };
      game.events.on('poststep', onPost);
      const img = gs.physics.add.image(400, 400, '__WHITE');
      img.setVelocity(120, 0);
      const x0 = img.x;
      const y0 = img.y;
      await api.advance(60);
      const x1 = img.x;
      const y1 = img.y;
      game.events.off('poststep', onPost);
      img.destroy();
      return { x0, y0, x1, y1, dx: x1 - x0, dy: y1 - y0, frames };
    });
    const totalSteps = physics.frames.reduce((sum, f) => sum + f.steps, 0);
    const pausedFrames = physics.frames.filter((f) => f.paused).length;
    const physicsExpectedDx = (120 * totalSteps) / 60;
    const physicsErrorPx = Math.abs(physics.dx - physicsExpectedDx);
    const physicsPass = physicsErrorPx <= 1e-3 && Math.abs(physics.dy) <= 1e-9;

    // 2d. SceneManager: the stage transition must fire on the synthetic
    // step where stageTimeMs first reaches durationMs (same time-jump
    // pattern as stage-transition-smoke.cjs). The expected step is
    // computed from the RECORDED per-frame deltas, not ideal arithmetic.
    const stage = await page.evaluate(async () => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const api = window.__ofeliyaTest;
      const durationMs = gs.stageDirector.currentStage.durationMs;
      gs.runState.stage.timeMs = durationMs - 100;
      const deltas = [];
      const onPost = () => deltas.push(game.loop.delta);
      game.events.on('poststep', onPost);
      let firedAtStep = -1;
      let timeAtFire = -1;
      let phaseAtFire = '';
      for (let i = 1; i <= 12; i++) {
        await api.advance(1);
        const st = api.readState();
        if (st.phase === 'BOSS_ACTIVE') {
          firedAtStep = i;
          timeAtFire = st.stageTimeMs;
          phaseAtFire = st.phase;
          break;
        }
      }
      game.events.off('poststep', onPost);
      return { durationMs, firedAtStep, timeAtFire, phaseAtFire, deltas };
    });
    let stageAcc = stage.durationMs - 100;
    let stageExpected = -1;
    for (let i = 0; i < stage.deltas.length; i++) {
      stageAcc += stage.deltas[i];
      if (stageAcc >= stage.durationMs) {
        stageExpected = i + 1;
        break;
      }
    }
    const stageTimeInWindow =
      stage.timeAtFire >= stage.durationMs && stage.timeAtFire < stage.durationMs + FIXED_DT + 1e-6;
    const stagePass = stage.firedAtStep > 0 && stage.firedAtStep === stageExpected && stageTimeInWindow;

    failIfPageErrors(errors, 'check (2)');
    const autoErrors = await readAutoChooseErrors(page);
    if (autoErrors.length > 0) {
      throw new Error(`check (2): auto-choice errors in-page: ${autoErrors.slice(0, 3).join(' | ')}`);
    }

    const sub = {
      timerEvent: {
        pass: timerPass,
        firedAtStep: timer.firedAt,
        expectedStep: timerExpected,
        delayMs: 1000,
        minClockTimeScale: timerMinTs,
      },
      tween: {
        pass: tweenPass,
        completedAtStep: tween.completedAt,
        expectedStep: tweenExpected,
        durationMs: 500,
        finalX: tween.x,
        wallMsAtComplete: tween.wallMsAtComplete,
        framesObserved: tween.count,
      },
      physics: {
        pass: physicsPass,
        velocityPxPerSec: 120,
        frames: 60,
        totalPhysicsSteps: totalSteps,
        pausedFrames,
        expectedDxPx: physicsExpectedDx,
        actualDxPx: physics.dx,
        errorPx: physicsErrorPx,
        dyPx: physics.dy,
      },
      stageTransition: {
        pass: stagePass,
        durationMs: stage.durationMs,
        firedAtStep: stage.firedAtStep,
        expectedStep: stageExpected,
        stageTimeMsAtFire: stage.timeAtFire,
        phaseAtFire: stage.phaseAtFire,
      },
    };
    const pass = timerPass && tweenPass && physicsPass && stagePass;
    const notes = [];
    if (!timerPass) {
      notes.push(
        `TimerEvent fired at step ${timer.firedAt}, expected ${timerExpected} ` +
          `(cumulative delta x clock timeScale >= 1000ms; min timeScale ${timerMinTs}).`
      );
    }
    if (!tweenPass) {
      notes.push(
        `Tween completed at step ${tween.completedAt} (expected synthetic step ${tweenExpected}), ` +
          `final x=${tween.x}, wall ${tween.wallMsAtComplete}ms at completion — ` +
          `TweenManager.getDelta() runs on Date.now(), not synthetic time (Phaser 3.90 TweenManager.js).`
      );
    }
    if (!physicsPass) {
      notes.push(
        `Physics displacement ${physics.dx}px vs expected ${physicsExpectedDx}px ` +
          `(${totalSteps} steps, ${pausedFrames} paused frames), error ${physicsErrorPx}px.`
      );
    }
    if (!stagePass) {
      notes.push(
        `Stage transition fired at step ${stage.firedAtStep} (expected ${stageExpected}), ` +
          `stageTimeMs=${stage.timeAtFire}, durationMs=${stage.durationMs}.`
      );
    }
    return { id: 2, name: 'TimerEvents / TweenManager / Arcade / SceneManager under stepping', status: pass ? 'PASS' : 'FAIL', details: sub, notes };
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// (3) 3600 steps with yield: no logical-time drift
// ---------------------------------------------------------------------------

async function check3LongTime(browser, url, seed) {
  const { ctx, page, errors } = await newHarnessPage(browser, url);
  try {
    await waitForTestApi(page);
    await startSteppedCampaign(page, { seed: `${seed}-3600` });
    await installSurvivalProbe(page);
    await installAutoChoose(page);
    // Per-frame record: runTimeMs (freeze detection), loop.delta (exact
    // expectation), timeScales (dip diagnostics).
    await page.evaluate(() => {
      window.__longTimeSeries = [];
      const game = window.__game;
      game.events.on('poststep', () => {
        const gs = game.scene.getScene('Game');
        if (!gs || !gs.runState) return;
        window.__longTimeSeries.push({
          r: gs.runState.run.timeMs,
          d: game.loop.delta,
          ts: gs.time.timeScale,
          ws: gs.physics.world.timeScale,
        });
      });
    });
    const before = await page.evaluate(() => window.__ofeliyaTest.readState().runTimeMs);
    await page.evaluate(() => window.__ofeliyaTest.advance(3600));
    const afterState = await page.evaluate(() => window.__ofeliyaTest.readState());
    const series = await page.evaluate(() => window.__longTimeSeries);
    const autoErrors = await readAutoChooseErrors(page);
    failIfPageErrors(errors, 'check (3)');
    if (autoErrors.length > 0) {
      throw new Error(`check (3): auto-choice errors in-page: ${autoErrors.slice(0, 3).join(' | ')}`);
    }
    const diff = afterState.runTimeMs - before;
    const naiveExpected = 3600 * FIXED_DT;
    // A frame is frozen when runTimeMs did not advance vs the previous
    // recorded frame (hit-stop hard freeze skips runState.tick).
    let frozen = 0;
    let expectedFromDeltas = 0;
    for (let i = 0; i < series.length; i++) {
      const prev = i === 0 ? before : series[i - 1].r;
      if (series[i].r === prev) frozen += 1;
      else expectedFromDeltas += series[i].d;
    }
    const accountedExpected = (3600 - frozen) * FIXED_DT;
    const driftVsDeltas = Math.abs(diff - expectedFromDeltas);
    const driftVsAccounted = Math.abs(diff - accountedExpected);
    const driftVsNaive = Math.abs(diff - naiveExpected);
    const alive = afterState.phase === 'PLAYING' || afterState.phase === 'BOSS_ACTIVE';
    const pass =
      alive &&
      series.length === 3600 &&
      driftVsDeltas <= REL_TOL * naiveExpected &&
      driftVsAccounted <= REL_TOL * naiveExpected;
    const dipped = series.filter((f) => f.ts < 0.999 || f.ws < 0.999).length;
    return {
      id: 3,
      name: '3600 steps with yield, no logical-time drift',
      status: pass ? 'PASS' : 'FAIL',
      details: {
        steps: 3600,
        recordedFrames: series.length,
        runTimeMsBefore: before,
        runTimeMsAfter: afterState.runTimeMs,
        diffMs: diff,
        naiveExpectedMs: naiveExpected,
        driftVsNaiveMs: driftVsNaive,
        frozenFrames: frozen,
        accountedExpectedMs: accountedExpected,
        driftVsAccountedMs: driftVsAccounted,
        driftVsRecordedDeltasMs: driftVsDeltas,
        toleranceMs: REL_TOL * naiveExpected,
        dippedFrames: dipped,
        finalPhase: afterState.phase,
      },
      notes: pass
        ? frozen > 0
          ? [`${frozen} frame(s) frozen by hit-stop hard freeze (GameScene.update early-return); accounted explicitly.`]
          : []
        : [
            `runTimeMs advanced ${diff}ms vs naive ${naiveExpected}ms ` +
              `(${frozen} frozen frames, accounted ${accountedExpected}ms); ` +
              `drift vs recorded deltas ${driftVsDeltas}ms; final phase ${afterState.phase}.`,
          ],
    };
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// (4) Same seed + same input log, >=3600 steps -> identical state
// ---------------------------------------------------------------------------

async function runReplayLeg(browser, url, seed) {
  const { ctx, page, errors } = await newHarnessPage(browser, url);
  try {
    await waitForTestApi(page);
    await startSteppedCampaign(page, { seed, difficulty: 'standard' });
    await installSurvivalProbe(page);
    // Fixed input vector for the whole leg (one setInput, same runTick in
    // both legs); mutation choices use the first-choice policy in-page.
    await page.evaluate(() => window.__ofeliyaTest.setInput({ moveX: 0.71, moveY: -0.7 }));
    await installAutoChoose(page);
    await page.evaluate(() => {
      window.__replaySeries = [];
      const game = window.__game;
      game.events.on('poststep', () => {
        const gs = game.scene.getScene('Game');
        if (!gs || !gs.runState) return;
        window.__replaySeries.push({
          r: gs.runState.run.timeMs,
          s: gs.runState.stage.timeMs,
          ph: gs.stageDirector.phase,
          ts: gs.time.timeScale,
          ws: gs.physics.world.timeScale,
          e: gs.enemies.countActive(true),
          b: gs.wave.boss ? gs.wave.boss.hp : -1,
          k: gs.runState.run.kills,
        });
      });
    });
    for (let chunk = 0; chunk < 6; chunk++) {
      await page.evaluate(() => window.__ofeliyaTest.advance(600));
      const state = await page.evaluate(() => window.__ofeliyaTest.readState());
      if (state.phase === 'RUN_ENDED' || state.scene !== 'Game') {
        throw new Error(
          `replay leg ended early at chunk ${chunk} (phase=${state.phase} scene=${state.scene})`
        );
      }
    }
    const log = await page.evaluate(() => window.__ofeliyaTest.getRunLog());
    const rng = await page.evaluate(() => window.__ofeliyaTest.getRngState());
    const state = await page.evaluate(() => window.__ofeliyaTest.readState());
    const series = await page.evaluate(() => window.__replaySeries);
    const choices = await readAutoChoices(page);
    const autoErrors = await readAutoChooseErrors(page);
    failIfPageErrors(errors, 'check (4)');
    if (autoErrors.length > 0) {
      throw new Error(`check (4): auto-choice errors in-page: ${autoErrors.slice(0, 3).join(' | ')}`);
    }
    return { log, rng, state, series, choices, errors };
  } finally {
    await ctx.close();
  }
}

function firstSeriesDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const fa = a[i];
    const fb = b[i];
    for (const key of ['r', 's', 'ph', 'e', 'b', 'k']) {
      if (fa[key] !== fb[key]) return { frame: i, field: key, a: fa[key], b: fb[key] };
    }
  }
  if (a.length !== b.length) return { frame: n, field: 'length', a: a.length, b: b.length };
  return null;
}

function firstRngDivergence(a, b) {
  if (a.seed !== b.seed) return `seed ${a.seed} vs ${b.seed}`;
  const streams = new Set([...Object.keys(a.states ?? {}), ...Object.keys(b.states ?? {})]);
  for (const stream of streams) {
    if (a.states?.[stream] !== b.states?.[stream]) {
      return `stream ${stream}: ${a.states?.[stream]} vs ${b.states?.[stream]}`;
    }
  }
  return null;
}

async function check4Replay(browser, url, seed) {
  const runSeed = `${seed}-replay-3600`;
  const first = await runReplayLeg(browser, url, runSeed);
  const second = await runReplayLeg(browser, url, runSeed);
  const mismatches = [];
  if (first.log.inputHash !== second.log.inputHash) {
    mismatches.push(`inputHash ${first.log.inputHash} vs ${second.log.inputHash}`);
  }
  if (first.log.stateHash !== second.log.stateHash) {
    mismatches.push(`stateHash ${first.log.stateHash} vs ${second.log.stateHash}`);
  }
  const rngDivergence = firstRngDivergence(first.rng, second.rng);
  if (rngDivergence) mismatches.push(`RNG (${rngDivergence})`);
  if (first.state.runTimeMs !== second.state.runTimeMs) {
    mismatches.push(`runTimeMs ${first.state.runTimeMs} vs ${second.state.runTimeMs}`);
  }
  if (first.state.stageTimeMs !== second.state.stageTimeMs) {
    mismatches.push(`stageTimeMs ${first.state.stageTimeMs} vs ${second.state.stageTimeMs}`);
  }
  if (JSON.stringify(first.choices) !== JSON.stringify(second.choices)) {
    mismatches.push(
      `choices ${JSON.stringify(first.choices)} vs ${JSON.stringify(second.choices)}`
    );
  }
  const divergence = firstSeriesDivergence(first.series, second.series);
  const notes = [];
  if (divergence) {
    notes.push(
      `first per-frame divergence at recorded frame ${divergence.frame}: ` +
        `${divergence.field} ${divergence.a} vs ${divergence.b}`
    );
    const f = divergence.frame;
    const lo = Math.max(0, f - 2);
    const hi = Math.min(first.series.length - 1, f + 2);
    for (let i = lo; i <= hi; i++) {
      notes.push(
        `  frame ${i}: run1 ts=${first.series[i].ts} ws=${first.series[i].ws} | ` +
          `run2 ts=${second.series[i].ts} ws=${second.series[i].ws}`
      );
    }
    const dipped1 = first.series.filter((x) => x.ts < 0.999 || x.ws < 0.999).length;
    const dipped2 = second.series.filter((x) => x.ts < 0.999 || x.ws < 0.999).length;
    notes.push(`hit-stop dipped frames: run1=${dipped1} run2=${dipped2} (wall-clock Juice — see header).`);
  }
  const pass = mismatches.length === 0;
  return {
    id: 4,
    name: 'two runs, one seed + one input log, 3600 steps -> identical state',
    status: pass ? 'PASS' : 'FAIL',
    details: {
      seed: runSeed,
      steps: 3600,
      framesRecordedRun1: first.series.length,
      framesRecordedRun2: second.series.length,
      stateHashRun1: first.log.stateHash,
      stateHashRun2: second.log.stateHash,
      inputHashRun1: first.log.inputHash,
      inputHashRun2: second.log.inputHash,
      runTimeMsRun1: first.state.runTimeMs,
      runTimeMsRun2: second.state.runTimeMs,
      choicesRun1: first.choices,
      choicesRun2: second.choices,
      mismatches,
      firstDivergence: divergence,
    },
    notes: pass ? [] : mismatches.concat(notes),
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seed = args.seed ?? 'harness-acceptance';
  const url = args.url ?? process.env.OFELIYA_URL ?? 'http://127.0.0.1:5176/';

  console.log(`harness-acceptance: seed=${seed} url=${url}`);

  const browser = await launchHarnessBrowser();
  const results = [];
  try {
    const checks = [
      ['(0) advance() guard', () => check0Guard(browser, url, seed)],
      ['(1) stable delta', () => check1Delta(browser, url)],
      ['(2) subsystems under stepping', () => check2Subsystems(browser, url, seed)],
      ['(3) 3600 steps logical time', () => check3LongTime(browser, url, seed)],
      ['(4) replay 3600 steps', () => check4Replay(browser, url, seed)],
    ];
    for (const [label, run] of checks) {
      const startedAt = Date.now();
      try {
        const result = await withTimeout(run(), CHECK_TIMEOUT_MS, `check ${label}`);
        result.wallMs = Date.now() - startedAt;
        results.push(result);
        console.log(`CHECK ${label}: ${result.status} (${(result.wallMs / 1000).toFixed(1)}s)`);
      } catch (error) {
        if (error.code === 'HARNESS_API_MISSING') throw error;
        const failed = {
          id: label,
          name: label,
          status: 'FAIL',
          details: { error: error.message },
          notes: [`threw: ${error.message}`],
          wallMs: Date.now() - startedAt,
        };
        results.push(failed);
        console.log(`CHECK ${label}: FAIL (threw after ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
      }
      const last = results[results.length - 1];
      for (const [key, value] of Object.entries(last.details)) {
        console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      }
      for (const note of last.notes || []) console.log(`  ! ${note}`);
    }
  } catch (error) {
    if (error.code === 'HARNESS_API_MISSING') {
      console.error(`harness-acceptance: ${error.message}`);
      process.exit(EXIT_API_MISSING);
    }
    throw error;
  } finally {
    await browser.close();
  }

  const allPass = results.every((r) => r.status === 'PASS');
  const summary = {
    seed,
    url,
    generatedAt: new Date().toISOString(),
    overall: allPass ? 'PASS' : 'FAIL',
    checks: results,
  };
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const summaryPath = path.join(ARTIFACT_DIR, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`summary: ${summaryPath}`);
  console.log(
    `harness-acceptance: ${allPass ? 'PASS' : 'FAIL'} — ` +
      `${results.filter((r) => r.status === 'PASS').length}/${results.length} checks passed`
  );
  process.exit(allPass ? EXIT_PASS : EXIT_FAIL);
}

main().catch((error) => {
  console.error(`harness-acceptance: FAILED: ${error.stack || error.message}`);
  process.exit(EXIT_FAIL);
});

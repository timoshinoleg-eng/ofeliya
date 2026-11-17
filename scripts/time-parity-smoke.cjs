'use strict';
/**
 * Time-parity smoke (harness track E, design §2.4 + Appendix C).
 *
 * An identical final stateHash at 1x and 4x can hide a timing error that
 * only shows up on another seed — so this script compares the ACTUAL time
 * series of two runs on one seed, not just the hash:
 *
 *   - real delta of every frame (game.loop.delta recorded each step),
 *   - accumulated runTimeMs and stageTimeMs,
 *   - telegraph appearance moments (full per-frame telegraph list),
 *   - boss phase-change moments (phase + bossPhase per frame),
 *   - heartbeat sync time (nextImpactAtMs / msToNextImpact per frame),
 *   - mutation-choice moments (awaitingChoice + pendingChoices per frame).
 *
 * Segment: from run start to the first boss spawn (bloodstream,
 * durationMs 300_000 -> ~18_000 frames). NOT a full campaign.
 *
 * Legs differ only in stepping cadence: 1x advances 60 frames per
 * page.evaluate call, 4x advances 240. Both step the same FIXED_DT
 * (1000/60) through the same advance() chunks of 120; any wall-clock
 * leak between chunks (timers, RAF, modal handling) shows up as a
 * series divergence.
 *
 * Determinism setup (why the legs are comparable at all):
 * - The RAF loop is stopped BEFORE startCampaign, so Game.create runs on
 *   synthetic steps from the fixed epoch (installAutonomousHarness note
 *   3b) — no wall-clock RAF frame ever touches either run.
 * - Mutation choices are applied IN-PAGE on the exact frame the modal
 *   opens (POST_STEP handler in the recorder). A Node-side poll would
 *   apply them at chunk boundaries and desync the legs by up to a chunk.
 * - The player gets the 1M-HP survival probe (same pattern as
 *   stage-transition-smoke.cjs) so both legs reach the boss.
 * - The page loads with ?qaHide=gems,atmo,ui (visibility ONLY — logic,
 *   physics and timers still run; see qaHide.ts). It keeps ~18k stepped
 *   renders cheap; the compared series are logic time, not pixels.
 *
 * Criterion: all series identical within float-rounding tolerance
 * (1e-9 relative). Exit 0 on match, 1 on divergence (with a line-by-line
 * diff of the first divergences), 2 when the Test API is absent.
 *
 * Usage:
 *   node scripts/time-parity-smoke.cjs [--url <base>] [--seed <seed>]
 *     [--difficulty standard|strained] [--max-frames N]
 * Default URL: $OFELIYA_URL or http://127.0.0.1:5176/ (port 5176: 5173 is
 * round 4, 5175 is track C). The dev server is NOT started here.
 */

const {
  launchHarnessBrowser,
  newHarnessPage,
  waitForTestApi,
  startSteppedCampaign,
  installSurvivalProbe,
} = require('./lib/harness-browser.cjs');

const EXIT_MATCH = 0;
const EXIT_DIVERGED = 1;
const EXIT_API_MISSING = 2;

const REL_TOL = 1e-9;
const MAX_DIFF_LINES = 20;
const LEG_TIMEOUT_MS = 10 * 60 * 1000;
const BOSS_SPAWN_PHASE = 'BOSS_ACTIVE';

function usageError(message) {
  console.error(`time-parity-smoke: ${message}\n`);
  console.error(
    'Usage: node scripts/time-parity-smoke.cjs [--url <base>] [--seed <seed>]\n' +
      '  [--difficulty standard|strained] [--max-frames N]'
  );
  process.exit(EXIT_DIVERGED);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        'time-parity-smoke: compare 1x vs 4x actual-time series on one seed.\n\n' +
          'Options:\n' +
          '  --url <base>             game URL (default: $OFELIYA_URL or http://127.0.0.1:5176/)\n' +
          '  --seed <seed>            run seed (default: time-parity-2026)\n' +
          '  --difficulty <id>        standard | strained (default: standard)\n' +
          '  --max-frames <n>         cap frames per leg (default: 19000)\n\n' +
          'Exit codes: 0 series match · 1 diverged · 2 Test API absent.'
      );
      process.exit(EXIT_MATCH);
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

function withQaHide(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('qaHide', 'gems,atmo,ui');
  return url.toString();
}

function relClose(a, b, tol = REL_TOL) {
  if (a === b) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= tol * scale;
}

function nullableClose(a, b) {
  if (a === null || b === null) return a === b;
  return relClose(a, b);
}

/** Install the per-frame time-series recorder + in-page auto-choice. */
async function installRecorder(page) {
  await page.evaluate(() => {
    window.__timeSeries = [];
    window.__timeSeriesErrors = [];
    const api = window.__ofeliyaTest;
    const game = window.__game;
    // 'poststep' is Phaser.Core.Events.POST_STEP; window.Phaser is not
    // exposed (Phaser is bundled as a module), so the literal is used.
    game.events.on('poststep', () => {
      try {
        const gs = game.scene.getScene('Game');
        if (!gs || !gs.runState) return;
        if (!game.scene.isActive('Game') && !game.scene.isPaused('Game')) return;
        const st = api.readState();
        window.__timeSeries.push({
          d: game.loop.delta,
          r: st.runTimeMs,
          s: st.stageTimeMs,
          ph: st.phase,
          bp: st.boss ? st.boss.bossPhase : 0,
          ac: st.awaitingChoice ? 1 : 0,
          pc: st.pendingChoices.join(','),
          tg: st.telegraphs.map((t) => [
            t.source,
            t.shape,
            t.msToFire,
            t.x,
            t.y,
            t.radius ?? null,
            t.angle ?? null,
            t.length ?? null,
          ]),
          hb: st.heartbeat.nextImpactAtMs,
          hbm: st.heartbeat.msToNextImpact,
        });
        // Apply the choice on the exact frame the modal opens — identical
        // in both legs regardless of chunk size (see header).
        if (st.awaitingChoice && st.pendingChoices.length > 0) {
          api.chooseUpgrade(st.pendingChoices[0]);
        }
      } catch (error) {
        window.__timeSeriesErrors.push(String((error && error.message) || error));
      }
    });
  });
}

async function runLeg(browser, { url, seed, difficulty, chunkFrames, maxFrames, label }) {
  const startedAt = Date.now();
  const { ctx, page, errors } = await newHarnessPage(browser, url);
  try {
    await waitForTestApi(page);
    await startSteppedCampaign(page, { seed, difficulty });
    await installSurvivalProbe(page);
    await installRecorder(page);

    let frames = 0;
    for (;;) {
      const state = await page.evaluate(() => window.__ofeliyaTest.readState());
      if (state.phase === BOSS_SPAWN_PHASE) break;
      if (state.phase === 'RUN_ENDED' || state.scene !== 'Game') {
        throw new Error(
          `${label}: run ended before the first boss (phase=${state.phase} scene=${state.scene} ` +
            `frames=${frames} runTimeMs=${state.runTimeMs})`
        );
      }
      if (frames >= maxFrames) {
        throw new Error(`${label}: first boss did not spawn within ${maxFrames} frames`);
      }
      const chunk = Math.min(chunkFrames, maxFrames - frames);
      await page.evaluate((n) => window.__ofeliyaTest.advance(n), chunk);
      frames += chunk;
    }

    const series = await page.evaluate(() => window.__timeSeries);
    const recorderErrors = await page.evaluate(() => window.__timeSeriesErrors);
    if (recorderErrors.length > 0) {
      throw new Error(`${label}: recorder errors in-page: ${recorderErrors.slice(0, 3).join(' | ')}`);
    }
    const log = await page.evaluate(() => window.__ofeliyaTest.getRunLog());
    const wallMs = Date.now() - startedAt;
    return { label, frames, series, stateHash: log.stateHash, inputHash: log.inputHash, wallMs, errors };
  } finally {
    await ctx.close();
  }
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

function firstIndexWhere(series, predicate) {
  for (let i = 0; i < series.length; i++) {
    if (predicate(series[i], i)) return i;
  }
  return -1;
}

function summarizeTelegraphs(series) {
  let framesWith = 0;
  let firstFrame = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i].tg.length > 0) {
      framesWith += 1;
      if (firstFrame < 0) firstFrame = i;
    }
  }
  return { framesWith, firstFrame };
}

function compareTelegraphs(a, b, frame, diffs) {
  if (a.length !== b.length) {
    diffs.push(`frame ${frame}: telegraph count ${a.length} vs ${b.length}`);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    const [sA, shA, msA, xA, yA, rA, anA, lA] = a[i];
    const [sB, shB, msB, xB, yB, rB, anB, lB] = b[i];
    if (sA !== sB || shA !== shB) {
      diffs.push(`frame ${frame}: telegraph[${i}] ${sA}/${shA} vs ${sB}/${shB}`);
      continue;
    }
    const fields = [
      ['msToFire', msA, msB],
      ['x', xA, xB],
      ['y', yA, yB],
    ];
    for (const [name, va, vb] of fields) {
      if (!relClose(va, vb)) diffs.push(`frame ${frame}: telegraph[${i}].${name} ${va} vs ${vb}`);
    }
    for (const [name, va, vb] of [
      ['radius', rA, rB],
      ['angle', anA, anB],
      ['length', lA, lB],
    ]) {
      if (!nullableClose(va, vb)) diffs.push(`frame ${frame}: telegraph[${i}].${name} ${va} vs ${vb}`);
    }
  }
}

function compareSeries(a, b) {
  const diffs = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const fa = a[i];
    const fb = b[i];
    if (!relClose(fa.d, fb.d)) diffs.push(`frame ${i}: loop.delta ${fa.d} vs ${fb.d}`);
    if (!relClose(fa.r, fb.r)) diffs.push(`frame ${i}: runTimeMs ${fa.r} vs ${fb.r}`);
    if (!relClose(fa.s, fb.s)) diffs.push(`frame ${i}: stageTimeMs ${fa.s} vs ${fb.s}`);
    if (fa.ph !== fb.ph) diffs.push(`frame ${i}: phase ${fa.ph} vs ${fb.ph}`);
    if (fa.bp !== fb.bp) diffs.push(`frame ${i}: bossPhase ${fa.bp} vs ${fb.bp}`);
    if (fa.ac !== fb.ac || fa.pc !== fb.pc) {
      diffs.push(`frame ${i}: choice awaiting=${fa.ac} [${fa.pc}] vs awaiting=${fb.ac} [${fb.pc}]`);
    }
    if (!nullableClose(fa.hb, fb.hb)) diffs.push(`frame ${i}: heartbeat nextImpactAtMs ${fa.hb} vs ${fb.hb}`);
    if (!nullableClose(fa.hbm, fb.hbm)) {
      diffs.push(`frame ${i}: heartbeat msToNextImpact ${fa.hbm} vs ${fb.hbm}`);
    }
    compareTelegraphs(fa.tg, fb.tg, i, diffs);
    if (diffs.length >= MAX_DIFF_LINES) break;
  }
  return diffs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seed = args.seed ?? 'time-parity-2026';
  const difficulty = args.difficulty ?? 'standard';
  if (difficulty !== 'standard' && difficulty !== 'strained') {
    usageError(`--difficulty must be standard or strained, got ${difficulty}`);
  }
  const maxFrames = args['max-frames'] === undefined ? 19000 : Number(args['max-frames']);
  if (!Number.isInteger(maxFrames) || maxFrames <= 0) usageError('--max-frames must be a positive integer');
  const baseUrl = args.url ?? process.env.OFELIYA_URL ?? 'http://127.0.0.1:5176/';
  const url = withQaHide(baseUrl);

  console.log(
    `time-parity-smoke: seed=${seed} difficulty=${difficulty} url=${url} maxFrames=${maxFrames}`
  );

  const browser = await launchHarnessBrowser();
  try {
    const legOptions = { url, seed, difficulty, maxFrames };
    const leg1x = await withTimeout(
      runLeg(browser, { ...legOptions, chunkFrames: 60, label: '1x' }),
      LEG_TIMEOUT_MS,
      '1x leg'
    );
    const leg4x = await withTimeout(
      runLeg(browser, { ...legOptions, chunkFrames: 240, label: '4x' }),
      LEG_TIMEOUT_MS,
      '4x leg'
    );

    for (const leg of [leg1x, leg4x]) {
      for (const error of leg.errors) console.warn(`warning: pageerror during ${leg.label} leg: ${error}`);
    }

    // Both legs stop at the first chunk boundary AFTER the boss spawns, so
    // the raw series have different tails. Truncate both at the boss-spawn
    // frame (inclusive) — the spawn frame itself must agree.
    const spawn1x = firstIndexWhere(leg1x.series, (f) => f.ph === BOSS_SPAWN_PHASE);
    const spawn4x = firstIndexWhere(leg4x.series, (f) => f.ph === BOSS_SPAWN_PHASE);
    console.log(
      `1x leg: ${leg1x.frames} stepped frames, ${leg1x.series.length} recorded, ` +
        `boss spawn at recorded frame ${spawn1x}, wall ${(leg1x.wallMs / 1000).toFixed(1)}s`
    );
    console.log(
      `4x leg: ${leg4x.frames} stepped frames, ${leg4x.series.length} recorded, ` +
        `boss spawn at recorded frame ${spawn4x}, wall ${(leg4x.wallMs / 1000).toFixed(1)}s`
    );
    if (spawn1x < 0 || spawn4x < 0) {
      console.error('time-parity-smoke: DIVERGED — boss spawn frame not recorded in one leg');
      process.exit(EXIT_DIVERGED);
    }

    const diffs = [];
    if (spawn1x !== spawn4x) {
      diffs.push(`boss spawn frame differs: 1x=${spawn1x} 4x=${spawn4x}`);
    }
    const a = leg1x.series.slice(0, spawn1x + 1);
    const b = leg4x.series.slice(0, spawn4x + 1);
    if (a.length !== b.length) {
      diffs.push(`truncated series length differs: 1x=${a.length} 4x=${b.length}`);
    } else {
      diffs.push(...compareSeries(a, b));
    }

    const tg1x = summarizeTelegraphs(a);
    const tg4x = summarizeTelegraphs(b);
    const last = a[a.length - 1];
    console.log(
      `compared ${a.length} frames to boss spawn: runTimeMs=${last.r} stageTimeMs=${last.s} ` +
        `telegraph frames 1x=${tg1x.framesWith} (first ${tg1x.firstFrame}) ` +
        `4x=${tg4x.framesWith} (first ${tg4x.firstFrame})`
    );
    console.log(
      `heartbeat on bloodstream: nextImpactAtMs=${last.hb} msToNextImpact=${last.hbm} ` +
        `(null on stage 1 — heartbeat lives on the heart stage; compared, trivially equal)`
    );
    console.log(`stateHash (secondary, not the criterion): 1x=${leg1x.stateHash} 4x=${leg4x.stateHash}`);
    if (leg1x.stateHash !== leg4x.stateHash) {
      console.log('note: stateHash differs while the time series above agree (or vice versa) — see diff');
    }

    if (diffs.length > 0) {
      console.error(`time-parity-smoke: DIVERGED (${diffs.length} shown, cap ${MAX_DIFF_LINES})`);
      for (const line of diffs.slice(0, MAX_DIFF_LINES)) console.error(`  ${line}`);
      process.exit(EXIT_DIVERGED);
    }
    console.log(
      `time-parity-smoke: MATCH — 1x vs 4x time series identical over ${a.length} frames ` +
        `(tolerance 1e-9 relative)`
    );
    process.exit(EXIT_MATCH);
  } catch (error) {
    if (error.code === 'HARNESS_API_MISSING') {
      console.error(`time-parity-smoke: ${error.message}`);
      process.exit(EXIT_API_MISSING);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`time-parity-smoke: FAILED: ${error.stack || error.message}`);
  process.exit(EXIT_DIVERGED);
});

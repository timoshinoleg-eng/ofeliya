'use strict';
/**
 * Audio diagnostics smoke (harness track E, design §4.3 + Appendix C).
 *
 * Gemini's claim that AudioContext.currentTime freezes at zero in headless
 * Linux was NOT accepted as fact — this script reproduces it (or not) in
 * the CI image, in headless Chromium against the same QA build the
 * campaign runs use. It probes the ENVIRONMENT's audio capability with
 * its own AudioContext, not the game's audio path (the game path is not
 * tested in this PR; game progress never depends on `onended` — there is
 * no `onended`/`AudioContext` use in src/game/).
 *
 * Probe, in-page:
 *   1. AudioContext constructor present; context created (state, sampleRate).
 *   2. If the context starts 'suspended', one resume() attempt + re-read.
 *   3. currentTime advance over ~1 s of wall time.
 *   4. A 0.1 s AudioBufferSourceNode plays to completion (onended fires).
 *
 * Statuses (stdout + JSON artifact):
 *   AUDIO_OK — everything works (context created, currentTime advances,
 *     onended fires). Exit 0.
 *   ENVIRONMENT_AUDIO_UNAVAILABLE — the environment cannot do audio: no
 *     constructor, context creation throws, or currentTime does not move
 *     (e.g. the context stays suspended without a user gesture) and
 *     onended never arrives. Exit 0 — this is NOT a CI failure.
 *   AUDIO_FAIL — the context exists and its clock runs (currentTime
 *     advances) but the test node never completes. That is a broken
 *     audio path, not an incapable environment. Exit 1.
 *
 * A page-load failure is a harness failure (exit 1), not an audio verdict.
 *
 * Usage:
 *   node scripts/audio-diagnostics-smoke.cjs [--url <base>] [--out <json>]
 * Default URL: $OFELIYA_URL or http://127.0.0.1:5176/. Default artifact:
 * artifacts/audio-diagnostics/result.json. The dev server is NOT started here.
 */

const fs = require('fs');
const path = require('path');
const { launchHarnessBrowser, newHarnessPage } = require('./lib/harness-browser.cjs');

const EXIT_OK = 0;
const EXIT_FAIL = 1;

const CURRENT_TIME_WINDOW_MS = 1000;
// A healthy clock advances ~1s here; this VM measured 0.63s under load
// (virtual audio device), so 0.3 separates "runs" from "frozen" (0.05)
// with margin on both sides. The in-between band (0.05–0.3) with a
// missing onended is reported as environment trouble, not AUDIO_FAIL.
const CURRENT_TIME_MIN_ADVANCE_S = 0.3;
const CURRENT_TIME_FROZEN_S = 0.05;
const ONENDED_TIMEOUT_MS = 3000;

function usageError(message) {
  console.error(`audio-diagnostics-smoke: ${message}\n`);
  console.error('Usage: node scripts/audio-diagnostics-smoke.cjs [--url <base>] [--out <json>]');
  process.exit(EXIT_FAIL);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        'audio-diagnostics-smoke: probe headless-Chromium audio capability.\n\n' +
          'Options:\n' +
          '  --url <base>   game URL (default: $OFELIYA_URL or http://127.0.0.1:5176/)\n' +
          '  --out <json>   artifact path (default: artifacts/audio-diagnostics/result.json)\n\n' +
          'Exit codes: 0 AUDIO_OK or ENVIRONMENT_AUDIO_UNAVAILABLE · 1 AUDIO_FAIL or harness failure.'
      );
      process.exit(EXIT_OK);
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

async function probeAudio(page) {
  return page.evaluate(
    async ({ windowMs, onendedTimeoutMs }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        return { constructorAvailable: false };
      }
      let ctx;
      try {
        ctx = new Ctor();
      } catch (error) {
        return { constructorAvailable: true, createError: String((error && error.message) || error) };
      }
      const result = {
        constructorAvailable: true,
        stateBeforeResume: ctx.state,
        sampleRate: ctx.sampleRate,
      };
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch (error) {
          result.resumeError = String((error && error.message) || error);
        }
        await sleep(500);
      }
      result.state = ctx.state;
      const t0 = ctx.currentTime;
      await sleep(windowMs);
      const t1 = ctx.currentTime;
      result.currentTimeBeforeS = t0;
      result.currentTimeAfterS = t1;
      result.currentTimeAdvanceS = t1 - t0;
      // 0.1 s of silence through a buffer source; onended must fire.
      let onended = false;
      try {
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        const ended = new Promise((resolve) => {
          source.onended = () => resolve(true);
          setTimeout(() => resolve(false), onendedTimeoutMs);
        });
        source.start();
        onended = await ended;
      } catch (error) {
        result.nodeError = String((error && error.message) || error);
      }
      result.onended = onended;
      try {
        await ctx.close();
      } catch {
        // Closing is best-effort; the verdict is already recorded.
      }
      return result;
    },
    { windowMs: CURRENT_TIME_WINDOW_MS, onendedTimeoutMs: ONENDED_TIMEOUT_MS }
  );
}

function verdict(measurements) {
  if (!measurements.constructorAvailable) {
    return {
      status: 'ENVIRONMENT_AUDIO_UNAVAILABLE',
      reason: 'no AudioContext constructor in this Chromium',
    };
  }
  if (measurements.createError) {
    return {
      status: 'ENVIRONMENT_AUDIO_UNAVAILABLE',
      reason: `AudioContext creation threw: ${measurements.createError}`,
    };
  }
  const advance = measurements.currentTimeAdvanceS;
  const clockRuns = typeof advance === 'number' && advance >= CURRENT_TIME_MIN_ADVANCE_S;
  const clockFrozen = typeof advance !== 'number' || advance < CURRENT_TIME_FROZEN_S;
  if (clockRuns && measurements.onended) {
    return { status: 'AUDIO_OK', reason: 'context runs, currentTime advances, test node completed' };
  }
  if (clockRuns && !measurements.onended) {
    return {
      status: 'AUDIO_FAIL',
      reason:
        `audio clock runs (currentTime advanced ${advance}s) but the test ` +
        `AudioBufferSourceNode never fired onended within ${ONENDED_TIMEOUT_MS}ms`,
    };
  }
  if (clockFrozen) {
    return {
      status: 'ENVIRONMENT_AUDIO_UNAVAILABLE',
      reason:
        `currentTime did not advance (${advance}s over ${CURRENT_TIME_WINDOW_MS}ms wall; ` +
        `state=${measurements.state}, before resume=${measurements.stateBeforeResume}) — ` +
        'the environment cannot run audio here',
    };
  }
  // In-between advance (0.05–0.5 s): the clock stutters but is not dead.
  // Treat a completed node as OK; a missing onended as environment trouble,
  // not a proven game-path break — the clock itself is unhealthy.
  if (measurements.onended) {
    return {
      status: 'AUDIO_OK',
      reason: `currentTime advanced only ${advance}s, but the test node completed`,
    };
  }
  return {
    status: 'ENVIRONMENT_AUDIO_UNAVAILABLE',
    reason: `currentTime advanced only ${advance}s and onended did not fire — unhealthy audio clock`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url ?? process.env.OFELIYA_URL ?? 'http://127.0.0.1:5176/';
  const outPath =
    args.out ?? path.join(process.cwd(), 'artifacts', 'audio-diagnostics', 'result.json');

  console.log(`audio-diagnostics-smoke: url=${url}`);

  const browser = await launchHarnessBrowser({ autoplay: true });
  try {
    const { ctx, page } = await newHarnessPage(browser, url);
    try {
      const measurements = await probeAudio(page);
      const { status, reason } = verdict(measurements);
      const report = {
        status,
        reason,
        url,
        generatedAt: new Date().toISOString(),
        measurements,
        thresholds: {
          currentTimeWindowMs: CURRENT_TIME_WINDOW_MS,
          currentTimeMinAdvanceS: CURRENT_TIME_MIN_ADVANCE_S,
          currentTimeFrozenS: CURRENT_TIME_FROZEN_S,
          onendedTimeoutMs: ONENDED_TIMEOUT_MS,
        },
      };
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`audio-diagnostics-smoke: ${status} — ${reason}`);
      console.log(
        `  constructor=${measurements.constructorAvailable} ` +
          `state=${measurements.state ?? 'n/a'} (before resume: ${measurements.stateBeforeResume ?? 'n/a'}) ` +
          `sampleRate=${measurements.sampleRate ?? 'n/a'} ` +
          `currentTimeAdvance=${measurements.currentTimeAdvanceS ?? 'n/a'}s ` +
          `onended=${measurements.onended ?? 'n/a'}`
      );
      console.log(`  artifact: ${outPath}`);
      process.exit(status === 'AUDIO_FAIL' ? EXIT_FAIL : EXIT_OK);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`audio-diagnostics-smoke: FAILED (harness failure): ${error.stack || error.message}`);
  process.exit(EXIT_FAIL);
});

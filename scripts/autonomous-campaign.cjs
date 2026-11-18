#!/usr/bin/env node
'use strict';
// Autonomous Campaign Harness — Playwright runner (track C, design §4).
//
// Drives a full OFELIYA campaign (bloodstream → IMMUNE PRIME → heart →
// CARDIAC TITAN) with no human in the loop: the CampaignBot (Node-side,
// scripts/autopilot/) reads window.__ofeliyaTest.readState() at 10 Hz of
// game time and feeds ordinary input back through setInput(); mutations
// are resolved through the real chooseUpgrade handler and stage transitions
// through the real acknowledgeTransition handler.
//
// Modes:
//   bot (default)  Bot plays the campaign; inputs/choices/transitions are
//                  recorded to inputs.json for replay.
//   replay         --replay inputs.json replays a recorded input log
//                  through the same loop (same tick coordinates, same
//                  start sequence) and compares stateHash/inputHash with
//                  the expected hashes stored in the log.
//
// Time: pure synthetic stepping, always (design §2.2 — there is no
// game.loop.timeScale in Phaser 3.90). The loop is paused before
// startCampaign (like the track-A determinism probe) so the pre-run frame
// count is deterministic; stepped runs stay stepped until the run ends
// (resume() would shift absolute-time deadlines — track A header note).
// --speed is a WALL-CLOCK pacing multiplier only: the simulation (frames,
// decisions, hashes) is identical at any speed, which is what makes the
// 1x/4x speed-parity check meaningful. Effective speed is measured and a
// TIME_SCALE_DEGRADED marker is emitted when the machine cannot keep up.
//
// Stepped mode still RENDERS: Game.step always renders (Game.js:474–522),
// there is no "render off" mode anywhere in this runner (Appendix C §2).
// No global Date.now / performance.now pinning is done anywhere either
// (Appendix C §3) — the runner measures wall time only for pacing and
// watchdogs, never for the game clock.
//
// Screenshots (Appendix C §1): the primary mechanism is the renderer
// snapshot API via window.__game.renderer — WebGLRenderer.snapshot(cb)
// (callback-based, fires on the NEXT render; WebGLRenderer.js:2891) and
// CanvasRenderer.snapshotCanvas(canvas, cb) (immediate). With RAF stopped,
// one synthetic step renders the next frame and fires the callback. The
// handshake is folded into the loop's regular advance() so it consumes NO
// extra simulation frames (arm before the advance, collect after it); only
// post-run shots use an explicit advance(1), when the run is already over.
// preserveDrawingBuffer is NOT set anywhere. A composited page screenshot
// is kept only as a fallback when the renderer API is unavailable.
//
// Visual profiles (Appendix C §5): the runner reads OFELIYA_VISUAL_PROFILE
// (logic-stress | rendering-performance | release-visual, default
// release-visual; --visual-profile overrides the env) and passes it into
// the page as the URL parameter ?ofeliyaVisualProfile=<profile>. The game
// ignores unknown query params (FeatureFlags reads only flag.*, qaHide
// reads only qaHide), so the parameter is inert until track E's
// scripts/lib/visual-profiles.cjs (not present in this worktree yet) maps
// the profile name to settings. The profile is recorded in run.json
// diagnostics and in series.json.
//
// Movement has no arena-edge rule: the game world is unbounded (no
// setBounds / world constants in GameScene), so no "arena edge" logic
// exists in the bot (Appendix C §4). No angular planner either.
//
// Pace (measured 2026-11-18, 600-frame probe, early game, this VM):
// stepped frames cost ~283 ms wall on SwiftShader WebGL — Canvas is no
// faster (293 ms), and screenshots/video/tracing add only ~5-10%. The
// visual groups dominate: ?qaHide=atmo -> 197 ms/frame,
// ?qaHide=atmo,gems,ui -> 118 ms/frame (2.4x). Hiding is visibility-only
// (src/game/qaHide.ts: nothing stops updating), so logic, RNG and state
// hashes are unchanged — --qa-hide (env OFELIYA_QA_HIDE) is the runner's
// speed lever for logic/determinism runs. Default hides nothing (faithful
// visual run); the selection is recorded in run.json diagnostics and
// series.json. A full campaign is ~40k frames: ~3.2 h unhidden vs ~1.3 h
// with all groups hidden on this VM. The design's 30-min per-run gate
// (§4.4) does not fit SwiftShader even for a first-boss smoke (18k
// frames, ~35 min hidden / ~85 min unhidden) — flagged in the handoff.
//
// Score (Contract QA, design §2.5): a local `node server/index.mjs` is
// started per run on a test port with a fresh store, and /api/score +
// /api/run/start are routed to it from the page. The game forms the real
// payload; the real server validator (parseScoreContract + anti-cheat)
// verdicts it. Nothing is ever sent to the production leaderboard.
//
// PLATFORM DIVERGENCE (design §4.1 vs §2.5): the design prescribes the
// WebApp mock AND a server-accepted score submit, but those two are
// mutually exclusive with a fake initData — the mock selects the MAX
// adapter (MaxPlatform.available is true when window.WebApp.initData is
// set), and the server rejects MAX/Telegram submissions whose initData
// does not validate against the real bot token (403, and /api/run/start
// requires a verified messenger identity too). The only way to get a real
// ok:true from the local validator without real messenger credentials is
// platform 'browser' (anonId, unverified). So the runner defaults to
// --platform browser (no WebApp mock); --platform max keeps the §4.1 mock
// for messenger-behaviour runs, with the 403 verdict recorded as-is.
// Gameplay itself does not depend on the platform adapter (score submit,
// share, haptics and viewport only).
//
// Other divergences from the design doc are listed in the track-C handoff;
// the doc itself is owned by the coordinator.
//
// Artifacts (§6.2): artifacts/autonomous-campaign/<seed>-<run>/ with
// run.json, timeline.ndjson, inputs.json, snapshots.json, trace.zip
// (failure only), failure.png (+ t-2s / t+2s frames), stage-*.png,
// console.log, network.json, heap-before/after.json, local-storage.json,
// score-payload.json. run.json follows the §6.3 schema validated by
// scripts/lib/campaign-report.cjs (track D).
//
// Usage:
//   node scripts/autonomous-campaign.cjs [--seed X] [--difficulty standard|strained]
//     [--speed N] [--runs N] [--replay inputs.json] [--until MARKER]
//     [--out DIR] [--url URL] [--platform browser|max]
//     [--max-frames N] [--wall-timeout-ms N] [--no-video] [--no-trace]
//     [--visual-profile NAME]
//   Env: OFELIYA_BASE_URL (default http://127.0.0.1:5173/),
//        OFELIYA_CAMPAIGN_RUNS (default 1),
//        OFELIYA_VISUAL_PROFILE (default release-visual).
// Exit codes: 0 all runs passed · 1 a run failed/timed out/diverged ·
//             2 usage error or Test API absent.

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const net = require('net');

const { CampaignBot, DECISION_FRAMES } = require('./autopilot/CampaignBot.cjs');

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const VIEWPORT = { width: 390, height: 844 };
const DEFAULT_BASE_URL = 'http://127.0.0.1:5173/';
const DEFAULT_SPEED = 4;
const DEFAULT_MAX_FRAMES = 150000; // 2500 s of simulation.
const DEFAULT_WALL_TIMEOUT_MS = 30 * 60 * 1000; // 30 min per run.
const FRAME_MS = 1000 / 60;
const SEED_RE = /^[A-Za-z0-9_-]{1,32}$/; // server RUN_SEED_RE (server/index.mjs:115).
const DIFFICULTIES = ['standard', 'strained'];
const REPLAY_TAIL_FRAMES = 60; // Same tail as verify-campaign-replay.mjs.
const SCREENSHOT_INTERVAL_FRAMES = 120; // 2 s of simulation.
const PERF_SAMPLE_FRAMES = 300; // 5 s of simulation.
const SNAPSHOT_SAMPLE_FRAMES = 60; // 1 s of simulation.
const STATE_HASH_STALL_SAMPLES = 3; // Consecutive identical samples = stall.
const STATE_HASH_SAMPLE_FRAMES = 300; // 5 s of simulation between samples.
const WAVE_STALL_FRAMES = 1200; // 20 s of simulation with zero progress.
const BOSS_ZERO_HP_FRAMES = 300; // 5 s of simulation.
const TRANSITION_TIMEOUT_FRAMES = 600; // 10 s of simulation.
const POST_RUN_ADVANCE_FRAMES = 300; // 5 s to let the result screen submit.
const POST_RUN_WALL_WAIT_MS = 3000;
const LISTENER_DELTA_TOLERANCE = 5; // Listeners may grow by this much (result screen).
const HEAP_GROWTH_LIMIT = 0.15; // §4.3: < 15% vs the first run of the series.
const MAX_CONSOLE_LINES = 2000;
const MAX_NETWORK_ENTRIES = 2000;

// Invariants that only apply after teardown (RUN_END). On --until runs
// they are recorded as "not exercised" and excluded from the verdict gate;
// gameplay invariants still gate those runs.
const TEARDOWN_INVARIANTS = new Set([
  'listenerBaseline',
  'noStuckInput',
  'saveAfterResult',
  'scoreContract',
  'runResultConsistent',
]);

// Visual profiles (Appendix C §5). The runner only passes the name into
// the page (URL parameter); the profile -> settings mapping is owned by
// track E's scripts/lib/visual-profiles.cjs, not present in this worktree
// yet. Default is the stock profile.
const VISUAL_PROFILES = ['logic-stress', 'rendering-performance', 'release-visual'];
const DEFAULT_VISUAL_PROFILE = 'release-visual';

// QA render-split groups (src/game/qaHide.ts): hiding a group removes only
// its pixels — nothing is destroyed and nothing stops updating, so game
// logic, RNG and state hashes are identical with or without hiding. The
// runner exposes this as --qa-hide for logic/determinism runs on software
// rendering, where Game.step always renders (Appendix C §2) and the visual
// groups dominate the per-frame wall cost. Measured 2026-11-18 on this VM
// (600-frame probe, early game): baseline 283 ms/frame; ?qaHide=atmo
// 197 ms/frame; ?qaHide=atmo,gems,ui 118 ms/frame (2.4x). Canvas is NOT
// faster than WebGL here (293 vs 284 ms/frame), and screenshots/video/
// tracing add only ~5-10%. Default hides nothing (faithful visual run);
// the selection is recorded in run.json diagnostics and series.json, so a
// qaHide run can never be mistaken for a visual run. Visual fidelity stays
// the release-visual matrix's job.
const QA_HIDE_GROUPS = ['gems', 'atmo', 'ui'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[campaign] ${message}`);
}

function warn(message) {
  console.warn(`[campaign] warning: ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function usageError(message) {
  console.error(`autonomous-campaign: ${message}\n`);
  console.error(
    'Usage: node scripts/autonomous-campaign.cjs [--seed X] [--difficulty standard|strained]\n' +
      '  [--speed N] [--runs N] [--replay inputs.json] [--until MARKER] [--out DIR]\n' +
      '  [--url URL] [--platform browser|max] [--max-frames N] [--wall-timeout-ms N]\n' +
      '  [--no-video] [--no-trace] [--score-port N] [--visual-profile NAME]\n\n' +
      '  --seed X             run seed, /^[A-Za-z0-9_-]{1,32}$/ (score contract)\n' +
      '  --difficulty ID      standard | strained (default standard)\n' +
      '  --speed N            wall-clock pacing multiplier (default 4; the\n' +
      '                       simulation is identical at any speed)\n' +
      '  --runs N             runs in the series (default 1, or OFELIYA_CAMPAIGN_RUNS)\n' +
      '  --replay FILE        replay a recorded inputs.json instead of botting\n' +
      '  --until MARKER       stop when the timeline marker fires (e.g. BOSS_ACTIVE,\n' +
      '                       STAGE_CHANGED, CAMPAIGN_VICTORY; aliases: first-boss,\n' +
      '                       heart, victory, defeat)\n' +
      '  --out DIR            artifact root (default artifacts/autonomous-campaign)\n' +
      '  --url URL            game URL (default $OFELIYA_BASE_URL or http://127.0.0.1:5173/)\n' +
      '  --platform KIND      browser (default) | max (WebApp mock, §4.1)\n' +
      '  --max-frames N       watchdog: max logical frames per run (default 150000)\n' +
      '  --wall-timeout-ms N  watchdog: max wall time per run (default 1800000)\n' +
      '  --no-video           disable retain-on-failure video\n' +
      '  --no-trace           disable Playwright tracing\n' +
      '  --score-port N       local score server port (default: a free port)\n' +
      '  --visual-profile NAME  logic-stress | rendering-performance |\n' +
      '                       release-visual (default: $OFELIYA_VISUAL_PROFILE\n' +
      '                       or release-visual); passed to the page as\n' +
      '                       ?ofeliyaVisualProfile=NAME\n' +
      '  --qa-hide GROUPS     hide render groups for faster logic runs\n' +
      '                       (comma-separated gems,atmo,ui; default:\n' +
      '                       $OFELIYA_QA_HIDE or hide nothing). Visibility\n' +
      '                       only — logic, RNG and hashes are unchanged.\n' +
      '                       Recorded in run.json diagnostics.\n\n' +
      'Exit codes: 0 all runs passed · 1 a run failed/timed out/diverged ·\n' +
      '            2 usage error or Test API absent.'
  );
  process.exit(EXIT_USAGE);
}

function parseArgs(argv) {
  const args = {
    speed: DEFAULT_SPEED,
    difficulty: 'standard',
    platform: 'browser',
    video: true,
    trace: true,
  };
  const valued = new Set([
    'seed', 'difficulty', 'speed', 'runs', 'replay', 'until', 'out', 'url',
    'platform', 'max-frames', 'wall-timeout-ms', 'score-port', 'visual-profile',
    'qa-hide',
  ]);
  const flags = new Set(['no-video', 'no-trace']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usageError('help requested');
    const match = arg.match(/^--([a-z-]+)$/);
    if (!match) usageError(`unexpected argument: ${arg}`);
    const name = match[1];
    if (flags.has(name)) {
      if (name === 'no-video') args.video = false;
      if (name === 'no-trace') args.trace = false;
      continue;
    }
    if (!valued.has(name)) usageError(`unknown option: --${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) usageError(`--${name} needs a value`);
    args[name] = value;
    i += 1;
  }
  return args;
}

function parseOptions(args) {
  const runsRaw = args.runs ?? process.env.OFELIYA_CAMPAIGN_RUNS ?? '1';
  const runs = Number(runsRaw);
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) {
    usageError(`--runs must be an integer 1..100, got ${runsRaw}`);
  }
  const speed = Number(args.speed);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 100) {
    usageError(`--speed must be a positive number <= 100, got ${args.speed}`);
  }
  if (!DIFFICULTIES.includes(args.difficulty)) {
    usageError(`--difficulty must be standard or strained, got ${args.difficulty}`);
  }
  if (args.platform !== 'browser' && args.platform !== 'max') {
    usageError(`--platform must be browser or max, got ${args.platform}`);
  }
  const maxFrames = args['max-frames'] === undefined
    ? DEFAULT_MAX_FRAMES
    : Number(args['max-frames']);
  if (!Number.isInteger(maxFrames) || maxFrames < 1000) {
    usageError(`--max-frames must be an integer >= 1000, got ${args['max-frames']}`);
  }
  const wallTimeoutMs = args['wall-timeout-ms'] === undefined
    ? DEFAULT_WALL_TIMEOUT_MS
    : Number(args['wall-timeout-ms']);
  if (!Number.isFinite(wallTimeoutMs) || wallTimeoutMs < 10000) {
    usageError(`--wall-timeout-ms must be >= 10000, got ${args['wall-timeout-ms']}`);
  }
  const scorePort = args['score-port'] === undefined ? 0 : Number(args['score-port']);
  if (!Number.isInteger(scorePort) || scorePort < 0 || scorePort > 65535) {
    usageError(`--score-port must be a port number, got ${args['score-port']}`);
  }
  const seed = args.seed ?? null;
  if (seed !== null && !SEED_RE.test(seed)) {
    usageError(`--seed must match /^[A-Za-z0-9_-]{1,32}$/ (server RUN_SEED_RE), got ${seed}`);
  }
  const visualProfile = args['visual-profile'] ?? process.env.OFELIYA_VISUAL_PROFILE ?? DEFAULT_VISUAL_PROFILE;
  if (!VISUAL_PROFILES.includes(visualProfile)) {
    usageError(`--visual-profile must be one of ${VISUAL_PROFILES.join(', ')}, got ${visualProfile}`);
  }
  const qaHideRaw = args['qa-hide'] ?? process.env.OFELIYA_QA_HIDE ?? '';
  const qaHide = [];
  for (const token of qaHideRaw.split(',')) {
    const group = token.trim().toLowerCase();
    if (!group) continue;
    if (!QA_HIDE_GROUPS.includes(group)) {
      usageError(`--qa-hide groups must be ${QA_HIDE_GROUPS.join(', ')}, got ${group}`);
    }
    if (!qaHide.includes(group)) qaHide.push(group);
  }
  // Canonical order (qaHideLabel in src/game/qaHide.ts): gems,atmo,ui.
  qaHide.sort((a, b) => QA_HIDE_GROUPS.indexOf(a) - QA_HIDE_GROUPS.indexOf(b));
  return {
    seed,
    difficulty: args.difficulty,
    speed,
    runs,
    replay: args.replay ?? null,
    until: args.until ?? null,
    out: args.out ?? path.join(process.cwd(), 'artifacts', 'autonomous-campaign'),
    url: args.url ?? process.env.OFELIYA_BASE_URL ?? DEFAULT_BASE_URL,
    platform: args.platform,
    video: args.video,
    trace: args.trace,
    maxFrames,
    wallTimeoutMs,
    scorePort,
    visualProfile,
    qaHide,
  };
}

function seedForRun(options, runIndex) {
  const base = options.seed ?? `campaign-${options.difficulty}`;
  if (options.runs === 1) return base;
  return `${base}-${runIndex + 1}`;
}

function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '0'.repeat(40);
  }
}

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
    .find(fs.existsSync);
  if (executablePath) return { chromium, executablePath };
  // No system Chrome: fall back to Playwright's bundled Chromium (launch
  // without executablePath resolves it from the Playwright cache). The
  // /usr/bin/google-chrome symlink proved unreliable in this environment
  // (it vanished twice on 2026-11-18, incl. across a runtime restart), so
  // the runner must not hard-fail without it.
  warn('no system Chrome found; falling back to Playwright bundled Chromium');
  return { chromium, executablePath: undefined };
}

// ---------------------------------------------------------------------------
// Local score server (Contract QA, design §2.5)
// ---------------------------------------------------------------------------

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: response.statusCode, body });
        }
      });
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('timeout')));
  });
}

async function waitForHealth(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const { status } = await httpGetJson(`http://127.0.0.1:${port}/health`, 2000);
      if (status === 200) return;
    } catch {
      // Server not up yet.
    }
    if (Date.now() > deadline) throw new Error(`score server on port ${port} did not become healthy`);
    await sleep(200);
  }
}

/**
 * Start `node server/index.mjs` on a test port with a FRESH store (the
 * DATA_DIR is wiped first). One server per run: a fresh store per run is
 * what §4.1 prescribes, and a restart is cheap.
 */
async function startScoreServer({ port, dataDir, origin }) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const serverPath = path.join(process.cwd(), 'server', 'index.mjs');
  if (!fs.existsSync(serverPath)) fail(`score server not found: ${serverPath}`);
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ALLOW_ORIGIN: origin,
      // No messenger tokens in the harness: messenger submissions are
      // expected to fail initData validation (see the header note).
      TG_BOT_TOKEN: '',
      MAX_TOKEN: '',
      OFELIYA_TELEGRAM_OUTBOUND_ENABLED: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', () => {});
  try {
    await waitForHealth(port);
  } catch (error) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    throw error;
  }
  return {
    port,
    proc: child,
    dataDir,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* already gone */ }
            resolve();
          }, 5000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
      return stderr;
    },
  };
}

async function readServerRuleset(port) {
  try {
    const { status, body } = await httpGetJson(`http://127.0.0.1:${port}/api/ruleset`, 3000);
    if (status === 200 && body && typeof body === 'object') return body;
  } catch {
    // Best effort: the score payload is the primary source.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Input log (design §2.4; same format as verify-campaign-replay.mjs)
// ---------------------------------------------------------------------------

function validateVec(vec, what, where) {
  if (
    !Array.isArray(vec)
    || vec.length !== 2
    || !vec.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 1)
  ) {
    throw new Error(`invalid ${what} at ${where}: expected [x, y] with components in [-1, 1]`);
  }
}

function loadInputsFile(file, cliSeed, cliDifficulty) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`inputs file ${file} is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('inputs file must be a JSON object');
  }
  if (parsed.version !== 1) throw new Error(`unsupported inputs version: ${parsed.version} (expected 1)`);
  const seed = cliSeed ?? parsed.seed;
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new Error('seed is required: pass --seed or set "seed" in the inputs file');
  }
  if (cliSeed !== undefined && cliSeed !== null && parsed.seed !== undefined && cliSeed !== parsed.seed) {
    throw new Error(`--seed ${cliSeed} conflicts with inputs file seed ${parsed.seed}`);
  }
  if (!SEED_RE.test(seed)) {
    throw new Error(`seed ${seed} does not match the score-contract seed regex /^[A-Za-z0-9_-]{1,32}$/`);
  }
  const difficulty = cliDifficulty ?? parsed.difficulty ?? 'standard';
  if (!DIFFICULTIES.includes(difficulty)) {
    throw new Error(`invalid difficulty: ${difficulty} (expected standard or strained)`);
  }
  const inputs = parsed.inputs ?? [];
  const choices = parsed.choices ?? [];
  const transitions = parsed.transitions ?? [];
  if (!Array.isArray(inputs) || !Array.isArray(choices) || !Array.isArray(transitions)) {
    throw new Error('inputs, choices and transitions must be arrays');
  }
  let prevTick = -1;
  for (const [index, entry] of inputs.entries()) {
    const where = `inputs[${index}]`;
    if (!Number.isInteger(entry?.tick) || entry.tick < 0) {
      throw new Error(`invalid tick at ${where}: expected a non-negative integer`);
    }
    if (entry.tick <= prevTick) {
      throw new Error(`ticks must be strictly increasing at ${where} (tick ${entry.tick})`);
    }
    prevTick = entry.tick;
    validateVec(entry.move, 'move vector', where);
    if (entry.aim !== undefined) validateVec(entry.aim, 'aim vector', where);
  }
  for (const [index, entry] of choices.entries()) {
    const where = `choices[${index}]`;
    if (!Number.isInteger(entry?.tick) || entry.tick < 0) {
      throw new Error(`invalid tick at ${where}: expected a non-negative integer`);
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`invalid id at ${where}: expected a non-empty upgrade id`);
    }
  }
  for (const [index, entry] of transitions.entries()) {
    const where = `transitions[${index}]`;
    if (!Number.isInteger(entry?.tick) || entry.tick < 0) {
      throw new Error(`invalid tick at ${where}: expected a non-negative integer`);
    }
  }
  return {
    seed,
    difficulty,
    inputs,
    choices,
    transitions,
    expectedStateHash: typeof parsed.expectedStateHash === 'string' ? parsed.expectedStateHash : null,
    expectedInputHash: typeof parsed.expectedInputHash === 'string' ? parsed.expectedInputHash : null,
    // Tick at which the recorded run's hashes were captured. The replay
    // must end at exactly this tick: stateHash is cumulative, so hashes
    // taken at different ticks always differ (the 2026-11-18 replay-1800
    // false DIVERGED: bot ended at 1800, replay ran to 1854 =
    // lastEventTick + tail, while all 30 per-second snapshots matched).
    finalTick: Number.isInteger(parsed.finalTick) && parsed.finalTick >= 0 ? parsed.finalTick : null,
  };
}

// ---------------------------------------------------------------------------
// Browser context (design §4.1: stage-transition-smoke + combat-fixture
// pattern — same viewport, flags, MAX route, localStorage seed)
// ---------------------------------------------------------------------------

async function makeRunContext(browser, options, run) {
  const contextOptions = {
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  };
  if (options.video) {
    contextOptions.video = {
      mode: 'retain-on-failure',
      size: { width: VIEWPORT.width, height: VIEWPORT.height },
    };
  }
  const ctx = await browser.newContext(contextOptions);
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );

  // Contract QA: /api/score and /api/run/start go to the LOCAL score
  // server (fresh store), never to production. The route answers as if
  // from the game origin, so no CORS is involved. The request/response are
  // recorded for score-payload.json and the SCORE_* markers.
  const forwardApi = (pathname) => async (route) => {
    const request = route.request();
    let body = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData() || null;
    }
    run.apiCalls.push({ pathname, method: request.method(), body, atWallMs: Date.now() - run.wallStart });
    try {
      const response = await fetch(`http://127.0.0.1:${run.scoreServer.port}${pathname}`, {
        method: request.method(),
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
      run.apiCalls[run.apiCalls.length - 1].response = { status: response.status, body: json ?? text };
      if (pathname === '/api/score') {
        run.scoreSubmission = {
          request: body,
          responseStatus: response.status,
          response: json ?? text,
        };
      }
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: text,
      });
    } catch (error) {
      run.apiCalls[run.apiCalls.length - 1].response = { status: 0, error: String(error) };
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: `harness score-server forward failed: ${error.message}` }),
      });
    }
  };
  await ctx.route('**/api/score', forwardApi('/api/score'));
  await ctx.route('**/api/run/start', forwardApi('/api/run/start'));

  const platform = options.platform;
  const difficulty = run.difficulty;
  await ctx.addInitScript(({ platform: plat, difficulty: diff }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_difficulty_v1', diff);
    // Twin-stick: the bot aims through registry 'aimJoy', which the game
    // only honors in two-hand/dual-move control modes.
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    if (plat === 'max') {
      window.WebApp = {
        platform: 'android',
        version: '26.20.0',
        initData: 'signed-autonomous-campaign',
        initDataUnsafe: { user: { id: 42, first_name: 'Campaign', last_name: 'QA' } },
        getViewportSize: async () => ({ width: '390', height: '844' }),
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      };
    }
  }, { platform, difficulty });

  if (options.trace) {
    await ctx.tracing.start({ screenshots: false, snapshots: true });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (error) => run.pageErrors.push(`pageerror: ${String(error)}`));
  page.on('unhandledrejection', (reason) => run.pageErrors.push(`unhandledrejection: ${String(reason)}`));
  page.on('console', (message) => {
    if (run.consoleLines.length >= MAX_CONSOLE_LINES) return;
    run.consoleLines.push(`[${message.type()}] ${message.text()}`);
  });
  page.on('request', (request) => {
    if (run.network.length >= MAX_NETWORK_ENTRIES) return;
    run.network.push({
      kind: 'request',
      method: request.method(),
      url: request.url(),
      atWallMs: Date.now() - run.wallStart,
    });
  });
  page.on('response', (response) => {
    if (run.network.length >= MAX_NETWORK_ENTRIES) return;
    run.network.push({
      kind: 'response',
      status: response.status(),
      url: response.url(),
      atWallMs: Date.now() - run.wallStart,
    });
  });
  return { ctx, page };
}

// ---------------------------------------------------------------------------
// Page probes (one evaluate per decision tick: state + run-log slice +
// pools + read-only __game diagnostics + heap)
// ---------------------------------------------------------------------------

async function pollState(page, lastEventCount) {
  return page.evaluate((lastCount) => {
    const api = window.__ofeliyaTest;
    const state = api.readState();
    const runLog = api.getRunLog();
    const pools = api.debugPools();
    let diag = null;
    try {
      const game = window.__game;
      const gs = game ? game.scene.getScene('Game') : null;
      const run = gs && gs.runState ? gs.runState.run : null;
      const stage = gs && gs.runState ? gs.runState.stage : null;
      const ui = game ? game.scene.getScene('UI') : null;
      diag = {
        runResult: game ? (game.registry.get('runResult') ?? null) : null,
        kills: run ? run.kills : null,
        bossesDefeated: run ? run.bossesDefeated : null,
        hostCellsInfected: run ? run.hostCellsInfected : null,
        bossClearTimesMs: run && run.bossClearTimesMs ? { ...run.bossClearTimesMs } : null,
        legendaryIds: run && run.legendaryIds ? [...run.legendaryIds] : null,
        evolutionsSeen: run && run.evolutionsSeen ? [...run.evolutionsSeen] : null,
        level: stage ? stage.level : null,
        xp: stage ? stage.xp : null,
        xpNext: stage ? stage.xpNext : null,
        waveBoss: gs && gs.wave && gs.wave.boss
          ? { hp: gs.wave.boss.hp, maxHp: gs.wave.boss.maxHp }
          : null,
        stageTransitionToken: gs && gs.stageTransition ? gs.stageTransition.token : null,
        modalOpen: ui ? Boolean(ui.modalOpen) : null,
        milestonesActive: gs && gs.milestones && gs.milestones.active ? gs.milestones.active.size : null,
        joy: game ? (game.registry.get('joy') ?? null) : null,
        scenePaused: gs ? gs.scene.isPaused() : null,
      };
    } catch (error) {
      diag = { error: String(error) };
    }
    let heapMb = null;
    try {
      if (performance.memory) heapMb = performance.memory.usedJSHeapSize / 1048576;
    } catch {
      // performance.memory is Chrome-only; page.metrics() is the fallback.
    }
    return {
      state,
      newEvents: runLog.events.slice(lastCount),
      eventCount: runLog.events.length,
      inputHash: runLog.inputHash,
      stateHash: runLog.stateHash,
      pools,
      diag,
      heapMb,
    };
  }, lastEventCount);
}

async function applyInputAndAdvance(page, input, frames) {
  await page.evaluate(({ input: payload, frames: n }) => {
    const api = window.__ofeliyaTest;
    if (payload) api.setInput(payload);
    return api.advance(n);
  }, { input, frames });
}

async function readLocalStorage(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      out[key] = localStorage.getItem(key);
    }
    return out;
  });
}

async function readHeap(page) {
  const fromPage = await page.evaluate(() => {
    if (!performance.memory) return null;
    return {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    };
  });
  if (fromPage) return { ...fromPage, source: 'performance.memory' };
  const metrics = await page.metrics().catch(() => null);
  if (metrics) {
    return {
      usedJSHeapSize: metrics.JSHeapUsedSize,
      totalJSHeapSize: metrics.JSHeapTotalSize,
      jsHeapSizeLimit: metrics.JSHeapSizeLimit,
      source: 'page.metrics',
    };
  }
  return null;
}

/**
 * Game URL with the visual profile (Appendix C §5) and the QA render-split
 * selection (?qaHide=, src/game/qaHide.ts) passed as query parameters.
 */
function buildPageUrl(url, options) {
  const parsed = new URL(url);
  parsed.searchParams.set('ofeliyaVisualProfile', options.visualProfile);
  if (options.qaHide && options.qaHide.length > 0) {
    parsed.searchParams.set('qaHide', options.qaHide.join(','));
  }
  return parsed.toString();
}

// ---------------------------------------------------------------------------
// Renderer snapshots (Appendix C §1)
//
// Primary mechanism: window.__game.renderer.snapshot(cb) on WebGL
// (callback-based, fires on the NEXT render) and snapshotCanvas(canvas, cb)
// on Canvas (immediate). With RAF stopped, one synthetic step renders the
// next frame and fires the WebGL callback. No preserveDrawingBuffer is set
// anywhere — the snapshot reads pixels during the render itself.
//
// The handshake is folded into the loop's regular advance() so it consumes
// NO extra simulation frames: arm before the advance, collect after it.
// Only post-run shots (the run is already over) use an explicit advance(1).
// A composited page screenshot is kept only as a fallback when the renderer
// API is unavailable.
// ---------------------------------------------------------------------------

/**
 * Arm a renderer snapshot. Returns 'webgl' | 'canvas' when armed,
 * otherwise a reason string ('no-renderer' | 'no-api' | 'error').
 * The pending data URL lands on window.__harnessSnapshot (a promise).
 */
async function armRendererSnapshot(page) {
  return page.evaluate(() => {
    try {
      const game = window.__game;
      const renderer = game ? game.renderer : null;
      if (!renderer) {
        window.__harnessSnapshot = null;
        return 'no-renderer';
      }
      if (typeof renderer.snapshotCanvas === 'function') {
        // Canvas renderer: snapshotCanvas(game.canvas, cb) is immediate.
        window.__harnessSnapshot = new Promise((resolve) => {
          try {
            renderer.snapshotCanvas(game.canvas, (image) => resolve(image ? image.src : null));
          } catch {
            resolve(null);
          }
        });
        return 'canvas';
      }
      if (typeof renderer.snapshot === 'function') {
        // WebGL renderer: callback fires on the NEXT render.
        window.__harnessSnapshot = new Promise((resolve) => {
          try {
            renderer.snapshot((image) => resolve(image ? image.src : null));
          } catch {
            resolve(null);
          }
        });
        return 'webgl';
      }
      window.__harnessSnapshot = null;
      return 'no-api';
    } catch {
      window.__harnessSnapshot = null;
      return 'error';
    }
  });
}

/**
 * Collect an armed snapshot. Must be called after at least one render
 * since arming (the loop's regular advance provides it). Returns a PNG
 * Buffer, or null when the snapshot never materialized (guarded by a
 * wall-clock timeout so a missed render cannot hang the runner).
 */
async function collectRendererSnapshot(page, timeoutMs = 10000) {
  const dataUrl = await page.evaluate(async (timeout) => {
    const pending = window.__harnessSnapshot;
    window.__harnessSnapshot = null;
    if (!pending) return null;
    let timer = null;
    try {
      return await Promise.race([
        pending,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), timeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, timeoutMs);
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const base64 = dataUrl.split(',')[1];
  if (!base64) return null;
  return Buffer.from(base64, 'base64');
}

/**
 * One-shot snapshot outside the loop (post-run failure frames): arm, one
 * synthetic step to render (the run is over, so the extra frame is
 * harmless), collect. Falls back to a composited page screenshot.
 */
async function snapshotNow(page) {
  const armed = await armRendererSnapshot(page);
  if (armed === 'webgl') {
    try {
      await page.evaluate(() => window.__ofeliyaTest.advance(1));
    } catch {
      return null;
    }
    const buffer = await collectRendererSnapshot(page);
    if (buffer) return buffer;
  } else if (armed === 'canvas') {
    const buffer = await collectRendererSnapshot(page);
    if (buffer) return buffer;
  }
  try {
    return await page.screenshot();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drivers: bot vs replay. Both answer decide(snapshot, tick) with
// { input, choices, ack } — the loop applies them identically, so bot runs
// and replays share tick coordinates, markers, invariants and artifacts.
// ---------------------------------------------------------------------------

class BotDriver {
  constructor({ seed, difficulty }) {
    this.bot = new CampaignBot({ seed, difficulty });
    this.ackedTransition = false;
    this.lastPhase = null;
  }

  // The loop calls decideAt() (tick-aware).
  decideAt(snapshot, tick) {
    const decision = this.bot.decide(snapshot, tick);
    const choices = [];
    if (snapshot.awaitingChoice && snapshot.pendingChoices.length > 0) {
      choices.push(this.bot.chooseUpgrade(snapshot));
    }
    let ack = false;
    if (snapshot.phase === 'STAGE_TRANSITION') {
      if (!this.ackedTransition) {
        ack = true;
        this.ackedTransition = true;
      }
    } else {
      this.ackedTransition = false;
    }
    this.lastPhase = snapshot.phase;
    return {
      input: { moveX: decision.move.x, moveY: decision.move.y, aimX: decision.aim.x, aimY: decision.aim.y },
      choices,
      ack,
      botEvents: decision.events,
      botDebug: decision.debug,
    };
  }
}

class ReplayDriver {
  constructor(plan) {
    this.plan = plan;
    this.inputByTick = new Map(plan.inputs.map((entry) => [entry.tick, entry]));
    this.choicesByTick = new Map();
    for (const entry of plan.choices) {
      if (!this.choicesByTick.has(entry.tick)) this.choicesByTick.set(entry.tick, []);
      this.choicesByTick.get(entry.tick).push(entry);
    }
    this.transitionTicks = new Set(plan.transitions.map((entry) => entry.tick));
    this.appliedInputs = new Set();
    this.appliedChoices = new Set();
    this.appliedTransitions = new Set();
    this.lastInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
    const lastEventTick = Math.max(
      0,
      ...plan.inputs.map((e) => e.tick),
      ...plan.choices.map((e) => e.tick),
      ...plan.transitions.map((e) => e.tick),
    );
    // End at the recorded run's final tick when known, so the hash
    // comparison is tick-anchored. Only legacy files without finalTick
    // fall back to last-event + tail (and then no hash comparison runs).
    this.endTick = plan.finalTick !== null && plan.finalTick !== undefined
      ? plan.finalTick
      : lastEventTick + REPLAY_TAIL_FRAMES;
  }

  decideAt(snapshot, tick) {
    // Apply every event whose tick has come (normally exactly == tick; the
    // <= comparison tolerates hand-written logs with non-6-aligned ticks).
    let input = null;
    for (const [at, entry] of this.inputByTick) {
      if (at <= tick && !this.appliedInputs.has(at)) {
        this.appliedInputs.add(at);
        input = {
          moveX: entry.move[0],
          moveY: entry.move[1],
          aimX: entry.aim ? entry.aim[0] : undefined,
          aimY: entry.aim ? entry.aim[1] : undefined,
        };
        this.lastInput = {
          moveX: input.moveX,
          moveY: input.moveY,
          aimX: input.aimX ?? this.lastInput.aimX,
          aimY: input.aimY ?? this.lastInput.aimY,
        };
      }
    }
    const choices = [];
    for (const [at, entries] of this.choicesByTick) {
      if (at <= tick && !this.appliedChoices.has(at)) {
        this.appliedChoices.add(at);
        for (const entry of entries) choices.push(entry.id);
      }
    }
    let ack = false;
    for (const at of this.transitionTicks) {
      if (at <= tick && !this.appliedTransitions.has(at)) {
        this.appliedTransitions.add(at);
        ack = true;
      }
    }
    return { input, choices, ack, botEvents: [], botDebug: null };
  }
}

// ---------------------------------------------------------------------------
// Timeline (§6.4), invariants (§4.2–§4.3), watchdog (§4.4)
// ---------------------------------------------------------------------------

// --until aliases to timeline events.
const UNTIL_ALIASES = {
  'first-boss': { event: 'BOSS_ACTIVE' },
  heart: { event: 'STAGE_CHANGED', to: 'heart' },
  victory: { event: 'CAMPAIGN_VICTORY' },
  defeat: { event: 'RUN_END', terminal: 'defeat' },
};

function untilMatches(until, marker) {
  if (!until) return false;
  const alias = UNTIL_ALIASES[until];
  if (alias) {
    if (marker.event !== alias.event) return false;
    if (alias.to !== undefined && marker.to !== alias.to) return false;
    if (alias.terminal !== undefined && marker.terminal !== alias.terminal) return false;
    return true;
  }
  return marker.event === until;
}

class Timeline {
  constructor() {
    this.entries = [];
  }

  push(event, ctx) {
    const entry = {
      tick: ctx.tick,
      simulationTimeMs: ctx.simulationTimeMs,
      wallTimeMs: Date.now() - ctx.wallStart,
      stage: ctx.state.stageId || 'unknown',
      phase: ctx.state.phase || 'unknown',
      player: ctx.state.player
        ? { x: ctx.state.player.x, y: ctx.state.player.y, hp: ctx.state.player.hp, maxHp: ctx.state.player.maxHp }
        : null,
      boss: ctx.state.boss
        ? { kind: ctx.state.boss.kind, hp: ctx.state.boss.hp, maxHp: ctx.state.boss.maxHp, x: ctx.state.boss.x, y: ctx.state.boss.y }
        : null,
      waveId: null, // Not observable: WaveDirector exposes no wave id (§4.4 divergence).
      input: ctx.lastInput
        ? { move: [ctx.lastInput.moveX, ctx.lastInput.moveY], aim: [ctx.lastInput.aimX ?? 0, ctx.lastInput.aimY ?? 0] }
        : null,
      event,
      ...(ctx.extra || {}),
    };
    if (ctx.perf) entry.perf = ctx.perf;
    this.entries.push(entry);
    return entry;
  }

  toNdjson() {
    return `${this.entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
  }
}

class Invariants {
  constructor() {
    this.results = new Map(); // id -> { passed, expected, actual, firstFailAt }
  }

  check(id, passed, { expected, actual, failAt }) {
    const prev = this.results.get(id);
    if (prev && !prev.passed) return prev; // First failure sticks.
    if (passed) {
      if (!prev) {
        this.results.set(id, { passed: true, expected, actual: actual ?? 'holds' });
      }
      return this.results.get(id);
    }
    const record = {
      passed: false,
      expected,
      actual: actual ?? 'violated',
      firstFailAt: failAt ?? null,
    };
    this.results.set(id, record);
    return record;
  }

  allPassed() {
    for (const record of this.results.values()) {
      if (!record.passed) return false;
    }
    return true;
  }

  failedIds() {
    return [...this.results.entries()].filter(([, r]) => !r.passed).map(([id]) => id);
  }

  toJson() {
    const out = {};
    for (const [id, record] of this.results) out[id] = { ...record };
    return out;
  }
}

// ---------------------------------------------------------------------------
// One campaign run
// ---------------------------------------------------------------------------

async function runCampaign(browser, options, runIndex, seriesState) {
  const isReplay = Boolean(options.replayPlan);
  const seed = isReplay ? options.replayPlan.seed : seedForRun(options, runIndex);
  const difficulty = isReplay ? options.replayPlan.difficulty : options.difficulty;
  const runId = `${seed}-${runIndex + 1}`;
  const runDir = path.join(options.out, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const run = {
    runId,
    seed,
    difficulty,
    wallStart: Date.now(),
    pageErrors: [],
    consoleLines: [],
    network: [],
    apiCalls: [],
    scoreSubmission: null,
    scoreServer: null,
  };
  const timeline = new Timeline();
  const invariants = new Invariants();
  const wallStart = run.wallStart;

  // Input log (§2.4). In replay mode the log is written back verbatim (plus
  // the hashes the replay actually produced).
  const inputLog = isReplay
    ? {
        version: 1,
        seed,
        difficulty,
        inputs: options.replayPlan.inputs.map((e) => ({ ...e })),
        choices: options.replayPlan.choices.map((e) => ({ ...e })),
        transitions: options.replayPlan.transitions.map((e) => ({ ...e })),
      }
    : { version: 1, seed, difficulty, inputs: [], choices: [], transitions: [] };
  const snapshots = [];

  // Run state carried across ticks.
  const st = {
    tick: 0,
    lastEventCount: 0,
    lastInput: null, // Last vector actually applied to the game.
    lastPhase: null,
    lastStageId: null,
    lastBossTelegraph: false,
    lastBossPhase: null,
    lastHostCells: [],
    lastKills: null,
    lastHostInfected: null,
    lastRunTimeMs: null,
    bossesDefeatedAtTransition: null,
    transitionFrom: null,
    lastTransition: null,
    legendariesBeforeFirstBoss: 0,
    firstBossDead: false,
    runStartSeed: null,
    runStartDifficulty: null,
    runStartOrder: null,
    runEnded: false,
    runResult: null,
    untilReached: false,
    untilMarker: null,
    failure: null,
    watchdog: null,
    lastStateHash: null,
    stateHashSamples: [], // { tick, hash } — stall detection.
    lastProgressTick: 0, // Last tick where (enemies, kills, stageTime) moved.
    lastProgressKey: null,
    bossZeroHpSinceTick: null,
    transitionSinceTick: null,
    deathSinceTick: null,
    stageScreenshots: [],
    ringScreenshots: [], // Last 2 frames (2 s cadence) for the t-2s shot.
    pendingShot: null, // Armed renderer snapshot, collected after the next advance.
    lastScreenshotTick: -SCREENSHOT_INTERVAL_FRAMES,
    lastPerfTick: 0,
    lastSnapshotTick: 0,
    degradedNoted: false,
    chunkWallEmaMs: null,
    lastProgressLogTick: 0,
    lastProgressLogWall: Date.now(),
    choicesMade: 0,
    transitionsAcked: 0,
    botStuckCount: 0,
    dwellCount: 0,
    heartSyncSuccesses: 0,
    heartSyncMisses: 0,
    nanCount: 0,
    infiniteCount: 0,
    stalledWaves: 0,
    poolsBaseline: null,
    heapBefore: null,
    heapAfter: null,
    saveBefore: null,
    saveAfter: null,
    outboxAfter: null,
    finalState: null,
    finalDiag: null,
    finalPools: null,
    finalHashes: { inputHash: null, stateHash: null },
    audioState: null,
  };

  const driver = isReplay
    ? new ReplayDriver(options.replayPlan)
    : new BotDriver({ seed, difficulty });

  const ctxFor = (state, extra, perf) => ({
    tick: st.tick,
    simulationTimeMs: state.runTimeMs,
    wallStart,
    state,
    lastInput: st.lastInput,
    extra,
    perf,
  });

  function markInvariantFail(id, state, detail) {
    const failAt = {
      tick: st.tick,
      gameMs: state.runTimeMs,
      wallMs: Date.now() - wallStart,
      wallEstimated: false,
    };
    timeline.push('INVARIANT_FAIL', ctxFor(state, { invariantId: id, detail }));
    return failAt;
  }

  function checkFiniteNumbers(state) {
    const values = [
      ['player.x', state.player.x],
      ['player.y', state.player.y],
      ['player.hp', state.player.hp],
      ['player.maxHp', state.player.maxHp],
      ['stageTimeMs', state.stageTimeMs],
      ['runTimeMs', state.runTimeMs],
    ];
    if (state.boss) {
      values.push(
        ['boss.x', state.boss.x],
        ['boss.y', state.boss.y],
        ['boss.hp', state.boss.hp],
        ['boss.maxHp', state.boss.maxHp],
      );
    }
    for (const [field, value] of values) {
      if (typeof value !== 'number') continue;
      if (Number.isNaN(value)) st.nanCount += 1;
      else if (!Number.isFinite(value)) st.infiniteCount += 1;
      else continue;
      invariants.check('finiteNumbers', false, {
        expected: 'hp, maxHp, xp, coordinates, velocities, timers, score all finite',
        actual: `${field}=${value}`,
        failAt: markInvariantFail('finiteNumbers', state, `${field}=${value}`),
      });
      return;
    }
    invariants.check('finiteNumbers', true, {
      expected: 'hp, maxHp, xp, coordinates, velocities, timers, score all finite',
    });
  }

  function checkMonotonic(state, diag) {
    if (!diag || diag.error) return;
    const pairs = [
      ['kills', diag.kills, st.lastKills],
      ['hostCellsInfected', diag.hostCellsInfected, st.lastHostInfected],
      ['runTimeMs', state.runTimeMs, st.lastRunTimeMs],
    ];
    for (const [name, value, prev] of pairs) {
      if (value === null || value === undefined || prev === null || prev === undefined) continue;
      if (value < prev) {
        invariants.check('monotonicCounters', false, {
          expected: 'kills, timeMs, hostCellsInfected never decrease',
          actual: `${name} ${prev} -> ${value}`,
          failAt: markInvariantFail('monotonicCounters', state, `${name} ${prev} -> ${value}`),
        });
        return;
      }
    }
    if (diag.kills !== null && diag.kills !== undefined) st.lastKills = diag.kills;
    if (diag.hostCellsInfected !== null && diag.hostCellsInfected !== undefined) {
      st.lastHostInfected = diag.hostCellsInfected;
    }
    st.lastRunTimeMs = state.runTimeMs;
    invariants.check('monotonicCounters', true, {
      expected: 'kills, timeMs, hostCellsInfected never decrease',
    });
  }

  function checkTransitionInvariants(state, diag, from, to) {
    // Stage order: bloodstream (1) -> heart (2); seed/difficulty agree.
    const orderOk = st.runStartOrder !== null
      ? state.stageOrder === st.runStartOrder + 1
      : state.stageOrder === 2;
    const idsOk = from === 'bloodstream' && to === 'heart';
    const seedOk = state.runSeed === st.runStartSeed && state.difficultyId === st.runStartDifficulty;
    const orderPassed = orderOk && idsOk && seedOk;
    invariants.check('stageOrder', orderPassed, {
      expected: 'bloodstream → immune-prime → heart → cardiac-titan; stageOrder / stageId / difficultyId / runSeed agree',
      actual: orderPassed
        ? `${from} -> ${to} order=${state.stageOrder}`
        : `${from} -> ${to} order=${state.stageOrder} seed=${state.runSeed} difficulty=${state.difficultyId}`,
      failAt: orderPassed ? undefined : markInvariantFail('stageOrder', state, `${from} -> ${to}`),
    });
    st.lastTransition = { from, to, atMs: state.runTimeMs };
    // bossesDefeated +1 per transition.
    if (diag && !diag.error && st.bossesDefeatedAtTransition !== null && diag.bossesDefeated !== null) {
      const delta = diag.bossesDefeated - st.bossesDefeatedAtTransition;
      invariants.check('bossDefeatCount', delta === 1, {
        expected: 'bossesDefeated increases by exactly 1 per transition',
        actual: `bossesDefeated ${st.bossesDefeatedAtTransition} -> ${diag.bossesDefeated} (delta ${delta})`,
        failAt: delta === 1 ? undefined : markInvariantFail('bossDefeatCount', state, `delta=${delta}`),
      });
    }
    // Cleanup: wave.boss null, no telegraphs, no dangling transition token.
    const bossGone = !diag || diag.error || diag.waveBoss === null;
    const telegraphsGone = state.telegraphs.length === 0;
    const tokenGone = !diag || diag.error || diag.stageTransitionToken === null;
    const cleanupPassed = bossGone && telegraphsGone && tokenGone;
    invariants.check('cleanupAfterTransition', cleanupPassed, {
      expected: 'old enemies, bullets, gems, timers, telegraphs inactive; wave.boss === null; no dangling transition token',
      actual: cleanupPassed
        ? 'wave.boss null, no telegraphs, no transition token'
        : `waveBoss=${JSON.stringify(diag?.waveBoss ?? null)} telegraphs=${state.telegraphs.length} token=${diag?.stageTransitionToken ?? null}`,
      failAt: cleanupPassed ? undefined : markInvariantFail('cleanupAfterTransition', state, 'leftovers after transition'),
    });
  }

  function checkLegendaryCap(state, diag) {
    if (!diag || diag.error || !Array.isArray(diag.legendaryIds)) return;
    const count = diag.legendaryIds.length;
    invariants.check('legendaryCap', count <= 2, {
      expected: '≤ 2 legendaries per run, ≤ 1 random legendary before the first boss',
      actual: `${count} legendaries: ${diag.legendaryIds.join(', ') || 'none'}`,
      failAt: count <= 2 ? undefined : markInvariantFail('legendaryCap', state, `legendaries=${count}`),
    });
    if (!st.firstBossDead && st.legendariesBeforeFirstBoss > 1) {
      invariants.check('legendaryCap', false, {
        expected: '≤ 2 legendaries per run, ≤ 1 random legendary before the first boss',
        actual: `${st.legendariesBeforeFirstBoss} random legendaries before the first boss`,
        failAt: markInvariantFail('legendaryCap', state, 'too many pre-boss legendaries'),
      });
    }
  }

  // Score server first (fresh store per run), then the browser page.
  const scorePort = options.scorePort || (await getFreePort());
  const baseOrigin = new URL(options.url).origin;
  run.scoreServer = await startScoreServer({
    port: scorePort,
    dataDir: path.join(options.out, '.score-store', runId),
    origin: baseOrigin,
  });
  log(`run ${runId}: seed=${seed} difficulty=${difficulty} score-server=127.0.0.1:${scorePort}`);

  let ctx = null;
  let page = null;
  try {
    ({ ctx, page } = await makeRunContext(browser, options, run));
    await page.goto(buildPageUrl(options.url, options), { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => typeof window.__ofeliyaTest?.startCampaign === 'function',
        null,
        { timeout: 60000 },
      );
    } catch {
      const err = new Error(
        'HARNESS_API_MISSING: window.__ofeliyaTest is not installed in the served build. ' +
          'Serve a dev build, or a QA build with VITE_QA_TOOLS=1.',
      );
      err.code = 'HARNESS_API_MISSING';
      throw err;
    }
    const apiVersion = await page.evaluate(() => window.__ofeliyaTest.version);
    if (apiVersion !== 1) fail(`unsupported __ofeliyaTest version: ${apiVersion} (expected 1)`);
    await page.waitForFunction(
      () => window.__game?.scene.isActive('Menu'),
      null,
      { timeout: 60000 },
    );

    st.heapBefore = await readHeap(page);
    st.saveBefore = await readLocalStorage(page);
    // No user gesture happens on the harness start path (startCampaign
    // bypasses the menu tap), so the AudioContext is expected to be
    // 'suspended' here; the context count is not observable from the
    // harness, so audio is recorded as a diagnostic, not an invariant.
    st.audioState = 'not-observable';

    // Pause BEFORE startCampaign: with RAF alive, a wall-dependent number
    // of frames would run before startCampaign returns, and the input-log
    // tick coordinate would drift between runs (track-A determinism probe
    // pattern). Stepped runs stay stepped until the run ends.
    await page.evaluate(() => window.__ofeliyaTest.pause());
    await page.evaluate(
      ({ seed: s, difficulty: d }) => window.__ofeliyaTest.startCampaign({ seed: s, difficulty: d }),
      { seed, difficulty },
    );

    // --- main decision loop -------------------------------------------------
    const loopWallStart = Date.now();
    let lastPoll = null;
    while (true) {
      const tickWallStart = Date.now();
      const poll = await pollState(page, st.lastEventCount);
      st.lastEventCount = poll.eventCount;
      st.finalHashes = { inputHash: poll.inputHash, stateHash: poll.stateHash };
      st.finalState = poll.state;
      st.finalDiag = poll.diag;
      st.finalPools = poll.pools;
      lastPoll = poll;
      const state = poll.state;
      const diag = poll.diag;

      // --- run-log events -> timeline markers -------------------------------
      for (const event of poll.newEvents) {
        if (event.type === 'RUN_START') {
          st.runStartSeed = event.seed ?? state.runSeed;
          st.runStartDifficulty = event.difficulty ?? state.difficultyId;
          st.runStartOrder = state.stageOrder;
          st.poolsBaseline = { ...poll.pools };
          timeline.push('RUN_START', ctxFor(state, {
            seed: st.runStartSeed, difficulty: st.runStartDifficulty, mode: isReplay ? 'replay' : 'bot',
          }));
          timeline.push('STAGE_START', ctxFor(state, { stage: state.stageId }));
        } else if (event.type === 'PHASE_CHANGED') {
          if (event.to === 'BOSS_ACTIVE') {
            timeline.push('BOSS_ACTIVE', ctxFor(state, { boss: state.boss?.kind }));
          } else if (event.to === 'STAGE_TRANSITION') {
            st.transitionFrom = state.stageId;
            st.transitionSinceTick = st.tick;
            if (diag && !diag.error) st.bossesDefeatedAtTransition = diag.bossesDefeated;
            timeline.push('STAGE_END', ctxFor(state, { stage: state.stageId }));
          } else if (event.to === 'BOSS_DEFEATED') {
            timeline.push('BOSS_DEFEATED', ctxFor(state, { boss: state.boss?.kind }));
          }
        } else if (event.type === 'STAGE_CHANGED') {
          timeline.push('STAGE_CHANGED', ctxFor(state, { from: event.from, to: event.to }));
          timeline.push('STAGE_START', ctxFor(state, { stage: event.to }));
          checkTransitionInvariants(state, diag, event.from, event.to);
          st.transitionSinceTick = null;
          // Stage screenshot (§6.2): arm a renderer snapshot, collected
          // after this iteration's advance (no extra frames). If a ring
          // shot is already pending, fall back to a composited screenshot
          // rather than orphaning it (one snapshot per frame).
          try {
            if (!st.pendingShot) {
              const armed = await armRendererSnapshot(page);
              if (armed === 'webgl' || armed === 'canvas') {
                st.pendingShot = { kind: 'stage', to: event.to };
              } else {
                await page.screenshot({ path: path.join(runDir, `stage-${event.to}.png`) });
                st.stageScreenshots.push(`stage-${event.to}.png`);
              }
            } else {
              await page.screenshot({ path: path.join(runDir, `stage-${event.to}.png`) });
              st.stageScreenshots.push(`stage-${event.to}.png`);
            }
          } catch (error) {
            warn(`stage screenshot failed: ${error.message}`);
          }
        } else if (event.type === 'BOSS_SPAWN') {
          timeline.push('BOSS_SPAWN', ctxFor(state, { boss: { kind: event.boss } }));
        } else if (event.type === 'BOSS_DEATH') {
          if (event.boss === 'immune-prime') st.firstBossDead = true;
          timeline.push('BOSS_DEATH', ctxFor(state, { boss: { kind: event.boss } }));
        } else if (event.type === 'CHOICE_OFFERED') {
          timeline.push('LEVEL_UP', ctxFor(state, { choices: event.choices }));
        } else if (event.type === 'MUTATION_SELECTED') {
          if (typeof event.id === 'string' && event.id.startsWith('legendary:') && !st.firstBossDead) {
            st.legendariesBeforeFirstBoss += 1;
          }
          timeline.push('MUTATION_SELECTED', ctxFor(state, {
            choiceId: event.id, kind: event.kind,
            legendaryId: event.legendaryId ?? null, evolutionId: event.evolutionId ?? null,
          }));
        } else if (event.type === 'TRANSITION_ACK') {
          timeline.push('TRANSITION_ACK', ctxFor(state, { token: event.token }));
        } else if (event.type === 'RUN_END') {
          st.runEnded = true;
          st.runResult = diag && !diag.error ? diag.runResult : null;
          timeline.push('RUN_END', ctxFor(state, { reason: event.reason, win: event.win, terminal: event.reason }));
          if (event.win === true && event.reason === 'campaign-complete') {
            timeline.push('CAMPAIGN_VICTORY', ctxFor(state, { terminal: 'victory' }));
          }
        }
      }

      // --- state-diff markers -------------------------------------------------
      const telegraphNow = Boolean(state.boss && state.boss.telegraph === 'telegraph');
      if (telegraphNow && !st.lastBossTelegraph) {
        timeline.push('BOSS_TELEGRAPH', ctxFor(state, {}));
      }
      st.lastBossTelegraph = telegraphNow;
      if (state.boss && state.boss.bossPhase !== st.lastBossPhase) {
        if (st.lastBossPhase !== null) {
          timeline.push('BOSS_PHASE_CHANGED', ctxFor(state, { bossPhase: state.boss.bossPhase }));
        }
        st.lastBossPhase = state.boss.bossPhase;
      }
      if (!state.boss) st.lastBossPhase = null;
      // Host-cell infection / lysis, matched by position (cells have no ids).
      const prevCells = st.lastHostCells;
      for (const cell of state.hostCells) {
        const prev = prevCells.find((c) => Math.abs(c.x - cell.x) < 5 && Math.abs(c.y - cell.y) < 5);
        if (prev && prev.infection < 1 && cell.infection >= 1) {
          timeline.push('HOST_CELL_INFECTED', ctxFor(state, { x: cell.x, y: cell.y }));
        }
      }
      for (const prev of prevCells) {
        const now = state.hostCells.find((c) => Math.abs(c.x - prev.x) < 5 && Math.abs(c.y - prev.y) < 5);
        if (!now && prev.active && prev.infection >= 1) {
          timeline.push('HOST_CELL_LYSIS', ctxFor(state, { x: prev.x, y: prev.y }));
        }
      }
      st.lastHostCells = state.hostCells.map((c) => ({ x: c.x, y: c.y, active: c.active, infection: c.infection }));

      // --- per-tick invariants --------------------------------------------------
      checkFiniteNumbers(state);
      checkMonotonic(state, diag);
      checkLegendaryCap(state, diag);

      // --- terminal conditions ----------------------------------------------------
      if (st.runEnded || (diag && !diag.error && diag.runResult)) {
        st.runEnded = true;
        st.runResult = (diag && !diag.error ? diag.runResult : null) || st.runResult;
        break;
      }
      if (st.tick >= options.maxFrames) {
        st.watchdog = { code: 'TIMEOUT', message: `max frames reached (${options.maxFrames})` };
        timeline.push('TIMEOUT', ctxFor(state, { reason: 'max-frames' }));
        break;
      }
      if (Date.now() - loopWallStart > options.wallTimeoutMs) {
        st.watchdog = { code: 'TIMEOUT', message: `max wall time reached (${options.wallTimeoutMs} ms)` };
        timeline.push('TIMEOUT', ctxFor(state, { reason: 'max-wall-time' }));
        break;
      }
      if (isReplay && st.tick >= driver.endTick) break;

      // --- watchdog: state-hash stall ----------------------------------------------
      if (st.tick - (st.stateHashSamples[st.stateHashSamples.length - 1]?.tick ?? -STATE_HASH_SAMPLE_FRAMES) >= STATE_HASH_SAMPLE_FRAMES) {
        st.stateHashSamples.push({ tick: st.tick, hash: poll.stateHash });
        if (st.stateHashSamples.length > STATE_HASH_STALL_SAMPLES) st.stateHashSamples.shift();
        const combatPhase = state.phase === 'PLAYING' || state.phase === 'BOSS_WARNING' || state.phase === 'BOSS_ACTIVE';
        if (
          combatPhase
          && st.stateHashSamples.length === STATE_HASH_STALL_SAMPLES
          && st.stateHashSamples.every((s) => s.hash === st.stateHashSamples[0].hash)
        ) {
          invariants.check('stateHashAdvancing', false, {
            expected: 'stateHash changes while gameplay is active',
            actual: `stateHash unchanged for ${STATE_HASH_STALL_SAMPLES * STATE_HASH_SAMPLE_FRAMES} frames`,
            failAt: markInvariantFail('stateHashAdvancing', state, 'hash stalled'),
          });
          st.watchdog = { code: 'TIMEOUT', message: 'stateHash did not change while gameplay was active' };
          timeline.push('TIMEOUT', ctxFor(state, { reason: 'state-hash-stalled' }));
          break;
        }
        invariants.check('stateHashAdvancing', true, {
          expected: 'stateHash changes while gameplay is active',
        });
      }

      // --- watchdog: wave / progress stall ------------------------------------------
      const progressKey = JSON.stringify([
        state.enemies.length,
        diag && !diag.error ? diag.kills : null,
        state.stageTimeMs,
        state.phase,
      ]);
      if (progressKey !== st.lastProgressKey) {
        st.lastProgressKey = progressKey;
        st.lastProgressTick = st.tick;
        invariants.check('waveProgressing', true, {
          expected: 'waveId / aliveCount change within the watchdog interval',
        });
      } else if (
        (state.phase === 'PLAYING' || state.phase === 'BOSS_ACTIVE')
        && st.tick - st.lastProgressTick >= WAVE_STALL_FRAMES
      ) {
        st.stalledWaves += 1;
        invariants.check('waveProgressing', false, {
          expected: 'waveId / aliveCount change within the watchdog interval',
          actual: `no enemy/kill/stage-time change for ${WAVE_STALL_FRAMES} frames`,
          failAt: markInvariantFail('waveProgressing', state, 'wave stalled'),
        });
        timeline.push('WAVE_STALL', ctxFor(state, { enemies: state.enemies.length }));
        st.watchdog = { code: 'WAVE_STALL', message: 'no wave progress for 20 s of simulation' };
        break;
      } else {
        invariants.check('waveProgressing', true, {
          expected: 'waveId / aliveCount change within the watchdog interval',
        });
      }

      // --- watchdog: boss at 0 HP without a transition --------------------------------
      if (state.boss && state.boss.hp <= 0) {
        if (st.bossZeroHpSinceTick === null) st.bossZeroHpSinceTick = st.tick;
        if (st.tick - st.bossZeroHpSinceTick >= BOSS_ZERO_HP_FRAMES) {
          invariants.check('bossZeroHpVictory', false, {
            expected: 'boss at 0 HP always triggers the victory transition',
            actual: `boss ${state.boss.kind} at 0 HP for ${BOSS_ZERO_HP_FRAMES} frames, phase still ${state.phase}`,
            failAt: markInvariantFail('bossZeroHpVictory', state, 'boss 0 HP, no transition'),
          });
          st.watchdog = { code: 'BOSS_ZERO_HP', message: `boss ${state.boss.kind} at 0 HP without a transition` };
          break;
        }
      } else {
        st.bossZeroHpSinceTick = null;
        invariants.check('bossZeroHpVictory', true, {
          expected: 'boss at 0 HP always triggers the victory transition',
        });
      }

      // --- watchdog: transition / death without progress ------------------------------
      if (state.phase === 'STAGE_TRANSITION' && st.transitionSinceTick !== null
        && st.tick - st.transitionSinceTick >= TRANSITION_TIMEOUT_FRAMES) {
        st.watchdog = { code: 'TIMEOUT', message: 'stage transition did not commit within 10 s of simulation' };
        timeline.push('TIMEOUT', ctxFor(state, { reason: 'transition-timeout' }));
        break;
      }
      if (state.player.hp <= 0 && state.phase !== 'RUN_ENDED') {
        if (st.deathSinceTick === null) st.deathSinceTick = st.tick;
        if (st.tick - st.deathSinceTick >= BOSS_ZERO_HP_FRAMES) {
          st.watchdog = { code: 'DEATH_NO_RUN_END', message: 'player at 0 HP without RUN_ENDED for 5 s of simulation' };
          break;
        }
      } else {
        st.deathSinceTick = null;
      }

      // --- --until ---------------------------------------------------------------------
      if (options.until) {
        // Check all markers emitted this tick (walk back to the tick start).
        for (let i = timeline.entries.length - 1; i >= 0; i -= 1) {
          const marker = timeline.entries[i];
          if (marker.tick !== st.tick) break;
          if (untilMatches(options.until, marker)) {
            st.untilReached = true;
            st.untilMarker = marker.event;
            break;
          }
        }
        if (st.untilReached) break;
      }

      // --- decide + apply ---------------------------------------------------------------
      const decision = driver.decideAt(state, st.tick);
      for (const botEvent of decision.botEvents || []) {
        if (botEvent === 'BOT_STUCK') {
          st.botStuckCount += 1;
          timeline.push('BOT_STUCK', ctxFor(state, { stuckCount: st.botStuckCount }));
        } else if (botEvent === 'BOT_DWELL') {
          st.dwellCount += 1;
          timeline.push('BOT_DWELL', ctxFor(state, { dwellCount: st.dwellCount }));
        } else if (botEvent === 'HEART_SYNC_SUCCESS') {
          st.heartSyncSuccesses += 1;
          timeline.push('HEART_SYNC_SUCCESS', ctxFor(state, {}));
        } else if (botEvent === 'HEART_SYNC_MISSED') {
          st.heartSyncMisses += 1;
          timeline.push('HEART_SYNC_MISSED', ctxFor(state, {}));
        }
      }

      // Mutation choices: resolve BEFORE advancing — a level-up pauses the
      // Game scene, so advancing first would burn frames with the run clock
      // frozen (track A note: the runner MUST resolve choices while stepping).
      for (const choiceId of decision.choices) {
        try {
          await page.evaluate((id) => window.__ofeliyaTest.chooseUpgrade(id), choiceId);
        } catch (error) {
          if (isReplay) {
            st.failure = {
              code: 'REPLAY_DIVERGED',
              message: `choice ${choiceId} at tick ${st.tick} could not be applied: ${error.message}`,
            };
          } else {
            throw new Error(`chooseUpgrade(${choiceId}) failed at tick ${st.tick}: ${error.message}`);
          }
          break;
        }
        st.choicesMade += 1;
        if (!isReplay) inputLog.choices.push({ tick: st.tick, id: choiceId });
      }
      if (st.failure) break;

      // Stage transition ack: immediately on entering STAGE_TRANSITION. The
      // ack reschedules the commit to earliestCommitAt (+350 ms sim), which
      // keeps the transition deterministic — without it the commit waits for
      // the 2.4 s guard timer or a wall-clock video-end callback.
      if (decision.ack) {
        try {
          await page.evaluate(() => window.__ofeliyaTest.acknowledgeTransition());
          st.transitionsAcked += 1;
          if (!isReplay) inputLog.transitions.push({ tick: st.tick });
        } catch (error) {
          // The transition may have auto-committed already (guard timer);
          // the watchdog catches a transition that never commits.
          warn(`acknowledgeTransition failed at tick ${st.tick}: ${error.message}`);
        }
      }

      // Input: apply only on change (piecewise-constant log, §2.4). A phase
      // change resets the comparison: the game itself clears registry 'joy'
      // on stage transitions, so a stale "unchanged" vector would leave the
      // player standing still.
      let inputToApply = null;
      if (decision.input) {
        const phaseChanged = state.phase !== st.lastPhase || state.stageId !== st.lastStageId;
        const prev = phaseChanged ? null : st.lastInput;
        const next = {
          moveX: decision.input.moveX,
          moveY: decision.input.moveY,
          aimX: decision.input.aimX ?? (prev ? prev.aimX : 0),
          aimY: decision.input.aimY ?? (prev ? prev.aimY : 0),
        };
        const changed = !prev
          || Math.abs(next.moveX - prev.moveX) > 1e-6
          || Math.abs(next.moveY - prev.moveY) > 1e-6
          || Math.abs(next.aimX - prev.aimX) > 1e-6
          || Math.abs(next.aimY - prev.aimY) > 1e-6;
        if (changed) {
          inputToApply = next;
          st.lastInput = { ...next };
          if (!isReplay) {
            inputLog.inputs.push({
              tick: st.tick,
              move: [next.moveX, next.moveY],
              aim: [next.aimX, next.aimY],
            });
          }
        }
      }
      st.lastPhase = state.phase;
      st.lastStageId = state.stageId;

      await applyInputAndAdvance(page, inputToApply, DECISION_FRAMES);
      st.tick += DECISION_FRAMES;

      // --- collect an armed renderer snapshot -------------------------------------
      // Armed earlier this iteration (stage shot) or in the previous one
      // (ring shot); the advance above rendered the frame that fires it.
      if (st.pendingShot) {
        const shot = st.pendingShot;
        st.pendingShot = null;
        let buffer = null;
        try {
          buffer = await collectRendererSnapshot(page);
        } catch (error) {
          warn(`snapshot collect failed: ${error.message}`);
        }
        if (!buffer) {
          try {
            buffer = await page.screenshot();
          } catch {
            buffer = null;
          }
        }
        if (buffer) {
          if (shot.kind === 'ring') {
            st.ringScreenshots.push({ tick: shot.tick, runTimeMs: shot.runTimeMs, buffer });
            if (st.ringScreenshots.length > 2) st.ringScreenshots.shift();
          } else if (shot.kind === 'stage') {
            fs.writeFileSync(path.join(runDir, `stage-${shot.to}.png`), buffer);
            st.stageScreenshots.push(`stage-${shot.to}.png`);
          }
        }
      }

      // --- periodic sampling --------------------------------------------------------------
      // Arm the next ring shot when due (2 s cadence); it is collected
      // after the NEXT advance, so the handshake costs zero extra frames.
      if (st.tick - st.lastScreenshotTick >= SCREENSHOT_INTERVAL_FRAMES && !st.pendingShot) {
        st.lastScreenshotTick = st.tick;
        try {
          const armed = await armRendererSnapshot(page);
          if (armed === 'webgl' || armed === 'canvas') {
            st.pendingShot = { kind: 'ring', tick: st.tick, runTimeMs: state.runTimeMs };
          } else {
            const buffer = await page.screenshot();
            st.ringScreenshots.push({ tick: st.tick, runTimeMs: state.runTimeMs, buffer });
            if (st.ringScreenshots.length > 2) st.ringScreenshots.shift();
          }
        } catch (error) {
          warn(`ring screenshot failed: ${error.message}`);
        }
      }
      if (st.tick - st.lastPerfTick >= PERF_SAMPLE_FRAMES) {
        st.lastPerfTick = st.tick;
        const perf = {
          heapMb: poll.heapMb,
          stepFps: null,
          wallMs: Date.now() - wallStart,
        };
        timeline.push('PERF', ctxFor(state, {}, perf));
      }
      if (st.tick - st.lastSnapshotTick >= SNAPSHOT_SAMPLE_FRAMES) {
        st.lastSnapshotTick = st.tick;
        snapshots.push({
          tick: st.tick,
          simulationTimeMs: state.runTimeMs,
          stageId: state.stageId,
          phase: state.phase,
          player: { x: state.player.x, y: state.player.y, hp: state.player.hp, maxHp: state.player.maxHp },
          boss: state.boss ? { kind: state.boss.kind, hp: state.boss.hp, maxHp: state.boss.maxHp } : null,
          enemies: state.enemies.length,
          gems: state.gems.length,
          telegraphs: state.telegraphs.length,
          kills: diag && !diag.error ? diag.kills : null,
          level: diag && !diag.error ? diag.level : null,
        });
      }

      // --- pacing: --speed is wall-clock only ----------------------------------------------
      const chunkWallMs = Date.now() - tickWallStart;
      st.chunkWallEmaMs = st.chunkWallEmaMs === null
        ? chunkWallMs
        : st.chunkWallEmaMs * 0.9 + chunkWallMs * 0.1;
      const budgetMs = (DECISION_FRAMES * FRAME_MS) / options.speed;
      if (chunkWallMs < budgetMs) await sleep(budgetMs - chunkWallMs);
      if (!st.degradedNoted && st.chunkWallEmaMs > budgetMs * 2 && st.tick > 600) {
        st.degradedNoted = true;
        const effective = (DECISION_FRAMES * FRAME_MS) / st.chunkWallEmaMs;
        timeline.push('TIME_SCALE_DEGRADED', ctxFor(state, {
          detail: `requested ${options.speed}x, effective ~${effective.toFixed(1)}x`,
        }));
      }

      // --- progress log: long runs must stay observable ----------------------------------
      // Every 600 frames (10 s sim) or 60 s wall, whichever comes first.
      if (
        st.tick - st.lastProgressLogTick >= 600
        || Date.now() - st.lastProgressLogWall >= 60000
      ) {
        st.lastProgressLogTick = st.tick;
        st.lastProgressLogWall = Date.now();
        const effective = st.chunkWallEmaMs
          ? ((DECISION_FRAMES * FRAME_MS) / st.chunkWallEmaMs).toFixed(1)
          : '?';
        log(
          `run ${runId}: tick=${st.tick} sim=${Math.round(state.runTimeMs / 1000)}s `
          + `${state.stageId}/${state.phase} hp=${state.player.hp}/${state.player.maxHp} `
          + `enemies=${state.enemies.length} kills=${diag && !diag.error ? diag.kills : '?'} `
          + `boss=${state.boss ? `${state.boss.kind} ${state.boss.hp}/${state.boss.maxHp}` : 'none'} `
          + `choices=${st.choicesMade} effective=${effective}x wall=${Math.round((Date.now() - wallStart) / 1000)}s`,
        );
      }
    }

    void lastPoll;

    // Flush a snapshot armed but not yet collected (e.g. --until broke on
    // the same tick a stage shot was armed): one explicit step renders it.
    // The run is over for decision purposes, so the extra frame is harmless.
    if (st.pendingShot) {
      const shot = st.pendingShot;
      st.pendingShot = null;
      try {
        await page.evaluate(() => window.__ofeliyaTest.advance(1));
        st.tick += 1;
        const buffer = await collectRendererSnapshot(page);
        if (buffer && shot.kind === 'stage') {
          fs.writeFileSync(path.join(runDir, `stage-${shot.to}.png`), buffer);
          st.stageScreenshots.push(`stage-${shot.to}.png`);
        } else if (buffer && shot.kind === 'ring') {
          st.ringScreenshots.push({ tick: shot.tick, runTimeMs: shot.runTimeMs, buffer });
          if (st.ringScreenshots.length > 2) st.ringScreenshots.shift();
        }
      } catch (error) {
        warn(`pending snapshot flush failed: ${error.message}`);
      }
    }

    // --- post-run: release the input (the player lifts the thumb) -----------
    // The harness owns the input channel: after the run ends it must leave
    // registry 'joy'/'aimJoy' released, exactly as the real joystick does
    // on pointerup (Joystick.ts removes 'joy'). The Game scene stays alive
    // behind the result screen, so without this the last input vector stays
    // stuck (campaign-std1: joy={-0.73, 0.68} after defeat) and the
    // noStuckInput invariant fails. Both bot and replay runs release here,
    // at the same end tick, so the input hash stays comparable.
    try {
      await page.evaluate(() => window.__ofeliyaTest.clearInput());
    } catch {
      // The page may already be gone (crash path) — the invariant below
      // reports what it can from the last poll.
    }
    // Re-poll so the noStuckInput check below sees the released input
    // (st.finalDiag still holds the pre-release poll).
    try {
      const released = await pollState(page, st.lastEventCount);
      st.lastEventCount = released.eventCount;
      st.finalState = released.state;
      st.finalDiag = released.diag;
      st.finalPools = released.pools;
    } catch {
      // Keep the last poll's values.
    }

    // --- post-run: no-stuck-input invariant (checked at RUN_END, before the
    // result screen opens its own modal) -----------------------------------------
    if (st.runEnded && st.finalDiag && !st.finalDiag.error) {
      const joy = st.finalDiag.joy;
      const joyStuck = joy && (Math.abs(joy.x) > 1e-6 || Math.abs(joy.y) > 1e-6);
      const modalOpen = st.finalDiag.modalOpen === true;
      const milestonesLeft = (st.finalDiag.milestonesActive ?? 0) > 0;
      const passed = !joyStuck && !modalOpen && !milestonesLeft;
      invariants.check('noStuckInput', passed, {
        expected: 'no modal, milestone, timer or input listener active after victory; input not stuck after reset',
        actual: passed
          ? 'joy released, no modal, no milestones'
          : `joy=${JSON.stringify(joy)} modalOpen=${modalOpen} milestones=${st.finalDiag.milestonesActive}`,
        failAt: passed ? undefined : markInvariantFail('noStuckInput', st.finalState, 'stuck input/modal after run end'),
      });
    } else {
      invariants.check('noStuckInput', true, {
        expected: 'no modal, milestone, timer or input listener active after victory; input not stuck after reset',
        actual: 'not exercised (run did not end)',
      });
    }

    // --- post-run: let the result screen submit the score -------------------------
    if (st.runEnded && !st.untilReached) {
      try {
        await page.evaluate((frames) => window.__ofeliyaTest.advance(frames), POST_RUN_ADVANCE_FRAMES);
        st.tick += POST_RUN_ADVANCE_FRAMES;
      } catch (error) {
        warn(`post-run advance failed: ${error.message}`);
      }
      await sleep(POST_RUN_WALL_WAIT_MS);
      const after = await pollState(page, st.lastEventCount);
      st.lastEventCount = after.eventCount;
      st.finalHashes = { inputHash: after.inputHash, stateHash: after.stateHash };
      st.finalState = after.state;
      st.finalDiag = after.diag;
      st.finalPools = after.pools;
      if (!st.runResult && after.diag && !after.diag.error) st.runResult = after.diag.runResult;
    }

    // --- failure screenshots: t (now) and t+2s --------------------------------------
    const died = st.runEnded && st.runResult && st.runResult.win === false;
    if (died || st.failure || st.watchdog) {
      const failureShot = await snapshotNow(page);
      if (failureShot) {
        fs.writeFileSync(path.join(runDir, 'failure.png'), failureShot);
      } else {
        warn('failure screenshot failed: renderer snapshot and page fallback both missed');
      }
      const before = st.ringScreenshots[st.ringScreenshots.length - 1];
      if (before) {
        fs.writeFileSync(path.join(runDir, 'failure-minus-2s.png'), before.buffer);
      }
      try {
        await page.evaluate((frames) => window.__ofeliyaTest.advance(frames), 120);
        const afterShot = await snapshotNow(page);
        if (afterShot) fs.writeFileSync(path.join(runDir, 'failure-plus-2s.png'), afterShot);
      } catch (error) {
        warn(`failure+2s screenshot failed: ${error.message}`);
      }
    }

    // --- final reads ------------------------------------------------------------------
    st.heapAfter = await readHeap(page);
    st.saveAfter = await readLocalStorage(page);
    st.outboxAfter = st.saveAfter ? st.saveAfter.ofeliya_score_outbox_v1 ?? null : null;
    const finalPools = st.finalPools || (await page.evaluate(() => window.__ofeliyaTest.debugPools()).catch(() => null));
    st.finalPools = finalPools;

    // Save validity + save-after-result.
    let saveValid = false;
    let saveRunsBefore = null;
    let saveRunsAfter = null;
    try {
      const before = st.saveBefore ? JSON.parse(st.saveBefore.ofeliya_save_v1 || '{}') : {};
      const after = st.saveAfter ? JSON.parse(st.saveAfter.ofeliya_save_v1 || '{}') : {};
      saveValid = true;
      saveRunsBefore = typeof before.runs === 'number' ? before.runs : null;
      saveRunsAfter = typeof after.runs === 'number' ? after.runs : null;
    } catch {
      saveValid = false;
    }
    invariants.check('saveValid', saveValid, {
      expected: 'localStorage save is valid JSON and passes migration round-trip',
      actual: saveValid ? 'save parses as JSON' : 'save is not valid JSON',
      failAt: saveValid ? undefined : markInvariantFail('saveValid', st.finalState, 'save JSON invalid'),
    });
    if (st.runEnded) {
      const committed = saveRunsBefore !== null && saveRunsAfter !== null && saveRunsAfter > saveRunsBefore;
      invariants.check('saveAfterResult', committed, {
        expected: 'save is committed only after the campaign result is final',
        actual: committed
          ? `runs ${saveRunsBefore} -> ${saveRunsAfter}`
          : `runs ${saveRunsBefore} -> ${saveRunsAfter} (not committed)`,
        failAt: committed ? undefined : markInvariantFail('saveAfterResult', st.finalState, 'save not committed'),
      });
      if (committed) timeline.push('SAVE_COMMITTED', ctxFor(st.finalState, { runs: saveRunsAfter }));
    } else {
      invariants.check('saveAfterResult', true, {
        expected: 'save is committed only after the campaign result is final',
        actual: 'not exercised (run did not end)',
      });
    }

    // Listener baseline (§4.3): pools after vs the RUN_START baseline.
    // Only meaningful after teardown (RUN_END): mid-run timers/tweens are
    // live combat state, not leaks, so --until runs skip the check.
    // The gate covers listeners and timers only. Tweens are reported as a
    // diagnostic, not gated: the result screen legitimately runs its own
    // animations (count-ups, pulses) in the UI scene, so the post-RUN_END
    // tween count measures the result screen, not a leak — campaign-std1
    // showed tweens +8 with listeners/timers at -1/-1. A true tween-leak
    // check needs a return-to-menu step + re-baseline, which the harness
    // does not perform (gap, noted in the handoff). Design §4.3 names
    // heap/listeners/localStorage/audio; tweens were a runner addition.
    if (st.runEnded && st.poolsBaseline && finalPools) {
      const listenerDelta = finalPools.listeners - st.poolsBaseline.listeners;
      const timerDelta = finalPools.timers - st.poolsBaseline.timers;
      const tweenDelta = finalPools.tweens - st.poolsBaseline.tweens;
      const passed = listenerDelta <= LISTENER_DELTA_TOLERANCE && timerDelta <= 2;
      invariants.check('listenerBaseline', passed, {
        expected: 'no listener / timer growth after teardown vs baseline (tweens reported, not gated — result-screen animations)',
        actual: `listeners ${st.poolsBaseline.listeners} -> ${finalPools.listeners} (delta ${listenerDelta}), timers delta ${timerDelta}, tweens delta ${tweenDelta} (diagnostic)`,
        failAt: passed ? undefined : markInvariantFail('listenerBaseline', st.finalState, `listener delta ${listenerDelta}`),
      });
      st.listenerDelta = listenerDelta;
    } else {
      invariants.check('listenerBaseline', true, {
        expected: 'no listener / timer / tween growth after teardown vs baseline',
        actual: 'not exercised (run did not end)',
      });
    }

    // Page errors (§4.3: zero over the series).
    invariants.check('noPageErrors', run.pageErrors.length === 0, {
      expected: 'zero pageerror / unhandledrejection / NaN in console over the series',
      actual: run.pageErrors.length === 0 ? 'clean' : `${run.pageErrors.length} errors: ${run.pageErrors.slice(0, 3).join(' | ')}`,
      failAt: run.pageErrors.length === 0 ? undefined : markInvariantFail('noPageErrors', st.finalState, 'page errors'),
    });

    // Run-result consistency (§4.2).
    if (st.runEnded && st.runResult) {
      const result = st.runResult;
      const consistent = result.stageId === st.finalState.stageId
        && result.stageOrder === st.finalState.stageOrder
        && (st.finalDiag && !st.finalDiag.error ? result.bossesDefeated === st.finalDiag.bossesDefeated : true)
        && (result.reason === 'campaign-complete') === (result.win === true);
      invariants.check('runResultConsistent', consistent, {
        expected: 'RunState and runResult agree; rulesetVersion / campaignVersion / stage clear times valid',
        actual: consistent
          ? `reason=${result.reason} stage=${result.stageId} bosses=${result.bossesDefeated}`
          : `runResult=${JSON.stringify({ reason: result.reason, stageId: result.stageId, stageOrder: result.stageOrder, bossesDefeated: result.bossesDefeated })} vs state=${st.finalState.stageId}/${st.finalState.stageOrder}`,
        failAt: consistent ? undefined : markInvariantFail('runResultConsistent', st.finalState, 'runResult mismatch'),
      });
    } else {
      invariants.check('runResultConsistent', true, {
        expected: 'RunState and runResult agree; rulesetVersion / campaignVersion / stage clear times valid',
        actual: 'not exercised (run did not end)',
      });
    }

    // Score contract (§2.5): the real server verdict on the real payload.
    let scoreValidation = 'not-submitted';
    if (run.scoreSubmission) {
      timeline.push('SCORE_SUBMITTED', ctxFor(st.finalState, {
        status: run.scoreSubmission.responseStatus,
      }));
      const response = run.scoreSubmission.response;
      if (run.scoreSubmission.responseStatus === 200 && response && response.ok === true) {
        scoreValidation = 'accepted';
        timeline.push('SCORE_VALIDATED', ctxFor(st.finalState, {}));
      } else {
        scoreValidation = `rejected: ${response && response.error ? response.error : `http ${run.scoreSubmission.responseStatus}`}`;
      }
    }
    if (st.runEnded && !st.untilReached) {
      const accepted = scoreValidation === 'accepted';
      invariants.check('scoreContract', accepted, {
        expected: 'score payload accepted by the local trusted validator',
        actual: scoreValidation,
        failAt: accepted ? undefined : markInvariantFail('scoreContract', st.finalState, scoreValidation),
      });
    } else {
      invariants.check('scoreContract', true, {
        expected: 'score payload accepted by the local trusted validator',
        actual: st.untilReached ? 'not exercised (--until run)' : 'not exercised (run did not end)',
      });
    }

    // Legit death: defeat with no invariant failure is a result, not a bug
    // (§3.4). Flag it suspicious when no threat was near in the last 5 s.
    if (died) {
      const recent = snapshots.slice(-5);
      const threatNear = recent.some((s) => s.enemies > 0 && s.boss !== null)
        || (st.finalState && (st.finalState.enemies.length > 0 || st.finalState.telegraphs.length > 0 || st.finalState.boss !== null));
      timeline.push('LEGIT_DEATH', ctxFor(st.finalState, {
        terminal: 'defeat',
        suspicious: !threatNear,
        detail: threatNear ? 'threats present at death' : 'no enemy/telegraph/boss near at death',
      }));
    }

    // Heap growth vs the first run of the series (§4.3).
    let heapGrowth = null;
    if (st.heapAfter && seriesState.firstHeapAfter) {
      heapGrowth = (st.heapAfter.usedJSHeapSize - seriesState.firstHeapAfter.usedJSHeapSize)
        / seriesState.firstHeapAfter.usedJSHeapSize;
      const passed = heapGrowth < HEAP_GROWTH_LIMIT;
      invariants.check('heapGrowth', passed, {
        expected: 'usedJSHeapSize growth < 15% vs the first run of the series',
        actual: `heap ${seriesState.firstHeapAfter.usedJSHeapSize} -> ${st.heapAfter.usedJSHeapSize} (${(heapGrowth * 100).toFixed(1)}%)`,
        failAt: passed ? undefined : markInvariantFail('heapGrowth', st.finalState, `heap +${(heapGrowth * 100).toFixed(1)}%`),
      });
    } else {
      invariants.check('heapGrowth', true, {
        expected: 'usedJSHeapSize growth < 15% vs the first run of the series',
        actual: 'baseline run (first of the series)',
      });
      if (st.heapAfter && !seriesState.firstHeapAfter) seriesState.firstHeapAfter = st.heapAfter;
    }

    // Replay determinism comparison. Only tick-anchored baselines compare:
    // without finalTick the recorded hash's tick is unknown, and comparing
    // hashes from different ticks is a guaranteed false DIVERGED.
    let replayVerdict = null;
    if (isReplay && options.replayPlan.expectedStateHash && options.replayPlan.finalTick !== null) {
      const match = st.finalHashes.stateHash === options.replayPlan.expectedStateHash
        && st.finalHashes.inputHash === options.replayPlan.expectedInputHash;
      replayVerdict = match ? 'MATCH' : 'DIVERGED';
      if (!match && !st.failure) {
        st.failure = {
          code: 'REPLAY_DIVERGED',
          message: `stateHash ${st.finalHashes.stateHash} vs expected ${options.replayPlan.expectedStateHash}`,
        };
      }
    }

    // --- verdict ------------------------------------------------------------------
    const won = st.runEnded && st.runResult && st.runResult.win === true;
    const lost = st.runEnded && st.runResult && st.runResult.win === false;
    let status;
    let terminal;
    let failure = st.failure;
    if (st.watchdog) {
      status = st.watchdog.code === 'TIMEOUT' || st.watchdog.code === 'WAVE_STALL' ? 'timeout' : 'failed';
      terminal = st.watchdog.code === 'TIMEOUT' ? 'timeout' : 'watchdog';
      failure = failure || { code: st.watchdog.code, message: st.watchdog.message };
    } else if (st.failure) {
      status = 'failed';
      terminal = 'error';
    } else if (st.untilReached) {
      status = 'passed';
      terminal = 'until-reached';
    } else if (won) {
      status = invariants.allPassed() ? 'passed' : 'failed';
      terminal = 'victory';
      if (!invariants.allPassed()) {
        failure = {
          code: 'INVARIANT_FAIL',
          message: `invariants failed: ${invariants.failedIds().join(', ')}`,
        };
      }
    } else if (lost) {
      // A legit death is a failed CAMPAIGN but not a failed HARNESS — except
      // the acceptance gate counts wins, so the run status is failed with a
      // LEGIT_DEATH diagnosis (the timeline carries the hp log + telegraphs).
      status = 'failed';
      terminal = 'defeat';
      failure = {
        code: 'LEGIT_DEATH',
        message: `bot died on ${st.finalState.stageId} at ${Math.round(st.finalState.runTimeMs)} ms sim`
          + (invariants.failedIds().length > 0 ? `; invariants also failed: ${invariants.failedIds().join(', ')}` : ''),
      };
    } else {
      // Replay that ran out of log without a run end.
      status = replayVerdict === 'DIVERGED' ? 'failed' : 'passed';
      terminal = 'replay-complete';
    }
    if (status === 'passed' && !st.untilReached && !invariants.allPassed()) {
      status = 'failed';
      failure = failure || {
        code: 'INVARIANT_FAIL',
        message: `invariants failed: ${invariants.failedIds().join(', ')}`,
      };
    }
    if (status === 'passed' && st.untilReached) {
      // Until-runs never reach teardown, so teardown-only invariants are
      // recorded as "not exercised" above — but a GAMEPLAY invariant
      // failure (finite numbers, monotonicity, stage order, ...) must
      // still fail the run.
      const gameplayFailed = invariants.failedIds().filter(
        (id) => !TEARDOWN_INVARIANTS.has(id),
      );
      if (gameplayFailed.length > 0) {
        status = 'failed';
        failure = failure || {
          code: 'INVARIANT_FAIL',
          message: `invariants failed: ${gameplayFailed.join(', ')}`,
        };
      }
    }

    // --- write artifacts ------------------------------------------------------------
    const wallDurationMs = Date.now() - wallStart;
    const finalState = st.finalState;
    const ruleset = run.scoreSubmission && run.scoreSubmission.request && run.scoreSubmission.request.payload
      ? {
          rulesetVersion: String(run.scoreSubmission.request.payload.rulesetVersion ?? 'unknown'),
          campaignVersion: String(run.scoreSubmission.request.payload.campaignVersion ?? 'unknown'),
          completionStage: run.scoreSubmission.request.payload.completionStage ?? null,
        }
      : null;
    let contract = ruleset;
    if (!contract) {
      const serverRuleset = await readServerRuleset(run.scoreServer.port);
      contract = {
        rulesetVersion: serverRuleset && serverRuleset.rulesetVersion !== undefined
          ? String(serverRuleset.rulesetVersion)
          : 'unknown',
        campaignVersion: serverRuleset && serverRuleset.campaignVersion !== undefined
          ? String(serverRuleset.campaignVersion)
          : 'unknown',
        completionStage: won ? 'heart' : null,
      };
    }

    const runJson = {
      schemaVersion: 1,
      project: 'OFELIYA: STRAIN ZERO',
      commit: gitCommit(),
      browser: 'chromium',
      renderer: 'webgl',
      viewport: [VIEWPORT.width, VIEWPORT.height],
      run: {
        id: runId,
        seed,
        difficulty,
        status,
        speed: options.speed,
        simulatedDurationMs: Math.round(finalState ? finalState.runTimeMs : 0),
        wallDurationMs,
        frames: st.tick,
        tick: st.tick,
        simulationTimeMs: Math.round(finalState ? finalState.runTimeMs : 0),
      },
      contract: {
        rulesetVersion: contract.rulesetVersion,
        campaignVersion: contract.campaignVersion,
        completionStage: contract.completionStage,
        scoreValidation,
      },
      result: {
        stage: finalState ? finalState.stageId : 'unknown',
        phase: finalState ? finalState.phase : 'unknown',
        boss: finalState && finalState.boss ? finalState.boss.kind : 'none',
        bossPhase: finalState && finalState.boss ? finalState.boss.bossPhase : 0,
        playerHp: finalState ? finalState.player.hp : 0,
        terminal,
      },
      lastTransition: st.lastTransition,
      stateHash: st.finalHashes.stateHash ? `sha256:${st.finalHashes.stateHash}` : 'sha256:unknown',
      inputHash: st.finalHashes.inputHash ? `sha256:${st.finalHashes.inputHash}` : 'sha256:unknown',
      invariants: invariants.toJson(),
      diagnostics: {
        nanCount: st.nanCount,
        infiniteCount: st.infiniteCount,
        stalledWaves: st.stalledWaves,
        duplicateEntityIds: 0, // No entity ids in the Test API — not checkable.
        audioNodesAfterTeardown: null, // Not observable from the harness.
        listenerDelta: st.listenerDelta ?? null,
        saveValid,
        pageErrors: run.pageErrors.length,
        botStuckCount: st.botStuckCount,
        dwellCount: st.dwellCount,
        heartSyncSuccesses: st.heartSyncSuccesses,
        heartSyncMisses: st.heartSyncMisses,
        choicesMade: st.choicesMade,
        transitionsAcked: st.transitionsAcked,
        heapGrowth,
        replayVerdict,
        visualProfile: options.visualProfile,
        qaHide: options.qaHide.length > 0 ? options.qaHide.join(',') : 'none',
        effectiveSpeed: st.chunkWallEmaMs
          ? Number(((DECISION_FRAMES * FRAME_MS) / st.chunkWallEmaMs).toFixed(2))
          : null,
      },
      failure: failure
        ? {
            code: failure.code,
            message: failure.message,
            frame: st.tick,
            ...(failure.type ? { type: failure.type } : {}),
          }
        : null,
      artifacts: {
        inputLog: 'inputs.json',
        timeline: 'timeline.ndjson',
        console: 'console.log',
      },
    };
    if (fs.existsSync(path.join(runDir, 'failure.png'))) runJson.artifacts.screenshot = 'failure.png';

    // inputs.json carries the hashes the run produced, so --replay can
    // compare against them (extra fields are ignored by verify-campaign-replay).
    // finalTick anchors the hashes: the replay ends at exactly this tick.
    const inputsOut = {
      ...inputLog,
      finalTick: st.tick,
      expectedStateHash: st.finalHashes.stateHash,
      expectedInputHash: st.finalHashes.inputHash,
    };
    fs.writeFileSync(path.join(runDir, 'inputs.json'), `${JSON.stringify(inputsOut, null, 2)}\n`);
    fs.writeFileSync(path.join(runDir, 'timeline.ndjson'), timeline.toNdjson());
    fs.writeFileSync(path.join(runDir, 'snapshots.json'), `${JSON.stringify(snapshots, null, 2)}\n`);
    fs.writeFileSync(path.join(runDir, 'console.log'), `${run.consoleLines.join('\n')}\n`);
    fs.writeFileSync(path.join(runDir, 'network.json'), `${JSON.stringify(run.network, null, 2)}\n`);
    fs.writeFileSync(path.join(runDir, 'heap-before.json'), `${JSON.stringify(st.heapBefore, null, 2)}\n`);
    fs.writeFileSync(path.join(runDir, 'heap-after.json'), `${JSON.stringify(st.heapAfter, null, 2)}\n`);
    fs.writeFileSync(path.join(runDir, 'local-storage.json'), `${JSON.stringify({ before: st.saveBefore, after: st.saveAfter }, null, 2)}\n`);
    fs.writeFileSync(path.join(runDir, 'score-payload.json'), `${JSON.stringify({
      submitted: Boolean(run.scoreSubmission),
      submission: run.scoreSubmission,
      outboxAfter: st.outboxAfter,
      apiCalls: run.apiCalls,
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify(runJson, null, 2)}\n`);

    const runFailed = status !== 'passed';
    log(
      `run ${runId}: ${status.toUpperCase()} terminal=${terminal} `
      + `stage=${runJson.result.stage} sim=${Math.round(runJson.run.simulatedDurationMs / 1000)}s `
      + `wall=${Math.round(wallDurationMs / 1000)}s frames=${st.tick} `
      + `score=${scoreValidation}${replayVerdict ? ` replay=${replayVerdict}` : ''} `
      + `dir=${runDir}`,
    );
    if (failure) {
      log(`CAMPAIGN_DIAGNOSIS stage=${runJson.result.stage} tick=${st.tick} `
        + `invariant=${invariants.failedIds()[0] || failure.code} `
        + `expected="${invariants.failedIds()[0] ? (invariants.results.get(invariants.failedIds()[0])?.expected || '') : ''}" `
        + `actual="${failure.message}"`);
    }

    return { runId, runDir, runJson, failed: runFailed };
  } finally {
    const failedRun = Boolean(st.failure || st.watchdog || (st.runEnded && st.runResult && !st.runResult.win));
    // Trace: retain-on-failure (design §4.1).
    if (options.trace && ctx) {
      try {
        if (failedRun) {
          await ctx.tracing.stop({ path: path.join(runDir, 'trace.zip') });
        } else {
          await ctx.tracing.stop();
        }
      } catch (error) {
        warn(`tracing stop failed: ${error.message}`);
      }
    }
    let videoPath = null;
    if (page) {
      try {
        const video = page.video();
        videoPath = video ? await video.path().catch(() => null) : null;
      } catch {
        videoPath = null;
      }
    }
    if (ctx) await ctx.close().catch(() => {});
    if (videoPath && fs.existsSync(videoPath)) {
      if (failedRun) {
        try {
          fs.renameSync(videoPath, path.join(runDir, 'video.webm'));
        } catch {
          // Video already moved or removed by Playwright; ignore.
        }
      } else {
        try { fs.unlinkSync(videoPath); } catch { /* already gone */ }
      }
    }
    if (run.scoreServer) {
      const stderr = await run.scoreServer.stop();
      if (stderr && stderr.trim()) {
        fs.writeFileSync(path.join(runDir, 'score-server.log'), stderr);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Series + main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = parseOptions(args);
  if (options.replay) {
    if (!fs.existsSync(options.replay)) usageError(`replay file not found: ${options.replay}`);
    try {
      options.replayPlan = loadInputsFile(options.replay, options.seed, args.difficulty);
    } catch (error) {
      usageError(error.message);
    }
    options.runs = 1;
    options.seed = options.replayPlan.seed;
    options.difficulty = options.replayPlan.difficulty;
  }
  if (options.until && !UNTIL_ALIASES[options.until] && !/^[A-Z][A-Z0-9_]*$/.test(options.until)) {
    usageError(`--until must be a timeline marker (e.g. BOSS_ACTIVE) or an alias (first-boss, heart, victory, defeat), got ${options.until}`);
  }
  fs.mkdirSync(options.out, { recursive: true });

  log(
    `autonomous campaign: ${options.runs} run(s) difficulty=${options.difficulty} `
    + `speed=${options.speed}x url=${options.url} platform=${options.platform} `
    + `visual=${options.visualProfile} qaHide=${options.qaHide.length > 0 ? options.qaHide.join(',') : 'none'} mode=${options.replay ? `replay(${options.replay})` : 'bot'}`
    + (options.until ? ` until=${options.until}` : '')
    + (options.seed ? ` seed=${options.seed}` : ''),
  );

  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32'
      ? []
      : ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });

  const seriesState = { firstHeapAfter: null };
  const results = [];
  let fatalError = null;
  try {
    for (let i = 0; i < options.runs; i++) {
      try {
        const result = await runCampaign(browser, options, i, seriesState);
        results.push(result);
      } catch (error) {
        if (error.code === 'HARNESS_API_MISSING') throw error;
        // One run crashing (browser hiccup, server failure) must not lose
        // the series artifacts already written; record and continue.
        console.error(`[campaign] run ${i + 1} crashed: ${error.stack || error}`);
        results.push({ runId: `run-${i + 1}`, failed: true, crashed: true, error: String(error) });
      }
    }
  } catch (error) {
    fatalError = error;
  } finally {
    await browser.close().catch(() => {});
  }

  if (fatalError) {
    console.error(`autonomous-campaign: FAILED: ${fatalError.message}`);
    process.exit(fatalError.code === 'HARNESS_API_MISSING' ? EXIT_USAGE : EXIT_FAIL);
  }

  const passed = results.filter((r) => !r.failed).length;
  const failed = results.length - passed;
  const series = {
    runs: results.length,
    passed,
    failed,
    difficulty: options.difficulty,
    speed: options.speed,
    visualProfile: options.visualProfile,
    qaHide: options.qaHide.length > 0 ? options.qaHide.join(',') : 'none',
    mode: options.replay ? 'replay' : 'bot',
    results: results.map((r) => ({
      runId: r.runId,
      status: r.runJson ? r.runJson.run.status : 'crashed',
      terminal: r.runJson ? r.runJson.result.terminal : 'error',
      seed: r.runJson ? r.runJson.run.seed : null,
      dir: r.runDir || null,
    })),
  };
  fs.writeFileSync(path.join(options.out, 'series.json'), `${JSON.stringify(series, null, 2)}\n`);
  log(`series: ${passed}/${results.length} passed (${failed} failed) — artifacts in ${options.out}`);
  process.exit(failed > 0 ? EXIT_FAIL : EXIT_PASS);
}

main().catch((error) => {
  console.error(`autonomous-campaign: FAILED: ${error.stack || error}`);
  process.exit(EXIT_FAIL);
});

/**
 * Campaign replay verification (harness track B, design §2.4).
 *
 * Runs the SAME seed + input log twice through the harness Test API and
 * compares the resulting state hashes. Exit 0 when both runs reproduce
 * bit-identically, exit 1 on divergence, exit 2 when the Test API is
 * absent (track A not installed in the served build).
 *
 * Expected Test API (design §1.3, installed by track A under
 * `import.meta.env.DEV || VITE_QA_TOOLS === '1'`):
 *
 *   window.__ofeliyaTest = {
 *     version: 1,
 *     startCampaign({ seed, difficulty }): Promise<void>,
 *     setInput({ moveX, moveY, aimX?, aimY? }): void,
 *     clearInput(): void,
 *     advance(frames: number): Promise<void>,  // synthetic stepping, §2.2
 *     chooseUpgrade(id: string): void,          // only ids from pendingChoices
 *     acknowledgeTransition(): void,
 *     readState(): { scene, phase, stageId, stageOrder, stageTimeMs,
 *       runTimeMs, player, boss, enemies, hostCells, gems, telegraphs,
 *       heartbeat, awaitingChoice, pendingChoices, runSeed, difficultyId },
 *     getRunLog(): { events, inputHash, stateHash },
 *     getRngState(): { seed, states: Record<stream, number> },
 *   };
 *
 * Inputs file (JSON, §2.4 tick-indexed log):
 *
 *   {
 *     "version": 1,
 *     "seed": "qa-seed-2026",            // optional if --seed is given
 *     "difficulty": "standard",          // optional, default "standard"
 *     "inputs": [                        // one vector per tick, strictly increasing ticks
 *       { "tick": 0, "move": [0.71, -0.70], "aim": [0.98, -0.12] },
 *       { "tick": 18420, "move": [0, 0] }
 *     ],
 *     "choices": [                       // mutation picks, applied at the logged tick
 *       { "tick": 5400, "id": "dmg" }
 *     ],
 *     "transitions": [                   // stage-transition acks, applied at the logged tick
 *       { "tick": 18120 }
 *     ]
 *   }
 *
 * Replay advances in chunks between logged event ticks (inputs are
 * piecewise-constant, so chunking is equivalent to per-frame stepping),
 * applies each logged input / choice / transition ack at its tick, then
 * reads getRunLog() + getRngState(). A choice whose id is not among
 * pendingChoices when the modal opens is a divergence and fails the run.
 * If the modal has not opened yet at the logged tick, the replay waits
 * up to MAX_CHOICE_WAIT_FRAMES for it (level-up timing shifts by a few
 * frames between runs — wall-clock Juice dip, design §2.2) and logs the
 * shift; only a modal that never opens within the window fails the run.
 *
 * The two runs use fresh browser contexts (localStorage isolation, §4.3).
 * Bit-identity is guaranteed only inside one Chromium in CI (§2.4).
 *
 * Usage:
 *   node scripts/verify-campaign-replay.mjs --seed <seed> --inputs <inputs.json>
 *     [--difficulty standard|strained] [--url http://127.0.0.1:5173/]
 *     [--api-timeout-ms 30000] [--run-timeout-ms 600000]
 *
 * The dev server is NOT started here: point --url (or OFELIYA_URL) at a
 * running vite dev server (5173) or a QA preview build (4173), like the
 * other *-smoke scripts. The served build must install the Test API.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = process.platform === 'win32' ? require('playwright') : require('playwright-core');

const chrome =
  process.platform === 'win32'
    ? undefined
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
if (process.platform !== 'win32' && !chrome) throw new Error('Chrome not found');

const EXIT_MATCH = 0;
const EXIT_DIVERGED = 1;
const EXIT_API_MISSING = 2;

const API_VERSION = 1;
const TAIL_FRAMES = 60;
// Bounded wait for the mutation modal when a recorded choice tick arrives
// before the modal opens in the replay. Level-up timing shifts by a few
// frames between runs because the Juice hit-stop dip runs on wall-clock
// (tween.js/performance.now, design §2.2) and stretches scene time
// differently per run (parity DIVERGED, first divergence frame 107).
// Without the wait the replay crashes at the first shifted choice and
// never reaches the hash comparison. The wait is LOGGED (choiceWaits)
// so a shifted application stays visible in the verdict; it does not
// hide divergence — the stateHash comparison still decides MATCH/DIVERGED.
// 600 frames (10 s) is a DIAGNOSTIC bound: on real campaign logs the
// shift can exceed 120 frames (choice 3 of the std-001 bot run needed
// more), and the point of the window is to let the replay complete so
// the hash comparison can quantify the divergence.
const MAX_CHOICE_WAIT_FRAMES = 600;
const DIFFICULTIES = ['standard', 'strained'];

function usageError(message) {
  console.error(`verify-campaign-replay: ${message}\n`);
  console.error(
    'Usage: node scripts/verify-campaign-replay.mjs --seed <seed> --inputs <inputs.json>\n' +
      '  [--difficulty standard|strained] [--url <base>] [--api-timeout-ms N] [--run-timeout-ms N]'
  );
  process.exit(EXIT_DIVERGED);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        'verify-campaign-replay: run one seed + input log twice and compare stateHash.\n\n' +
          'Options:\n' +
          '  --seed <seed>            run seed (or set "seed" in the inputs file)\n' +
          '  --inputs <inputs.json>   tick-indexed input log (required)\n' +
          '  --difficulty <id>        standard | strained (default: inputs file or standard)\n' +
          '  --url <base>             game URL (default: $OFELIYA_URL or http://127.0.0.1:5173/)\n' +
          '  --api-timeout-ms <n>     wait for window.__ofeliyaTest (default 30000)\n' +
          '  --run-timeout-ms <n>     watchdog per run (default 600000)\n\n' +
          'Exit codes: 0 hashes match · 1 diverged or invalid input · 2 Test API absent.'
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

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateVec(vec, what, where) {
  if (
    !Array.isArray(vec) ||
    vec.length !== 2 ||
    !vec.every((v) => isFiniteNumber(v) && v >= -1 && v <= 1)
  ) {
    throw new Error(`invalid ${what} at ${where}: expected [x, y] with components in [-1, 1]`);
  }
}

function validateInputsFile(raw, fileSeed, fileDifficulty) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`inputs file is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('inputs file must be a JSON object');
  }
  if (parsed.version !== 1) throw new Error(`unsupported inputs version: ${parsed.version} (expected 1)`);

  const seed = fileSeed ?? parsed.seed;
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new Error('seed is required: pass --seed or set "seed" in the inputs file');
  }
  if (fileSeed !== undefined && parsed.seed !== undefined && fileSeed !== parsed.seed) {
    throw new Error(`--seed ${fileSeed} conflicts with inputs file seed ${parsed.seed}`);
  }

  const difficulty = fileDifficulty ?? parsed.difficulty ?? 'standard';
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

  return { seed, difficulty, inputs, choices, transitions };
}

async function makePage(browser, url) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.setItem('ofeliya_difficulty_v1', 'standard');
    localStorage.setItem('ofeliya_control_mode_v1', 'two-hand');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-verify-campaign-replay',
      initDataUnsafe: { user: { id: 42, first_name: 'Replay', last_name: 'QA' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
}

async function runOnce(browser, { seed, difficulty, inputs, choices, transitions, url, apiTimeoutMs }) {
  const { ctx, page, errors } = await makePage(browser, url);
  try {
    try {
      await page.waitForFunction(
        () => typeof window.__ofeliyaTest?.startCampaign === 'function',
        null,
        { timeout: apiTimeoutMs }
      );
    } catch {
      const err = new Error(
        'HARNESS_API_MISSING: window.__ofeliyaTest is not installed in the served build. ' +
          'The harness Test API is track A work: serve a build with the API installed ' +
          '(vite dev, or a QA build with VITE_QA_TOOLS=1).'
      );
      err.code = 'HARNESS_API_MISSING';
      throw err;
    }
    const version = await page.evaluate(() => window.__ofeliyaTest.version);
    if (version !== API_VERSION) {
      throw new Error(`unsupported __ofeliyaTest version: ${version} (expected ${API_VERSION})`);
    }

    await page.evaluate(
      ({ seed: s, difficulty: d }) => window.__ofeliyaTest.startCampaign({ seed: s, difficulty: d }),
      { seed, difficulty }
    );

    const inputByTick = new Map(inputs.map((entry) => [entry.tick, entry]));
    const choicesByTick = new Map();
    for (const entry of choices) {
      if (!choicesByTick.has(entry.tick)) choicesByTick.set(entry.tick, []);
      choicesByTick.get(entry.tick).push(entry);
    }
    const transitionTicks = new Set(transitions.map((entry) => entry.tick));
    const eventTicks = [
      ...new Set([...inputByTick.keys(), ...choicesByTick.keys(), ...transitionTicks]),
    ].sort((a, b) => a - b);

    const applyInput = (entry) =>
      page.evaluate((e) => {
        const payload = { moveX: e.move[0], moveY: e.move[1] };
        if (e.aim) {
          payload.aimX = e.aim[0];
          payload.aimY = e.aim[1];
        }
        window.__ofeliyaTest.setInput(payload);
      }, entry);
    const tryApplyChoice = (id) =>
      page.evaluate((choiceId) => {
        const api = window.__ofeliyaTest;
        const state = api.readState();
        if (!state.awaitingChoice) {
          return { applied: false, reason: 'no mutation modal open', pending: state.pendingChoices };
        }
        if (!state.pendingChoices.includes(choiceId)) {
          return { applied: false, reason: 'id not among pendingChoices', pending: state.pendingChoices };
        }
        api.chooseUpgrade(choiceId);
        return { applied: true };
      }, id);
    const ackedTransitions = new Set();
    const ackTransition = async (tickValue) => {
      if (ackedTransitions.has(tickValue)) return;
      ackedTransitions.add(tickValue);
      await page.evaluate(() => window.__ofeliyaTest.acknowledgeTransition());
    };

    const choiceWaits = [];
    let tick = 0;
    for (const at of eventTicks) {
      if (at > tick) {
        await page.evaluate((frames) => window.__ofeliyaTest.advance(frames), at - tick);
        tick = at;
      }
      const input = inputByTick.get(at);
      if (input) {
        await applyInput(input);
      }
      for (const choice of choicesByTick.get(at) ?? []) {
        let result = await tryApplyChoice(choice.id);
        let waited = 0;
        while (
          !result.applied &&
          result.reason === 'no mutation modal open' &&
          waited < MAX_CHOICE_WAIT_FRAMES
        ) {
          await page.evaluate(() => window.__ofeliyaTest.advance(1));
          tick += 1;
          waited += 1;
          const pendingInput = inputByTick.get(tick);
          if (pendingInput) {
            await applyInput(pendingInput);
          }
          if (transitionTicks.has(tick)) {
            await ackTransition(tick);
          }
          result = await tryApplyChoice(choice.id);
        }
        if (waited > 0) {
          choiceWaits.push({ id: choice.id, recordedTick: at, appliedTick: tick, waited });
          console.log(
            `choice ${choice.id}: modal opened ${waited}f after recorded tick ${at} (applied @${tick})`
          );
        }
        if (!result.applied) {
          throw new Error(
            `choice ${choice.id} at tick ${at} could not be applied (${result.reason}; ` +
              `pending: ${JSON.stringify(result.pending)}; waited ${waited} frames) — the replay diverged from the recorded run`
          );
        }
      }
      if (transitionTicks.has(at)) {
        await ackTransition(at);
      }
    }
    await page.evaluate((frames) => window.__ofeliyaTest.advance(frames), TAIL_FRAMES);

    const log = await page.evaluate(() => window.__ofeliyaTest.getRunLog());
    const rngState = await page.evaluate(() => window.__ofeliyaTest.getRngState());
    const state = await page.evaluate(() => window.__ofeliyaTest.readState());
    return { log, rngState, state, errors, choiceWaits };
  } finally {
    await ctx.close();
  }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inputs) usageError('--inputs <inputs.json> is required');
  if (!existsSync(args.inputs)) usageError(`inputs file not found: ${args.inputs}`);

  const apiTimeoutMs = args['api-timeout-ms'] === undefined ? 30000 : Number(args['api-timeout-ms']);
  const runTimeoutMs = args['run-timeout-ms'] === undefined ? 600000 : Number(args['run-timeout-ms']);
  if (!Number.isFinite(apiTimeoutMs) || apiTimeoutMs <= 0) {
    usageError('--api-timeout-ms must be a positive number');
  }
  if (!Number.isFinite(runTimeoutMs) || runTimeoutMs <= 0) {
    usageError('--run-timeout-ms must be a positive number');
  }

  let plan;
  try {
    plan = validateInputsFile(readFileSync(args.inputs, 'utf8'), args.seed, args.difficulty);
  } catch (error) {
    usageError(error.message);
  }
  const url = args.url ?? process.env.OFELIYA_URL ?? 'http://127.0.0.1:5173/';

  console.log(
    `verify-campaign-replay: seed=${plan.seed} difficulty=${plan.difficulty} ` +
      `inputs=${plan.inputs.length} choices=${plan.choices.length} ` +
      `transitions=${plan.transitions.length} url=${url}`
  );

  const browser = await chromium.launch({
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const runOptions = { ...plan, url, apiTimeoutMs };
    const first = await withTimeout(runOnce(browser, runOptions), runTimeoutMs, 'first replay run');
    const second = await withTimeout(runOnce(browser, runOptions), runTimeoutMs, 'second replay run');

    for (const [label, run] of [['first', first], ['second', second]]) {
      for (const error of run.errors) {
        console.warn(`warning: pageerror during ${label} run: ${error}`);
      }
      for (const wait of run.choiceWaits) {
        console.log(
          `choice wait during ${label} run: ${wait.id} ` +
            `recorded@${wait.recordedTick} applied@${wait.appliedTick} (+${wait.waited}f)`
        );
      }
    }

    const mismatches = [];
    if (first.log.inputHash !== second.log.inputHash) {
      mismatches.push(`inputHash differs: ${first.log.inputHash} vs ${second.log.inputHash}`);
    }
    if (first.log.stateHash !== second.log.stateHash) {
      mismatches.push(`stateHash differs: ${first.log.stateHash} vs ${second.log.stateHash}`);
    }
    const rngDivergence = firstRngDivergence(first.rngState, second.rngState);
    if (rngDivergence) mismatches.push(`RNG state differs (${rngDivergence})`);
    if (first.state.runSeed !== second.state.runSeed) {
      mismatches.push(`runSeed differs: ${first.state.runSeed} vs ${second.state.runSeed}`);
    }

    const summary = (run) =>
      `${run.state.stageId}/${run.state.phase} runTimeMs=${run.state.runTimeMs} ` +
      `stateHash=${run.log.stateHash}`;
    console.log(`first run:  ${summary(first)}`);
    console.log(`second run: ${summary(second)}`);

    if (mismatches.length > 0) {
      console.error(`verify-campaign-replay: DIVERGED\n${mismatches.map((m) => `  ${m}`).join('\n')}`);
      process.exit(EXIT_DIVERGED);
    }
    console.log('verify-campaign-replay: MATCH — same seed + input log reproduced bit-identically');
    process.exit(EXIT_MATCH);
  } catch (error) {
    if (error.code === 'HARNESS_API_MISSING') {
      console.error(`verify-campaign-replay: ${error.message}`);
      process.exit(EXIT_API_MISSING);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`verify-campaign-replay: FAILED: ${error.message}`);
  process.exit(EXIT_DIVERGED);
});

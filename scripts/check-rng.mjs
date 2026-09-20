import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-rng-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/RunRng.ts',
      'src/game/EvolutionSystem.ts',
      'src/game/DifficultyProfile.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const { RunRng, GAMEPLAY_RNG_STREAMS, generateRunSeed } = require(join(temp, 'game/RunRng.js'));
  const { RunState } = require(join(temp, 'game/RunState.js'));
  const { BLOODSTREAM_STAGE } = require(join(temp, 'game/StageDefinitions.js'));
  const { rollRunChoices } = require(join(temp, 'game/EvolutionSystem.js'));
  const { getDifficultyProfile, pickEliteModifier } = require(join(temp, 'game/DifficultyProfile.js'));

  const seed = 'qa-seed-2026';
  const a = new RunRng(seed);
  const b = new RunRng(seed);
  assert(a.seed === seed && b.seed === seed, 'canonical seed changed');

  for (const stream of GAMEPLAY_RNG_STREAMS) {
    const seqA = Array.from({ length: 12 }, () => a.next(stream));
    const seqB = Array.from({ length: 12 }, () => b.next(stream));
    assert(
      JSON.stringify(seqA) === JSON.stringify(seqB),
      `same seed diverged in ${stream} stream`
    );
    assert(
      seqA.every((value) => value >= 0 && value < 1),
      `${stream} emitted value outside [0,1)`
    );
  }

  const independentA = new RunRng(seed);
  const independentB = new RunRng(seed);
  for (let i = 0; i < 40; i++) independentA.next('progression');
  const spawnAfterProgressionNoise = Array.from({ length: 10 }, () =>
    independentA.next('enemy-spawn')
  );
  const untouchedSpawn = Array.from({ length: 10 }, () => independentB.next('enemy-spawn'));
  assert(
    JSON.stringify(spawnAfterProgressionNoise) === JSON.stringify(untouchedSpawn),
    'progression draws shifted the enemy-spawn stream'
  );

  const different = new RunRng('qa-seed-other');
  const sameSeedEnemy = new RunRng(seed);
  const seqSame = Array.from({ length: 8 }, () => sameSeedEnemy.next('enemy-kind'));
  const seqDifferent = Array.from({ length: 8 }, () => different.next('enemy-kind'));
  assert(JSON.stringify(seqSame) !== JSON.stringify(seqDifferent), 'different seeds produced same trace');

  const traceChoices = () => {
    const rng = new RunRng(seed);
    const state = new RunState(BLOODSTREAM_STAGE);
    const trace = [];
    for (let step = 0; step < 10; step++) {
      const choices = rollRunChoices(state, 3, () => rng.next('progression'));
      trace.push(choices.map((choice) => choice.id));
      const chosen = choices[0];
      chosen.apply(state);
      if (!chosen.kind) state.bump(chosen.id);
    }
    return trace;
  };
  assert(
    JSON.stringify(traceChoices()) === JSON.stringify(traceChoices()),
    'same seed produced different progression/Legendary offer traces'
  );

  const strained = getDifficultyProfile('strained');
  const eliteTrace = () => {
    const rng = new RunRng(seed);
    return Array.from({ length: 12 }, () =>
      pickEliteModifier(strained, () => rng.next('elite'))
    );
  };
  assert(
    JSON.stringify(eliteTrace()) === JSON.stringify(eliteTrace()),
    'same seed produced different elite modifier trace'
  );

  const resumable = new RunRng(seed);
  GAMEPLAY_RNG_STREAMS.forEach((stream, index) => {
    for (let i = 0; i <= index; i++) resumable.next(stream);
  });
  const rngSnapshot = resumable.snapshot();
  const expectedContinuation = Object.fromEntries(
    GAMEPLAY_RNG_STREAMS.map((stream) => [
      stream,
      Array.from({ length: 6 }, () => resumable.next(stream)),
    ])
  );
  const restoredRng = new RunRng(seed);
  restoredRng.restore(rngSnapshot);
  const restoredContinuation = Object.fromEntries(
    GAMEPLAY_RNG_STREAMS.map((stream) => [
      stream,
      Array.from({ length: 6 }, () => restoredRng.next(stream)),
    ])
  );
  assert(
    JSON.stringify(restoredContinuation) === JSON.stringify(expectedContinuation),
    'RNG snapshot/restore changed deterministic continuation'
  );

  const generated = generateRunSeed();
  assert(/^[A-Za-z0-9_-]{1,32}$/.test(generated), 'generated run seed is not transport-safe');

  console.log('deterministic gameplay RNG smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

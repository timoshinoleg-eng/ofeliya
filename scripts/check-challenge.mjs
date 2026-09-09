import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-challenge-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/Challenge.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const {
    createChallengePayload,
    encodeChallengePayload,
    isChallengeBeaten,
    parseChallengePayload,
  } = require(join(temp, 'Challenge.js'));

  const losingRun = {
    win: false,
    timeMs: 123_456,
    kills: 78,
    hostCellsInfected: 4,
    level: 9,
    comboBest: 21,
  };
  const survival = createChallengePayload(losingRun);
  const survivalWire = encodeChallengePayload(survival);
  assert(typeof survivalWire === 'string', 'survival payload should encode');
  assert(/^[A-Za-z0-9_-]{1,512}$/.test(survivalWire), 'payload must satisfy MAX startapp charset/length');
  assert(JSON.stringify(parseChallengePayload(survivalWire)) === JSON.stringify(survival), 'survival round-trip failed');
  assert(isChallengeBeaten(survival, { ...losingRun, timeMs: 123_457 }), 'longer survival should beat target');
  assert(!isChallengeBeaten(survival, losingRun), 'tie must not beat survival target');

  const winningRun = { ...losingRun, win: true, timeMs: 310_250 };
  const clear = createChallengePayload(winningRun);
  const clearWire = encodeChallengePayload(clear);
  assert(JSON.stringify(parseChallengePayload(clearWire)) === JSON.stringify(clear), 'clear round-trip failed');
  assert(isChallengeBeaten(clear, { ...winningRun, timeMs: 310_249 }), 'faster clear should beat target');
  assert(!isChallengeBeaten(clear, { ...winningRun, timeMs: 310_251 }), 'slower clear must not beat target');
  assert(!isChallengeBeaten(clear, { ...winningRun, win: false, timeMs: 100_000 }), 'loss must not beat clear target');

  assert(parseChallengePayload('sz2_c_1_1_1_1_1') === null, 'unknown version must be rejected');
  assert(parseChallengePayload('sz1_c_1_1_1_1_1!') === null, 'invalid MAX payload characters must be rejected');
  assert(parseChallengePayload(`sz1_c_${'z'.repeat(513)}`) === null, 'oversized payload must be rejected');

  console.log('challenge contract smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

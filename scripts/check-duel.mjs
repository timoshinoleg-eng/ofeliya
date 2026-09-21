import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-duel-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/Duel.ts',
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
    DUEL_ID_RE,
    encodeDuelStartPayload,
    isDuelBeaten,
    parseDuelStartPayload,
  } = require(join(temp, 'Duel.js'));

  const id = 'AbCdEf0123_-xyZ9';
  assert(DUEL_ID_RE.test(id), 'valid opaque duel id rejected');
  const payload = encodeDuelStartPayload(id);
  assert(payload === `d3_${id}`, 'duel start payload encoding mismatch');
  assert(parseDuelStartPayload(payload) === id, 'duel start payload round-trip failed');
  assert(parseDuelStartPayload('d2_' + id) === null, 'unknown duel version must be rejected');
  assert(parseDuelStartPayload('d3_short') === null, 'short duel id must be rejected');
  assert(parseDuelStartPayload('d3_AbCdEf0123_-xyZ!') === null, 'unsafe start payload must be rejected');

  assert(isDuelBeaten(600_000, true, 599_999), 'faster campaign clear must beat duel target');
  assert(!isDuelBeaten(600_000, true, 600_000), 'tie must not beat duel target');
  assert(!isDuelBeaten(600_000, true, 600_001), 'slower clear must not beat duel target');
  assert(!isDuelBeaten(600_000, false, 590_000), 'death must never beat duel target');

  console.log('fixed-seed duel contract smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

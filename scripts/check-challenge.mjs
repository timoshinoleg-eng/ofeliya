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
    timeMs: 423_456,
    boss1ClearMs: 0,
    kills: 78,
    hostCellsInfected: 4,
    level: 9,
    comboBest: 21,
  };
  const survival = createChallengePayload(losingRun);
  const survivalWire = encodeChallengePayload(survival);
  assert(survival.version === 2 && survival.objective === 'survive', 'new survival challenge must be v2');
  assert(survivalWire?.startsWith('sz2_s_'), 'new survival payload must use sz2');
  assert(/^[A-Za-z0-9_-]{1,512}$/.test(survivalWire), 'payload must satisfy MAX startapp charset/length');
  assert(JSON.stringify(parseChallengePayload(survivalWire)) === JSON.stringify(survival), 'v2 survival round-trip failed');
  assert(isChallengeBeaten(survival, { ...losingRun, timeMs: 423_457 }), 'longer survival should beat target');
  assert(!isChallengeBeaten(survival, losingRun), 'tie must not beat survival target');

  const winningRun = { ...losingRun, win: true, timeMs: 550_250, boss1ClearMs: 305_000 };
  const campaign = createChallengePayload(winningRun);
  const campaignWire = encodeChallengePayload(campaign);
  assert(campaign.version === 2 && campaign.objective === 'campaign-clear', 'new win challenge must target campaign clear');
  assert(campaignWire?.startsWith('sz2_c_'), 'new campaign payload must use sz2');
  assert(JSON.stringify(parseChallengePayload(campaignWire)) === JSON.stringify(campaign), 'v2 campaign round-trip failed');
  assert(isChallengeBeaten(campaign, { ...winningRun, timeMs: 550_249 }), 'faster campaign should beat target');
  assert(!isChallengeBeaten(campaign, { ...winningRun, timeMs: 550_251 }), 'slower campaign must not beat target');
  assert(!isChallengeBeaten(campaign, { ...winningRun, win: false, timeMs: 500_000 }), 'loss must not beat campaign target');

  // Legacy sz1 clear links were created by the one-stage build. They must remain IMMUNE PRIME
  // challenges instead of being silently reinterpreted as impossible full-campaign targets.
  const legacyClear = {
    version: 1,
    objective: 'boss1-clear',
    timeMs: 310_250,
    kills: 60,
    hostCellsInfected: 3,
    level: 8,
    comboBest: 19,
  };
  const legacyWire = encodeChallengePayload(legacyClear);
  assert(legacyWire?.startsWith('sz1_c_'), 'legacy clear payload must preserve sz1 wire format');
  assert(JSON.stringify(parseChallengePayload(legacyWire)) === JSON.stringify(legacyClear), 'legacy clear round-trip failed');
  assert(
    isChallengeBeaten(legacyClear, { ...losingRun, timeMs: 700_000, boss1ClearMs: 310_249 }),
    'legacy clear must be beatable by a faster IMMUNE PRIME time even if the run later loses'
  );
  assert(
    !isChallengeBeaten(legacyClear, { ...winningRun, boss1ClearMs: 310_251 }),
    'slower IMMUNE PRIME clear must not beat legacy target'
  );
  assert(
    !isChallengeBeaten(legacyClear, { ...winningRun, boss1ClearMs: 0 }),
    'missing IMMUNE PRIME clear must not beat legacy target'
  );

  assert(parseChallengePayload('sz3_c_1_1_1_1_1') === null, 'unknown version must be rejected');
  assert(parseChallengePayload('sz2_c_1_1_1_1_1!') === null, 'invalid MAX payload characters must be rejected');
  assert(parseChallengePayload(`sz2_c_${'z'.repeat(513)}`) === null, 'oversized payload must be rejected');

  console.log('challenge v1/v2 compatibility smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

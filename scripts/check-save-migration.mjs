import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-save-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/SaveSystem.ts',
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

  const legacy = {
    bestTimeMs: 123_456,
    bestWinTimeMs: 310_000,
    bestKills: 42,
    bestLevel: 11,
    runs: 3,
    muted: true,
    totalKills: 90,
    achievements: ['first-cycle'],
    evolutionsSeen: ['prism'],
  };
  const storage = new Map([['ofeliya_save_v1', JSON.stringify(legacy)]]);
  global.localStorage = {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
  };

  const { SaveSystem } = require(join(temp, 'systems/SaveSystem.js'));
  const migrated = SaveSystem.get();
  assert(migrated.bestSurvivalMs === 123_456, 'legacy survival record was not preserved');
  assert(migrated.bestBoss1ClearMs === 310_000, 'legacy win must migrate to IMMUNE PRIME record');
  assert(migrated.bestWinTimeMs === 310_000, 'legacy bestWinTimeMs alias must remain coherent');
  assert(migrated.bestCampaignClearMs === 0, 'legacy win must never be guessed as a campaign clear');

  const heartLoss = SaveSystem.recordRun(false, 420_000, 55, 10, ['halo'], { boss1ClearMs: 305_000 });
  assert(heartLoss.timeRecord, 'Heart loss with faster Boss 1 must produce a time record');
  let save = SaveSystem.get();
  assert(save.bestSurvivalMs === 420_000, 'longer survival was not recorded');
  assert(save.bestBoss1ClearMs === 305_000, 'faster IMMUNE PRIME clear was not recorded');
  assert(save.bestCampaignClearMs === 0, 'loss must not create a campaign record');

  const campaignWin = SaveSystem.recordRun(true, 560_000, 70, 12, ['singularity'], { boss1ClearMs: 307_000 });
  assert(campaignWin.timeRecord, 'first campaign clear must be a time record');
  save = SaveSystem.get();
  assert(save.bestBoss1ClearMs === 305_000, 'slower Boss 1 clear replaced the record');
  assert(save.bestCampaignClearMs === 560_000, 'campaign clear record was not stored');

  const slowerWin = SaveSystem.recordRun(true, 570_000, 60, 9, [], { boss1ClearMs: 309_000 });
  assert(!slowerWin.timeRecord, 'slower campaign and Boss 1 times must not be records');
  save = SaveSystem.get();
  assert(save.bestCampaignClearMs === 560_000, 'slower campaign replaced fastest clear');

  const persisted = JSON.parse(storage.get('ofeliya_save_v1'));
  assert(persisted.bestWinTimeMs === 305_000, 'persisted legacy win alias drifted from Boss 1 record');
  assert(persisted.bestBoss1ClearMs === 305_000, 'persisted Boss 1 record missing');
  assert(persisted.bestCampaignClearMs === 560_000, 'persisted campaign record missing');

  console.log('save migration compatibility smoke: ok');
} finally {
  delete global.localStorage;
  rmSync(temp, { recursive: true, force: true });
}
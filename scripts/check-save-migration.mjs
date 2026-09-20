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
  assert(migrated.legendarySeen.length === 0, 'legacy save invented Legendary discovery');
  assert(migrated.standardCampaignClears === 0, 'legacy save invented Standard clears');
  assert(migrated.strainedCampaignClears === 0, 'legacy save invented Strained clears');
  assert(migrated.bestStrainedCampaignClearMs === 0, 'legacy save invented Strained record');

  const heartLoss = SaveSystem.recordRun(false, 420_000, 55, 10, ['halo'], {
    boss1ClearMs: 305_000,
    legendaryIds: ['zero-point'],
    difficultyId: 'standard',
  });
  assert(heartLoss.timeRecord, 'Heart loss with faster Boss 1 must produce a time record');
  let save = SaveSystem.get();
  assert(save.bestSurvivalMs === 420_000, 'longer survival was not recorded');
  assert(save.bestBoss1ClearMs === 305_000, 'faster IMMUNE PRIME clear was not recorded');
  assert(save.bestCampaignClearMs === 0, 'loss must not create a campaign record');

  const campaignWin = SaveSystem.recordRun(true, 560_000, 70, 12, ['singularity'], {
    boss1ClearMs: 307_000,
    legendaryIds: ['core-predator'],
    difficultyId: 'standard',
  });
  assert(campaignWin.timeRecord, 'first campaign clear must be a time record');
  save = SaveSystem.get();
  assert(save.bestBoss1ClearMs === 305_000, 'slower Boss 1 clear replaced the record');
  assert(save.bestCampaignClearMs === 560_000, 'campaign clear record was not stored');

  const slowerWin = SaveSystem.recordRun(true, 570_000, 60, 9, [], {
    boss1ClearMs: 309_000,
    difficultyId: 'standard',
  });
  assert(!slowerWin.timeRecord, 'slower campaign and Boss 1 times must not be records');
  save = SaveSystem.get();
  assert(save.bestCampaignClearMs === 560_000, 'slower campaign replaced fastest clear');

  const rankedBeforeStrained = SaveSystem.get();
  const strainedRun = SaveSystem.recordRun(
    true,
    590_000,
    999,
    99,
    ['prism'],
    {
      boss1ClearMs: 320_000,
      legendaryIds: ['last-carrier'],
      difficultyId: 'strained',
    },
    false
  );
  assert(!strainedRun.timeRecord, 'unranked Strained run created a time record');
  assert(!strainedRun.killsRecord, 'unranked Strained run created a kill record');
  assert(!strainedRun.levelRecord, 'unranked Strained run created a level record');
  save = SaveSystem.get();
  assert(
    save.bestBoss1ClearMs === rankedBeforeStrained.bestBoss1ClearMs,
    'Strained run replaced canonical Boss 1 record'
  );
  assert(
    save.bestCampaignClearMs === rankedBeforeStrained.bestCampaignClearMs,
    'Strained run replaced canonical campaign record'
  );
  assert(save.bestKills === rankedBeforeStrained.bestKills, 'Strained run replaced canonical kill record');
  assert(save.bestLevel === rankedBeforeStrained.bestLevel, 'Strained run replaced canonical level record');
  assert(save.runs === rankedBeforeStrained.runs + 1, 'Strained run was not counted in total runs');
  assert(
    save.totalKills === rankedBeforeStrained.totalKills + 999,
    'Strained kills were not counted in lifetime stats'
  );
  assert(save.standardCampaignClears === 2, 'Standard mastery clear count drifted');
  assert(save.strainedCampaignClears === 1, 'Strained mastery clear was not counted');
  assert(save.bestStrainedCampaignClearMs === 590_000, 'Strained personal record was not stored');
  assert(
    JSON.stringify([...save.legendarySeen].sort()) ===
      JSON.stringify(['core-predator', 'last-carrier', 'zero-point'].sort()),
    'Legendary Codex discovery did not persist across runs'
  );

  const persisted = JSON.parse(storage.get('ofeliya_save_v1'));
  assert(persisted.bestWinTimeMs === 305_000, 'persisted legacy win alias drifted from Boss 1 record');
  assert(persisted.bestBoss1ClearMs === 305_000, 'persisted Boss 1 record missing');
  assert(persisted.bestCampaignClearMs === 560_000, 'persisted campaign record missing');
  assert(persisted.standardCampaignClears === 2, 'persisted Standard mastery missing');
  assert(persisted.strainedCampaignClears === 1, 'persisted Strained mastery missing');
  assert(persisted.bestStrainedCampaignClearMs === 590_000, 'persisted Strained record missing');
  assert(
    persisted.legendarySeen.includes('zero-point') &&
      persisted.legendarySeen.includes('core-predator') &&
      persisted.legendarySeen.includes('last-carrier'),
    'persisted Legendary Codex entries missing'
  );

  console.log('save migration compatibility smoke: ok');
} finally {
  delete global.localStorage;
  rmSync(temp, { recursive: true, force: true });
}

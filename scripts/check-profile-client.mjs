import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-profile-client-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/ProfileClient.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { fetchServerProfile, migrateLocalSave, buildMigrationSave } = require(
    join(temp, 'systems/ProfileClient.js')
  );

  const platform = {
    kind: 'telegram',
    available: true,
    platform: 'android',
    version: '9',
    initData: 'signed-init-data',
    getUser: () => ({ id: 111 }),
    getDisplayName: () => 'Alice',
    getStartParam: () => null,
    buildStartLink: () => null,
    getViewportSize: async () => null,
    setBackHandler: () => {},
    shareResult: async () => false,
    haptic: () => {},
    notify: () => {},
  };

  const profile = {
    profileVersion: 1,
    createdAt: 1000,
    updatedAt: 2000,
    preferences: { muted: true },
    records: {
      bestSurvivalMs: 421234.7,
      bestBoss1ClearMs: 320000,
      bestCampaignClearMs: 560000,
      bestKills: 420,
      bestLevel: 17,
      runs: 12,
      totalKills: 5000,
      achievements: ['first-contact'],
      migrated: true,
    },
    inventory: { schemaVersion: 1, items: { 'founder-badge-v1': { source: 'migration', grantedAt: 1500 } } },
  };

  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  // --- valid read ---
  let requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return jsonRes(200, { ok: true, profile });
  };
  const readPlatform = { ...platform };
  const [read, concurrentRead] = await Promise.all([
    fetchServerProfile(readPlatform),
    fetchServerProfile(readPlatform),
  ]);
  assert.deepEqual(read, profile);
  assert.deepEqual(concurrentRead, profile);
  assert.equal(requests.length, 1, 'concurrent profile reads must share one network request');
  assert.match(requests.at(-1).url, /api\/profile$/);
  assert.deepEqual(requests.at(-1).body, { platform: 'telegram', initData: 'signed-init-data' });
  assert.deepEqual(await fetchServerProfile(readPlatform), profile);
  assert.equal(requests.length, 1, 'successful profile read must stay cached for the session');

  // --- valid migration claim ---
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return jsonRes(200, { ok: true, claimed: true, profile });
  };
  const migrationPlatform = { ...platform };
  const migrated = await migrateLocalSave(migrationPlatform, {
    bestTimeMs: 111,
    bestSurvivalMs: 0,
    bestWinTimeMs: 222,
    bestBoss1ClearMs: 0,
    bestCampaignClearMs: 560000,
    bestKills: -5,
    bestLevel: 17,
    runs: 12,
    muted: true,
    totalKills: 5000,
    achievements: ['first-contact', 42],
    evolutionsSeen: [],
    legendarySeen: [],
    standardCampaignClears: 1,
    strainedCampaignClears: 0,
    bestStrainedCampaignClearMs: 0,
  });
  assert.equal(migrated.claimed, true);
  assert.deepEqual(migrated.profile, profile);
  assert.match(requests.at(-1).url, /api\/profile\/migrate$/);
  const sentSave = requests.at(-1).body.save;
  assert.equal(sentSave.bestSurvivalMs, 111, 'legacy bestTimeMs folds into survival');
  assert.equal(sentSave.bestBoss1ClearMs, 222, 'legacy bestWinTimeMs folds into boss-1 record');
  assert.equal(sentSave.bestKills, 0, 'negative numbers clamp to 0');
  assert.deepEqual(sentSave.achievements, ['first-contact']);
  assert.equal(sentSave.muted, true);
  const migrationRequestCount = requests.length;
  assert.deepEqual(await fetchServerProfile(migrationPlatform), profile);
  assert.equal(
    requests.length,
    migrationRequestCount,
    'successful migration must prime the profile cache'
  );

  // buildMigrationSave is deterministic and clamps NaN/negatives
  assert.equal(buildMigrationSave({ runs: Number.NaN }).runs, 0);

  // --- idempotent repeat ---
  global.fetch = async () => jsonRes(200, { ok: true, claimed: false, profile });
  const repeat = await migrateLocalSave(platform, { runs: 1 });
  assert.equal(repeat.claimed, false);
  assert.deepEqual(repeat.profile, profile);

  // --- reject: ok !== true ---
  global.fetch = async () => jsonRes(200, { ok: false, profile });
  assert.equal(await fetchServerProfile({ ...platform }), null);
  assert.equal(await migrateLocalSave(platform, { runs: 1 }), null);

  // --- reject: missing/invalid fields ---
  global.fetch = async () => jsonRes(200, { ok: true, profile: { ...profile, records: undefined } });
  assert.equal(await fetchServerProfile({ ...platform }), null);

  global.fetch = async () => jsonRes(200, { ok: true, profile: { ...profile, profileVersion: '1' } });
  assert.equal(await fetchServerProfile({ ...platform }), null);

  global.fetch = async () => jsonRes(200, { ok: true, profile: { ...profile, records: { ...profile.records, achievements: undefined } } });
  assert.equal(await fetchServerProfile({ ...platform }), null);

  global.fetch = async () => jsonRes(200, {
    ok: true,
    profile: { ...profile, inventory: { schemaVersion: 1, items: { x: { source: 'purchase', grantedAt: 1 } } } },
  });
  assert.equal(await fetchServerProfile({ ...platform }), null, 'purchase source must never be accepted');

  global.fetch = async () => jsonRes(200, { ok: true, claimed: 'yes', profile });
  assert.equal(await migrateLocalSave(platform, { runs: 1 }), null);

  // raw identity fields are rejected outright
  global.fetch = async () => jsonRes(200, { ok: true, profile: { ...profile, uid: '111' } });
  assert.equal(await fetchServerProfile({ ...platform }), null);

  // --- reject: malformed JSON ---
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('bad json'); },
  });
  assert.equal(await fetchServerProfile({ ...platform }), null);

  // --- reject: non-2xx ---
  global.fetch = async () => jsonRes(403, { ok: false });
  assert.equal(await fetchServerProfile({ ...platform }), null);
  global.fetch = async () => jsonRes(500, {});
  assert.equal(await fetchServerProfile({ ...platform }), null);

  // --- reject: network failure remains retryable on the same platform object ---
  const retryPlatform = { ...platform };
  let retryFetches = 0;
  global.fetch = async () => {
    retryFetches += 1;
    if (retryFetches === 1) throw new Error('boom');
    return jsonRes(200, { ok: true, profile });
  };
  assert.equal(await fetchServerProfile(retryPlatform), null);
  assert.deepEqual(await fetchServerProfile(retryPlatform), profile);
  assert.equal(retryFetches, 2, 'failed profile read must not poison the session cache');
  global.fetch = async () => { throw new Error('boom'); };
  assert.equal(await migrateLocalSave(platform, { runs: 1 }), null);

  // --- precondition: browser / no initData never issues a request ---
  let unavailableFetches = 0;
  global.fetch = async () => {
    unavailableFetches += 1;
    return jsonRes(200, { ok: true, profile });
  };
  assert.equal(await fetchServerProfile({ ...platform, kind: 'browser' }), null);
  assert.equal(await fetchServerProfile({ ...platform, initData: '' }), null);
  assert.equal(await migrateLocalSave({ ...platform, kind: 'browser' }, { runs: 1 }), null);
  assert.equal(await migrateLocalSave({ ...platform, initData: '' }, { runs: 1 }), null);
  assert.equal(unavailableFetches, 0, 'no network call without a signed messenger identity');

  console.log('Profile client contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

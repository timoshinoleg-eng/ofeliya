import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-daily-v2-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/DailyRunClient.ts',
      'src/systems/ScoreClient.ts',
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

  const { requestDailyRun } = require(join(temp, 'systems/DailyRunClient.js'));
  const {
    buildDailyScoreSubmission,
    submitDailyRunScore,
  } = require(join(temp, 'systems/ScoreClient.js'));

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
  const ticket = {
    runId: 'dailyRun_123456789',
    runSeed: 'abc123def4567890',
    dateKey: '2026-09-22',
    issuedAt: 1000,
    expiresAt: 9999999999999,
    difficultyId: 'standard',
    rulesetVersion: 2,
    campaignVersion: 2,
  };
  const result = {
    win: true,
    reason: 'victory',
    difficultyId: 'standard',
    runSeed: ticket.runSeed,
    controlMode: 'dual-move',
    resumed: false,
    timeMs: 600000,
    kills: 420,
    hostCellsInfected: 12,
    level: 17,
    highestLevel: 17,
    comboBest: 7,
    stageId: 'heart',
    stageOrder: 2,
    bossesDefeated: 2,
    boss1ClearMs: 320000,
    stacks: {},
    evolutions: [],
    legendaryIds: [],
    stageBuilds: {},
    newAchievements: [],
    records: { timeRecord: false, killsRecord: false, levelRecord: false },
  };

  let requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (String(url).includes('daily/run')) {
      return { ok: true, json: async () => ({ ok: true, ticket }) };
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        rank: 3,
        ranked: true,
        rulesetVersion: 2,
        campaignVersion: 2,
        dailyRunAccepted: true,
      }),
    };
  };

  const issued = await requestDailyRun(platform);
  assert.deepEqual(issued, ticket);

  const submission = buildDailyScoreSubmission(result, platform, ticket);
  assert.equal(submission.payload.daily, true);
  assert.equal(submission.payload.dailyRunId, ticket.runId);
  assert.equal(submission.payload.runSeed, ticket.runSeed);
  assert.equal(submission.payload.dateKey, ticket.dateKey);

  assert.equal(
    buildDailyScoreSubmission({ ...result, runSeed: 'wrong-seed' }, platform, ticket),
    null
  );
  assert.equal(
    buildDailyScoreSubmission({ ...result, resumed: true }, platform, ticket),
    null
  );

  const response = await submitDailyRunScore(result, platform, ticket);
  assert.equal(response.dailyRunAccepted, true);
  assert.equal(response.rank, 3);
  assert.equal(requests.at(-1).body.payload.dailyRunId, ticket.runId);

  console.log('Daily V2 client contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

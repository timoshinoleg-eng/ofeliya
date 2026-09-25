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

  const { requestDailyRun, requestDailyRunDetailed } = require(join(temp, 'systems/DailyRunClient.js'));
  const {
    buildDailyScoreSubmission,
    submitRunScore,
    submitDailyRunScore,
    submitDailyRunScoreDetailed,
    retryPendingDailySubmission,
  } = require(join(temp, 'systems/ScoreClient.js'));
  const local = new Map();
  global.localStorage = {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, value),
    removeItem: (key) => local.delete(key),
  };

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
  assert.match(requests.at(-1).body.submissionId, /^[A-Za-z0-9_-]{16,64}$/);

  let failOnce = true;
  const retryRequests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    retryRequests.push(body);
    if (failOnce) {
      failOnce = false;
      throw new Error('response lost after commit');
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, ranked: false, rank: null, rulesetVersion: 2, campaignVersion: 2, dailyRunAccepted: true }),
    };
  };
  const lost = await submitDailyRunScoreDetailed(result, platform, ticket);
  assert.equal(lost.status, 'network');
  const pendingKey = 'ofeliya_daily_score_outbox_v1';
  const pendingId = JSON.parse(local.get(pendingKey)).submissionId;
  await retryPendingDailySubmission({ ...platform, initData: 'fresh-signed-init-data' });
  assert.equal(retryRequests[0].submissionId, pendingId);
  assert.equal(retryRequests[1].submissionId, pendingId);
  assert.equal(retryRequests[1].initData, 'fresh-signed-init-data');
  assert.equal(local.has(pendingKey), false);

  // Pending messenger scores must never be replayed under another platform identity.
  local.set('ofeliya_score_outbox_v1', JSON.stringify([{
    submissionId: 'telegram-pending-000001',
    submission: {
      platform: 'telegram',
      initData: 'stale-telegram-init',
      payload: { ...submission.payload, daily: false },
    },
  }]));
  let crossPlatformFetches = 0;
  global.fetch = async () => {
    crossPlatformFetches += 1;
    throw new Error('cross-platform replay must not happen');
  };
  await retryPendingDailySubmission({ ...platform, kind: 'max', initData: 'signed-max-init' });
  assert.equal(crossPlatformFetches, 0);
  assert.equal(JSON.parse(local.get('ofeliya_score_outbox_v1')).length, 1);
  local.delete('ofeliya_score_outbox_v1');

  // Failed ordinary submissions are bounded so an offline client cannot create an unbounded replay storm.
  global.fetch = async () => { throw new Error('offline'); };
  for (let i = 0; i < 12; i += 1) {
    await submitRunScore({ ...result, runSeed: `ordinary-${i}` }, platform);
  }
  const ordinaryOutbox = JSON.parse(local.get('ofeliya_score_outbox_v1'));
  assert.equal(ordinaryOutbox.length, 8);
  local.delete('ofeliya_score_outbox_v1');
  // --- detailed ticket status contract ---
  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  global.fetch = async () => jsonRes(200, { ok: true, ticket });
  let detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'ok');
  assert.deepEqual(detailed.ticket, ticket);

  global.fetch = async () => jsonRes(503, { ok: false });
  detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'capacity');
  assert.equal(detailed.ticket, null);

  global.fetch = async () => jsonRes(403, { ok: false });
  detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'denied');
  assert.equal(detailed.ticket, null);

  global.fetch = async () => jsonRes(500, {});
  detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'http');
  assert.equal(detailed.ticket, null);

  // ok:false 2xx is not an accepted ticket -> closest error status
  global.fetch = async () => jsonRes(200, { ok: false, ticket });
  detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'http');
  assert.equal(detailed.ticket, null);

  // malformed 2xx ticket shape -> closest error status
  global.fetch = async () => jsonRes(200, { ok: true, ticket: { runId: 5 } });
  detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'http');
  assert.equal(detailed.ticket, null);

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('bad json'); },
  });
  detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'http');
  assert.equal(detailed.ticket, null);

  global.fetch = async () => {
    throw new Error('boom');
  };
  detailed = await requestDailyRunDetailed(platform);
  assert.equal(detailed.status, 'network');
  assert.equal(detailed.ticket, null);

  // unavailable: precondition unmet, fetch must not be attempted
  let unavailableFetches = 0;
  global.fetch = async () => {
    unavailableFetches += 1;
    return jsonRes(200, { ok: true, ticket });
  };
  detailed = await requestDailyRunDetailed({ ...platform, kind: 'browser' });
  assert.equal(detailed.status, 'unavailable');
  assert.equal(detailed.ticket, null);
  detailed = await requestDailyRunDetailed({ ...platform, initData: '' });
  assert.equal(detailed.status, 'unavailable');
  assert.equal(unavailableFetches, 0);

  console.log('Daily V2 client contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

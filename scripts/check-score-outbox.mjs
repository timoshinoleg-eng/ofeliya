import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-score-outbox-'));
const require = createRequire(import.meta.url);
const key = 'ofeliya_score_outbox_v1';
const local = new Map();
const platform = { kind: 'browser' };
const result = {
  resumed: false, difficultyId: 'standard', runSeed: 'outbox-seed', controlMode: 'one-hand',
  stageId: 'bloodstream', bossesDefeated: 0, boss1ClearMs: 0, hostCellsInfected: 2,
  win: false, timeMs: 145000, kills: 73, highestLevel: 11,
};
const accepted = { ok: true, rank: null, ranked: false, rulesetVersion: 2, campaignVersion: 2 };
const response = (status, body = accepted) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const queue = () => JSON.parse(local.get(key) ?? '[]');
const ids = () => queue().map((entry) => entry.submissionId);
const seed = (...names) => {
  local.clear();
  local.set(key, JSON.stringify(names.map((name) => ({
    submissionId: `outbox-submission-${name}`,
    submission: {
      submissionId: `outbox-submission-${name}`, platform: 'browser', anonId: 'outbox-anon-0001',
      payload: { runSeed: name, daily: false },
    },
  }))));
};

try {
  execFileSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'), 'src/systems/ScoreClient.ts',
    '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--rootDir', 'src', '--outDir', temp, '--skipLibCheck', 'true', '--esModuleInterop', 'true',
  ], { stdio: 'inherit' });
  const { submitRunScore, submitDailyRunScoreDetailed, retryPendingDailySubmission } = require(join(temp, 'systems/ScoreClient.js'));
  global.localStorage = {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, value),
    removeItem: (key) => local.delete(key),
  };

  for (const status of [200, 503]) {
    await test(`append during pending replay survives ${status}`, async () => {
      seed('old');
      const gate = deferred();
      global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        return body.payload.runSeed === 'old' ? gate.promise : response(503);
      };
      const retry = retryPendingDailySubmission(platform);
      await submitRunScore(result, platform);
      const appended = queue().at(-1);
      assert.notEqual(appended.submissionId, 'outbox-submission-old');
      gate.resolve(response(status));
      await retry;
      assert.deepEqual(ids(), status === 200
        ? [appended.submissionId]
        : ['outbox-submission-old', appended.submissionId]);
      assert.deepEqual(queue().at(-1), appended);
    });
  }

  for (const status of [409, 410, 422]) {
    await test(`terminal ${status} drops only the head and attempts the next entry`, async () => {
      seed('head', 'next');
      const requests = [];
      global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body.submissionId);
        return response(body.payload.runSeed === 'head' ? status : 200);
      };
      await retryPendingDailySubmission(platform);
      assert.deepEqual(requests, ['outbox-submission-head', 'outbox-submission-next']);
      assert.deepEqual(queue(), []);
    });
    await test(`direct terminal ${status} also removes its exact entry`, async () => {
      seed('other');
      global.fetch = async () => response(status);
      assert.equal(await submitRunScore(result, platform), null);
      assert.deepEqual(ids(), ['outbox-submission-other']);
    });
  }

  for (const failure of [429, 500, 503, 'network', 'abort', 'bad-json', 'invalid-body']) {
    await test(`transient ${failure} preserves order including an appended entry`, async () => {
      seed('head', 'later');
      const gate = deferred();
      const requests = [];
      global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body.submissionId);
        if (body.payload.runSeed !== 'head') return response(503);
        await gate.promise;
        if (failure === 'network') throw new TypeError('offline');
        if (failure === 'abort') throw new DOMException('aborted', 'AbortError');
        if (failure === 'bad-json') return { ok: true, status: 200, json: async () => { throw new SyntaxError(); } };
        if (failure === 'invalid-body') return response(200, { ok: false });
        return response(failure);
      };
      const retry = retryPendingDailySubmission(platform);
      await submitRunScore(result, platform);
      const appendedId = ids().at(-1);
      gate.resolve();
      await retry;
      assert.deepEqual(ids(), ['outbox-submission-head', 'outbox-submission-later', appendedId]);
      assert.deepEqual(requests, ['outbox-submission-head', appendedId]);
    });
  }

  await test('an older failed replay cannot resurrect an entry removed by overlapping replay', async () => {
    seed('old');
    const gate = deferred();
    let calls = 0;
    global.fetch = async () => ++calls === 1 ? gate.promise : response(200);
    const first = retryPendingDailySubmission(platform);
    await retryPendingDailySubmission(platform);
    assert.deepEqual(queue(), []);
    gate.resolve(response(503));
    await first;
    assert.deepEqual(queue(), []);
  });

  await test('bounded queue and replay IDs survive a stale pass and a lost response', async () => {
    seed('old');
    const gate = deferred();
    global.fetch = async (_url, options) => JSON.parse(options.body).payload.runSeed === 'old'
      ? gate.promise : response(503);
    const retry = retryPendingDailySubmission(platform);
    for (let index = 0; index < 12; index += 1) {
      await submitRunScore({ ...result, runSeed: `new-${index}` }, platform);
      assert.ok(queue().length <= 8);
    }
    const bounded = queue();
    assert.deepEqual(bounded.map((entry) => entry.submission.payload.runSeed),
      Array.from({ length: 8 }, (_, index) => `new-${index + 4}`));
    assert.equal(new Set(ids()).size, 8);
    gate.resolve(response(503));
    await retry;
    assert.deepEqual(queue(), bounded);

    const attempts = [];
    global.fetch = async (_url, options) => {
      attempts.push(JSON.parse(options.body).submissionId);
      throw new Error('response lost after commit');
    };
    await retryPendingDailySubmission(platform);
    assert.deepEqual(queue(), bounded);
    global.fetch = async (_url, options) => {
      attempts.push(JSON.parse(options.body).submissionId);
      return response(200);
    };
    await retryPendingDailySubmission(platform);
    assert.deepEqual(attempts, [bounded[0].submissionId, ...bounded.map((entry) => entry.submissionId)]);
    assert.deepEqual(queue(), []);
  });

  for (const kind of ['max', 'telegram']) {
    await test(`${kind} credentials travel on the wire but never persist in either outbox`, async () => {
      local.clear();
      const requests = [];
      global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return response(503);
      };
      const messenger = { kind, initData: 'raw-private-launch-credential' };
      await submitRunScore(result, messenger);
      assert.equal(requests[0].initData, messenger.initData);
      assert.equal(queue()[0].submission.initData, undefined);
      const ticket = { runId: 'dailyRun_123456789', runSeed: result.runSeed, dateKey: '2026-10-05', issuedAt: Date.now(), expiresAt: Date.now() + 3600000 };
      await submitDailyRunScoreDetailed(result, messenger, ticket);
      assert.equal(requests[1].initData, messenger.initData);
      const dailyKey = 'ofeliya_daily_score_outbox_v1';
      assert.equal(JSON.parse(local.get(dailyKey)).submission.initData, undefined);
      // Old releases already persisted credentials. Startup must scrub them even
      // when current platform cannot replay that messenger queue.
      for (const storageKey of [key, dailyKey]) {
        const stored = JSON.parse(local.get(storageKey));
        const entry = Array.isArray(stored) ? stored[0] : stored;
        entry.submission.initData = 'legacy-private-credential';
        local.set(storageKey, JSON.stringify(stored));
      }
      await retryPendingDailySubmission({ kind: 'browser' });
      assert.ok([...local.values()].every((value) => !value.includes('private-credential')));
      // Expired offline entries must not persist indefinitely.
      for (const storageKey of [key, dailyKey]) {
        const stored = JSON.parse(local.get(storageKey));
        const entry = Array.isArray(stored) ? stored[0] : stored;
        entry.queuedAt = Date.now() - 8 * 86400000;
        local.set(storageKey, JSON.stringify(stored));
      }
      await retryPendingDailySubmission({ kind: 'browser' });
      assert.deepEqual(queue(), []);
      assert.equal(local.has(dailyKey), false);
    });
    await test(`${kind} replay refreshes initData and preserves mismatched identity`, async () => {
      seed('messenger', 'browser');
      const entries = queue();
      entries[0].submission.platform = kind;
      entries[0].submission.initData = 'stale-init';
      entries[0].submission.runToken = 'existing-run-token';
      entries[0].ownerId = '101';
      local.set(key, JSON.stringify(entries));
      const requests = [];
      global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return response(200);
      };
      await retryPendingDailySubmission({ kind: 'browser' });
      assert.deepEqual(ids(), ['outbox-submission-messenger']);
      assert.equal(requests.length, 1);
      await retryPendingDailySubmission({ kind, initData: 'other-user', getUser: () => ({ id: 102 }) });
      assert.equal(requests.length, 1, 'same platform different user must not replay');
      await retryPendingDailySubmission({ kind, initData: 'fresh-init', getUser: () => ({ id: 101 }) });
      assert.equal(requests[1].initData, 'fresh-init');
      assert.equal(requests[1].runToken, 'existing-run-token');
      assert.equal(requests[1].submissionId, entries[0].submissionId);
      assert.deepEqual(queue(), []);
    });
  }
  await test('Daily terminal409 releases ordinary replay and overlapping Daily removal is exact', async () => {
    seed('ordinary');
    const dailyKey = 'ofeliya_daily_score_outbox_v1';
    local.set(dailyKey, JSON.stringify({ submissionId: 'daily-old', ownerId: '101', submission: { platform: 'telegram', payload: { dailyRunId: 'daily-old' } } }));
    const calls = [];
    global.fetch = async (_url, options) => { const body = JSON.parse(options.body); calls.push(body.submissionId); return response(body.payload.dailyRunId ? 409 : 200); };
    await retryPendingDailySubmission({ kind: 'telegram', initData: 'fresh', getUser: () => ({ id: 101 }) });
    assert.deepEqual(calls, ['daily-old', 'outbox-submission-ordinary']);
    assert.equal(local.has(dailyKey), false);
    assert.deepEqual(queue(), []);
  });
  await test('fresh Daily submission supersedes legacy unknown or other-account slot', async () => {
    for (const ownerId of [undefined, '100', '101']) {
      local.clear();
      const dailyKey = 'ofeliya_daily_score_outbox_v1';
      local.set(dailyKey, JSON.stringify({submissionId:'old-slot',ownerId,submission:{platform:ownerId === '101' ? 'max' : 'telegram',payload:{dailyRunId:'old-ticket'}}}));
      const requests=[];
      global.fetch = async (_url,options) => {requests.push(JSON.parse(options.body));return response(503);};
      const ticket = {runId:'new-ticket',runSeed:result.runSeed,dateKey:'2026-10-05',issuedAt:Date.now(),expiresAt:Date.now()+3600000};
      await submitDailyRunScoreDetailed(result,{kind:'telegram',initData:'fresh',getUser:()=>({id:101})},ticket);
      assert.equal(requests.length,1);
      const stored=JSON.parse(local.get(dailyKey));
      assert.equal(stored.ownerId,'101');
      assert.equal(stored.submission.payload.dailyRunId,'new-ticket');
    }
  });
  await test('completed Daily retry cannot remove a replacement appended while awaiting response', async () => {
    local.clear();const dailyKey='ofeliya_daily_score_outbox_v1';
    local.set(dailyKey,JSON.stringify({submissionId:'old',ownerId:'101',submission:{platform:'telegram',payload:{dailyRunId:'old'}}}));
    const gate=deferred();global.fetch=()=>gate.promise;
    const retry=retryPendingDailySubmission({kind:'telegram',initData:'fresh',getUser:()=>({id:101})});
    const replacement={submissionId:'new',ownerId:'101',submission:{platform:'telegram',payload:{dailyRunId:'new'}}};
    local.set(dailyKey,JSON.stringify(replacement));gate.resolve(response(409));await retry;
    assert.equal(JSON.parse(local.get(dailyKey)).submissionId,'new');
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

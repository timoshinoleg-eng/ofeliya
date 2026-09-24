#!/usr/bin/env node
/**
 * Тесты score-сервера (V4 / Ruleset V2). Запуск: node server/test.mjs
 *
 * Проверяют: HMAC-валидация initData TG/MAX, production BOT_TOKEN fallback,
 * дубликаты параметров, анти-чит, дедупликация/порядок топов, daily/season,
 * реферальные рёбра, friends и VK verified/unverified.
 */
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TG_TOKEN = '7123456789:TEST-TOKEN-for-ofeliya';
const MAX_TOKEN = 'TEST-MAX-TOKEN-000';
const VK_SECURE_KEY = 'test-vk-secure-key-123';

// Force server-local calendar time away from UTC so UTC/local date-key drift is deterministic.
// UTC < 10:00 uses UTC-10 (previous local day); otherwise UTC+14 (next local day).
process.env.TZ = new Date().getUTCHours() < 10 ? 'America/Adak' : 'Pacific/Kiritimati';

process.env.TG_BOT_TOKEN = TG_TOKEN;
// Production MAX bot historically uses BOT_TOKEN. Deliberately do NOT set
// MAX_BOT_TOKEN here: this verifies the score-service fallback contract.
process.env.BOT_TOKEN = MAX_TOKEN;
delete process.env.MAX_BOT_TOKEN;
process.env.VK_SECURE_KEY = VK_SECURE_KEY;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'ofeliya-server-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = '0';

const { server, compactDailyRunEntries } = await import('./index.mjs');
await new Promise((resolve) => server.once('listening', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

function signInitData(user, token, { date = Math.floor(Date.now() / 1000) } = {}) {
  const params = {
    user: JSON.stringify(user),
    auth_date: String(date),
    query_id: 'AAF-test',
  };
  const dataCheck = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

function makeWebAppT(pairs, secretKey) {
  const entries = Object.entries(pairs);
  const i = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const checkString = entries
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n') + '\n';
  const t = createHmac('sha256', Buffer.from(secretKey, 'utf8'))
    .update(Buffer.from(checkString, 'utf8'))
    .digest('hex');
  return Buffer.from(JSON.stringify({ v: 2, i, t }), 'utf8').toString('base64');
}

const ALICE = { id: 111, first_name: 'Alice', username: 'alice' };
const BOB = { id: 222, first_name: 'Bob', username: 'bob' };

function campaignPayload({
  seed = 'duel-seed-001',
  timeMs = 600_000,
  controlMode = 'dual-move',
  win = true,
  completionStage = win ? 'heart' : 'bloodstream',
  bossesDefeated = win ? 2 : 0,
  boss1ClearMs = win ? 320_000 : null,
  difficultyId = 'standard',
  resumed = false,
} = {}) {
  return {
    rulesetVersion: 2,
    campaignVersion: 2,
    difficultyId,
    completionStage,
    runSeed: seed,
    controlMode,
    bossesDefeated,
    boss1ClearMs,
    hostCellsInfected: 9,
    win,
    timeMs,
    kills: 420,
    level: 17,
    resumed,
    daily: false,
  };
}

const j = (r) => r.json();
let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      console.error(`  ✗ ${name}: ${e.message}`);
      process.exitCode = 1;
    });
}

console.log('ofeliya-server tests');

await ok('GET /health', async () => {
  const r = await j(await fetch(`${BASE}/health`));
  assert.equal(r.ok, true);
  assert.equal(r.rulesetVersion, 2);
  assert.equal(r.campaignVersion, 2);
});

await ok('GET /api/ruleset публикует текущий двухактный контракт', async () => {
  const r = await j(await fetch(`${BASE}/api/ruleset`));
  assert.equal(r.ok, true);
  assert.equal(r.rulesetVersion, 2);
  assert.equal(r.campaignVersion, 2);
  assert.equal(r.rankedDifficultyId, 'standard');
  assert.equal(r.minCampaignWinTimeMs, 540_000);
  assert.deepEqual(r.supportedRulesets, [1, 2]);
});

await ok('TG: валидный initData принимается', async () => {
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: true, timeMs: 340_000, kills: 240, level: 12, daily: false },
    }),
  }));
  assert.equal(r.ok, true);
  assert.equal(r.rank, 1);
});

await ok('TG: подделанный initData отклоняется (403)', async () => {
  const initData = signInitData(ALICE, TG_TOKEN).replace(/auth_date=\d+/, 'auth_date=1') + '&x=1';
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'telegram', initData, payload: { win: true, timeMs: 340_000, kills: 240, level: 12 } }),
  });
  assert.equal(res.status, 403);
});

await ok('TG/MAX: дубликат подписанного параметра отклоняется (403)', async () => {
  const base = signInitData(ALICE, TG_TOKEN);
  const authDate = new URLSearchParams(base).get('auth_date');
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: `${base}&auth_date=${authDate}`,
      payload: { win: true, timeMs: 340_000, kills: 200, level: 10 },
    }),
  });
  assert.equal(res.status, 403);
});

await ok('TG: чужой токен не проходит', async () => {
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, 'WRONG:TOKEN'),
      payload: { win: true, timeMs: 340_000, kills: 240, level: 12 },
    }),
  });
  assert.equal(res.status, 403);
});

await ok('MAX: официальный WebAppData initData + BOT_TOKEN fallback принимаются', async () => {
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'max', initData: signInitData(BOB, MAX_TOKEN),
      payload: { win: true, timeMs: 330_000, kills: 180, level: 9, daily: false },
    }),
  }));
  assert.equal(r.ok, true);
});

await ok('анти-чит: победа до появления босса невозможна (422)', async () => {
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: true, timeMs: 299_999, kills: 100, level: 8 },
    }),
  });
  assert.equal(res.status, 422);
  assert.match((await j(res)).error, /win-time/);
});

await ok('ruleset v2: Standard campaign win принимается и ранжируется отдельно', async () => {
  const dora = { id: 444, first_name: 'Dora', username: 'dora' };
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'max',
      initData: signInitData(dora, MAX_TOKEN),
      payload: {
        rulesetVersion: 2,
        campaignVersion: 2,
        difficultyId: 'standard',
        completionStage: 'heart',
        runSeed: 'qa-v2-standard',
        controlMode: 'dual-move',
        bossesDefeated: 2,
        boss1ClearMs: 312_000,
        hostCellsInfected: 9,
        win: true,
        timeMs: 560_000,
        kills: 420,
        level: 17,
        daily: false,
      },
    }),
  }));
  assert.equal(r.ok, true);
  assert.equal(r.ranked, true);
  assert.equal(r.rank, 1);
  assert.equal(r.rulesetVersion, 2);
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.equal(top.rulesetVersion, 2);
  assert.equal(top.top.length, 1);
  assert.equal(top.top[0].difficultyId, 'standard');
  assert.equal(top.top[0].completionStage, 'heart');
  assert.equal(top.top[0].rulesetVersion, 2);
});

await ok('ruleset v2: победа раньше 9:00 невозможна (422)', async () => {
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      payload: {
        rulesetVersion: 2,
        campaignVersion: 2,
        difficultyId: 'standard',
        completionStage: 'heart',
        runSeed: 'qa-v2-too-fast',
        controlMode: 'one-hand',
        bossesDefeated: 2,
        boss1ClearMs: 305_000,
        hostCellsInfected: 4,
        win: true,
        timeMs: 539_999,
        kills: 250,
        level: 15,
      },
    }),
  });
  assert.equal(res.status, 422);
  assert.match((await j(res)).error, /win-time/);
});

await ok('ruleset v2: win обязан завершаться в Heart после двух боссов', async () => {
  const badStage = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      payload: {
        rulesetVersion: 2,
        campaignVersion: 2,
        difficultyId: 'standard',
        completionStage: 'bloodstream',
        runSeed: 'qa-v2-bad-stage',
        controlMode: 'one-hand',
        bossesDefeated: 2,
        boss1ClearMs: 305_000,
        hostCellsInfected: 4,
        win: true,
        timeMs: 560_000,
        kills: 250,
        level: 15,
      },
    }),
  });
  assert.equal(badStage.status, 422);
  assert.match((await j(badStage)).error, /win-stage/);

  const badBosses = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      payload: {
        rulesetVersion: 2,
        campaignVersion: 2,
        difficultyId: 'standard',
        completionStage: 'heart',
        runSeed: 'qa-v2-bad-bosses',
        controlMode: 'one-hand',
        bossesDefeated: 1,
        boss1ClearMs: 305_000,
        hostCellsInfected: 4,
        win: true,
        timeMs: 560_000,
        kills: 250,
        level: 15,
      },
    }),
  });
  assert.equal(badBosses.status, 422);
  assert.match((await j(badBosses)).error, /win-bosses/);
});

await ok('ruleset v2: Strained сохраняется, но сервер не даёт рейтинг', async () => {
  const strained = { id: 555, first_name: 'Strain', username: 'strain' };
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'max',
      initData: signInitData(strained, MAX_TOKEN),
      payload: {
        rulesetVersion: 2,
        campaignVersion: 2,
        difficultyId: 'strained',
        completionStage: 'heart',
        runSeed: 'qa-v2-strained',
        controlMode: 'two-hand',
        bossesDefeated: 2,
        boss1ClearMs: 320_000,
        hostCellsInfected: 12,
        win: true,
        timeMs: 575_000,
        kills: 500,
        level: 18,
      },
    }),
  }));
  assert.equal(r.ok, true);
  assert.equal(r.ranked, false);
  assert.equal(r.rank, null);
  const ranked = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.ok(!ranked.top.some((row) => row.difficultyId === 'strained'));
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&includeUnverified=1`));
  assert.ok(shadow.top.some((row) => row.difficultyId === 'strained'));
});

await ok('ruleset filters: current, legacy и all не смешиваются молча', async () => {
  const current = await j(await fetch(`${BASE}/api/top?period=all`));
  const legacy = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy`));
  const all = await j(await fetch(`${BASE}/api/top?period=all&ruleset=all`));
  assert.equal(current.rulesetVersion, 2);
  assert.equal(legacy.rulesetVersion, 1);
  assert.equal(all.rulesetVersion, null);
  assert.ok(current.top.every((row) => row.rulesetVersion === 2));
  assert.ok(legacy.top.every((row) => row.rulesetVersion === 1));
  assert.ok(all.top.some((row) => row.rulesetVersion === 1));
  assert.ok(all.top.some((row) => row.rulesetVersion === 2));
});

await ok('анти-чит: слишком много kills (422)', async () => {
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: false, timeMs: 30_000, kills: 999_999, level: 5 },
    }),
  });
  assert.equal(res.status, 422);
});

await ok('анти-чит: слишком короткий timeMs (422)', async () => {
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: false, timeMs: 10, kills: 5, level: 2 },
    }),
  });
  assert.equal(res.status, 422);
});

await ok('анти-чит: застарелый auth_date (403)', async () => {
  const initData = signInitData(ALICE, TG_TOKEN, { date: Math.floor(Date.now() / 1000) - 3 * 86_400 });
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'telegram', initData, payload: { win: true, timeMs: 340_000, kills: 240, level: 12 } }),
  });
  assert.equal(res.status, 403);
});

await ok('fixed-seed duel: verified Standard clear creates immutable 7-day snapshot', async () => {
  const before = await j(await fetch(`${BASE}/health`));
  const response = await fetch(`${BASE}/api/duel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'max',
      initData: signInitData(BOB, MAX_TOKEN),
      payload: campaignPayload(),
    }),
  });
  assert.equal(response.status, 201);
  const created = await j(response);
  assert.equal(created.ok, true);
  assert.equal(created.ranked, false);
  assert.match(created.challenge.challengeId, /^[A-Za-z0-9_-]{16,32}$/);
  assert.equal(created.challenge.runSeed, 'duel-seed-001');
  assert.equal(created.challenge.controlMode, 'dual-move');
  assert.equal(created.challenge.difficultyId, 'standard');
  assert.equal(created.challenge.targetTimeMs, 600_000);
  assert.ok(created.challenge.expiresAt - created.challenge.createdAt >= 7 * 86_400_000 - 1000);

  const loaded = await j(await fetch(`${BASE}/api/duel/${created.challenge.challengeId}`));
  assert.deepEqual(loaded.challenge, created.challenge);
  assert.equal(Object.hasOwn(loaded.challenge, 'ownerUid'), false);
  assert.equal(Object.hasOwn(loaded.challenge, 'source'), false);

  globalThis.__DUEL_ID = created.challenge.challengeId;
  const after = await j(await fetch(`${BASE}/health`));
  assert.equal(after.duels, before.duels + 1);
  assert.ok(after.duelEvents >= before.duelEvents + 1);
});

await ok('fixed-seed duel: create rejects browser, resumed and Strained sources', async () => {
  const browser = await fetch(`${BASE}/api/duel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'browser', anonId: 'anon-duel-test', payload: campaignPayload() }),
  });
  assert.equal(browser.status, 403);

  const resumed = await fetch(`${BASE}/api/duel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'max',
      initData: signInitData(BOB, MAX_TOKEN),
      payload: campaignPayload({ resumed: true }),
    }),
  });
  assert.equal(resumed.status, 422);

  const strained = await fetch(`${BASE}/api/duel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'max',
      initData: signInitData(BOB, MAX_TOKEN),
      payload: campaignPayload({ difficultyId: 'strained' }),
    }),
  });
  assert.equal(strained.status, 422);
});

await ok('fixed-seed duel: open/start/rematch telemetry is verified and bounded to snapshot', async () => {
  const challengeId = globalThis.__DUEL_ID;
  assert.ok(challengeId);
  for (const event of ['open', 'start', 'rematch']) {
    const response = await fetch(`${BASE}/api/duel/${challengeId}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'telegram',
        initData: signInitData(ALICE, TG_TOKEN),
        event,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await j(response)).ranked, false);
  }

  const bad = await fetch(`${BASE}/api/duel/${challengeId}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, 'WRONG:TOKEN'),
      event: 'start',
    }),
  });
  assert.equal(bad.status, 403);
});

await ok('fixed-seed duel: exact seed/control required; slower loses, faster wins, rematches unlimited', async () => {
  const challengeId = globalThis.__DUEL_ID;
  const auth = {
    platform: 'telegram',
    initData: signInitData(ALICE, TG_TOKEN),
  };

  const wrongSeed = await fetch(`${BASE}/api/duel/${challengeId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...auth,
      payload: campaignPayload({ seed: 'different-seed', timeMs: 590_000 }),
    }),
  });
  assert.equal(wrongSeed.status, 422);
  assert.match((await j(wrongSeed)).error, /snapshot mismatch/);

  const wrongControl = await fetch(`${BASE}/api/duel/${challengeId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...auth,
      payload: campaignPayload({ controlMode: 'one-hand', timeMs: 590_000 }),
    }),
  });
  assert.equal(wrongControl.status, 422);

  const slower = await j(await fetch(`${BASE}/api/duel/${challengeId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, payload: campaignPayload({ timeMs: 610_000 }) }),
  }));
  assert.equal(slower.ok, true);
  assert.equal(slower.ranked, false);
  assert.equal(slower.valid, true);
  assert.equal(slower.beaten, false);
  assert.equal(slower.everBeaten, false);
  assert.equal(slower.attemptCount, 1);
  assert.equal(slower.bestTimeMs, 610_000);

  const death = await j(await fetch(`${BASE}/api/duel/${challengeId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...auth,
      payload: campaignPayload({
        win: false,
        timeMs: 580_000,
        completionStage: 'bloodstream',
        bossesDefeated: 0,
        boss1ClearMs: null,
      }),
    }),
  }));
  assert.equal(death.beaten, false);
  assert.equal(death.everBeaten, false);
  assert.equal(death.attemptCount, 2);
  assert.equal(death.bestTimeMs, 610_000);

  const faster = await j(await fetch(`${BASE}/api/duel/${challengeId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, payload: campaignPayload({ timeMs: 590_000 }) }),
  }));
  assert.equal(faster.ok, true);
  assert.equal(faster.beaten, true);
  assert.equal(faster.everBeaten, true);
  assert.equal(faster.targetTimeMs, 600_000);
  assert.equal(faster.attemptCount, 3);
  assert.equal(faster.bestTimeMs, 590_000);

  const tie = await j(await fetch(`${BASE}/api/duel/${challengeId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, payload: campaignPayload({ timeMs: 600_000 }) }),
  }));
  assert.equal(tie.beaten, false);
  assert.equal(tie.everBeaten, true);
  assert.equal(tie.attemptCount, 4);
  assert.equal(tie.bestTimeMs, 590_000);

  const health = await j(await fetch(`${BASE}/health`));
  assert.ok(health.duelAttempts >= 4);
  assert.ok(health.duelEvents >= 8);
});

await ok('топ: лучший результат на юзера + более быстрая победа выше', async () => {
  await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: true, timeMs: 320_000, kills: 150, level: 8 },
    }),
  }));
  const top = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy`));
  assert.equal(top.top.length, 2);
  assert.equal(top.top[0].timeMs, 320_000);
  assert.equal(top.top[0].platform, 'telegram');
  assert.equal(top.top[0].rank, 1);
  assert.equal(top.top[1].platform, 'max');
  assert.ok(top.top.every((row) => !Object.hasOwn(row, 'uid')));
});

await ok('Daily V2: сервер выдаёт identity-bound ticket и переиспользует незакрытый', async () => {
  const auth = {
    platform: 'telegram',
    initData: signInitData(ALICE, TG_TOKEN),
  };
  const firstResponse = await fetch(`${BASE}/api/daily/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auth),
  });
  assert.equal(firstResponse.status, 201);
  const first = await j(firstResponse);
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  assert.equal(first.ticket.difficultyId, 'standard');
  assert.equal(first.ticket.rulesetVersion, 2);
  assert.equal(first.ticket.campaignVersion, 2);
  assert.match(first.ticket.runId, /^[A-Za-z0-9_-]{16,32}$/);
  assert.match(first.ticket.runSeed, /^[a-f0-9]{16}$/);

  const secondResponse = await fetch(`${BASE}/api/daily/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auth),
  });
  assert.equal(secondResponse.status, 200);
  const second = await j(secondResponse);
  assert.equal(second.reused, true);
  assert.equal(second.ticket.runId, first.ticket.runId);
  assert.equal(second.ticket.runSeed, first.ticket.runSeed);

  const scoreResponse = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...auth,
      payload: {
        ...campaignPayload({ seed: first.ticket.runSeed, timeMs: 600_000 }),
        daily: true,
        dailyRunId: first.ticket.runId,
        dateKey: '1999-01-01',
      },
    }),
  });
  assert.equal(scoreResponse.status, 200);
  const scored = await j(scoreResponse);
  assert.equal(scored.ok, true);
  assert.equal(scored.dailyRunAccepted, true);

  const duplicate = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...auth,
      payload: {
        ...campaignPayload({ seed: first.ticket.runSeed, timeMs: 601_000 }),
        daily: true,
        dailyRunId: first.ticket.runId,
      },
    }),
  });
  assert.equal(duplicate.status, 409);

  const next = await j(await fetch(`${BASE}/api/daily/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auth),
  }));
  assert.notEqual(next.ticket.runId, first.ticket.runId);
  assert.equal(next.ticket.runSeed, first.ticket.runSeed);
});

await ok('Daily V2: ruleset v2 daily без ticket отклоняется', async () => {
  const response = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      payload: {
        ...campaignPayload({ seed: 'ticketless-v2', timeMs: 600_000 }),
        daily: true,
      },
    }),
  });
  assert.equal(response.status, 422);
  assert.match((await j(response)).error, /ticket required/);
});

await ok('Daily V2: capacity compaction preserves active tickets', async () => {
  const now = Date.now();
  const active = [
    { runId: 'active-1', closedAt: null, expiresAt: now + 60_000 },
    { runId: 'active-2', closedAt: null, expiresAt: now + 60_000 },
  ];
  const stale = [
    { runId: 'closed', closedAt: now - 1, expiresAt: now + 60_000 },
    { runId: 'expired', closedAt: null, expiresAt: now - 1 },
  ];
  const compacted = compactDailyRunEntries([...stale, ...active], now, 3, 1);
  assert.equal(compacted.hasCapacity, true);
  assert.deepEqual(compacted.runs.map((run) => run.runId).sort(), ['active-1', 'active-2']);

  const full = compactDailyRunEntries(active, now, 2, 1);
  assert.equal(full.hasCapacity, false);
  assert.equal(full.runs.length, 2);
});

await ok('Daily V2: ticket нельзя использовать другой identity или seed', async () => {
  const aliceAuth = {
    platform: 'telegram',
    initData: signInitData(ALICE, TG_TOKEN),
  };
  const ticketBody = await j(await fetch(`${BASE}/api/daily/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(aliceAuth),
  }));
  const ticket = ticketBody.ticket;

  const wrongOwner = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(BOB, TG_TOKEN),
      payload: {
        ...campaignPayload({ seed: ticket.runSeed, timeMs: 600_000 }),
        daily: true,
        dailyRunId: ticket.runId,
      },
    }),
  });
  assert.equal(wrongOwner.status, 403);

  const wrongSeed = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...aliceAuth,
      payload: {
        ...campaignPayload({ seed: 'wrong-daily-seed', timeMs: 600_000 }),
        daily: true,
        dailyRunId: ticket.runId,
      },
    }),
  });
  assert.equal(wrongSeed.status, 422);
});

await ok('top daily: только daily-результаты сегодня', async () => {
  await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: false, timeMs: 120_000, kills: 60, level: 4, daily: true },
    }),
  }));
  const daily = await j(await fetch(`${BASE}/api/top?period=daily&ruleset=legacy`));
  assert.equal(daily.top.length, 1);
  assert.equal(daily.top[0].timeMs, 120_000);
  assert.equal(daily.top[0].daily, true);
  assert.ok(!Object.hasOwn(daily.top[0], 'uid'));
});

await ok('top weekly: результаты за 7 дней', async () => {
  const weekly = await j(await fetch(`${BASE}/api/top?period=weekly&ruleset=legacy`));
  assert.ok(weekly.top.length >= 1);
});

await ok('рефы: награда один раз, повтор без награды', async () => {
  const carol = { id: 333, first_name: 'Carol', username: 'carol' };
  const r1 = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'max', initData: signInitData(carol, MAX_TOKEN),
      payload: { win: true, timeMs: 400_000, kills: 200, level: 10, ref: 't_111' },
    }),
  }));
  assert.ok(r1.refReward);
  assert.equal(r1.refReward.from, 'telegram:111');
  assert.equal(r1.refReward.first, true);

  const r2 = await j(await fetch(`${BASE}/api/ref`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'telegram:111', to: '333', platform: 'max' }),
  }));
  assert.equal(r2.first, false);
  const status = await j(await fetch(`${BASE}/api/ref?user=111&platform=telegram`));
  assert.equal(status.invited, 1);
});

await ok('browser: anonId принимается, но не попадает в верифицированный топ', async () => {
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'browser', anonId: 'anon-browser-12345678',
      payload: { win: true, timeMs: 310_000, kills: 50, level: 6 },
    }),
  }));
  assert.equal(r.ok, true);
  const top = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy`));
  assert.ok(!top.top.some((t) => t.platform === 'browser'));
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy&includeUnverified=1`));
  assert.ok(shadow.top.some((t) => t.platform === 'browser'));
  assert.ok(shadow.top.every((row) => !Object.hasOwn(row, 'uid')));
});

await ok('daily: быстрее победа получает лучший rank', async () => {
  const now = Date.now();
  const dk = () => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const entries = [
    { platform: 'browser', anonId: 'anon-11111111', payload: { daily: true, win: true, timeMs: 312_000, kills: 9, level: 5, dateKey: dk() } },
    { platform: 'browser', anonId: 'anon-22222222', payload: { daily: true, win: false, timeMs: 30_000, kills: 4, level: 3, dateKey: dk() } },
    { platform: 'browser', anonId: 'anon-33333333', payload: { daily: true, win: true, timeMs: 320_000, kills: 20, level: 6, dateKey: dk() } },
  ];
  for (const body of entries) {
    await j(await fetch(`${BASE}/api/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  }
  const d = await j(await fetch(`${BASE}/api/daily?user=anon-11111111&platform=browser&ruleset=legacy`));
  assert.equal(d.ok, true);
  assert.ok(d.total >= 3);
  assert.equal(d.rank, 1);
  assert.equal(d.dateKey, dk());
  const none = await j(await fetch(`${BASE}/api/daily?user=anon-99999999&platform=browser&ruleset=legacy`));
  assert.equal(none.rank, null);
  assert.equal(none.total, 0);
});

await ok('season: текущий сезон + сезонный топ (C5)', async () => {
  const s = await j(await fetch(`${BASE}/api/season`));
  assert.equal(s.ok, true);
  const { index, start, end, daysLeft } = s.season;
  assert.ok(index >= 0);
  assert.equal(end - start, 14 * 86_400_000);
  assert.ok(daysLeft >= 0 && daysLeft <= 14);
  const seasonTop = await j(await fetch(`${BASE}/api/top?period=season&ruleset=legacy`));
  assert.equal(seasonTop.ok, true);
  assert.ok(Array.isArray(seasonTop.top));
  assert.equal(seasonTop.season.index, index);
});

await ok('friends: топ друзей по реф-рёбрам (двунаправленно)', async () => {
  const as111 = await j(await fetch(`${BASE}/api/friends?user=111&platform=telegram`));
  assert.equal(as111.ok, true);
  const invitedBy111 = as111.friends.find((f) => f.relation === 'invited' && f.platform === 'max');
  assert.ok(invitedBy111);
  assert.ok(as111.friends.every((row) => !Object.hasOwn(row, 'uid')));
  const as333 = await j(await fetch(`${BASE}/api/friends?user=333&platform=max`));
  const inviter = as333.friends.find((f) => f.relation === 'inviter' && f.platform === 'telegram');
  assert.ok(inviter);
  const lonely = await j(await fetch(`${BASE}/api/friends?user=99999&platform=telegram`));
  assert.equal(lonely.friends.length, 0);
});

await ok('vk: числовой VK user id принимается (unverified)', async () => {
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'vk', anonId: '98765',
      payload: { win: true, timeMs: 320_000, kills: 130, level: 7, daily: false },
    }),
  }));
  assert.equal(r.ok, true);
  const top = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy`));
  assert.ok(!top.top.some((t) => t.platform === 'vk'));
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy&includeUnverified=1`));
  assert.ok(shadow.top.some((t) => t.platform === 'vk'));
  assert.ok(shadow.top.every((row) => !Object.hasOwn(row, 'uid')));
});

await ok('vk: валидный web_app_t → verified (общий топ)', async () => {
  const user = { id: 77777, first_name: 'Vera', username: 'vera' };
  const webAppInit = makeWebAppT({ user: JSON.stringify(user), app: '123456' }, VK_SECURE_KEY);
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'vk', anonId: '77777', webAppInit,
      payload: { win: true, timeMs: 305_000, kills: 180, level: 9, daily: false },
    }),
  }));
  assert.equal(r.ok, true);
  assert.ok(r.rank !== null);
  const top = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy`));
  assert.ok(top.top.some((t) => t.platform === 'vk'));
  assert.ok(top.top.every((row) => !Object.hasOwn(row, 'uid')));
});

await ok('vk: подделанный web_app_t → unverified (фолбэк на anonId)', async () => {
  const user = { id: 88888, first_name: 'Mara' };
  let token = makeWebAppT({ user: JSON.stringify(user), app: '123456' }, VK_SECURE_KEY);
  token = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
  const r = await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'vk', anonId: '88888', webAppInit: token,
      payload: { win: true, timeMs: 315_000, kills: 90, level: 6, daily: false },
    }),
  }));
  assert.equal(r.ok, true);
  const top = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy`));
  const verifiedVk = top.top.filter((t) => t.platform === 'vk');
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&ruleset=legacy&includeUnverified=1`));
  assert.ok(shadow.top.filter((t) => t.platform === 'vk').length > verifiedVk.length);
  assert.ok(shadow.top.every((row) => !Object.hasOwn(row, 'uid')));
});

await ok('analytics: signed Telegram event is accepted and counted', async () => {
  const response = await fetch(`${BASE}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      event: 'first_rna_pickup',
      props: { value: 4, noisy: 'x'.repeat(120) },
    }),
  });
  assert.equal(response.status, 202);
  const body = await j(response);
  assert.equal(body.ok, true);
  const health = await j(await fetch(`${BASE}/health`));
  assert.ok(health.analyticsEvents >= 1);
});

await ok('analytics: tampered messenger identity is rejected', async () => {
  const response = await fetch(`${BASE}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, 'WRONG:TOKEN'),
      event: 'app_open',
      props: {},
    }),
  });
  assert.equal(response.status, 403);
});

await ok('analytics: browser and unknown events are rejected', async () => {
  const browser = await fetch(`${BASE}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'browser',
      anonId: 'anon-analytics-123456',
      event: 'run_start',
      props: { difficulty: 'standard' },
    }),
  });
  assert.equal(browser.status, 400);

  const rejected = await fetch(`${BASE}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      event: 'arbitrary_event',
      props: {},
    }),
  });
  assert.equal(rejected.status, 400);
});

const { parseStartParam } = await import('./bot.mjs');
await ok('бот: parseStartParam — deep-link ref_<uid>', async () => {
  assert.equal(parseStartParam('/start ref_m_12345'), 'ref_m_12345');
});
await ok('бот: parseStartParam — обычный start', async () => {
  assert.equal(parseStartParam('/start'), null);
});
await ok('бот: parseStartParam — результат друга', async () => {
  assert.equal(parseStartParam('/start r_run_240w'), 'r_run_240w');
});

// ---------- профили (V1) ----------
const { readFileSync, writeFileSync } = await import('node:fs');
const { execFileSync } = await import('node:child_process');
const SERVER_INDEX_URL = new URL('./index.mjs', import.meta.url).href;
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');
const STORE_FILE = join(DATA_DIR, 'store.json');
const PROFILE_HEADERS = { 'Content-Type': 'application/json' };
const readProfile = (platform, initData) =>
  fetch(`${BASE}/api/profile`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({ platform, initData }),
  }).then(j);

/** Дочерний процесс сервера на том же DATA_DIR: доказывает перезагрузку с диска. */
function runChildServer(env) {
  const script = `
const { server } = await import(${JSON.stringify(SERVER_INDEX_URL)});
await new Promise((resolve) => server.once('listening', resolve));
const port = server.address().port;
const res = await fetch('http://127.0.0.1:' + port + '/api/profile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ platform: 'telegram', initData: process.env.OFELIYA_TEST_INITDATA }),
});
process.stdout.write('__OFELIYA_PROFILE__' + JSON.stringify(await res.json()));
server.close();
`;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

await ok('profile: tampered initData отклоняется (403)', async () => {
  const res = await fetch(`${BASE}/api/profile`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({ platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN).replace(/auth_date=\d+/, 'auth_date=1') }),
  });
  assert.equal(res.status, 403);
});

await ok('profile: отсутствующий initData отклоняется (403)', async () => {
  const res = await fetch(`${BASE}/api/profile`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({ platform: 'telegram' }),
  });
  assert.equal(res.status, 403);
});

await ok('profile: некорректное тело запроса отклоняется (422)', async () => {
  for (const raw of ['{}', '{"platform":42}', '[]', 'null']) {
    const res = await fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: PROFILE_HEADERS, body: raw,
    });
    assert.equal(res.status, 422);
  }
});

await ok('profile: browser и vk не получают серверный профиль (403)', async () => {
  for (const platform of ['browser', 'vk']) {
    const res = await fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: PROFILE_HEADERS,
      body: JSON.stringify({ platform, initData: 'whatever', anonId: '0123456789abcdef' }),
    });
    assert.equal(res.status, 403);
  }
});

let aliceProfile = null;
await ok('profile: валидный MAX/TG read создаёт независимые пустые V1-профили', async () => {
  aliceProfile = await readProfile('telegram', signInitData(ALICE, TG_TOKEN));
  const bob = await readProfile('max', signInitData(BOB, MAX_TOKEN));
  for (const r of [aliceProfile, bob]) {
    assert.equal(r.ok, true);
    assert.equal(r.profile.profileVersion, 1);
    assert.equal(r.profile.inventory.schemaVersion, 1);
    assert.equal(r.profile.records.migrated, false);
    assert.deepEqual(r.profile.inventory.items, {});
    assert.equal(typeof r.profile.createdAt, 'number');
    assert.equal(typeof r.profile.updatedAt, 'number');
  }
});

await ok('profile: повторное чтение стабильно (идемпотентно, без новых профилей)', async () => {
  const again = await readProfile('telegram', signInitData(ALICE, TG_TOKEN));
  assert.deepEqual(again, aliceProfile);
  const onDisk = JSON.parse(readFileSync(PROFILES_FILE, 'utf8'));
  assert.equal(Object.keys(onDisk.profiles).length, 2);
});

let aliceMigratedProfile = null;
await ok('profile/migrate: первый claim выигрывает; числа клампятся; неизвестные ключи отбрасываются', async () => {
  const scoresBefore = (await j(await fetch(`${BASE}/health`))).scores;
  const r = await fetch(`${BASE}/api/profile/migrate`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      save: {
        bestSurvivalMs: 421_234.7,
        bestBoss1ClearMs: -5,
        bestCampaignClearMs: Number.NaN,
        bestKills: 999_999_999_999,
        bestLevel: 42,
        runs: 12,
        totalKills: 5_000,
        achievements: ['first-contact', 'first-contact', 'not a valid id!', 42, 'cleanup-500'],
        evolutionsSeen: ['prism'],
        legendarySeen: ['zero-point'],
        bestTimeMs: 999,
        bestWinTimeMs: 888,
        hackerField: { evil: true },
        muted: true,
      },
    }),
  }).then(j);
  assert.equal(r.ok, true);
  assert.equal(r.claimed, true);
  assert.equal(r.profile.records.migrated, true);
  assert.equal(r.profile.records.bestSurvivalMs, 421_234.7);
  assert.equal(r.profile.records.bestBoss1ClearMs, 0);
  assert.equal(r.profile.records.bestCampaignClearMs, 0);
  assert.equal(r.profile.records.bestKills, 1_000_000_000);
  assert.equal(r.profile.records.bestLevel, 42);
  assert.equal(r.profile.records.runs, 12);
  assert.deepEqual(r.profile.records.achievements, ['first-contact', 'cleanup-500']);
  assert.equal(r.profile.records.evolutionsSeen, undefined);
  assert.equal(r.profile.records.legendarySeen, undefined);
  assert.equal(r.profile.preferences.muted, true);
  assert.deepEqual(Object.keys(r.profile.inventory.items), ['founder-badge-v1']);
  assert.equal(r.profile.inventory.items['founder-badge-v1'].source, 'migration');
  // advisory: миграция не создаёт ranked/verified скор
  const health = await j(await fetch(`${BASE}/health`));
  assert.equal(health.scores, scoresBefore);
  aliceMigratedProfile = r.profile;
});

await ok('profile/migrate: повторный claim идемпотентен (claimed:false, профиль не меняется)', async () => {
  const again = await fetch(`${BASE}/api/profile/migrate`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({
      platform: 'telegram',
      initData: signInitData(ALICE, TG_TOKEN),
      save: { bestSurvivalMs: 1, runs: 1, achievements: ['deep-dive'] },
    }),
  }).then(j);
  assert.equal(again.ok, true);
  assert.equal(again.claimed, false);
  assert.deepEqual(again.profile, aliceMigratedProfile);
  // независимость платформ: MAX-профиль BOB не затронут миграцией ALICE
  const bob = await readProfile('max', signInitData(BOB, MAX_TOKEN));
  assert.equal(bob.profile.records.migrated, false);
  assert.deepEqual(bob.profile.inventory.items, {});
});

await ok('profile/migrate: некорректный/отсутствующий save → 422', async () => {
  const initData = signInitData(BOB, MAX_TOKEN);
  for (const save of [undefined, 'string', 42, []]) {
    const res = await fetch(`${BASE}/api/profile/migrate`, {
      method: 'POST', headers: PROFILE_HEADERS,
      body: JSON.stringify({ platform: 'max', initData, save }),
    });
    assert.equal(res.status, 422);
  }
});

await ok('profile/migrate: слишком большой save → 422', async () => {
  const res = await fetch(`${BASE}/api/profile/migrate`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({ platform: 'max', initData: signInitData(BOB, MAX_TOKEN), save: { pad: 'x'.repeat(9000) } }),
  });
  assert.equal(res.status, 422);
});

await ok('profile/migrate: конкурентные дубли не дают двойной грант', async () => {
  const dora = { id: 909_101, first_name: 'Dora' };
  const initData = signInitData(dora, TG_TOKEN);
  const fire = () => fetch(`${BASE}/api/profile/migrate`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({ platform: 'telegram', initData, save: { runs: 3, bestKills: 9 } }),
  }).then(j);
  const results = await Promise.all([fire(), fire(), fire(), fire()]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(results.filter((r) => r.claimed === true).length, 1);
  const onDisk = JSON.parse(readFileSync(PROFILES_FILE, 'utf8'));
  const doraDisk = onDisk.profiles['telegram:909101'];
  assert.ok(doraDisk);
  assert.deepEqual(Object.keys(doraDisk.inventory.items), ['founder-badge-v1']);
  assert.ok(onDisk.migrations['telegram:909101'].claimedAt > 0);
});

await ok('profile: публичные ответы не содержат raw uid/userKey/initData/имя', async () => {
  const user = { id: 515_000, first_name: 'Secretive', username: 'secretive' };
  const initData = signInitData(user, TG_TOKEN);
  const readText = await (await fetch(`${BASE}/api/profile`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({ platform: 'telegram', initData }),
  })).text();
  const migrateText = await (await fetch(`${BASE}/api/profile/migrate`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({ platform: 'telegram', initData, save: { runs: 1 } }),
  })).text();
  for (const text of [readText, migrateText]) {
    assert.ok(!text.includes('"515000"'), 'raw uid leaked');
    assert.ok(!text.includes('telegram:515000'), 'userKey leaked');
    assert.ok(!text.includes(initData), 'initData leaked');
    assert.ok(!text.includes('Secretive'), 'display name leaked');
    const parsed = JSON.parse(text);
    assert.equal('uid' in parsed.profile, false);
    assert.equal('userKey' in parsed.profile, false);
    assert.equal('initData' in parsed.profile, false);
  }
  assert.equal(JSON.parse(migrateText).claimed, true);
});

await ok('profile: битый profiles.json коэрсится к пустому стору (не роняет загрузку)', async () => {
  const corruptDir = mkdtempSync(join(tmpdir(), 'ofeliya-profiles-corrupt-'));
  try {
    writeFileSync(join(corruptDir, 'profiles.json'), '{"profiles":"garbage","migrations":null,"version":"x"}');
    const initData = signInitData({ id: 700_100, first_name: 'Rex' }, TG_TOKEN);
    const out = runChildServer({ ...process.env, DATA_DIR: corruptDir, OFELIYA_TEST_INITDATA: initData });
    const parsed = JSON.parse(out.split('__OFELIYA_PROFILE__')[1]);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.profile.records.migrated, false);
    assert.deepEqual(parsed.profile.inventory.items, {});
  } finally {
    rmSync(corruptDir, { recursive: true, force: true });
  }
});

await ok('profile: profiles.json переживает перезапись store.json legacy-формой (rollback safety)', async () => {
  const before = readFileSync(PROFILES_FILE, 'utf8');
  // Симуляция старой сборки: store.json содержит только известные старые ключи.
  writeFileSync(STORE_FILE, JSON.stringify({ scores: [], refs: [], refRewards: {} }));
  // Обычный путь записи скора вызывает saveStore(): старая сборка переписала бы
  // store.json целиком из известных ей ключей.
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: PROFILE_HEADERS,
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: true, timeMs: 340_000, kills: 240, level: 12, daily: false },
    }),
  });
  assert.equal(res.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50)); // debounced saveStore (setImmediate)
  const storeAfter = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
  assert.equal('profiles' in storeAfter, false);
  assert.equal(readFileSync(PROFILES_FILE, 'utf8'), before);
  const read = await readProfile('telegram', signInitData(ALICE, TG_TOKEN));
  assert.equal(read.profile.records.migrated, true);
});

await ok('profile: сохранённый ответ переживает перезагрузку из profiles.json (дочерний сервер)', async () => {
  const initData = signInitData(ALICE, TG_TOKEN);
  const out = runChildServer({ ...process.env, DATA_DIR, OFELIYA_TEST_INITDATA: initData });
  const parsed = JSON.parse(out.split('__OFELIYA_PROFILE__')[1]);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.profile, aliceMigratedProfile);
  assert.equal(parsed.profile.createdAt, aliceMigratedProfile.createdAt);
});

server.close();
rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${passed} проверок пройдено${process.exitCode ? ' (Есть провалы!)' : ''}`);

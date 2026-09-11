#!/usr/bin/env node
/**
 * Тесты score-сервера (V3). Запуск: node server/test.mjs
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

process.env.TG_BOT_TOKEN = TG_TOKEN;
// Production MAX bot historically uses BOT_TOKEN. Deliberately do NOT set
// MAX_BOT_TOKEN here: this verifies the score-service fallback contract.
process.env.BOT_TOKEN = MAX_TOKEN;
delete process.env.MAX_BOT_TOKEN;
process.env.VK_SECURE_KEY = VK_SECURE_KEY;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'ofeliya-server-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = '0';

const { server } = await import('./index.mjs');
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

await ok('топ: лучший результат на юзера + более быстрая победа выше', async () => {
  await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: true, timeMs: 320_000, kills: 150, level: 8 },
    }),
  }));
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.equal(top.top.length, 2);
  assert.equal(top.top[0].timeMs, 320_000);
  assert.equal(top.top[0].platform, 'telegram');
  assert.equal(top.top[0].rank, 1);
  assert.equal(top.top[1].platform, 'max');
  assert.ok(top.top.every((row) => !Object.hasOwn(row, 'uid')));
});

await ok('top daily: только daily-результаты сегодня', async () => {
  await j(await fetch(`${BASE}/api/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: false, timeMs: 120_000, kills: 60, level: 4, daily: true },
    }),
  }));
  const daily = await j(await fetch(`${BASE}/api/top?period=daily`));
  assert.equal(daily.top.length, 1);
  assert.equal(daily.top[0].timeMs, 120_000);
  assert.equal(daily.top[0].daily, true);
  assert.ok(!Object.hasOwn(daily.top[0], 'uid'));
});

await ok('top weekly: результаты за 7 дней', async () => {
  const weekly = await j(await fetch(`${BASE}/api/top?period=weekly`));
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
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.ok(!top.top.some((t) => t.platform === 'browser'));
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&includeUnverified=1`));
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
  const d = await j(await fetch(`${BASE}/api/daily?user=anon-11111111&platform=browser`));
  assert.equal(d.ok, true);
  assert.ok(d.total >= 3);
  assert.equal(d.rank, 1);
  assert.equal(d.dateKey, dk());
  const none = await j(await fetch(`${BASE}/api/daily?user=anon-99999999&platform=browser`));
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
  const seasonTop = await j(await fetch(`${BASE}/api/top?period=season`));
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
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.ok(!top.top.some((t) => t.platform === 'vk'));
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&includeUnverified=1`));
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
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
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
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  const verifiedVk = top.top.filter((t) => t.platform === 'vk');
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&includeUnverified=1`));
  assert.ok(shadow.top.filter((t) => t.platform === 'vk').length > verifiedVk.length);
  assert.ok(shadow.top.every((row) => !Object.hasOwn(row, 'uid')));
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

server.close();
rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${passed} проверок пройдено${process.exitCode ? ' (Есть провалы!)' : ''}`);

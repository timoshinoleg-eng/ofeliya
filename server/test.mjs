#!/usr/bin/env node
/**
 * Тесты score-сервера (V3). Запуск: node server/test.mjs
 *
 * Проверяют: HMAC-валидация initData (TG-схема + MAX-вариант), отклонение
 * подделки, анти-чит (time/kills/level), дедупликация best, топы
 * all/daily/weekly, реферальные рёбра и разовая награда.
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
process.env.MAX_BOT_TOKEN = MAX_TOKEN;
process.env.VK_SECURE_KEY = VK_SECURE_KEY;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'ofeliya-server-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = '0'; // порт не нужен — слушаем напрямую

const { server } = await import('./index.mjs');

await new Promise((resolve) => server.once('listening', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- helpers ----------
function signInitData(user, token, { scheme = 'tg', date = Math.floor(Date.now() / 1000) } = {}) {
  const params = {
    user: JSON.stringify(user),
    auth_date: String(date),
    query_id: 'AAF-test',
  };
  const dataCheck = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
  let hash;
  if (scheme === 'tg') {
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  } else {
    hash = createHmac('sha256', token).update(dataCheck).digest('hex');
  }
  return new URLSearchParams({ ...params, hash }).toString();
}

/**
 * Собрать валидный VK web_app_t (V6-server). pairs — объект init data (user =
 * JSON-строка и т.д.), secretKey — секрет VK Mini Apps. Возвращает base64(JSON).
 */
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
  const initData = signInitData(ALICE, TG_TOKEN);
  const r = await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'telegram',
        initData,
        payload: { win: true, timeMs: 300_000, kills: 240, level: 12, daily: false },
      }),
    })
  );
  assert.equal(r.ok, true);
  assert.equal(r.rank, 1);
});

await ok('TG: подделанный initData отклоняется (403)', async () => {
  const initData = signInitData(ALICE, TG_TOKEN).replace(/auth_date=\d+/, 'auth_date=1') + '&x=1';
  // подпись не пересчитана → не сойдётся
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData,
      payload: { win: true, timeMs: 300_000, kills: 240, level: 12 },
    }),
  });
  assert.equal(res.status, 403);
});

await ok('TG: чужой токен не проходит', async () => {
  const initData = signInitData(ALICE, 'WRONG:TOKEN');
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData,
      payload: { win: true, timeMs: 300_000, kills: 240, level: 12 },
    }),
  });
  assert.equal(res.status, 403);
});

await ok('MAX: initData валидируется (fallback-схема)', async () => {
  const initData = signInitData(BOB, MAX_TOKEN, { scheme: 'max' });
  const r = await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'max',
        initData,
        payload: { win: true, timeMs: 250_000, kills: 180, level: 9, daily: false },
      }),
    })
  );
  assert.equal(r.ok, true);
});

await ok('анти-чит: слишком много kills (422)', async () => {
  const initData = signInitData(ALICE, TG_TOKEN);
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData,
      payload: { win: true, timeMs: 30_000, kills: 999_999, level: 5 },
    }),
  });
  assert.equal(res.status, 422);
});

await ok('анти-чит: слишком короткий timeMs (422)', async () => {
  const initData = signInitData(ALICE, TG_TOKEN);
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData,
      payload: { win: true, timeMs: 10, kills: 5, level: 2 },
    }),
  });
  assert.equal(res.status, 422);
});

await ok('анти-чит: застарелый auth_date (403)', async () => {
  const initData = signInitData(ALICE, TG_TOKEN, { date: Math.floor(Date.now() / 1000) - 3 * 86_400 });
  const res = await fetch(`${BASE}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram',
      initData,
      payload: { win: true, timeMs: 300_000, kills: 240, level: 12 },
    }),
  });
  assert.equal(res.status, 403);
});

await ok('дедупликация: лучший результат на юзера в топе', async () => {
  // Alice бьёт свой же результат — быстрее победа
  const initData = signInitData(ALICE, TG_TOKEN);
  await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'telegram',
        initData,
        payload: { win: true, timeMs: 200_000, kills: 150, level: 8 },
      }),
    })
  );
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  const aliceRows = top.top.filter((t) => t.uid === '111');
  assert.equal(aliceRows.length, 1);
  assert.equal(aliceRows[0].timeMs, 200_000);
  assert.equal(top.top.length, 2); // Alice + Bob
  assert.equal(top.top[0].rank, 1);
});

await ok('top daily: только daily-результаты сегодня', async () => {
  const initData = signInitData(ALICE, TG_TOKEN);
  await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'telegram',
        initData,
        payload: { win: false, timeMs: 120_000, kills: 60, level: 4, daily: true },
      }),
    })
  );
  const daily = await j(await fetch(`${BASE}/api/top?period=daily`));
  assert.equal(daily.top.length, 1);
  assert.equal(daily.top[0].uid, '111');
  assert.equal(daily.top[0].daily, true);
});

await ok('top weekly: результаты за 7 дней', async () => {
  const weekly = await j(await fetch(`${BASE}/api/top?period=weekly`));
  assert.ok(weekly.top.length >= 1);
});

await ok('рефы: награда один раз, повтор без награды', async () => {
  // Carol (max) приходит по реф-линку Alice
  const carol = { id: 333, first_name: 'Carol', username: 'carol' };
  const initData = signInitData(carol, MAX_TOKEN, { scheme: 'max' });
  const r1 = await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'max',
        initData,
        payload: { win: true, timeMs: 400_000, kills: 200, level: 10, ref: '111' },
      }),
    })
  );
  assert.ok(r1.refReward);
  assert.equal(r1.refReward.from, '111');
  assert.equal(r1.refReward.first, true);

  const r2 = await j(
    await fetch(`${BASE}/api/ref`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '111', to: '333', platform: 'max' }),
    })
  );
  assert.equal(r2.first, false); // рёбро уже есть

  const status = await j(await fetch(`${BASE}/api/ref?user=111&platform=max`));
  assert.equal(status.invited, 1);
});

await ok('browser: anonId принимается, но не попадает в верифицированный топ', async () => {
  const r = await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'browser',
        anonId: 'anon-browser-12345678',
        payload: { win: true, timeMs: 100_000, kills: 50, level: 6 },
      }),
    })
  );
  assert.equal(r.ok, true);
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.ok(!top.top.some((t) => t.uid === 'anon-browser-12345678'));
  const withUnverified = await j(await fetch(`${BASE}/api/top?period=all&includeUnverified=1`));
  assert.ok(withUnverified.top.some((t) => t.uid === 'anon-browser-12345678'));
});

await ok('daily: «общий» результат дня (V4) — №N из M', async () => {
  const now = Date.now();
  const dk = (offset = 0) => {
    const d = new Date(now + offset * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // Два daily-сор за «сегодня» (browser, anonId >=8).
  const p1 = { platform: 'browser', anonId: 'anon-11111111', payload: { daily: true, win: true, timeMs: 12000, kills: 9, level: 5, dateKey: dk() } };
  const p2 = { platform: 'browser', anonId: 'anon-22222222', payload: { daily: true, win: false, timeMs: 30000, kills: 4, level: 3, dateKey: dk() } };
  await j(await fetch(`${BASE}/api/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p1) }));
  await j(await fetch(`${BASE}/api/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p2) }));

  const d = await j(await fetch(`${BASE}/api/daily?user=anon-11111111&platform=browser`));
  assert.equal(d.ok, true);
  assert.ok(d.total >= 2, 'дней total учитывает обоих');
  assert.equal(d.rank, 1, 'победа → №1');
  assert.equal(d.dateKey, dk());

  // Без daily-скор за сегодня — rank null, total 0.
  const none = await j(await fetch(`${BASE}/api/daily?user=anon-99999999&platform=browser`));
  assert.equal(none.rank, null);
  assert.equal(none.total, 0);
});

await ok('season: текущий сезон + сезонный топ (C5)', async () => {
  const s = await j(await fetch(`${BASE}/api/season`));
  assert.equal(s.ok, true);
  const { index, start, end, daysLeft } = s.season;
  assert.ok(index >= 0);
  assert.equal(end - start, 14 * 86_400_000); // 14 дней
  assert.ok(daysLeft >= 0 && daysLeft <= 14);

  // сезонный топ: окно текущего сезона (Alice/Bob/Carol успели в 0-й сезон)
  const seasonTop = await j(await fetch(`${BASE}/api/top?period=season`));
  assert.equal(seasonTop.ok, true);
  assert.ok(Array.isArray(seasonTop.top));
  assert.equal(seasonTop.season.index, index);
});

await ok('friends: топ друзей по реф-рёбрам (двунаправленно)', async () => {
  // В тесте рефов 111 (tg) позвал 333 (max). Проверим обе стороны.
  // 333 — max, его платформа в рёбере max:333.
  const as111 = await j(
    await fetch(`${BASE}/api/friends?user=111&platform=telegram`)
  );
  assert.equal(as111.ok, true);
  const invitedBy111 = as111.friends.find((f) => f.uid === '333');
  assert.ok(invitedBy111, '111 должен видеть приглашённого 333');
  assert.equal(invitedBy111.relation, 'invited');
  assert.equal(invitedBy111.platform, 'max');

  const as333 = await j(await fetch(`${BASE}/api/friends?user=333&platform=max`));
  const inviter = as333.friends.find((f) => f.uid === '111');
  assert.ok(inviter, '333 должен видеть приглашавшего 111');
  assert.equal(inviter.relation, 'inviter');

  // У одинокого юзера друзей нет.
  const lonely = await j(await fetch(`${BASE}/api/friends?user=99999&platform=telegram`));
  assert.equal(lonely.friends.length, 0);
});

await ok('vk: числовой VK user id принимается (unverified)', async () => {
  const r = await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'vk',
        anonId: '98765', // короткий VK id — minLen=1 для vk
        payload: { win: true, timeMs: 220_000, kills: 130, level: 7, daily: false },
      }),
    })
  );
  assert.equal(r.ok, true);
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.ok(!top.top.some((t) => t.uid === '98765')); // unverified — вне общего
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&includeUnverified=1`));
  assert.ok(shadow.top.some((t) => t.uid === '98765'));
  assert.ok(shadow.top.find((t) => t.uid === '98765')?.platform === 'vk');
});

await ok('vk: валидный web_app_t → verified (общий топ)', async () => {
  const user = { id: 77777, first_name: 'Vera', username: 'vera' };
  const webAppInit = makeWebAppT({ user: JSON.stringify(user), app: '123456' }, VK_SECURE_KEY);
  const r = await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'vk',
        anonId: '77777',
        webAppInit,
        payload: { win: true, timeMs: 95_000, kills: 180, level: 9, daily: false },
      }),
    })
  );
  assert.equal(r.ok, true);
  assert.ok(r.rank !== null, 'verified → есть место в общем топе');
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.ok(top.top.some((t) => t.uid === '77777' && t.platform === 'vk'), 'в общем топе');
});

await ok('vk: подделанный web_app_t → unverified (фолбэк на anonId)', async () => {
  const user = { id: 88888, first_name: 'Mara' };
  let token = makeWebAppT({ user: JSON.stringify(user), app: '123456' }, VK_SECURE_KEY);
  // ломаем токен (меняем символ в base64) → HMAC не сойдётся
  token = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
  const r = await j(
    await fetch(`${BASE}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'vk',
        anonId: '88888',
        webAppInit: token,
        payload: { win: true, timeMs: 150_000, kills: 90, level: 6, daily: false },
      }),
    })
  );
  assert.equal(r.ok, true);
  const top = await j(await fetch(`${BASE}/api/top?period=all`));
  assert.ok(!top.top.some((t) => t.uid === '88888'), 'подделка вне общего топа');
  const shadow = await j(await fetch(`${BASE}/api/top?period=all&includeUnverified=1`));
  assert.ok(shadow.top.some((t) => t.uid === '88888'), 'но в shadow-тени');
});

// ---------- бот (V7): логика парсинга, без сетевых вызовов ----------
const { parseStartParam } = await import('./bot.mjs');

await ok('бот: parseStartParam — deep-link ref_<uid>', async () => {
  assert.equal(parseStartParam('/start ref_12345'), 'ref_12345');
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

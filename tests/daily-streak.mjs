/**
 * Daily streak contract — ежедневная награда Фазы 3 (порт).
 *
 * Covers: локальные дни (не UTC — серверные тикеты на localDateKey),
 * стрик из DailyHistory (сыгранные забеги дня, не визиты), 7-дневный цикл
 * наград, гейт claim (только после забега дня), идемпотентность claim
 * (один грант на день), форма таблицы наград.
 *
 * NOTE: независимый DailyCalendar стека (UTC-дни, свой стрик, claim за
 * визит) НЕ портируется — см. src/game/daily/DailyCalendar.ts.
 * Стрик здесь строится реальным DailyHistory.dailyStreakSummary по явной
 * истории (тестируется шов DailyHistory → DailyCalendar).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-daily-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`daily-streak: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// Ключ локального дня 'YYYY-MM-DD' (те же компоненты, что localDayKey).
const dayKey = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
// Дата в полдень локального времени.
const at = (y, mo, d) => new Date(y, mo - 1, d, 12, 0, 0);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/daily/DailyCalendar.ts',
      'src/systems/DailyHistory.ts',
      'src/game/meta/MetaWallet.ts',
      'src/game/lab/LabState.ts',
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

  const dc = require(join(temp, 'game/daily/DailyCalendar.js'));
  const dh = require(join(temp, 'systems/DailyHistory.js'));
  const mw = require(join(temp, 'game/meta/MetaWallet.js'));

  // --- localDayKey: локальный календарь, не UTC ---
  eq(dh.localDayKey(at(2026, 10, 21)), '2026-10-21', 'localDayKey noon');
  eq(dh.localDayKey(new Date(2026, 9, 21, 0, 0, 0)), '2026-10-21', 'localDayKey midnight local');
  eq(dh.localDayKey(new Date(2026, 9, 21, 23, 59, 59)), '2026-10-21', 'localDayKey late local');

  // --- reward table: 7 days, ascending ---
  eq(dc.DAILY_REWARDS.length, 7, '7-day cycle');
  for (let i = 1; i < dc.DAILY_REWARDS.length; i++) {
    assert(dc.DAILY_REWARDS[i].rna >= dc.DAILY_REWARDS[i - 1].rna, 'rewards non-decreasing');
    assert(dc.DAILY_REWARDS[i].rna > 0, 'reward positive');
  }
  eq(dc.DAILY_REWARDS[0].rna, 50, 'day 1 reward 50');
  eq(dc.DAILY_REWARDS[6].rna, 500, 'day 7 reward 500');
  eq(dc.rewardForDayIndex(7).rna, dc.DAILY_REWARDS[0].rna, 'rewardForDayIndex wraps');

  // --- history -> summary (реальный DailyHistory, явная история) ---
  const entry = (date) => ({ date, timeMs: 60000, kills: 10, level: 2, win: false, savedAt: 0 });
  const historyFor = (dates) => Object.fromEntries(dates.map((d) => [d, entry(d)]));
  const summaryFor = (dates, now) => dh.dailyStreakSummary(historyFor(dates), now);

  // Первый день: ничего не сыграно.
  let s = dc.getDailyStatus(at(2026, 10, 21), { summary: summaryFor([], at(2026, 10, 21)) });
  eq(s.playedToday, false, 'never played: playedToday false');
  eq(s.canClaim, false, 'never played: canClaim false');
  eq(s.streak, 0, 'never played: streak 0');
  eq(s.cycleIndex, 0, 'never played: cycle preview day 1');
  eq(s.rewardToday.rna, 50, 'never played: preview reward 50');

  // Сегодня сыгран первый забег дня.
  s = dc.getDailyStatus(at(2026, 10, 21), { summary: summaryFor([dayKey(2026, 10, 21)], at(2026, 10, 21)) });
  eq(s.playedToday, true, 'played today');
  eq(s.canClaim, true, 'played today: canClaim true');
  eq(s.streak, 1, 'streak 1');
  eq(s.cycleIndex, 0, 'streak 1: day 1 reward');
  eq(s.rewardToday.rna, 50, 'streak 1: 50 RNA');

  // Стрик 2: вчера + сегодня.
  s = dc.getDailyStatus(at(2026, 10, 22), {
    summary: summaryFor([dayKey(2026, 10, 21), dayKey(2026, 10, 22)], at(2026, 10, 22)),
  });
  eq(s.streak, 2, 'streak 2');
  eq(s.cycleIndex, 1, 'streak 2: day 2 reward');
  eq(s.rewardToday.rna, 75, 'streak 2: 75 RNA');

  // Стрик 3 закончился вчера, сегодня не сыграно: превью дня 4.
  s = dc.getDailyStatus(at(2026, 10, 24), {
    summary: summaryFor(
      [dayKey(2026, 10, 21), dayKey(2026, 10, 22), dayKey(2026, 10, 23)],
      at(2026, 10, 24)
    ),
  });
  eq(s.playedToday, false, 'not played today');
  eq(s.canClaim, false, 'not played: canClaim false');
  eq(s.streak, 3, 'streak ending yesterday = 3');
  eq(s.cycleIndex, 3, 'preview: day 4');
  eq(s.rewardToday.rna, 150, 'preview reward 150');

  // Пропуск дня обнуляет стрик.
  s = dc.getDailyStatus(at(2026, 10, 25), { summary: summaryFor([dayKey(2026, 10, 21)], at(2026, 10, 25)) });
  eq(s.streak, 0, 'gap resets streak');
  eq(s.cycleIndex, 0, 'gap: cycle restarts');

  // 7-й день стрика — 500 RNA; 8-й — цикл заново (50).
  const seven = [15, 16, 17, 18, 19, 20, 21].map((d) => dayKey(2026, 10, d));
  s = dc.getDailyStatus(at(2026, 10, 21), { summary: summaryFor(seven, at(2026, 10, 21)) });
  eq(s.streak, 7, 'streak 7');
  eq(s.rewardToday.rna, 500, 'streak 7: 500 RNA');
  const eight = [14, 15, 16, 17, 18, 19, 20, 21].map((d) => dayKey(2026, 10, d));
  s = dc.getDailyStatus(at(2026, 10, 21), { summary: summaryFor(eight, at(2026, 10, 21)) });
  eq(s.streak, 8, 'streak 8');
  eq(s.cycleIndex, 0, 'streak 8: cycle wraps');
  eq(s.rewardToday.rna, 50, 'streak 8: 50 RNA');

  // Уже забрано сегодня: canClaim false, claimedToday true.
  s = dc.getDailyStatus(at(2026, 10, 21), {
    summary: summaryFor([dayKey(2026, 10, 21)], at(2026, 10, 21)),
    claims: { [dayKey(2026, 10, 21)]: { streak: 1, reward: 50, claimedAt: 1 } },
  });
  eq(s.claimedToday, true, 'claimedToday true');
  eq(s.canClaim, false, 'already claimed: canClaim false');

  // --- claimDaily: гейт, грант один раз, идемпотентность ---
  const fakeWallet = () => {
    const calls = { addRna: [], recordStreak: [] };
    return {
      calls,
      addRna: (n) => {
        calls.addRna.push(n);
        return n;
      },
      recordStreak: (n) => {
        calls.recordStreak.push(n);
      },
    };
  };

  // Без забега сегодня — claim невозможен, гранта нет.
  let w = fakeWallet();
  let r = dc.claimDaily(at(2026, 10, 21), { summary: summaryFor([], at(2026, 10, 21)), wallet: w });
  eq(r.ok, false, 'claim without play rejected');
  eq(r.reason, 'not_played', 'reason not_played');
  eq(w.calls.addRna.length, 0, 'no grant without play');

  // Сыграно — claim даёт награду ровно один раз.
  const claims = {};
  w = fakeWallet();
  const sum = summaryFor([dayKey(2026, 10, 20), dayKey(2026, 10, 21)], at(2026, 10, 21));
  r = dc.claimDaily(at(2026, 10, 21), { summary: sum, claims, wallet: w });
  eq(r.ok, true, 'claim ok');
  eq(r.streak, 2, 'claim streak 2');
  eq(r.reward.rna, 75, 'claim reward 75');
  eq(w.calls.addRna.length, 1, 'grant once');
  eq(w.calls.addRna[0], 75, 'granted 75');
  eq(w.calls.recordStreak.length, 1, 'recordStreak once');
  eq(claims[dayKey(2026, 10, 21)].reward, 75, 'claim recorded');

  // Повторный claim в тот же день — уже забрано, гранта нет.
  r = dc.claimDaily(at(2026, 10, 21), { summary: sum, claims, wallet: w });
  eq(r.ok, false, 'second claim rejected');
  eq(r.reason, 'already_claimed', 'reason already_claimed');
  eq(w.calls.addRna.length, 1, 'still one grant');

  // Default wallet (без deps.wallet): грант идёт через grantMetaRna
  // (Фаза 4: множитель лаборатории; при нулевых уровнях = addRna).
  // Требует localStorage: grantMetaRna читает ofeliya.lab.v1.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
  const claims2 = {};
  const sum2 = summaryFor([dayKey(2026, 10, 20), dayKey(2026, 10, 21)], at(2026, 10, 21));
  const before = mw.loadMeta().rna;
  r = dc.claimDaily(at(2026, 10, 21), { summary: sum2, claims: claims2 });
  eq(r.ok, true, 'default wallet claim ok');
  eq(r.reward.rna, 75, 'default wallet reward 75');
  eq(mw.loadMeta().rna, before + 75, 'default wallet grants via grantMetaRna');
  delete globalThis.localStorage;

  console.log('daily-streak: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
  delete globalThis.localStorage;
}

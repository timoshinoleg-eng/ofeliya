// Smoke-тест чистых модулей (без браузера): SeededRng + SaveSystem daily/leaderboard.
// Запуск: node --experimental-strip-types scripts/smoke-daily.ts
import {
  dailyRng,
  hashSeed,
  mathRandom,
  mulberry32,
  nextDayKey,
  todayKey,
} from '../src/game/SeededRng';
import { SaveSystem } from '../src/systems/SaveSystem';

let failed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok:   ${name}`);
  }
}

// 1. Детерминированность daily rng
const a = dailyRng('2026-09-09');
const b = dailyRng('2026-09-09');
const seqA = Array.from({ length: 5 }, () => a.next());
const seqB = Array.from({ length: 5 }, () => b.next());
check('daily rng детерминирован', JSON.stringify(seqA) === JSON.stringify(seqB));
const c = dailyRng('2026-09-10');
const seqC = Array.from({ length: 5 }, () => c.next());
check('разные даты → разные последовательности', JSON.stringify(seqA) !== JSON.stringify(seqC));

// 2. Диапазон значений
const r = mulberry32(hashSeed('x'));
const vals = Array.from({ length: 1000 }, () => r.next());
check('rng в [0,1)', vals.every((v) => v >= 0 && v < 1));
check('int(max) в диапазоне', Array.from({ length: 100 }, () => r.int(10)).every((v) => v >= 0 && v < 10));
check('pick возвращает элемент', ['a', 'b'].includes(r.pick(['a', 'b'] as const)));
check('mathRandom реализует Rng', typeof mathRandom.next === 'function');

// 3. Даты
check('todayKey формат', /^\d{4}-\d{2}-\d{2}$/.test(todayKey()));
check('nextDayKey +1', nextDayKey('2026-09-09') === '2026-09-10');
check('nextDayKey месячный рубеж', nextDayKey('2026-09-30') === '2026-10-01');

// 4. Стрики и результат дня
const s = SaveSystem.get();
check('daily по умолчанию пуст', s.daily.dateKey === '' && s.daily.streak === 0);

const day1 = '2026-09-08';
const day2 = '2026-09-09';
const day3 = '2026-09-10';
const day5 = '2026-09-12';

let res = SaveSystem.recordDaily(day1, { win: false, timeMs: 300000, kills: 100 });
check('первый день: стрик 1, без рекорда', res.streak === 1 && !res.newStreak && !res.dailyRecord);

res = SaveSystem.recordDaily(day1, { win: false, timeMs: 400000, kills: 120 });
check('повтор в тот же день: стрик 1, рекорд дня', res.streak === 1 && res.dailyRecord);

res = SaveSystem.recordDaily(day2, { win: true, timeMs: 310000, kills: 200 });
check('следующий день: стрик 2, newStreak', res.streak === 2 && res.newStreak);

res = SaveSystem.recordDaily(day3, { win: true, timeMs: 310000, kills: 205 });
check('новый день: стрик 3, первый забег — не «рекорд»', res.streak === 3 && !res.dailyRecord);
res = SaveSystem.recordDaily(day3, { win: true, timeMs: 290000, kills: 210 });
check('повтор победа быстрее → рекорд дня', res.dailyRecord);

res = SaveSystem.recordDaily(day5, { win: false, timeMs: 100000, kills: 50 });
check('пропуск дня: стрик сбросился на 1', res.streak === 1 && !res.newStreak);

// 5. Лидерборд
const rank1 = SaveSystem.recordLeaderboard({ dateKey: '2026-09-09', daily: false, win: false, timeMs: 200000, kills: 80, level: 7 });
check('первый забег — №1', rank1 === 1);
const rank2 = SaveSystem.recordLeaderboard({ dateKey: '2026-09-09', daily: false, win: false, timeMs: 150000, kills: 60, level: 5 });
check('короче/меньше — №2', rank2 === 2);
const rankWin = SaveSystem.recordLeaderboard({ dateKey: '2026-09-09', daily: true, win: true, timeMs: 310000, kills: 150, level: 9 });
check('победа выше поражений', rankWin === 1);
const save2 = SaveSystem.get();
check('лидерборд хранит топ', save2.leaderboard.length === 3 && save2.leaderboard[0].win === true);
for (let i = 0; i < 12; i++) {
  SaveSystem.recordLeaderboard({ dateKey: '2026-09-09', daily: false, win: false, timeMs: 10000 + i * 1000, kills: 10 + i, level: 2 });
}
check('лидерборд обрезается до 10', SaveSystem.get().leaderboard.length === 10);
check('ранг вне топа = null', SaveSystem.recordLeaderboard({ dateKey: 'x', daily: false, win: false, timeMs: 1000, kills: 1, level: 1 }) === null);

// 6. M-блок (MAX/Android): режим управления
check('controlMode по умолчанию — one', SaveSystem.get().controlMode === 'one');
SaveSystem.update({ controlMode: 'dual' });
check('controlMode переключается на dual', SaveSystem.get().controlMode === 'dual');
SaveSystem.update({ controlMode: 'one' });
check('controlMode возвращается на one', SaveSystem.get().controlMode === 'one');

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);

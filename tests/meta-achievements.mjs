/**
 * Meta achievements contract — lifetime-достижения Фазы 3 с наградами (порт).
 *
 * Covers: catalog shape (24 defs, unique ids, sane rewards), pure trigger
 * evaluation on synthetic stats, skin-reward slot for Phase 5.
 * NOTE: this is the META layer; run-scoped achievements live in
 * src/game/AchievementSystem.ts (untouched).
 *
 * Порт: evo_5 → evo_3 (в игре всего 3 критические мутации, порог 5 был
 * недостижим уже в стеке — см. src/game/achievements/MetaAchievements.ts).
 * MetaWallet больше не импортирует DailyCalendar (todayUtc убрана).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-mach-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`meta-achievements: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const ZERO_STATS = {
  totalKills: 0,
  runs: 0,
  evolutionsSeen: 0,
  questsCompleted: 0,
  timeSecTotal: 0,
  deaths: 0,
  rnaEarned: 0,
  starsSpent: 0,
  maxStreak: 0,
  comboBest: 0,
  maxNoDamageMs: 0,
  won: false,
};

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/achievements/MetaAchievements.ts',
      'src/game/meta/MetaWallet.ts',
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

  const ma = require(join(temp, 'game/achievements/MetaAchievements.js'));
  const mw = require(join(temp, 'game/meta/MetaWallet.js'));

  // --- catalog shape ---
  eq(ma.META_ACHIEVEMENTS.length, 24, '24 meta achievements');
  const ids = ma.META_ACHIEVEMENTS.map((d) => d.id);
  assert(new Set(ids).size === ids.length, 'unique ids');
  for (const d of ma.META_ACHIEVEMENTS) {
    assert(d.title && d.title.length > 0, `${d.id} has title`);
    assert(d.desc && d.desc.length > 0, `${d.id} has desc`);
    assert(d.reward.kind === 'rna' || d.reward.kind === 'skin', `${d.id} reward kind`);
    if (d.reward.kind === 'rna') assert(d.reward.amount > 0, `${d.id} rna reward positive`);
    else assert(d.reward.skinId.length > 0, `${d.id} skin reward has skinId`);
  }

  // --- pure trigger evaluation ---
  eq(ma.checkMetaAchievements(ZERO_STATS).length, 0, 'nothing unlocked at zero');

  let got = ma.checkMetaAchievements({ ...ZERO_STATS, totalKills: 1500 });
  assert(got.includes('killer_500'), 'killer_500 at 1500');
  assert(got.includes('killer_1k'), 'killer_1k at 1500');
  assert(!got.includes('killer_10k'), 'no killer_10k at 1500');

  got = ma.checkMetaAchievements({ ...ZERO_STATS, maxStreak: 7 });
  assert(got.includes('daily_first'), 'daily_first at streak 1+');
  assert(got.includes('streak_3'), 'streak_3');
  assert(got.includes('streak_7'), 'streak_7');
  assert(!got.includes('streak_30'), 'no streak_30');

  // evo_3: все 3 критические мутации (порог 5 из стека недостижим).
  got = ma.checkMetaAchievements({ ...ZERO_STATS, evolutionsSeen: 2 });
  assert(!got.includes('evo_3'), 'no evo_3 at 2 evolutions');
  got = ma.checkMetaAchievements({ ...ZERO_STATS, evolutionsSeen: 3 });
  assert(got.includes('evo_3'), 'evo_3 at 3 evolutions');
  assert(!ids.includes('evo_5'), 'no unreachable evo_5 (only 3 evolutions exist)');

  got = ma.checkMetaAchievements({ ...ZERO_STATS, starsSpent: 500 });
  assert(got.includes('stars_1'), 'stars_1');
  assert(got.includes('stars_500'), 'stars_500');
  const investor = ma.getMetaAchievementDef('stars_500');
  eq(investor.reward.kind, 'skin', 'investor reward is a skin (Phase 5 slot)');

  got = ma.checkMetaAchievements({ ...ZERO_STATS, won: true, comboBest: 55, maxNoDamageMs: 130000 });
  assert(got.includes('winner'), 'winner on win');
  assert(got.includes('combo_50'), 'combo_50 at 55');
  assert(got.includes('ghost_120'), 'ghost_120 at 130s');

  got = ma.checkMetaAchievements({ ...ZERO_STATS, won: false, comboBest: 55 });
  assert(!got.includes('winner'), 'no winner on defeat');
  assert(got.includes('combo_50'), 'combo_50 still unlocks on defeat');

  // --- progress fields agree with the trigger closures ---
  // `metaMilestoneProgress` is the nearest goal's read of the same defs: for
  // every milestone, the counter named by `metric` at threshold - 1 must
  // leave the milestone locked with progress below the threshold, and at the
  // threshold it must unlock with progress exactly at the threshold. The
  // table below is the review surface: if a check changes, it changes here.
  const PROGRESS_SPEC = [
    { id: 'killer_500', metric: 'totalKills', threshold: 500 },
    { id: 'killer_1k', metric: 'totalKills', threshold: 1000 },
    { id: 'killer_10k', metric: 'totalKills', threshold: 10000 },
    { id: 'killer_100k', metric: 'totalKills', threshold: 100000 },
    { id: 'runs_3', metric: 'runs', threshold: 3 },
    { id: 'runs_10', metric: 'runs', threshold: 10 },
    { id: 'runs_50', metric: 'runs', threshold: 50 },
    { id: 'runs_100', metric: 'runs', threshold: 100 },
    { id: 'evo_3', metric: 'evolutionsSeen', threshold: 3 },
    { id: 'daily_first', metric: 'maxStreak', threshold: 1 },
    { id: 'streak_3', metric: 'maxStreak', threshold: 3 },
    { id: 'streak_7', metric: 'maxStreak', threshold: 7 },
    { id: 'streak_30', metric: 'maxStreak', threshold: 30 },
    { id: 'quests_10', metric: 'questsCompleted', threshold: 10 },
    { id: 'quests_50', metric: 'questsCompleted', threshold: 50 },
    { id: 'stars_1', metric: 'starsSpent', threshold: 1 },
    { id: 'stars_500', metric: 'starsSpent', threshold: 500 },
    { id: 'deaths_100', metric: 'deaths', threshold: 100 },
    { id: 'rna_1k', metric: 'rnaEarned', threshold: 1000 },
    { id: 'rna_10k', metric: 'rnaEarned', threshold: 10000 },
    { id: 'combo_50', metric: 'comboBest', threshold: 50 },
    { id: 'ghost_120', metric: 'maxNoDamageMs', threshold: 120000 },
    { id: 'winner', metric: 'won', threshold: 1 },
    { id: 'time_10h', metric: 'timeSecTotal', threshold: 36000 },
  ];
  for (const spec of PROGRESS_SPEC) {
    const below =
      spec.metric === 'won'
        ? { ...ZERO_STATS, won: false }
        : { ...ZERO_STATS, [spec.metric]: spec.threshold - 1 };
    const at =
      spec.metric === 'won'
        ? { ...ZERO_STATS, won: true }
        : { ...ZERO_STATS, [spec.metric]: spec.threshold };
    const progressBelow = ma.metaMilestoneProgress(below).find((m) => m.id === spec.id);
    const progressAt = ma.metaMilestoneProgress(at).find((m) => m.id === spec.id);
    assert(progressBelow && progressBelow.progress === spec.threshold - 1, `${spec.id} progress below threshold`);
    assert(progressAt && progressAt.progress === spec.threshold, `${spec.id} progress at threshold`);
    assert(!ma.checkMetaAchievements(below).includes(spec.id), `${spec.id} locked below threshold`);
    assert(ma.checkMetaAchievements(at).includes(spec.id), `${spec.id} unlocked at threshold`);
  }
  eq(ma.metaMilestoneProgress(ZERO_STATS).length, 24, 'progress list covers the catalog');
  assert(
    ma.metaMilestoneProgress(ZERO_STATS).every((m) => m.progress === 0),
    'zero progress at zero stats'
  );
  for (const d of ma.META_ACHIEVEMENTS) {
    assert(!('metric' in d) && !('threshold' in d), `${d.id} public def has no progress fields`);
  }

  // --- unknown id throws ---
  let threw = false;
  try {
    ma.getMetaAchievementDef('nope');
  } catch {
    threw = true;
  }
  assert(threw, 'unknown achievement id throws');

  // --- MetaWallet: add/spend round-trip (in-memory fallback in Node) ---
  const before = mw.loadMeta().rna;
  mw.addRna(100);
  eq(mw.loadMeta().rna, before + 100, 'addRna');
  eq(mw.loadMeta().rnaEarned >= 100, true, 'rnaEarned tracked');
  assert(mw.spendRna(40) === true, 'spendRna ok');
  eq(mw.loadMeta().rna, before + 60, 'spendRna deducts');
  assert(mw.spendRna(1000000) === false, 'spendRna fails when broke');

  console.log('meta-achievements: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

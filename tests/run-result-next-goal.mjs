/**
 * Run result — the nearest goal.
 *
 * Exercises the rule's pure core: `computeNextGoal` takes the quest snapshot
 * entries (the same numbers the QuestBoard shows), the milestone progress
 * list (from the real `metaMilestoneProgress`, never a second table), and
 * the mastery tracks (from the real `masteryTracks`), and returns the two
 * lines the result screen shows.
 *
 * Cases: the six prototype scenarios (expected goals from
 * `ofeliya-next-goal-contract-2026-11-09.md` §3), the contract's
 * distinguishing case (rotation quests done, marathon/veteran out of
 * rotation, runs 2 → the runs_3 milestone, not the marathon quest), the
 * marathon tie (milestone wins the tie), the mastery branches (focused,
 * hybrid, hybrid tie, completed branch falls through), the cumulative-quest
 * branch in isolation, and the thousands/time formatting.
 *
 * Method (same pattern as tests/run-result-codex-openings.mjs): the real
 * TypeScript sources are compiled to a temp dir and required, so the test
 * exercises the game's own code. The scenario fixtures are the prototype's
 * (pre-run save + run deltas); the post-run stats are derived the way
 * `GameScene.finish` derives them (recordRun, then the accruals, then
 * `collectLifetimeStats`).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-next-goal-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const assert = (condition, message) => {
  if (!condition) throw new Error(`run-result-next-goal: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

/** Non-breaking space: the game's thousands separator (UiFormat.fmtInt). */
const NBSP = '\u00A0';

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/runNextGoal.ts',
      'src/game/achievements/MetaAchievements.ts',
      'src/game/meta/MetaWallet.ts',
      'src/systems/SaveSystem.ts',
      'src/game/RunIdentity.ts',
      'src/quests/questCatalog.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      resolve('src'),
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const { computeNextGoal } = require(join(temp, 'game/runNextGoal.js'));
  const { metaMilestoneProgress } = require(join(temp, 'game/achievements/MetaAchievements.js'));
  const { masteryTracks } = require(join(temp, 'game/RunIdentity.js'));
  const { QUEST_CATALOG } = require(join(temp, 'quests/questCatalog.js'));

  const catalogById = new Map(QUEST_CATALOG.map((q) => [q.id, q]));

  // --- fixture builders (prototype scenarios: pre-run save + run deltas) ---

  /** Quest snapshot entries for a rotation, from the run's own progress. */
  const questEntries = (rotation, questProgress, postRuns) => {
    return rotation.map((id) => {
      const def = catalogById.get(id);
      // Lifetime quests mirror the post-run runs count (the snapshot's
      // `progress` is the mirrored total after finish's recordRun).
      const progress = def.metric === 'q_runs' ? postRuns : (questProgress[id] ?? 0);
      return { questId: id, value: progress, progress, target: def.target, complete: progress >= def.target, claimed: false };
    });
  };

  /** Post-run lifetime stats, the way finish() derives them. */
  const postRunStats = (save, run, extra = {}) => {
    const seenEvo = new Set([...(save.seenEvo ?? []), ...(run.evolutions ?? [])]);
    return {
      totalKills: (save.totalKills ?? 0) + run.kills,
      runs: (save.runs ?? 0) + 1,
      evolutionsSeen: seenEvo.size,
      // The prototype's counters carry no quest-completion or star-spending
      // fields; the scenarios that reach the milestone/mastery categories
      // supply veteran-plausible values explicitly (see below).
      questsCompleted: extra.questsCompleted ?? 0,
      timeSecTotal: Math.floor(((save.counters?.survivalMs ?? 0) + run.timeMs) / 1000),
      deaths: (save.counters?.losses ?? 0) + (run.win ? 0 : 1),
      rnaEarned: (save.counters?.rnaCollected ?? 0) + run.rna,
      starsSpent: extra.starsSpent ?? 0,
      maxStreak: save.counters?.visitStreak ?? 0,
      comboBest: Math.max(save.counters?.combo ?? 0, run.comboBest),
      maxNoDamageMs: Math.max(save.counters?.noDamageMs ?? 0, run.noDamageMs),
      won: run.win,
    };
  };

  const goalInput = (save, run, rotation, extra = {}) => {
    const postRuns = (save.runs ?? 0) + 1;
    const seenLeg = new Set([...(save.seenLeg ?? []), ...(run.legendaryIds ?? [])]);
    const seenEvo = new Set([...(save.seenEvo ?? []), ...(run.evolutions ?? [])]);
    return {
      questProgress: questEntries(rotation, run.questProgress ?? {}, postRuns),
      milestones: metaMilestoneProgress(postRunStats(save, run, extra)),
      mastery: {
        // The identity does not change the goal while a rotation quest wins;
        // the mastery cases below pin the identity explicitly.
        identityId: 'hybrid',
        tracks: masteryTracks({ evolutionsSeen: [...seenEvo], legendarySeen: [...seenLeg] }),
      },
    };
  };

  const goalOf = (save, run, rotation, extra) => computeNextGoal(goalInput(save, run, rotation, extra));

  // --- the six prototype scenarios ---

  const SCENARIOS = {
    'early-death': {
      rotation: ['slayer_1', 'slayer_2', 'mutant_1'],
      save: { runs: 2, totalKills: 380, seenEvo: [], seenLeg: [], counters: { kills: 380, runs: 2, mutations: 3, hostCells: 6, elites: 0, combo: 31, noDamageMs: 42000, rnaCollected: 640, wins: 0, losses: 2, survivalMs: 420000, visitDays: 2, visitStreak: 2 } },
      run: { win: false, timeMs: 132000, kills: 214, hostCells: 6, level: 4, comboBest: 31, rna: 310, elites: 0, noDamageMs: 38000, evolutions: [], legendaryIds: [], questProgress: { slayer_1: 50, slayer_2: 214, mutant_1: 2 } },
      expect: { category: 'quest-run', id: 'slayer_2', title: 'Гроза лейкоцитов', line1: 'Следующий забег: Уничтожь 300 врагов за один забег', line2: 'В этом забеге: 214 / 300' },
    },
    'first-trophy': {
      rotation: ['slayer_2', 'slayer_3', 'hoarder_1'],
      save: { runs: 5, totalKills: 2100, seenEvo: [], seenLeg: [], counters: { kills: 2100, runs: 5, mutations: 6, hostCells: 14, elites: 3, combo: 48, noDamageMs: 74000, rnaCollected: 2400, wins: 0, losses: 5, survivalMs: 1380000, visitDays: 4, visitStreak: 4 } },
      run: { win: false, timeMs: 370000, kills: 412, hostCells: 8, level: 9, comboBest: 48, rna: 480, elites: 2, noDamageMs: 61000, evolutions: [], legendaryIds: ['core-predator'], questProgress: { slayer_2: 300, slayer_3: 412, hoarder_1: 480 } },
      expect: { category: 'quest-run', id: 'hoarder_1', title: 'Собиратель', line1: 'Следующий забег: Собери 500 РНК за один забег', line2: 'В этом забеге: 480 / 500' },
    },
    'repeat-legendary': {
      rotation: ['slayer_2', 'survivor_1', 'hunter'],
      save: { runs: 9, totalKills: 3900, seenEvo: ['prism'], seenLeg: ['core-predator'], counters: { kills: 3900, runs: 9, mutations: 8, hostCells: 22, elites: 6, combo: 52, noDamageMs: 88000, rnaCollected: 4300, wins: 0, losses: 9, survivalMs: 2700000, visitDays: 6, visitStreak: 5 } },
      run: { win: false, timeMs: 370000, kills: 380, hostCells: 7, level: 8, comboBest: 44, rna: 430, elites: 3, noDamageMs: 54000, evolutions: [], legendaryIds: ['core-predator'], questProgress: { slayer_2: 300, survivor_1: 180, hunter: 3 } },
      expect: { category: 'quest-run', id: 'hunter', title: 'Охотник за элитой', line1: 'Следующий забег: Уничтожь 5 элитных клеток за один забег', line2: 'В этом забеге: 3 / 5' },
    },
    'two-openings': {
      rotation: ['hoarder_2', 'ghost', 'mutant_1'],
      save: { runs: 12, totalKills: 5400, seenEvo: ['prism'], seenLeg: [], counters: { kills: 5400, runs: 12, mutations: 9, hostCells: 31, elites: 9, combo: 57, noDamageMs: 96000, rnaCollected: 6100, wins: 0, losses: 12, survivalMs: 3600000, visitDays: 8, visitStreak: 6 } },
      run: { win: false, timeMs: 402000, kills: 520, hostCells: 11, level: 11, comboBest: 57, rna: 1150, elites: 4, noDamageMs: 41000, evolutions: ['singularity'], legendaryIds: ['zero-point'], questProgress: { hoarder_2: 1150, ghost: 41, mutant_1: 3 } },
      expect: { category: 'quest-run', id: 'ghost', title: 'Невидимка', line1: 'Следующий забег: Продержись 60 секунд подряд без урона', line2: 'Лучшее сегодня: 00:41 / 01:00' },
    },
    'achievement-only': {
      rotation: ['slayer_1', 'slayer_2', 'mutant_1'],
      save: { runs: 4, totalKills: 460, seenEvo: [], seenLeg: [], counters: { kills: 460, runs: 4, mutations: 4, hostCells: 9, elites: 1, combo: 26, noDamageMs: 51000, rnaCollected: 900, wins: 0, losses: 4, survivalMs: 780000, visitDays: 3, visitStreak: 3 } },
      run: { win: false, timeMs: 125000, kills: 96, hostCells: 4, level: 3, comboBest: 26, rna: 180, elites: 1, noDamageMs: 33000, evolutions: [], legendaryIds: [], questProgress: { slayer_1: 50, slayer_2: 96, mutant_1: 1 } },
      expect: { category: 'quest-run', id: 'mutant_1', title: 'Мутант', line1: 'Следующий забег: Выбери 3 мутации за один забег', line2: 'В этом забеге: 1 / 3' },
    },
    'no-goal': {
      rotation: ['slayer_3', 'hoarder_2', 'veteran'],
      save: { runs: 120, totalKills: 120000, seenEvo: ['prism', 'halo', 'singularity'], seenLeg: ['split-geometry', 'lysis-chain', 'zero-point', 'core-predator', 'myocardial-rhythm', 'last-carrier'], counters: { kills: 120000, runs: 120, mutations: 14, hostCells: 640, elites: 310, combo: 120, noDamageMs: 150000, rnaCollected: 48000, wins: 9, losses: 111, survivalMs: 39600000, visitDays: 40, visitStreak: 30 } },
      run: { win: true, timeMs: 580000, kills: 1050, hostCells: 19, level: 15, comboBest: 120, rna: 2100, elites: 8, noDamageMs: 98000, evolutions: ['singularity'], legendaryIds: ['lysis-chain'], questProgress: { slayer_3: 1000, hoarder_2: 2000, veteran: 10 } },
      extra: { questsCompleted: 60, starsSpent: 600 },
      expect: { category: 'none', id: null, title: null, line1: 'Ближайшая цель: сегодня всё выполнено', line2: 'Новые задания появятся завтра — или просто начни новый забег.' },
    },
  };

  for (const [name, sc] of Object.entries(SCENARIOS)) {
    eq(goalOf(sc.save, sc.run, sc.rotation, sc.extra), sc.expect, `scenario ${name}`);
  }

  // --- the contract's distinguishing case ---
  // Rotation quests done; marathon/veteran out of rotation; pre-run runs 1
  // (post-run 2): the goal is the runs_3 milestone, not the marathon quest.
  {
    const save = { runs: 1, totalKills: 100, seenEvo: [], seenLeg: [], counters: { survivalMs: 60000, losses: 1, rnaCollected: 100, combo: 5, noDamageMs: 10000, visitStreak: 1 } };
    const run = { win: false, timeMs: 60000, kills: 10, rna: 50, comboBest: 5, noDamageMs: 10000, evolutions: [], legendaryIds: [], questProgress: { slayer_1: 50, slayer_2: 300, mutant_1: 3 } };
    eq(
      goalOf(save, run, ['slayer_1', 'slayer_2', 'mutant_1']),
      { category: 'milestone', id: 'runs_3', title: 'РЕЦИДИВ', line1: `РЕЦИДИВ — 2 / 3, осталось 1`, line2: 'Завершить 3 забега' },
      'distinguishing case: milestone, not the out-of-rotation marathon'
    );
  }

  // --- ghost: the day's best, not this run's streak ---
  // `q_nodmg` is day-scoped: the snapshot progress is the best no-damage
  // streak of the day, across every run of that day. Run 1 holds 40 s
  // without damage; run 2 only 10 s. After run 2 the screen must still
  // show the day's best (00:40) and say so — «В этом забеге» would claim
  // the 40 s belong to the second run.
  {
    const rotation = ['ghost', 'slayer_1', 'mutant_1'];
    const save = { runs: 3, totalKills: 500, seenEvo: [], seenLeg: [], counters: { kills: 500, runs: 3, mutations: 4, hostCells: 9, elites: 1, combo: 30, noDamageMs: 40000, rnaCollected: 900, wins: 0, losses: 3, survivalMs: 600000, visitDays: 2, visitStreak: 2 } };
    const run1 = { win: false, timeMs: 90000, kills: 120, hostCells: 5, level: 4, comboBest: 30, rna: 200, elites: 1, noDamageMs: 40000, evolutions: [], legendaryIds: [], questProgress: { ghost: 40, slayer_1: 50, mutant_1: 1 } };
    const run2 = { win: false, timeMs: 60000, kills: 80, hostCells: 4, level: 3, comboBest: 25, rna: 120, elites: 0, noDamageMs: 10000, evolutions: [], legendaryIds: [], questProgress: { ghost: 40, slayer_1: 30, mutant_1: 1 } };
    const expectGhost = { category: 'quest-run', id: 'ghost', title: 'Невидимка', line1: 'Следующий забег: Продержись 60 секунд подряд без урона', line2: 'Лучшее сегодня: 00:40 / 01:00' };
    eq(goalOf(save, run1, rotation), expectGhost, 'ghost run 1: the day best is this run’s 40 s');
    eq(goalOf(save, run2, rotation), expectGhost, 'ghost run 2: the day best survives a weaker second run');
  }

  // --- marathon tie: the milestone wins the tie (checked first, strict >) ---
  {
    const save = { runs: 1, totalKills: 100, seenEvo: [], seenLeg: [], counters: { survivalMs: 60000, losses: 1, rnaCollected: 100, combo: 5, noDamageMs: 10000, visitStreak: 1 } };
    const run = { win: false, timeMs: 60000, kills: 10, rna: 50, comboBest: 5, noDamageMs: 10000, evolutions: [], legendaryIds: [], questProgress: { slayer_1: 50, slayer_2: 300, marathon: 2 } };
    eq(
      goalOf(save, run, ['slayer_1', 'slayer_2', 'marathon']).category,
      'milestone',
      'marathon tie: the runs_3 milestone wins'
    );
  }

  // --- cumulative quest in isolation (no mirroring milestone in the list) ---
  {
    const input = {
      questProgress: [{ questId: 'marathon', value: 2, progress: 2, target: 3, complete: false, claimed: false }],
      milestones: [{ id: 'killer_500', title: 'ЧИСТИЛЬЩИК', desc: '500 убийств суммарно', progress: 100, threshold: 500 }],
      mastery: { identityId: 'hybrid', tracks: masteryTracks({ evolutionsSeen: ['prism', 'halo', 'singularity'], legendarySeen: ['split-geometry', 'zero-point', 'lysis-chain'] }) },
    };
    eq(
      computeNextGoal(input),
      { category: 'quest-cum', id: 'marathon', title: 'Марафонец', line1: 'Марафонец — 2 / 3, осталось 1', line2: 'Заверши 3 забега (суммарно)' },
      'cumulative quest wins when no milestone mirrors it'
    );
  }

  // --- mastery branches ---
  const masteryInput = (identityId, evolutionsSeen, legendarySeen) => ({
    questProgress: [],
    milestones: metaMilestoneProgress({
      totalKills: 100000, runs: 100, evolutionsSeen: 3, questsCompleted: 60, timeSecTotal: 40000,
      deaths: 120, rnaEarned: 50000, starsSpent: 600, maxStreak: 30, comboBest: 120, maxNoDamageMs: 150000, won: true,
    }),
    mastery: { identityId, tracks: masteryTracks({ evolutionsSeen, legendarySeen }) },
  });
  eq(
    computeNextGoal(masteryInput('projectile', ['prism'], [])),
    { category: 'mastery', id: 'projectile', title: 'Снарядный штамм', line1: 'Ближайшая цель: Геометрия раскола', line2: 'Ветка «Снарядный штамм»: 1 / 2 · ГИПЕРШИП + ГЕОМЕТРИЯ РАСКОЛА' },
    'mastery: focused branch, next goal without the дальше: prefix'
  );
  eq(
    computeNextGoal(masteryInput('hybrid', [], [])),
    { category: 'mastery', id: 'infection-lysis', title: 'Инфекция / Лизис', line1: 'Ближайшая цель: Сингулярность', line2: 'Ветка «Инфекция / Лизис»: 0 / 2 · СИНГУЛЯРНОСТЬ + ЦЕПЬ ЛИЗИСА' },
    'mastery: hybrid tie at zero resolves by branch id (infection-lysis first)'
  );
  eq(
    computeNextGoal(masteryInput('hybrid', ['prism'], ['zero-point'])),
    { category: 'mastery', id: 'infection-lysis', title: 'Инфекция / Лизис', line1: 'Ближайшая цель: Сингулярность', line2: 'Ветка «Инфекция / Лизис»: 0 / 2 · СИНГУЛЯРНОСТЬ + ЦЕПЬ ЛИЗИСА' },
    'mastery: hybrid takes the outright least-progress branch'
  );
  eq(
    computeNextGoal(masteryInput('hybrid', ['singularity'], [])),
    { category: 'mastery', id: 'orbit-control', title: 'Орбитальный контроль', line1: 'Ближайшая цель: Сверхкапсид', line2: 'Ветка «Орбитальный контроль»: 0 / 2 · СВЕРХКАПСИД + НУЛЕВАЯ ТОЧКА' },
    'mastery: hybrid tie between orbit-control and projectile resolves by branch id'
  );
  eq(
    computeNextGoal(masteryInput('projectile', ['prism', 'halo', 'singularity'], ['split-geometry', 'zero-point'])),
    { category: 'mastery', id: 'infection-lysis', title: 'Инфекция / Лизис', line1: 'Ближайшая цель: Цепь лизиса', line2: 'Ветка «Инфекция / Лизис»: 1 / 2 · СИНГУЛЯРНОСТЬ + ЦЕПЬ ЛИЗИСА' },
    'mastery: a completed run branch falls through to the least-progress open branch'
  );

  // --- formatting: thousands separator and the time pair ---
  eq(
    computeNextGoal({
      questProgress: [
        { questId: 'slayer_3', value: 412, progress: 412, target: 1000, complete: false, claimed: false },
        { questId: 'slayer_1', value: 50, progress: 50, target: 50, complete: true, claimed: false },
        { questId: 'mutant_1', value: 1, progress: 1, target: 3, complete: false, claimed: false },
      ],
      milestones: [],
      mastery: { identityId: 'hybrid', tracks: [] },
    }).line2,
    `В этом забеге: 412 / 1${NBSP}000`,
    'thousands separator in the quest pair'
  );
  eq(
    computeNextGoal({
      questProgress: [],
      milestones: [{ id: 'killer_1k', title: 'ТЫСЯЧНИК', desc: '1 000 убийств суммарно', progress: 999, threshold: 1000 }],
      mastery: { identityId: 'hybrid', tracks: [] },
    }).line1,
    `ТЫСЯЧНИК — 999 / 1${NBSP}000, осталось 1`,
    'thousands separator in the milestone line'
  );

  console.log('run-result-next-goal: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

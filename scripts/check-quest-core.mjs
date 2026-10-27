import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * OFELIYA quest core contract.
 *
 * The quest core is a self-contained subsystem: it consumes a typed event stream and
 * produces a read-only snapshot. These checks cover the behaviours the quest core has to
 * guarantee, including the three that protect the product: the quest core must not
 * become a second daily source, it must not grant anything, and it must not keep a
 * second copy of a product counter.
 *
 * The vocabulary under test is the Muse reference: the twelve quest ids, the titles,
 * the descriptions, the counter names, the targets, the daily selection algorithm and
 * the storage key. The reward table of the Muse reference is deliberately not part of it.
 */

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-quest-core-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/quests/index.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
      // The same strictness as the project tsconfig, so the suite cannot pass on a
      // module the real build would reject.
      '--strict', 'true',
    ],
    { stdio: 'inherit' }
  );

  const quests = require(join(temp, 'quests/index.js'));
  const {
    DAILY_QUEST_COUNT,
    MAX_DAY_HISTORY,
    MAX_DAY_SKEW_DAYS,
    MAX_REMEMBERED_EVENT_IDS,
    PERSIST_COALESCE_MS,
    QUEST_CATALOG,
    QUEST_SAVE_MIN_VERSION,
    QUEST_SAVE_VERSION,
    QUEST_STORAGE_KEY,
    createQuestEngine,
    createQuestLocalStorage,
    nextUtcMidnightMs,
    parseQuestSaveData,
    selectDailyQuests,
    utcDayKey,
  } = quests;

  // The limits are part of the contract, so they are pinned by literal. An assertion
  // against the imported constant would only prove that the constant equals itself.
  assert.equal(MAX_DAY_HISTORY, 8, 'the day history keeps eight days');
  assert.equal(
    MAX_REMEMBERED_EVENT_IDS,
    1024,
    'the idempotency window keeps a thousand and twenty-four ids'
  );
  assert.equal(QUEST_SAVE_VERSION, 4, 'the record format is version 4');
  assert.equal(QUEST_SAVE_MIN_VERSION, 1, 'the record format reads version 1');
  assert.equal(MAX_DAY_SKEW_DAYS, 2, 'a stored day may be two days ahead');
  assert.equal(PERSIST_COALESCE_MS, 1000, 'the writes are coalesced over a second');

  // --- helpers -------------------------------------------------------------------------

  const DAY = '2026-10-22';
  const DAY_START = Date.parse(`${DAY}T00:00:00.000Z`);
  const NEXT_DAY = Date.parse('2026-10-23T00:00:00.000Z');

  function memoryStorage(initial = null) {
    const state = { raw: initial, writes: 0 };
    return {
      state,
      read: () => state.raw,
      write: (raw) => {
        state.raw = raw;
        state.writes += 1;
      },
    };
  }

  function clockAt(ms) {
    let current = ms;
    return {
      now: () => current,
      set: (next) => {
        current = next;
      },
    };
  }

  /**
   * A three-quest catalog, so every quest of it is active on every day and the
   * behaviour checks do not depend on which quests the rotation happens to pick.
   */
  const TEST_CATALOG = [
    {
      id: 'test_kills',
      title: 'ТЕСТ УБИЙСТВ',
      desc: 'Уничтожить 10 врагов за забег',
      metric: 'q_kills',
      target: 10,
      family: 'combat',
    },
    {
      id: 'test_time',
      title: 'ТЕСТ ВРЕМЕНИ',
      desc: 'Продержаться 60 секунд',
      metric: 'q_time',
      target: 60,
      family: 'survival',
    },
    {
      id: 'test_runs',
      title: 'ТЕСТ ЗАБЕГОВ',
      desc: 'Завершить 3 забега суммарно',
      metric: 'q_runs',
      target: 3,
      family: 'mastery',
    },
  ];

  /**
   * A catalog with a single quest, so the counter of that quest can be observed without
   * the other counters of the test catalog interfering.
   */
  function singleQuestCatalog(metric, target) {
    return [
      {
        id: 'only',
        title: 'ЕДИНСТВЕННЫЙ',
        desc: 'Проверка одного счётчика',
        metric,
        target,
        family: 'combat',
      },
    ];
  }

  const storages = new Map();

  function makeEngine(overrides = {}) {
    const clock = overrides.clock ?? clockAt(DAY_START + 3_600_000);
    const storage = overrides.storage ?? memoryStorage();
    const engine = createQuestEngine({
      catalog: overrides.catalog ?? TEST_CATALOG,
      clock,
      storage,
    });
    storages.set(engine, storage);
    return { engine, clock, storage };
  }

  /** The persisted record of an engine, as the storage holds it. */
  function recordOf(engine) {
    const storage = storages.get(engine);
    if (!storage) throw new Error('the engine has no storage');
    return storage.state.raw;
  }

  function kill(id, at = DAY_START, elite = false) {
    return { id, kind: 'enemy_killed', at, elite };
  }

  function rna(id, delta, at = DAY_START) {
    return { id, kind: 'rna_collected', at, delta };
  }

  function mutation(id, at = DAY_START) {
    return { id, kind: 'mutation_chosen', at };
  }

  function tick(id, timeMs, noDamageMs, at = DAY_START) {
    return { id, kind: 'run_tick', at, timeMs, noDamageMs };
  }

  function runStarted(id, at = DAY_START) {
    return { id, kind: 'run_started', at };
  }

  function runCompleted(id, at = DAY_START) {
    return { id, kind: 'run_completed', at };
  }

  function progressOf(engine, questId) {
    return engine.snapshot().progress.find((entry) => entry.questId === questId);
  }

  // --- 1. the catalog is the Muse reference ---------------------------------------------

  // The twelve quests of `src/game/quests/content/quests.ink` in the Muse patch stack,
  // transcribed as data. The ids, the titles, the descriptions, the counters and the
  // targets have to match exactly, because the HUD copy, the analytics event names and
  // the daily selection are shared with the Muse build.
  const MUSE_CATALOG = [
    ['slayer_1', 'Первая кровь', 'Уничтожь 50 врагов за один забег', 'q_kills', 50],
    ['slayer_2', 'Гроза лейкоцитов', 'Уничтожь 300 врагов за один забег', 'q_kills', 300],
    ['slayer_3', 'Эпидемия', 'Уничтожь 1000 врагов за один забег', 'q_kills', 1000],
    ['hoarder_1', 'Собиратель', 'Собери 500 РНК за один забег', 'q_rna', 500],
    ['hoarder_2', 'Жадный штамм', 'Собери 2 000 РНК за один забег', 'q_rna', 2000],
    ['survivor_1', 'Живучий', 'Переживи 3 минуты в одном забеге', 'q_time', 180],
    ['survivor_2', 'Неубиваемый', 'Переживи 5 минут в одном забеге', 'q_time', 300],
    ['ghost', 'Невидимка', 'Продержись 60 секунд подряд без урона', 'q_nodmg', 60],
    ['mutant_1', 'Мутант', 'Выбери 3 мутации за один забег', 'q_mut', 3],
    ['hunter', 'Охотник за элитой', 'Уничтожь 5 элитных клеток за один забег', 'q_elites', 5],
    ['marathon', 'Марафонец', 'Заверши 3 забега (суммарно)', 'q_runs', 3],
    ['veteran', 'Ветеран штамма', 'Заверши 10 забегов (суммарно)', 'q_runs', 10],
  ];

  assert.equal(QUEST_CATALOG.length, MUSE_CATALOG.length, 'the catalog has twelve quests');
  for (const [id, title, desc, metric, target] of MUSE_CATALOG) {
    const quest = QUEST_CATALOG.find((entry) => entry.id === id);
    assert.ok(quest, `the catalog holds ${id}`);
    assert.equal(quest.title, title, `${id} keeps the Muse title`);
    assert.equal(quest.desc, desc, `${id} keeps the Muse description`);
    assert.equal(quest.metric, metric, `${id} keeps the Muse counter`);
    assert.equal(quest.target, target, `${id} keeps the Muse target`);
  }

  // The Muse reward tag is deliberately not taken. The server owns the reward table.
  for (const quest of QUEST_CATALOG) {
    for (const field of ['rewardRna', 'reward_rna', 'rna', 'stars', 'balance', 'amount']) {
      assert.ok(
        !(field in quest),
        `${quest.id} must not carry a value field (${field})`
      );
    }
  }

  // The Muse counters that hold a duration are written in seconds, not milliseconds.
  assert.equal(
    QUEST_CATALOG.find((quest) => quest.id === 'survivor_1').target,
    180,
    'the survival target is in seconds'
  );
  assert.equal(
    QUEST_CATALOG.find((quest) => quest.id === 'ghost').target,
    60,
    'the no-damage target is in seconds'
  );

  // --- 2. the daily selection is the Muse reference --------------------------------------

  // The reference algorithm: an FNV-1a hash of `ofeliya-quests:<day>` seeds a
  // mulberry32, and a Fisher–Yates pass over the catalog order picks the first three.
  // These are the values the Muse build produces, so both sides offer the same quests on
  // the same day.
  const MUSE_SELECTION = {
    '2026-10-22': ['mutant_1', 'slayer_1', 'slayer_3'],
    '2026-10-23': ['hunter', 'slayer_3', 'slayer_1'],
    '2026-10-24': ['ghost', 'survivor_1', 'slayer_2'],
    '2026-11-01': ['hoarder_2', 'slayer_2', 'mutant_1'],
    '2026-12-31': ['slayer_1', 'slayer_2', 'survivor_1'],
  };

  for (const [day, expected] of Object.entries(MUSE_SELECTION)) {
    assert.deepEqual(
      selectDailyQuests(day, QUEST_CATALOG),
      expected,
      `${day} selects the quests of the Muse reference`
    );
  }

  assert.equal(DAILY_QUEST_COUNT, 3, 'three quests are offered per day');
  for (const day of Object.keys(MUSE_SELECTION)) {
    const selected = selectDailyQuests(day, QUEST_CATALOG);
    assert.equal(selected.length, 3, `${day} offers three quests`);
    assert.equal(new Set(selected).size, 3, `${day} offers three different quests`);
    assert.deepEqual(
      selected,
      selectDailyQuests(day, QUEST_CATALOG),
      `${day} selects the same quests on every call`
    );
  }

  // --- 3. the day key is UTC, not the local calendar -------------------------------------

  assert.equal(utcDayKey(Date.parse('2026-10-22T23:59:59.999Z')), '2026-10-22');
  // A clock that is not a number must not produce a broken day key: the key is compared
  // as a string and persisted.
  assert.ok(
    /^\d{4}-\d{2}-\d{2}$/.test(utcDayKey(Number.NaN)),
    `a broken clock does not produce a broken day key, got ${utcDayKey(Number.NaN)}`
  );
  assert.ok(
    /^\d{4}-\d{2}-\d{2}$/.test(utcDayKey(Number.POSITIVE_INFINITY)),
    'an infinite clock does not produce a broken day key'
  );
  assert.equal(utcDayKey(Date.parse('2026-10-23T00:00:00.000Z')), '2026-10-23');
  assert.equal(nextUtcMidnightMs(Date.parse('2026-10-22T23:59:59.999Z')), NEXT_DAY);
  assert.equal(nextUtcMidnightMs(DAY_START), NEXT_DAY);

  // The day key must not depend on the time zone of the device. The same instant is
  // checked in three zones, in a child process each.
  for (const zone of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
    const printed = execFileSync(
      process.execPath,
      [
        '-e',
        `const { utcDayKey } = require(${JSON.stringify(join(temp, 'quests/index.js'))});` +
          `process.stdout.write(utcDayKey(${DAY_START + 3_600_000}));`,
      ],
      { env: { ...process.env, TZ: zone }, encoding: 'utf8' }
    );
    assert.equal(printed, DAY, `the day key is UTC in ${zone}`);
  }

  // --- 4. the storage key is the Muse reference key ---------------------------------------

  assert.equal(
    QUEST_STORAGE_KEY,
    'ofeliya.quests.v1',
    'the quest record lives at the key the server migration expects'
  );
  assert.notEqual(
    QUEST_STORAGE_KEY,
    'ofeliya_save_v1',
    'the quest record must not share the product save key'
  );

  // --- 5. the run-scoped counters are earned inside the run --------------------------------

  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 9; index += 1) {
      engine.ingest(kill(`k${index}`));
    }
    assert.equal(progressOf(engine, 'test_kills').value, 9, 'nine kills are counted');
    assert.equal(
      progressOf(engine, 'test_kills').complete,
      false,
      'the quest is not complete before the target'
    );

    const result = engine.ingest(kill('k9'));
    assert.deepEqual(
      [...result.newlyCompleted],
      ['test_kills'],
      'the tenth kill completes the quest'
    );
    assert.equal(progressOf(engine, 'test_kills').complete, true, 'the quest is complete');
  }

  // Every Muse counter is observable on its own. The catalog of the Muse reference
  // measures all of them, so a counter that silently stopped moving would hide a whole
  // quest.
  {
    const elite = makeEngine({ catalog: singleQuestCatalog('q_elites', 5) });
    elite.engine.ingest(runStarted('r1'));
    elite.engine.ingest(kill('k1', DAY_START, true));
    elite.engine.ingest(kill('k2', DAY_START, false));
    assert.equal(
      progressOf(elite.engine, 'only').value,
      1,
      'only the elite kills count towards the elite counter'
    );
    assert.equal(
      progressOf(elite.engine, 'only').complete,
      false,
      'one elite is not enough'
    );
  }

  {
    const collected = makeEngine({ catalog: singleQuestCatalog('q_rna', 500) });
    collected.engine.ingest(runStarted('r1'));
    collected.engine.ingest(rna('m1', 250));
    collected.engine.ingest(rna('m2', 250));
    assert.equal(
      progressOf(collected.engine, 'only').value,
      500,
      'the collected RNA is counted'
    );
    assert.equal(
      progressOf(collected.engine, 'only').complete,
      true,
      'the RNA target completes the quest'
    );
  }

  {
    const mutated = makeEngine({ catalog: singleQuestCatalog('q_mut', 3) });
    mutated.engine.ingest(runStarted('r1'));
    mutated.engine.ingest(mutation('u1'));
    mutated.engine.ingest(mutation('u2'));
    mutated.engine.ingest(mutation('u3'));
    assert.equal(
      progressOf(mutated.engine, 'only').value,
      3,
      'the chosen mutations are counted'
    );
    assert.equal(
      progressOf(mutated.engine, 'only').complete,
      true,
      'the mutation target completes the quest'
    );
  }

  {
    const survived = makeEngine({ catalog: singleQuestCatalog('q_time', 60) });
    survived.engine.ingest(runStarted('r1'));
    survived.engine.ingest(tick('t1', 45_000, 0));
    survived.engine.ingest(tick('t2', 60_000, 0));
    assert.equal(
      progressOf(survived.engine, 'only').value,
      60,
      'the survival peak is kept in seconds'
    );
    survived.engine.ingest(tick('t3', 30_000, 0));
    assert.equal(
      progressOf(survived.engine, 'only').value,
      60,
      'a lower survival time does not lower the peak'
    );
    assert.equal(
      progressOf(survived.engine, 'only').complete,
      true,
      'a minute of survival completes the quest'
    );
  }

  // F5: malformed/late ticks must not manufacture progress, including after reload.
  const f5Failures=[];
  const f5 = fn => {try {fn();} catch(e) {console.error(e.message); f5Failures.push(e);}};
  for (const bad of [undefined, NaN, 10000]) { f5(() => {
    const clock = clockAt(DAY_START), storage = memoryStorage();
    const options = {clock, storage, catalog: singleQuestCatalog('q_nodmg', 200)};
    let {engine} = makeEngine(options);
    engine.ingest(tick('before',100000,100000)); clock.set(NEXT_DAY);
    engine.ingest(tick('today',101000,101000));
    engine.ingest(tick('bad',bad === 10000 ? 50000 : 101500,bad));
    engine.flush(); engine = makeEngine(options).engine;
    engine.ingest(tick('next',102000,102000));
    assert.equal(progressOf(engine,'only').value,2,`F5 malformed/stale ${bad}`);
  }); }
  f5(() => {
    const {engine,clock} = makeEngine({catalog:singleQuestCatalog('q_nodmg',200)});
    engine.ingest(tick('before',31001,31001)); clock.set(NEXT_DAY);
    engine.ingest(tick('same-id',32001,32001));
    assert.equal(progressOf(engine,'only').value,1,'F5 exact millisecond day subtraction');
    for (const time of [32001,31010]) {
      assert.equal(engine.ingest(tick('late',time,0)).accepted,false,'F5 stale/equal rejected');
    }
    engine.ingest(tick('same-id',32100,0)); engine.ingest(tick('next',33100,1000));
    assert.equal(progressOf(engine,'only').value,1,'F5 valid subsecond hit');
    engine.flush();
    assert.equal(JSON.parse(recordOf(engine)).seenEventIds.includes('same-id'),false,'F5 peak IDs never remembered');
    engine.restoreRunMetrics({kills:0,timeMs:1000,rna:0,mutations:0,elites:0});
    engine.restoreNoDamageStreak(0,false);
    assert.equal(engine.ingest(tick('resumed',1010,10)).accepted,true,'F5 restore opens timeline');
    engine.flush();
    assert.equal(JSON.parse(recordOf(engine)).runMetrics.q_time,33,'F5 restore preserves time peak');
  });
  f5(() => {
    const {engine} = makeEngine(); engine.ingest(tick('a',1099,1099));
    assert.equal(engine.ingest(tick('b',1010,0)).accepted,false,'F5 same-second stale milliseconds');
  });
  f5(() => {
    const clock=clockAt(DAY_START),storage=memoryStorage();
    const options={clock,storage,catalog:singleQuestCatalog('q_nodmg',200)};
    let {engine}=makeEngine(options);
    engine.ingest(tick('before',100000,100000));clock.set(NEXT_DAY);
    engine.ingest(tick('today',101000,101000));engine.flush();
    engine=makeEngine(options).engine;
    assert.equal(engine.ingest(tick('late-after-reload',50000,50000)).accepted,false,'F5 reload retains freshness');
    engine.ingest(tick('today-next',102000,102000));
    assert.equal(progressOf(engine,'only').value,2,'F5 reload UTC streak remains bounded');
  });
  f5(() => {
    const {engine,clock}=makeEngine({catalog:singleQuestCatalog('q_nodmg',200)});
    engine.ingest(tick('before-hit',80000,80000));clock.set(NEXT_DAY);
    engine.ingest(tick('pre-hit',80100,80100));engine.ingest(tick('hit',80101,0));
    engine.ingest(tick('post-hit',81101,1000));
    assert.equal(progressOf(engine,'only').value,1,'F5 valid increasing subsecond hit earns fresh second');
  });
  f5(() => {
    const {engine}=makeEngine();engine.ingest(tick('peak',33000,0));
    engine.restoreRunMetrics({kills:0,timeMs:1000,rna:0,mutations:0,elites:0});
    assert.equal(engine.ingest(tick('resume',1010,0)).accepted,true,'F5 checkpoint rewind accepts new timeline');
    engine.flush();assert.equal(JSON.parse(recordOf(engine)).runMetrics.q_time,33,'F5 checkpoint rewind keeps peak');
    engine.ingest(runStarted('new-timeline'));
    assert.equal(engine.ingest(tick('first',0,0)).accepted,true,'F5 new run accepts zero time');
    for (const time of [undefined,NaN,Infinity,-1]) {
      assert.equal(engine.ingest(tick('invalid-time',time,0)).accepted,false,'F5 invalid elapsed time rejected');
    }
  });
  assert.equal(f5Failures.length,0,'F5 regressions');

  // --- 6. the no-damage counter is the longest streak of the day ---------------------------

  // The counter is fed with the *current* streak, not with the peak of the run: the goal
  // is about a streak, and the streak of yesterday is not a streak of today.
  {
    const streak = makeEngine({ catalog: singleQuestCatalog('q_nodmg', 60) });
    streak.engine.ingest(runStarted('r1'));
    streak.engine.ingest(tick('t1', 10_000, 30_000));
    streak.engine.ingest(tick('t2', 20_000, 60_000));
    assert.equal(
      progressOf(streak.engine, 'only').value,
      60,
      'a streak of a minute counts for the day'
    );
    assert.equal(
      progressOf(streak.engine, 'only').value,
      60,
      'the longest streak of the day is kept'
    );
    assert.equal(
      progressOf(streak.engine, 'only').complete,
      true,
      'a streak of a minute completes the quest'
    );

    // A streak that ends does not lower the value of the day.
    streak.engine.ingest(tick('t3', 30_000, 10_000));
    assert.equal(
      progressOf(streak.engine, 'only').value,
      60,
      'the longest streak of the day is not lowered by a broken streak'
    );
  }

  // --- 7. the completion survives the next run --------------------------------------------

  {
    const { engine, clock } = makeEngine();
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 10; index += 1) engine.ingest(kill(`k${index}`));
    assert.equal(progressOf(engine, 'test_kills').complete, true, 'the quest is complete');

    clock.set(DAY_START + 7_200_000);
    engine.ingest(runStarted('r2'));
    assert.equal(
      progressOf(engine, 'test_kills').value,
      0,
      'the new run starts from zero'
    );
    assert.equal(
      progressOf(engine, 'test_kills').complete,
      true,
      'the completion of the day survives the next run'
    );
  }

  // --- 8. only the progress of the current day counts ---------------------------------------

  // A run that crosses midnight keeps its counters. The progress of yesterday does not
  // finish the goals of today, so the quest has to be earned during the new day.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock, catalog: singleQuestCatalog('q_kills', 10) });
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 10; index += 1) engine.ingest(kill(`k${index}`));
    assert.equal(progressOf(engine, 'only').complete, true, 'the quest is complete');

    // The same run continues into the next UTC day.
    clock.set(NEXT_DAY + 60_000);
    engine.ingest(tick('t1', 5000, 0));
    assert.equal(
      progressOf(engine, 'only').value,
      10,
      'the counter of the run keeps its value'
    );
    assert.equal(
      progressOf(engine, 'only').progress,
      0,
      'the progress of the previous day does not count'
    );
    assert.equal(
      progressOf(engine, 'only').complete,
      false,
      'the carried-over run does not complete the quest of the new day for free'
    );

    engine.ingest(kill('k10'));
    assert.equal(
      progressOf(engine, 'only').progress,
      1,
      'the new kill is the progress of the new day'
    );
    assert.equal(
      progressOf(engine, 'only').complete,
      false,
      'one kill is not enough for the goal of the new day'
    );

    for (let index = 0; index < 9; index += 1) engine.ingest(kill(`n${index}`));
    assert.equal(
      progressOf(engine, 'only').complete,
      true,
      'the run earns the goal during the new day'
    );
  }

  // The same rule for a counter that grows on its own. A run that survived three
  // minutes before midnight has not survived three minutes of the new day.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock, catalog: singleQuestCatalog('q_time', 180) });
    engine.ingest(runStarted('r1'));
    engine.ingest(tick('t1', 200_000, 0));
    assert.equal(
      progressOf(engine, 'only').complete,
      true,
      'the run survived three minutes'
    );

    clock.set(NEXT_DAY + 1000);
    engine.ingest(tick('t2', 201_000, 0));
    assert.equal(
      progressOf(engine, 'only').value,
      201,
      'the survival time of the run keeps growing'
    );
    assert.equal(
      progressOf(engine, 'only').progress,
      1,
      'only the second of the new day counts'
    );
    assert.equal(
      progressOf(engine, 'only').complete,
      false,
      'the new day starts with an empty progress'
    );

    engine.ingest(tick('t3', 380_000, 0));
    assert.equal(
      progressOf(engine, 'only').complete,
      true,
      'three minutes of the new day complete the goal'
    );
  }

  // The streak is a day counter, so it starts from zero on the new day. The streak of
  // yesterday is not a streak of today.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock, catalog: singleQuestCatalog('q_nodmg', 60) });
    engine.ingest(runStarted('r1'));
    engine.ingest(tick('t1', 100_000, 70_000));
    assert.equal(
      progressOf(engine, 'only').complete,
      true,
      'a streak of a minute and ten seconds'
    );

    // The streak is not broken at the midnight: the player was not hit. The product
    // keeps the current streak across the day boundary, so the quest core has to
    // decide what the streak of the new day is. Only the part of the streak that
    // happened today counts.
    clock.set(NEXT_DAY + 1000);
    engine.ingest(tick('t2', 101_000, 71_000));
    assert.equal(
      progressOf(engine, 'only').value,
      1,
      'only the second of the new day counts towards the streak'
    );
    assert.equal(
      progressOf(engine, 'only').complete,
      false,
      'the streak of the previous day does not complete the goal of the new day'
    );

    // The streak continues: it has to grow by a minute of the new day.
    engine.ingest(tick('t3', 160_000, 131_000));
    assert.equal(
      progressOf(engine, 'only').complete,
      true,
      'a streak that grows by a minute during the new day completes the goal'
    );

    // A new streak after a break starts from zero: the whole of it is new.
    const fresh = makeEngine({ clock: clockAt(DAY_START + 3_600_000), catalog: singleQuestCatalog('q_nodmg', 60) });
    fresh.engine.ingest(runStarted('r1'));
    fresh.engine.ingest(tick('f1', 100_000, 70_000));
    fresh.clock.set(NEXT_DAY + 1000);
    fresh.engine.ingest(tick('f2', 101_000, 71_000));
    fresh.engine.ingest(tick('f3', 110_000, 0));
    fresh.engine.ingest(tick('f4', 170_000, 60_000));
    assert.equal(
      progressOf(fresh.engine, 'only').complete,
      true,
      'a fresh streak of a minute completes the goal of the new day'
    );
  }

  // A new run starts from zero, so the progress of the day starts from zero as well.
  // Otherwise the run would have to beat the numbers of the run before it.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock });
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 10; index += 1) engine.ingest(kill(`k${index}`));

    clock.set(NEXT_DAY + 60_000);
    engine.ingest(tick('t1', 5000, 0));

    clock.set(NEXT_DAY + 120_000);
    engine.ingest(runStarted('r2'));
    for (let index = 0; index < 10; index += 1) engine.ingest(kill(`n${index}`));
    assert.equal(
      progressOf(engine, 'test_kills').complete,
      true,
      'the new run earns the quest from zero, not from the numbers of the run before it'
    );
  }

  // --- 9. the day only rolls forward ---------------------------------------------------------

  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock });
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));

    // The device clock jumps backwards — a time zone correction, an NTP correction, a
    // wrong manual setting. The quest day must not follow it.
    clock.set(DAY_START - 86_400_000);
    engine.ingest(kill('k2'));
    assert.equal(engine.snapshot().dayKey, DAY, 'the quest day does not move backwards');
  }

  // --- 10. the selection follows the day -------------------------------------------------------

  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock, catalog: QUEST_CATALOG });
    assert.deepEqual(
      engine.snapshot().activeQuestIds,
      MUSE_SELECTION[DAY],
      'the engine offers the quests of the Muse reference'
    );
    clock.set(NEXT_DAY + 3_600_000);
    engine.ingest(tick('t1', 1000, 0));
    assert.deepEqual(
      engine.snapshot().activeQuestIds,
      MUSE_SELECTION['2026-10-23'],
      'the next day offers the next set'
    );
  }

  // --- 11. the lifetime total is mirrored, never counted ---------------------------------------

  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    engine.ingest(runCompleted('end-r1'));

    assert.equal(
      progressOf(engine, 'test_runs').value,
      0,
      'the quest core does not count the runs itself'
    );
    assert.equal(
      progressOf(engine, 'test_runs').complete,
      false,
      'without the mirror the lifetime quest is not complete'
    );

    engine.syncLifetime({ completedRuns: 3 });
    assert.equal(
      progressOf(engine, 'test_runs').value,
      3,
      'the mirrored total is the value of the quest'
    );
    assert.equal(
      progressOf(engine, 'test_runs').complete,
      true,
      'the lifetime quest completes when the mirrored total reaches the target'
    );
    assert.equal(
      engine.snapshot().lifetime.synced,
      true,
      'the snapshot says the totals are mirrored'
    );
  }

  // The mirror is not persisted: a persisted copy could go stale, so it is applied again
  // whenever the product save changes.
  {
    const storage = memoryStorage();
    const { engine } = makeEngine({ storage });
    engine.syncLifetime({ completedRuns: 3 });
    engine.flush();
    const raw = storage.state.raw;
    assert.ok(raw.includes('"days"'), 'the record holds the day state');
    assert.ok(
      !raw.includes('completedRuns'),
      'the mirrored totals are not written to the record'
    );
    assert.ok(
      !/"lifetime"\s*:/.test(raw),
      'the record holds no mirrored lifetime block'
    );
  }

  // --- 12. a redelivered event is dropped ------------------------------------------------------

  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));
    const second = engine.ingest(kill('k1'));
    assert.equal(second.accepted, false, 'the redelivered event is not applied');
    assert.equal(second.duplicate, true, 'the redelivered event is reported as a duplicate');
    assert.equal(progressOf(engine, 'test_kills').value, 1, 'the counter moved once');
    assert.equal(engine.snapshot().duplicateEvents, 1, 'the duplicate is counted');
  }

  // An event without an id cannot be deduplicated, so it is refused.
  {
    const { engine } = makeEngine();
    const result = engine.ingest({ kind: 'enemy_killed', at: DAY_START });
    assert.equal(result.accepted, false, 'an event without an id is refused');
    assert.equal(result.duplicate, false, 'an event without an id is not a duplicate');
    assert.equal(
      progressOf(engine, 'test_kills').value,
      0,
      'an event without an id does not move a counter'
    );
  }

  // The peak event carries a value instead of an occurrence, so redelivering it cannot
  // change anything. It is therefore not remembered.
  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    engine.ingest(tick('t1', 120_000, 0));
    engine.ingest(tick('t1', 120_000, 0));
    assert.equal(progressOf(engine, 'test_time').value, 120, 'the peak is unchanged');
    assert.equal(engine.snapshot().duplicateEvents, 0, 'the peak event is not a duplicate');
    engine.flush();
    assert.equal(JSON.parse(recordOf(engine)).seenEventIds.includes('t1'),false,'peak event IDs are never remembered');
  }

  // The remembered ids are bounded, so the record cannot grow without limit.
  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < MAX_REMEMBERED_EVENT_IDS + 50; index += 1) {
      engine.ingest(kill(`k${index}`));
    }
    engine.flush();
    const saved = JSON.parse(recordOf(engine));
    assert.ok(
      saved.seenEventIds.length <= MAX_REMEMBERED_EVENT_IDS,
      'the remembered ids stay inside the bound'
    );
  }

  // --- 13. no double completion and no repeated receipt ----------------------------------------

  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 10; index += 1) engine.ingest(kill(`k${index}`));

    const first = engine.claimLocalReward('test_kills');
    assert.ok(first, 'the receipt is issued');
    assert.equal(first.state, 'local_pending', 'the receipt is local state only');
    assert.equal(first.dayKey, DAY, 'the receipt carries the day it was issued in');

    const second = engine.claimLocalReward('test_kills');
    assert.equal(second, null, 'the receipt is not issued twice');

    assert.equal(
      engine.claimLocalReward('test_time'),
      null,
      'a quest that is not complete has no receipt'
    );
  }

  // A receipt may only be issued for a quest of the daily set. Otherwise the one-shot
  // claim of a goal the player was never offered would be spent.
  {
    const { engine } = makeEngine({ catalog: QUEST_CATALOG });
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 1200; index += 1) engine.ingest(kill(`k${index}`));
    engine.ingest(rna('m1', 500));
    engine.syncLifetime({ completedRuns: 20 });
    assert.equal(
      engine.claimLocalReward('veteran'),
      null,
      'a quest outside the daily set has no receipt'
    );
    assert.equal(
      engine.claimLocalReward('hoarder_1'),
      null,
      'a second quest outside the daily set has no receipt'
    );
    assert.deepEqual(
      engine.snapshot().activeQuestIds,
      MUSE_SELECTION[DAY],
      'the daily set of the test is the Muse set'
    );
  }

  // --- 14. the lifetime receipt is issued once ever ---------------------------------------------

  // The lifetime quests measure a total that only grows. A per-day receipt would hand
  // out a milestone again on every day the quest is offered.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock });
    engine.syncLifetime({ completedRuns: 3 });
    assert.equal(progressOf(engine, 'test_runs').complete, true, 'the quest is complete');

    const first = engine.claimLocalReward('test_runs');
    assert.ok(first, 'the receipt is issued');
    assert.equal(
      first.state,
      'local_pending',
      'the lifetime receipt is local state only as well'
    );

    clock.set(NEXT_DAY + 3_600_000);
    engine.ingest(tick('t1', 1000, 0));
    assert.equal(
      engine.claimLocalReward('test_runs'),
      null,
      'the milestone is not paid out again on the next day'
    );
  }

  // --- 15. a damaged or unknown save is rebuilt -----------------------------------------------

  // Whatever the record looked like, the parsed state is complete: every field the
  // engine reads is there.
  for (const raw of [
    '{"version":9999,"dayKey":"x"}',
    '"a string"',
    '{not json',
    JSON.stringify({ version: QUEST_SAVE_VERSION, dayKey: DAY }),
  ]) {
    let parsed = null;
    let threw = false;
    try {
      parsed = parseQuestSaveData(raw, DAY);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, `a damaged record does not throw (${raw.slice(0, 24)})`);
    assert.ok(parsed.runMetrics, 'a parsed record always has the run metrics');
    assert.ok(parsed.dayMetrics, 'a parsed record always has the day metrics');
    assert.ok(parsed.baseline, 'a parsed record always has the baseline');
    assert.equal(typeof parsed.streakLast, 'number', 'a parsed record always has the streak');
    assert.ok(Array.isArray(parsed.seenEventIds), 'a parsed record always has the id list');
    assert.ok(Array.isArray(parsed.claimedLifetime), 'a parsed record always has the claims');
    assert.ok(parsed.days && typeof parsed.days === 'object', 'a parsed record always has the days');
  }

  {
    let engine = null;
    let threw = false;
    try {
      engine = makeEngine({ storage: memoryStorage('{not json') }).engine;
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'a damaged save does not throw into the game loop');
    assert.equal(engine.snapshot().dayKey, DAY, 'a damaged save does not break the engine');
    assert.equal(engine.snapshot().activeQuestIds.length, 3, 'the daily set is rebuilt');
  }

  {
    const { engine } = makeEngine({ storage: memoryStorage('"a string"') });
    assert.equal(engine.snapshot().dayKey, DAY, 'a save of the wrong shape is ignored');
  }

  {
    const { engine } = makeEngine({ storage: memoryStorage('{"version":9999,"dayKey":"x"}') });
    assert.equal(engine.snapshot().dayKey, DAY, 'an unknown version does not break the engine');
  }

  {
    const hostile = JSON.stringify({
      version: QUEST_SAVE_VERSION,
      dayKey: 'not-a-day',
      days: { '2026-10-22': { done: 'nope', started: [1, 2], best: { x: -5 } } },
      runMetrics: { q_kills: 'lots' },
      dayMetrics: { q_nodmg: 'nope' },
      baseline: null,
      seenEventIds: [null, 42],
      claimedLifetime: 'nope',
    });
    const { engine } = makeEngine({ storage: memoryStorage(hostile) });
    const snapshot = engine.snapshot();
    assert.equal(snapshot.dayKey, DAY, 'a hostile day key is replaced');
    assert.equal(snapshot.activeQuestIds.length, 3, 'the daily set is still built');
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));
    assert.equal(progressOf(engine, 'test_kills').value, 1, 'the counters still work');

    engine.flush();
    const saved = JSON.parse(recordOf(engine));
    assert.deepEqual(saved.runMetrics.q_kills, 1, 'the hostile counter is replaced by a number');

    // The sanitiser itself drops every hostile field.
    const sanitised = parseQuestSaveData(hostile, DAY);
    assert.deepEqual(sanitised.days[DAY].done, [], 'the hostile completion list is dropped');
    assert.deepEqual(sanitised.days[DAY].started, [], 'the hostile started list is dropped');
    assert.deepEqual(sanitised.days[DAY].best, {}, 'the hostile best values are dropped');
    assert.deepEqual(sanitised.seenEventIds, [], 'the hostile event ids are dropped');
    assert.deepEqual(sanitised.claimedLifetime, [], 'the hostile claim list is dropped');
    assert.equal(sanitised.dayMetrics.q_nodmg, 0, 'the hostile day counter is dropped');
    assert.equal(sanitised.runMetrics.q_kills, 0, 'the hostile counter is dropped');
    assert.equal(sanitised.dayKey, DAY, 'the hostile day key is replaced');
  }

  // --- 16. a stored day key in the future is not trusted ----------------------------------------

  // The quest day only moves forward, so a record with a day of 2099 would pin the
  // rotation to 2099 and never heal. The day is clamped back to today.
  {
    const future = JSON.stringify({
      version: QUEST_SAVE_VERSION,
      dayKey: '2099-01-01',
      days: { '2099-01-01': { done: [], started: [], best: {}, claimed: [] } },
      runMetrics: {},
      dayMetrics: {},
      baseline: {},
      seenEventIds: [],
      claimedLifetime: [],
    });
    const { engine, storage } = makeEngine({
      storage: memoryStorage(future),
      catalog: QUEST_CATALOG,
    });
    assert.equal(
      engine.snapshot().dayKey,
      DAY,
      'a day key from the far future is not trusted'
    );
    assert.deepEqual(
      engine.snapshot().activeQuestIds,
      MUSE_SELECTION[DAY],
      'the daily set of today is served'
    );
    engine.flush();
    assert.notEqual(
      JSON.parse(storage.state.raw).dayKey,
      '2099-01-01',
      'the future day key is not written back'
    );
  }

  // A day key that is one day ahead is a normal clock skew and is kept: the day only
  // ever moves forward.
  {
    const ahead = JSON.stringify({
      version: QUEST_SAVE_VERSION,
      dayKey: '2026-10-23',
      days: {},
      runMetrics: {},
      dayMetrics: {},
      baseline: {},
      seenEventIds: [],
      claimedLifetime: [],
    });
    const { engine } = makeEngine({ storage: memoryStorage(ahead) });
    assert.equal(
      engine.snapshot().dayKey,
      '2026-10-23',
      'a day key that is one day ahead is kept'
    );
  }

  // --- 17. a record from a newer build is never overwritten ----------------------------------------

  {
    const newer = JSON.stringify({
      version: QUEST_SAVE_VERSION + 1,
      dayKey: DAY,
      days: {},
      runMetrics: {},
      dayMetrics: {},
      baseline: {},
      seenEventIds: [],
      claimedLifetime: [],
      futureOnlyField: 'keep me',
    });
    const storage = memoryStorage(newer);
    const { engine } = makeEngine({ storage });
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));
    engine.flush();
    assert.equal(
      storage.state.raw,
      newer,
      'a record of a newer build is not overwritten'
    );
  }

  // --- 18. the Muse reference record is read ----------------------------------------------------

  // A player may already have a Muse record on disk under the shared key. It is a map of
  // day key to the Muse day state, without a version field.
  {
    const museRecord = JSON.stringify({
      '2026-10-21': { done: ['slayer_1'], started: ['slayer_1'], best: { slayer_1: 50 } },
      '2026-10-22': { done: [], started: ['hoarder_1'], best: { hoarder_1: 120 } },
    });
    const { engine } = makeEngine({ storage: memoryStorage(museRecord), catalog: QUEST_CATALOG });
    const snapshot = engine.snapshot();
    assert.equal(snapshot.dayKey, DAY, 'the newest Muse day is the active day');
    assert.deepEqual(
      engine.activeQuests().map((quest) => quest.id),
      MUSE_SELECTION[DAY],
      'the daily set is the Muse set'
    );
    engine.flush();
    const saved = JSON.parse(recordOf(engine));
    assert.equal(saved.version, QUEST_SAVE_VERSION, 'the record is at the current version');
    assert.deepEqual(
      saved.days['2026-10-22'].best,
      { hoarder_1: 120 },
      'the Muse day state is carried over'
    );
    assert.deepEqual(
      saved.days['2026-10-21'].done,
      ['slayer_1'],
      'the Muse completion is carried over'
    );
  }

  // --- 18b. the version 3 record is migrated -----------------------------------------------------

  // A version 3 record has no streak bookkeeping, so it cannot tell a continuing streak
  // from a broken one. The count starts from zero, once.
  {
    const older = JSON.stringify({
      version: 3,
      dayKey: DAY,
      days: {},
      runMetrics: { q_kills: 4, q_time: 12, q_nodmg: 30 },
      dayMetrics: { q_nodmg: 30 },
      baseline: { q_kills: 0, q_time: 0, q_nodmg: 0 },
      seenEventIds: [],
      claimedLifetime: [],
    });
    const { engine } = makeEngine({ storage: memoryStorage(older), catalog: singleQuestCatalog('q_kills', 10) });
    engine.flush();
    const saved = JSON.parse(recordOf(engine));
    assert.equal(saved.version, QUEST_SAVE_VERSION, 'the version 3 record is migrated');
    assert.equal(saved.streakLast, 0, 'the streak count starts from zero');
    assert.equal(
      saved.runMetrics.q_kills,
      4,
      'the counters of the version 3 record are carried over'
    );
    assert.equal(
      saved.runMetrics.q_nodmg,
      undefined,
      'the streak is not written into the run-scoped counters'
    );
  }

  // --- 18c. version 3 migration must not inherit a ghost streak's previous baseline ---------
  {
    const older = JSON.stringify({
      version: 3,
      dayKey: DAY,
      days: {},
      runMetrics: { q_kills: 0 },
      dayMetrics: { q_nodmg: 0 },
      baseline: { q_nodmg: 45 },
      seenEventIds: [],
      claimedLifetime: [],
    });
    const { engine } = makeEngine({
      storage: memoryStorage(older),
      catalog: singleQuestCatalog('q_nodmg', 60),
    });
    const migrated = JSON.parse(recordOf(engine));
    assert.equal(migrated.streakLast, 45,
      'v3 migration should seed the last streak from the inherited baseline');
    engine.ingest(tick('fresh-streak-start', 0, 0));
    engine.ingest(tick('fresh-streak-60', 60_000, 60_000));
    const ghost = progressOf(engine, 'only');
    assert.equal(ghost.progress, 60, 'the old baseline must not mask new streak progress');
    assert.equal(ghost.complete, true, 'ghost quest stays reachable after v3 to v4 migration');
  }

  // --- 19. the version 1 record is migrated -------------------------------------------------------

  {
    const legacy = JSON.stringify({
      version: 1,
      dayKey: DAY,
      completedQuestIds: ['first_blood'],
      completedValues: { first_blood: 12 },
      claimedQuestIds: ['first_blood'],
      runMetrics: { run_kills: 7, run_time_ms: 45_000, run_no_damage_ms: 12_000 },
      dayMetrics: { day_kills: 3 },
      baseline: { run_kills: 2 },
      seenEventIds: ['a', 'b'],
    });
    const storage = memoryStorage(legacy);
    const { engine } = makeEngine({ storage });
    engine.flush();
    const saved = JSON.parse(storage.state.raw);
    assert.equal(saved.version, QUEST_SAVE_VERSION, 'the record is migrated');
    assert.equal(saved.runMetrics.q_kills, 7, 'the kill counter is carried over');
    assert.equal(saved.runMetrics.q_time, 45, 'the time counter is converted to seconds');
    assert.deepEqual(saved.seenEventIds, ['a', 'b'], 'the remembered ids are carried over');
    assert.equal(
      saved.days[DAY].claimed.length,
      1,
      'the claim of the old record is carried over'
    );
  }

  // --- 20. the day bookkeeping ---------------------------------------------------------------------

  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));
    engine.ingest(tick('t1', 30_000, 0));
    engine.flush();
    const saved = JSON.parse(recordOf(engine));
    const day = saved.days[DAY];
    assert.deepEqual(
      day.started,
      ['test_kills', 'test_time'],
      'the quests that moved are started'
    );
    assert.equal(day.best.test_kills, 1, 'the best value of the day is kept');
    assert.equal(day.best.test_time, 30, 'the best peak of the day is kept');
  }

  // --- 21. a storage that throws does not break the engine -----------------------------------------

  {
    const hostileStorage = {
      read: () => {
        throw new Error('read blocked');
      },
      write: () => {
        throw new Error('write blocked');
      },
    };
    let engine = null;
    let threw = false;
    try {
      engine = makeEngine({ storage: hostileStorage }).engine;
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'a failing storage does not take the engine down');
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));
    assert.equal(progressOf(engine, 'test_kills').value, 1, 'the engine keeps working');
  }

  // --- 22. the writes are coalesced -----------------------------------------------------------------

  // A burst of events must not rewrite the whole record once per event.
  {
    const storage = memoryStorage();
    const clock = clockAt(DAY_START);
    const { engine } = makeEngine({
      storage,
      clock,
      catalog: singleQuestCatalog('q_kills', 100),
    });
    const before = storage.state.writes;
    for (let index = 0; index < 60; index += 1) {
      clock.set(DAY_START + index * 16);
      engine.ingest(kill(`k${index}`));
    }
    const burst = storage.state.writes - before;
    assert.ok(
      burst <= 2,
      `a burst of sixty events writes at most twice, wrote ${burst}`
    );

    // A completion is written through, because it is a transition that matters.
    const afterBurst = storage.state.writes;
    for (let index = 0; index < 40; index += 1) engine.ingest(kill(`c${index}`));
    assert.ok(
      storage.state.writes > afterBurst,
      'a completion is written through immediately'
    );
  }

  // --- 23. the resume path can realign the run counters -----------------------------------------------

  {
    const { engine } = makeEngine({ catalog: singleQuestCatalog('q_kills', 100) });
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));
    engine.syncRunProgress({ kills: 42, timeMs: 30_000 });
    assert.equal(
      progressOf(engine, 'only').value,
      42,
      'the run counters are realigned with the restored run'
    );
  }

  {
    const { engine } = makeEngine({ catalog: singleQuestCatalog('q_time', 100) });
    engine.ingest(runStarted('r1'));
    engine.ingest(tick('t1', 5000, 0));
    engine.syncRunProgress({ kills: 0, timeMs: 90_000 });
    assert.equal(
      progressOf(engine, 'only').value,
      90,
      'the survival time is realigned with the restored run'
    );
    assert.equal(
      progressOf(engine, 'only').complete,
      false,
      'the restored run has not reached the goal yet'
    );
    engine.syncRunProgress({ kills: 0, timeMs: 120_000 });
    assert.equal(
      progressOf(engine, 'only').complete,
      true,
      'the restored run reaches the goal'
    );
  }

  // A restored run can be older than the quest record. The baseline follows the counter
  // down, so the goal stays the target and not the target plus the baseline.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock, catalog: singleQuestCatalog('q_kills', 50) });
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 100; index += 1) engine.ingest(kill(`k${index}`));

    // The day rolls over, so the baseline is the hundred kills of the run.
    clock.set(NEXT_DAY + 60_000);
    engine.ingest(tick('t1', 1000, 0));
    assert.equal(
      progressOf(engine, 'only').progress,
      0,
      'the new day starts with an empty progress'
    );

    // A checkpoint that is older than the quest record is restored.
    engine.syncRunProgress({ kills: 80, timeMs: 0 });
    assert.equal(
      progressOf(engine, 'only').progress,
      0,
      'the restored run starts the new day from zero'
    );
    for (let index = 0; index < 50; index += 1) engine.ingest(kill(`n${index}`));
    assert.equal(
      progressOf(engine, 'only').complete,
      true,
      'the goal of the new day is fifty kills, not fifty plus the baseline'
    );
  }

  // The survival time is a peak: a restored run cannot have survived longer than the
  // run already did.
  {
    const { engine } = makeEngine({ catalog: singleQuestCatalog('q_time', 100) });
    engine.ingest(runStarted('r1'));
    engine.ingest(tick('t1', 120_000, 0));
    engine.syncRunProgress({ kills: 0, timeMs: 30_000 });
    assert.equal(
      progressOf(engine, 'only').value,
      120,
      'the restored run does not lower the peak of the run'
    );
  }

  // --- 24. a clock that is not a number does not poison the day ---------------------------------------

  {
    const clock = { now: () => Number.NaN };
    const { engine } = makeEngine({ clock });
    engine.ingest(runStarted('r1'));
    engine.ingest(kill('k1'));
    assert.ok(
      /^\d{4}-\d{2}-\d{2}$/.test(engine.snapshot().dayKey),
      `a broken clock does not write a broken day key, got ${engine.snapshot().dayKey}`
    );
  }

  // The day rolls when the snapshot is taken, even when no event arrives.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock, catalog: QUEST_CATALOG });
    assert.equal(engine.snapshot().dayKey, DAY, 'the day of the snapshot is today');
    clock.set(NEXT_DAY + 3_600_000);
    assert.equal(
      engine.snapshot().dayKey,
      '2026-10-23',
      'the snapshot rolls the day even without an event'
    );
    assert.deepEqual(
      engine.snapshot().activeQuestIds,
      MUSE_SELECTION['2026-10-23'],
      'the snapshot offers the set of the new day'
    );
  }

  // A clock that jumps backwards must not block the writes.
  {
    const storage = memoryStorage();
    const clock = clockAt(DAY_START);
    const { engine } = makeEngine({ storage, clock });
    engine.ingest(runStarted('r1'));
    const before = storage.state.writes;
    clock.set(DAY_START - 3_600_000);
    for (let index = 0; index < 5; index += 1) engine.ingest(kill(`k${index}`));
    assert.ok(
      storage.state.writes > before,
      'a backwards clock does not block the writes'
    );
  }

  // The best value of the day is the progress of the day, and the snapshot exposes it.
  {
    const { engine } = makeEngine();
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 4; index += 1) engine.ingest(kill(`k${index}`));
    engine.flush();
    assert.equal(engine.snapshot().best.test_kills, 4, 'the best value of the day is exposed');
    const saved = JSON.parse(recordOf(engine));
    assert.equal(
      saved.days[DAY].best.test_kills,
      4,
      'the record keeps the best value of the day'
    );
  }

  // After the midnight the best value of the new day is the progress of the new day,
  // not the counter of the run, which still holds yesterday's part.
  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock, catalog: singleQuestCatalog('q_kills', 50) });
    engine.ingest(runStarted('r1'));
    for (let index = 0; index < 100; index += 1) engine.ingest(kill(`k${index}`));
    clock.set(NEXT_DAY + 60_000);
    engine.ingest(tick('t1', 1000, 0));
    engine.flush();
    assert.equal(
      engine.snapshot().best.only ?? 0,
      0,
      'the best value of the new day is the progress of the new day'
    );
    const saved = JSON.parse(recordOf(engine));
    assert.equal(
      saved.days['2026-10-23'].best.only ?? 0,
      0,
      'the record keeps the progress of the new day, not the counter of the run'
    );
  }

  // --- 25. the day history is bounded ------------------------------------------------------------------

  {
    const clock = clockAt(DAY_START + 3_600_000);
    const { engine } = makeEngine({ clock });
    for (let day = 0; day < MAX_DAY_HISTORY + 4; day += 1) {
      clock.set(DAY_START + day * 86_400_000 + 3_600_000);
      engine.ingest(tick(`t${day}`, 1000, 0));
    }
    engine.flush();
    const saved = JSON.parse(recordOf(engine));
    assert.ok(
      Object.keys(saved.days).length <= MAX_DAY_HISTORY,
      'the day history stays inside the retention window'
    );
  }

  // A record with a huge day map is pruned when it is read, not only at the next
  // midnight.
  {
    const days = {};
    for (let index = 0; index < 2000; index += 1) {
      // A distinct key per entry: a map of twenty-eight keys would not be a map of
      // two thousand.
      const day = Math.floor(index / 28) + 1;
      const key = `2020-${String(Math.min(day, 12)).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`;
      days[key] = { done: [], started: [], best: {}, claimed: [] };
    }
    const huge = JSON.stringify({
      version: QUEST_SAVE_VERSION,
      dayKey: DAY,
      days,
      runMetrics: {},
      dayMetrics: {},
      baseline: {},
      seenEventIds: [],
      claimedLifetime: [],
    });
    const { engine } = makeEngine({ storage: memoryStorage(huge) });
    engine.flush();
    const saved = JSON.parse(recordOf(engine));
    assert.ok(
      Object.keys(saved.days).length <= MAX_DAY_HISTORY,
      'a huge day map is pruned on load'
    );
  }

  // --- 26. the server seam ------------------------------------------------------------------------------

  {
    const { engine } = makeEngine();
    const answer = await engine.verifyWithServer('test_kills');
    assert.equal(answer, 'unavailable', 'without a gateway the answer is unavailable');
  }

  {
    const gateway = {
      verifyQuestCompletion: async () => 'confirmed',
    };
    const engine = createQuestEngine({
      catalog: TEST_CATALOG,
      clock: clockAt(DAY_START + 3_600_000),
      storage: memoryStorage(),
      rewardGateway: gateway,
    });
    assert.equal(
      await engine.verifyWithServer('test_kills'),
      'confirmed',
      'a gateway can confirm a completion'
    );
  }

  {
    const gateway = {
      verifyQuestCompletion: async () => {
        throw new Error('network down');
      },
    };
    const engine = createQuestEngine({
      catalog: TEST_CATALOG,
      clock: clockAt(DAY_START + 3_600_000),
      storage: memoryStorage(),
      rewardGateway: gateway,
    });
    assert.equal(
      await engine.verifyWithServer('test_kills'),
      'unavailable',
      'a failing gateway does not throw into the caller'
    );
  }

  // --- 27. the isolation of the quest core -----------------------------------------------------------

  {
    const sourceDir = resolve('src/quests');
    const files = readdirSync(sourceDir).filter((file) => file.endsWith('.ts'));
    const sourceOf = (file) =>
      readFileSync(join(sourceDir, file), 'utf8')
        // Strip the comments, so that prose about a forbidden word cannot fail a check.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    for (const file of files) {
      const source = sourceOf(file);

      // No request of any kind: the quest core never talks to the server.
      assert.ok(
        !/\bfetch\s*\(/.test(source),
        `the quest core must not perform a request (${file})`
      );
      assert.ok(
        !/\bXMLHttpRequest\b/.test(source),
        `the quest core must not use XHR (${file})`
      );

      // No value field may be declared. The reward belongs to the server.
      const forbidden = [
        'rewardRna',
        'reward_rna',
        'starBalance',
        'telegramStars',
        'addRna',
        'grantRna',
        'balance',
        'price',
        'amount',
      ];
      for (const name of forbidden) {
        const pattern = new RegExp(`(^|[^\\w])(${name})\\s*[:?]`, 'm');
        assert.ok(
          !pattern.test(source),
          `the quest core must not declare a value field (${file}: ${name})`
        );
      }

      // Every module the quest core loads has to be relative.
      const specifiers = [
        ...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g),
      ].map((match) => match[1]);
      for (const specifier of specifiers) {
        assert.ok(
          specifier.startsWith('./'),
          `the quest core must only load relative modules, ${file} loads ${specifier}`
        );
      }

      // No browser global outside the dedicated adapter.
      for (const global of [
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'document',
        'window',
        'navigator',
        'XMLHttpRequest',
      ]) {
        if (file === 'questStorage.ts' && global === 'localStorage') continue;
        assert.ok(
          !new RegExp(`\\b${global}\\b`).test(source),
          `the quest core must not touch ${global} outside the adapter (${file})`
        );
      }

      // The scenes, the product save and the server must stay out of the quest core.
      for (const forbiddenImport of [
        '../scenes/',
        '../systems/',
        '../game/',
        'phaser',
        'server/',
      ]) {
        assert.ok(
          !source.includes(forbiddenImport),
          `the quest core must not reach into ${forbiddenImport} (${file})`
        );
      }
    }
  }

  console.log(
    'quest core: Muse catalog and selection, UTC rotation, Muse storage key and record, ' +
      'run accounting, day progress, day streaks, lifetime mirror, forward-only day, ' +
      'event idempotency, single completion, single receipt, damaged saves, newer builds, ' +
      'coalesced writes, Daily isolation and catalog integrity PASS'
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

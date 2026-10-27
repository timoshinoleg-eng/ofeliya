/**
 * RU UI copy catalog contract.
 *
 * Guards that the catalog did not silently rewrite player-visible strings:
 * the expected values are pinned here as literals, deliberately NOT derived
 * from the implementation constants, and the scene call sites are checked for
 * adoption.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-ui-copy-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/UiCopy.ts',
      'src/game/ControlMode.ts',
      'src/game/UpgradeSystem.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--outDir', temp,
      '--rootDir', resolve('src'),
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const copy = require(join(temp, 'game', 'UiCopy.js'));
  const control = require(join(temp, 'game', 'ControlMode.js'));
  const { UPGRADES } = require(join(temp, 'game', 'UpgradeSystem.js'));
  const evolutionSource = readFileSync('src/game/EvolutionSystem.ts', 'utf8');
  const evolutionRecipes = [...evolutionSource.matchAll(/recipe:\s*'([^']+)'/g)].map((m) => m[1]);

  const MODES = ['one-hand', 'two-hand', 'dual-move'];

  // 1. Rarity words — pinned literals, not read back from the module.
  assert.deepEqual(
    { ...copy.RARITY_LABELS },
    { common: 'СТАНДАРТ', rare: 'РЕДКИЙ' },
    'rarity labels'
  );
  assert.deepEqual(
    { ...copy.MUTATION_CARD_HEADERS },
    { legendary: 'ЛЕГЕНДАРНАЯ МУТАЦИЯ', evolution: 'КРИТИЧЕСКАЯ МУТАЦИЯ' },
    'special mutation card headers'
  );

  // 2. Card header composition for every real family/rarity/kind combination.
  assert.equal(
    copy.mutationCardHeader({ family: 'weapon', rarity: 'common' }),
    'АГРЕССИЯ · СТАНДАРТ',
    'weapon/common header'
  );
  assert.equal(
    copy.mutationCardHeader({ family: 'core', rarity: 'rare' }),
    'РАСПРОСТРАНЕНИЕ · РЕДКИЙ',
    'core/rare header'
  );
  assert.equal(
    copy.mutationCardHeader({ family: 'defense', rarity: 'common', kind: 'upgrade' }),
    'ЗАЩИТА · СТАНДАРТ',
    'explicit upgrade kind header'
  );
  assert.equal(
    copy.mutationCardHeader({ family: 'weapon', rarity: 'rare', kind: 'evolution' }),
    'КРИТИЧЕСКАЯ МУТАЦИЯ',
    'evolution header ignores family/rarity'
  );
  assert.equal(
    copy.mutationCardHeader({ family: 'utility', rarity: 'legendary', kind: 'legendary' }),
    'ЛЕГЕНДАРНАЯ МУТАЦИЯ',
    'legendary header ignores family/rarity'
  );

  // Every upgrade that can reach a card must produce a non-empty header.
  for (const def of UPGRADES) {
    const header = copy.mutationCardHeader(def);
    assert.equal(typeof header, 'string');
    assert.ok(header.length > 0, `empty header for ${def.id}`);
    assert.ok(!header.includes('undefined'), `undefined in header for ${def.id}`);
  }

  // 3. Build summary abbreviations: exact strings + full UPGRADES coverage.
  assert.deepEqual(
    { ...copy.BUILD_SUMMARY_LABELS },
    {
      dmg: 'ШИПЫ',
      rate: 'РЕПЛИКАЦИЯ',
      multi: 'КОПИИ',
      pierce: 'ПРОБИТИЕ',
      speed: 'СКОРОСТЬ',
      hp: 'КАПСИД',
      magnet: 'МАГНИТ',
      orbit: 'СПУТНИКИ',
      nova: 'ИМПУЛЬС',
      regen: 'РЕГЕН.',
      infect: 'ЗАРАЖЕНИЕ',
      lysis: 'ЦИТОЛИЗ',
      factory: 'ФАБРИКА',
    },
    'build summary abbreviations'
  );
  const unlabeled = UPGRADES.map((u) => u.id).filter((id) => !(id in copy.BUILD_SUMMARY_LABELS));
  assert.deepEqual(unlabeled, [], 'every upgrade id must have a summary abbreviation');

  // 4. Build summary behavior: filter, order, top-5 cap, unknown-id fallback.
  assert.equal(
    copy.formatBuildSummary({ dmg: 3, rate: 2, speed: 1, hp: 0, magnet: -1, 'evo:prism': 9 }),
    'ШИПЫ 3 · РЕПЛИКАЦИЯ 2 · СКОРОСТЬ 1',
    'zero/negative stacks and non-UPGRADES ids are dropped'
  );
  const capped = { factory: 1, orbit: 9, nova: 8, magnet: 7, speed: 6, pierce: 5, hp: 4 };
  assert.equal(
    copy.formatBuildSummary(capped),
    'СПУТНИКИ 9 · ИМПУЛЬС 8 · МАГНИТ 7 · СКОРОСТЬ 6 · ПРОБИТИЕ 5',
    'build summary is sorted by stack desc and capped at 5'
  );
  assert.equal(copy.formatBuildSummary({}), '', 'empty stacks yield an empty summary');
  assert.equal(copy.formatBuildSummary({ hp: 3, dmg: 3, orbit: 3 }),
    'КАПСИД 3 · ШИПЫ 3 · СПУТНИКИ 3', 'equal stack counts retain insertion order');

  // 5. Control modes: full vs compact variants, exhaustive over supported modes.
  assert.deepEqual(Object.keys(control.CONTROL_MODE_COPY).sort(), [...MODES].sort());
  assert.deepEqual(Object.keys(control.CONTROL_MODE_COPY_COMPACT).sort(), [...MODES].sort());
  assert.deepEqual(Object.keys(control.CONTROL_MODE_COPY_TINY).sort(), [...MODES].sort());

  assert.deepEqual(
    Object.fromEntries(MODES.map((m) => [m, control.controlModeLabel(m)])),
    {
      'one-hand': 'ОДНА РУКА',
      'two-hand': 'ДВЕ РУКИ · ПРИЦЕЛ',
      'dual-move': 'ДВЕ РУКИ · ДВИЖЕНИЕ',
    },
    'full control-mode labels'
  );
  assert.deepEqual(
    Object.fromEntries(MODES.map((m) => [m, control.controlModeDescription(m)])),
    {
      'one-hand': 'текущее управление · касание в любом месте · автоатака',
      'two-hand': 'слева движение · справа приоритет атаки · автоатака',
      'dual-move': 'оба стика двигают · автоатака',
    },
    'full control-mode descriptions'
  );
  assert.deepEqual(
    Object.fromEntries(MODES.map((m) => [m, control.controlModeCompactLabel(m)])),
    {
      'one-hand': 'ОДНА РУКА',
      'two-hand': 'ДВЕ РУКИ',
      'dual-move': 'ДВА СТИКА',
    },
    'compact control-mode labels'
  );
  assert.deepEqual(
    Object.fromEntries(MODES.map((m) => [m, control.controlModeCompactDescription(m)])),
    {
      'one-hand': 'АВТОАТАКА · одно касание',
      'two-hand': 'ПРИЦЕЛ · справа атака',
      'dual-move': 'оба стика · автоатака',
    },
    'compact control-mode descriptions'
  );
  assert.deepEqual(
    Object.fromEntries(MODES.map((m) => [m, control.controlModeTinyHint(m)])),
    { 'one-hand': 'автоатака', 'two-hand': 'прицел', 'dual-move': 'автоатака' },
    'tiny viewport hints'
  );

  // 6. Compact and full variants must stay distinct where the game intends them to.
  assert.notEqual(
    control.controlModeLabel('two-hand'),
    control.controlModeCompactLabel('two-hand'),
    'two-hand label must keep the layout suffix only in the full variant'
  );
  assert.notEqual(
    control.controlModeCompactLabel('dual-move'),
    control.controlModeLabel('dual-move'),
    'dual-move compact label must not reuse the full label'
  );
  for (const mode of MODES) {
    assert.notEqual(
      control.controlModeCompactDescription(mode),
      control.controlModeDescription(mode),
      `compact description for ${mode} must differ from the full one`
    );
  }

  // 7. Adoption: the catalog is actually consumed, no inline duplicates remain.
  const ui = readFileSync('src/scenes/UIScene.ts', 'utf8');
  assert(ui.includes("from '../game/UiCopy'"), 'UIScene must import the copy catalog');
  assert(ui.includes('mutationCardHeader(def)'), 'UIScene must render card headers via the catalog');
  assert(ui.includes('MUTATION_CARD_HEADERS.legendary'), 'legendary reward must use the catalog header');
  assert(ui.includes('MUTATION_CARD_HEADERS.evolution'), 'evolution reward must use the catalog header');
  assert(ui.includes('formatBuildSummary(stacks)'), 'build summary must use the catalog formatter');
  for (const drifted of [
    "'РЕДКИЙ' : 'СТАНДАРТ'",
    "'ЛЕГЕНДАРНАЯ МУТАЦИЯ'",
    "'КРИТИЧЕСКАЯ МУТАЦИЯ'",
    "regen: 'РЕГЕН.'",
  ]) {
    assert(!ui.includes(drifted), `UIScene still inlines the drift candidate: ${drifted}`);
  }

  const menu = readFileSync('src/scenes/MenuScene.ts', 'utf8');
  for (const adopted of [
    'controlModeCompactLabel(selectedControlMode)',
    'controlModeCompactDescription(selectedControlMode)',
    'controlModeTinyHint(selectedControlMode)',
  ]) {
    assert(menu.includes(adopted), `MenuScene must use ${adopted}`);
  }
  for (const drifted of ["'ДВА СТИКА'", "'ПРИЦЕЛ · справа атака'", "'АВТОАТАКА · одно касание'"]) {
    assert(!menu.includes(drifted), `MenuScene still inlines the drift candidate: ${drifted}`);
  }

  // 8. The copy of the UI redesign is pinned to the source of truth.
  assert.equal(copy.MENU_COPY.tagline, 'Выживай. Поглощай РНК. Эволюционируй.', 'menu tagline');
  assert.equal(copy.MENU_COPY.start, 'НАЧАТЬ ЗАРАЖЕНИЕ', 'fresh start action');
  assert.equal(copy.MENU_COPY.resume, 'ПРОДОЛЖИТЬ ЗАБЕГ', 'resume action');
  assert.equal(copy.MENU_COPY.newRun, 'НОВЫЙ ЗАБЕГ', 'new run action');
  assert.equal(
    copy.MENU_COPY.nextRunHint,
    'Для нового забега',
    'the run-configuration cards belong to the next run'
  );
  assert.equal(copy.MENU_COPY.music, '♪ Музыка', 'the music switch carries its glyph');
  assert.deepEqual(
    { ...copy.MENU_COPY.difficultySteps },
    { easy: '• ◦ ◦', standard: '• • ◦', strained: '• • •' },
    'the difficulty step indicator'
  );
  assert.equal(copy.RESULT_COPY.header, 'ИТОГ ЗАБЕГА', 'result header');
  assert.equal(copy.RESULT_COPY.defeat, 'ШТАММ УНИЧТОЖЕН', 'defeat headline');
  assert.equal(copy.RESULT_COPY.victory, 'НОСИТЕЛЬ ЗАРАЖЁН', 'victory headline');
  assert.equal(copy.RESULT_COPY.critical, 'Критические мутации', 'the critical line is written in full');
  assert.equal(copy.RESULT_COPY.legendary, 'ЛЕГЕНДАРНАЯ МУТАЦИЯ', 'the legendary line');
  assert.equal(copy.RESULT_COPY.resumed, 'Тренировка (продолженный забег)', 'the practice chip');
  assert.equal(copy.RESULT_COPY.dailyRank(5), '★ МЕСТО #5 В РЕЙТИНГЕ ДНЯ', 'the daily place');
  assert.deepEqual(
    [...copy.CODEX_COPY.synergyRecipes],
    evolutionRecipes,
    'Codex synergy recipes must be the actual EvolutionSystem recipes'
  );
  assert.deepEqual(
    { ...copy.RESULT_MODE_CHIP },
    {
      practice: 'Тренировка (продолженный забег)',
      ranked: 'СТАНДАРТ · В зачёт рейтинга',
      daily: 'ЗАБЕГ ДНЯ · СТАНДАРТ',
      duel: 'ДУЭЛЬ · СТАНДАРТ',
      easy: 'ЛЁГКИЙ · Тренировка',
      strained: 'НАПРЯЖЕНИЕ · Тренировка',
      local: 'СТАНДАРТ · Тренировка',
    },
    'the mode chips of the result screen'
  );
  assert.equal(copy.META_COPY.tasks, 'ЗАДАЧИ ДНЯ', 'daily tasks title');
  assert.equal(copy.META_COPY.mastery, 'ПРОХОЖДЕНИЕ РЕЖИМОВ', 'codex mastery section');
  assert.equal(copy.META_COPY.dailyCta, 'НАЧАТЬ ЗАБЕГ ДНЯ', 'the daily call to action');
  assert.equal(copy.META_COPY.dailyEmpty, 'Сегодня ты ещё не играл', 'the empty daily state');
  assert.equal(
    copy.META_COPY.networkError,
    'Нет соединения с сервером. Твой прогресс сохраняется.',
    'the network error of the rating'
  );
  assert.equal(
    copy.META_COPY.serverError,
    'Сервер не ответил. Твой прогресс сохраняется.',
    'the server error of the rating'
  );
  assert.equal(
    copy.META_COPY.friendsEmpty,
    'Здесь появятся результаты друзей, которые играют через @ofeliya_game_bot.',
    'the empty friends state'
  );
  assert.equal(copy.META_COPY.streak(3, 5), 'Серия: 3 дн. · Рекорд: 5 дн.', 'the streak line');
  assert.equal(
    copy.META_COPY.streakEmptyWithBest(5),
    'Сыграй забег дня, чтобы начать серию · Рекорд: 5 дн.',
    'the empty streak line'
  );
  assert.equal(copy.META_COPY.remaining(1), 'остался 1', 'one task is left');
  assert.equal(copy.META_COPY.remaining(4), 'осталось 4', 'four tasks are left');
  assert.equal(copy.META_COPY.seasonTitle(3, 2), 'СЕЗОН 3 · осталось 2 дн.', 'the season header');
  assert.equal(
    copy.META_COPY.seasonRow(1, 'Игрок (TG)', '10:48', '1\u00a0414'),
    '#1 · Игрок (TG) — 10:48 · 1\u00a0414 кл.',
    'a row of the season table'
  );
  assert.equal(
    copy.META_COPY.dailyRow('Олег', '01:09', '68', 1),
    'Олег · 01:09 · уничтожено 68 · ★ место #1',
    'the daily row of the player'
  );
  assert.equal(
    copy.META_COPY.shellLockedBy('ОХОТНИК НА ЭЛИТУ'),
    'Чтобы открыть: выполни веху «ОХОТНИК НА ЭЛИТУ»',
    'the condition of a locked shell'
  );
  assert.equal(
    copy.META_COPY.shellUnlockedBy('ОХОТНИК НА ЭЛИТУ'),
    'Открыто за веху «ОХОТНИК НА ЭЛИТУ»',
    'the condition of an open shell'
  );
  assert.equal(
    copy.META_COPY.milestoneKillsGroup(2771),
    'Уничтожение иммунных клеток (в прогрессе вех: 2\u00a0771)',
    'the group header of the kill milestones names the collection progress window'
  );
  assert.ok(
    !copy.META_COPY.milestoneKillsGroup(2771).includes('всего:'),
    'the milestone kills counter must not be presented as a lifetime total'
  );
  assert.equal(
    copy.META_COPY.codexSubtitle(4, 9, 12),
    'Открыто записей: 4/9 · Забегов: 12',
    'the codex header'
  );
  // The lifetime totals left the codex: the catalog must not offer them again.
  assert.equal(
    Object.prototype.hasOwnProperty.call(copy.META_COPY, 'codexLifetime'),
    false,
    'the codex must not carry a lifetime row'
  );
  assert.equal(
    copy.META_COPY.codexEntries(3),
    '★ Открыто в Кодексе: +3 записи',
    'the codex entries plate'
  );
  assert.equal(
    copy.META_COPY.codexEntries(1),
    '★ Открыто в Кодексе: +1 запись',
    'the codex entries plate, one record'
  );
  assert.equal(
    copy.META_COPY.newRecords(['выживание', 'иммунитет']),
    'НОВЫЕ РЕКОРДЫ: выживание · иммунитет',
    'the new records line'
  );
  assert.deepEqual(
    [...copy.CODEX_COPY.synergyTitles],
    ['ЗАКРЫТАЯ СИНЕРГИЯ I', 'ЗАКРЫТАЯ СИНЕРГИЯ II', 'ЗАКРЫТАЯ СИНЕРГИЯ III'],
    'the locked synergy titles'
  );
  assert.deepEqual(
    [...copy.CODEX_COPY.synergyRecipes],
    [
      'БЕЛКОВЫЕ ШИПЫ III + ПРОНИКНОВЕНИЕ II',
      'КАПСИДНЫЕ СПУТНИКИ III + ПОДВИЖНОСТЬ/РЕПЛИКАЦИЯ II',
      'МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II',
    ],
    'the source-truth recipes of the locked synergies'
  );
  assert.equal(
    copy.CODEX_COPY.synergySub,
    'Открываются при совмещении двух совместимых ветвей в одном забеге',
    'the explanation of the synergy section'
  );
  assert.equal(copy.CODEX_COPY.branchComplete, 'Выполнено', 'the state of a complete branch');
  assert.equal(
    copy.masteryModeLine('Стандарт', 0, '15:20'),
    'Стандарт — ещё не пройдена · лучшее время: 15:20',
    'a mode that was played but not cleared'
  );
  assert.equal(
    copy.masteryModeLine('Стандарт', 0, null),
    'Стандарт — ещё не пройдена',
    'a mode that was never played never shows a dash as "no value"'
  );
  assert.equal(
    copy.masteryModeLine('Стандарт', 2, '09:15'),
    '◆ Стандарт — пройдено: 2 · рекорд: 09:15',
    'a cleared mode'
  );

  // 9. The share variants of the source of truth and their invariants.
  const standardShare = copy.buildShareText({ win: false, time: '00:26', kills: 18, infected: 2 });
  assert.equal(
    standardShare,
    'OFELIYA · Вызов в кровотоке\n' +
      '🦠 Мой вирус продержался 00:26 в OFELIYA — и это только начало.\n' +
      'Уничтожено 18 иммунных клеток, заражено 2.\n' +
      'Сможешь дольше? Играй: @ofeliya_game_bot',
    'the standard challenge share'
  );
  const firstRunShare = copy.buildShareText({
    win: true, time: '00:26', kills: 18, infected: 2, firstRun: true,
  });
  assert.equal(
    firstRunShare,
    'OFELIYA · Вызов в кровотоке\n' +
      '🦠 Я запустил свой первый штамм в OFELIYA. Синтетический вирус против иммунной системы — выживи дольше меня.\n' +
      '@ofeliya_game_bot',
    'the first run share'
  );
  const legendaryShare = copy.buildShareText({
    win: true, time: '15:20', kills: 2617, infected: 61, legendaryName: 'НУЛЕВАЯ ТОЧКА',
  });
  assert.equal(
    legendaryShare,
    'OFELIYA · Вызов в кровотоке\n' +
      '🦠 15:20 выживания в OFELIYA. Уничтожено 2\u00a0617 иммунных клеток, заражено 61.\n' +
      'Легендарная мутация «НУЛЕВАЯ ТОЧКА» открыта.\n' +
      'Повторишь? @ofeliya_game_bot',
    'the legendary share'
  );
  const victoryShare = copy.buildShareText({ win: true, time: '00:26', kills: 18, infected: 2 });
  assert.ok(
    victoryShare.startsWith('OFELIYA · Вызов в кровотоке'),
    'a share text always starts with the product name'
  );
  assert.ok(
    victoryShare.includes('Сможешь быстрее?'),
    'a victory asks for a faster run, not a longer one'
  );
  for (const [name, text] of Object.entries({ standardShare, firstRunShare, legendaryShare, victoryShare })) {
    assert.ok(text.startsWith('OFELIYA'), `${name} must start with OFELIYA`);
    assert.ok(text.includes('@ofeliya_game_bot'), `${name} must name the bot`);
    for (const forbidden of copy.SHARE_FORBIDDEN_TERMS) {
      assert.ok(!text.includes(forbidden), `${name} must not carry "${forbidden}"`);
    }
  }
  assert.ok(standardShare.includes('продержался'), 'a defeat says "продержался"');
  assert.ok(!standardShare.includes('выжил'), 'a defeat never says "выжил"');
  assert.equal(
    copy.buildDuelShareText('10:48'),
    'OFELIYA · ДУЭЛЬ: мой результат 10:48. Сможешь пройти быстрее? @ofeliya_game_bot',
    'the duel share'
  );

  console.log('ui copy catalog: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
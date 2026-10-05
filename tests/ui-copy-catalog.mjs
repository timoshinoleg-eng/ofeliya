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

  console.log('ui copy catalog: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
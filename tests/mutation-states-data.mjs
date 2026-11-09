/**
 * QA fixture contract for the three fixed mutation-choice states (A/B/C) the
 * owner and the agent agreed on for the choice-screen work. Base: main 2bd6320.
 *
 * The states are exercised against the game's own compiled sources — the same
 * tsc-to-temp pattern as tests/mutation-before-after.mjs — so every number and
 * every recipe condition is computed by the game's real formulas, never copied
 * from the brief.
 *
 * State A — fresh run, random pick: ПОСЛЕДНИЙ НОСИТЕЛЬ (legendary) +
 *           РЕЦЕПТОРНЫЙ ЗАХВАТ (infect) + ЦИТОЛИЗ (lysis).
 *           Expected pairs: 1250 → 1025 мс / 58 → 62,6 and 26 → 33,8 / 150 → 162.
 * State B — recipe almost ready: МЕМБРАННЫЙ ИМПУЛЬС 3/3, РНК-АФФИНИТЕТ 1/2.
 *           Choosing magnet must COMPLETE the singularity conditions (make it
 *           offerable) but must NOT apply the evolution by itself.
 * State C — evolution offered: СИНГУЛЯРНОСТЬ already among the three choices,
 *           full effect + boss caveat, visually distinct kind.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-states-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const assert = (condition, message) => {
  if (!condition) throw new Error(`mutation-states-data: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/upgradeBeforeAfter.ts',
      'src/game/RunState.ts',
      'src/game/UpgradeSystem.ts',
      'src/game/EvolutionSystem.ts',
      'src/game/LegendarySystem.ts',
      'src/game/config.ts',
      'src/systems/PerformanceProfile.ts',
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

  // eslint-disable-next-line no-require-imports
  const { RunState } = require(join(temp, 'game/RunState.js'));
  // eslint-disable-next-line no-require-imports
  const { UPGRADES } = require(join(temp, 'game/UpgradeSystem.js'));
  // eslint-disable-next-line no-require-imports
  const { formatUpgradeEffectSuffix } = require(join(temp, 'game/upgradeBeforeAfter.js'));
  // eslint-disable-next-line no-require-imports
  const { EVOLUTIONS, getEvolutionDef, readyEvolutions, rollRunChoices } = require(join(
    temp,
    'game/EvolutionSystem.js'
  ));
  // eslint-disable-next-line no-require-imports
  const { getLegendaryDefinition } = require(join(temp, 'game/LegendarySystem.js'));

  const def = (id) => UPGRADES.find((u) => u.id === id);
  const applyTimes = (s, id, n) => {
    const d = def(id);
    for (let i = 0; i < n; i++) {
      d.apply(s);
      s.bump(id);
    }
  };

  /* ------------------------------ State A ------------------------------ */
  // Fresh run: the base values themselves are the «before» of the first stack.
  const a = new RunState({ id: 'bloodstream', order: 1 });
  eq(a.infectionDurationMs, 1250, 'A: base infection time');
  eq(a.infectionRadius, 58, 'A: base infection radius');
  eq(a.hostLysisDamage, 26, 'A: base lysis damage');
  eq(a.hostLysisRadius, 150, 'A: base lysis radius');
  eq(
    formatUpgradeEffectSuffix(a, def('infect')),
    '1250 → 1025 · 58 → 62,6',
    'A: infect pair (время 1250 → 1025 мс, радиус 58 → 62,6)'
  );
  eq(
    formatUpgradeEffectSuffix(a, def('lysis')),
    '26 → 33,8 · 150 → 162',
    'A: lysis pair (урон 26 → 33,8, радиус 150 → 162)'
  );

  // The legendary card of state A: real definition, distinct kind, no suffix.
  const carrier = getLegendaryDefinition('last-carrier');
  eq(carrier.title, 'ПОСЛЕДНИЙ НОСИТЕЛЬ', 'A: legendary title');
  assert(carrier.effect.includes('Один раз за забег'), 'A: carrier effect states one activation per run');
  assert(carrier.effect.includes('1 прочности'), 'A: carrier effect leaves 1 HP');
  assert(carrier.desc.includes('25%'), 'A: carrier desc names the 25% cost');
  assert(carrier.desc.includes('8 секунд'), 'A: carrier desc names the 8-second form');
  eq(formatUpgradeEffectSuffix(a, { ...carrier, id: 'legendary:last-carrier', kind: 'legendary' }), null,
    'A: legendary card carries no before-after suffix');
  // Rarity of the three A cards per the agreed fixture.
  eq(def('infect').rarity, 'common', 'A: infect is common');
  eq(def('lysis').rarity, 'rare', 'A: lysis is rare');

  /* ------------------------------ State B ------------------------------ */
  // МЕМБРАННЫЙ ИМПУЛЬС 3/3, РНК-АФФИНИТЕТ 1/2: one magnet stack short of the recipe.
  const b = new RunState({ id: 'bloodstream', order: 1 });
  applyTimes(b, 'nova', 3);
  applyTimes(b, 'magnet', 1);
  eq(b.stackOf('nova'), 3, 'B: nova 3/3');
  eq(b.stackOf('magnet'), 1, 'B: magnet 1/2');
  assert(
    !readyEvolutions(b).some((e) => e.id === 'singularity'),
    'B: singularity must NOT be ready while magnet is 1/2'
  );
  // One stack already applied: 90 × 1.35 = 121,5 before, × 1.35 again after.
  eq(
    formatUpgradeEffectSuffix(b, def('magnet')),
    '121,5 → 164 · → СИНГУЛЯРНОСТЬ',
    'B: magnet before-after with singularity tag'
  );

  // The player's pick: real apply of the magnet card only.
  def('magnet').apply(b);
  b.bump('magnet');
  eq(b.stackOf('magnet'), 2, 'B: magnet becomes 2/2 after the pick');
  assert(
    readyEvolutions(b).some((e) => e.id === 'singularity'),
    'B: picking magnet COMPLETES the recipe — singularity becomes offerable'
  );
  assert(!b.hasEvolution('singularity'), 'B: the pick must NOT apply the evolution itself');

  // A real roll now leads with the ready evolution (priority layer).
  const rolled = rollRunChoices(b, 3, () => 0.99);
  eq(rolled[0].id, 'evo:singularity', 'B: next real offer leads with singularity');

  /* ------------------------------ State C ------------------------------ */
  // Recipe complete; СИНГУЛЯРНОСТЬ already stands among the three choices.
  const c = new RunState({ id: 'bloodstream', order: 1 });
  applyTimes(c, 'nova', 3);
  applyTimes(c, 'magnet', 2);
  assert(
    readyEvolutions(c).some((e) => e.id === 'singularity'),
    'C: singularity is ready'
  );
  const singularity = getEvolutionDef('singularity');
  eq(singularity.recipe, 'МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II', 'C: recipe copy');
  assert(singularity.desc.includes('Боссы получают урон без перемещения'), 'C: boss caveat present');

  // The choice object the UI receives (same mapping EvolutionSystem.toChoice uses).
  const cRolled = rollRunChoices(c, 3, () => 0.99);
  const evoChoice = cRolled.find((choice) => choice.id === 'evo:singularity');
  assert(evoChoice, 'C: evo:singularity among the offered choices');
  eq(evoChoice.kind, 'evolution', 'C: evolution kind is visually distinct from legendary');
  eq(evoChoice.shortName, 'СИНГУЛЯРНОСТЬ', 'C: evolution name');
  eq(evoChoice.name, singularity.effect, 'C: evolution effect line comes from the single game source');
  assert(evoChoice.desc.includes(singularity.recipe), 'C: card desc carries the recipe');
  eq(
    EVOLUTIONS.find((e) => e.id === 'prism').recipe,
    'БЕЛКОВЫЕ ШИПЫ III + ПРОНИКНОВЕНИЕ II',
    'C: hyperшип recipe unchanged'
  );

  console.log('mutation-states-data: OK (A/B/C fixtures match game sources)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

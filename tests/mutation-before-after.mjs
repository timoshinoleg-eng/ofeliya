/**
 * C2: mutation cards show «было → стало» + synergy tag.
 *
 * Covers: the before→after computation for cards of different shapes —
 * multiplicative (dmg, rate, magnet), additive counts (orbit, multi),
 * additive pool (hp), dual-stat (lysis), and the synergy tag presence /
 * absence — plus the guarantees that the source state is never mutated and
 * that ceremony cards / unknown ids get no suffix.
 *
 * Method (same pattern as tests/lab-economy.mjs): the real TypeScript
 * sources are compiled to a temp dir and required, so the test exercises
 * the game's own apply() formulas. Expected values are computed in-test
 * from base constants taken from src/game/config.ts (WEAPON.damage 10,
 * fireIntervalMs 550, PLAYER.speed 180, GEM.magnetRadius 90, lysis base
 * 26 / 150) times the card's own declared factor — never copied from the
 * audit's example numbers.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-c2-'));
// The repo root is "type": "module", so compiled CommonJS output inside it
// would be misread as ESM without this (same trick as lab-economy.mjs).
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const assert = (condition, message) => {
  if (!condition) throw new Error(`mutation-before-after: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// Test-side oracle formatting (mirrors the Russian comma convention, not the
// implementation's code path): one decimal trimmed, two decimals kept.
const fmt1 = (n) => n.toFixed(1).replace('.', ',').replace(/,0$/, '');
const fmt2 = (n) => n.toFixed(2).replace('.', ',');

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/upgradeBeforeAfter.ts',
      'src/game/RunState.ts',
      'src/game/UpgradeSystem.ts',
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
  const { formatUpgradeEffectSuffix, getUpgradeBeforeAfter } = require(join(
    temp,
    'game/upgradeBeforeAfter.js'
  ));

  const fresh = () => new RunState({ id: 'bloodstream', order: 1 });
  const def = (id) => UPGRADES.find((u) => u.id === id);
  // Apply a card n times exactly as a run does: apply() + stack bump.
  const applyTimes = (s, id, n) => {
    const d = def(id);
    for (let i = 0; i < n; i++) {
      d.apply(s);
      s.bump(id);
    }
  };

  // 1. Multiplicative damage, fresh and mid-run (audit's 10 → 12,5 → 15,6
  //    is recomputed here from WEAPON.damage 10 × 1.25, not asserted blind).
  eq(formatUpgradeEffectSuffix(fresh(), def('dmg')), `${fmt1(10)} → ${fmt1(10 * 1.25)} · → ГИПЕРШИП`, 'dmg fresh');
  const dmg2 = fresh();
  applyTimes(dmg2, 'dmg', 2);
  eq(
    formatUpgradeEffectSuffix(dmg2, def('dmg')),
    `${fmt1(10 * 1.25 ** 2)} → ${fmt1(10 * 1.25 ** 3)} · → ГИПЕРШИП`,
    'dmg at 2 stacks'
  );

  // 2. Multiplicative fire rate, shown as shots/sec (1000 / intervalMs).
  eq(
    formatUpgradeEffectSuffix(fresh(), def('rate')),
    `${fmt2(1000 / 550)} → ${fmt2((1000 / 550) * 1.15)} · → СВЕРХКАПСИД`,
    'rate fresh'
  );

  // 3. Multiplicative move speed (PLAYER.speed 180 × 1.08).
  eq(
    formatUpgradeEffectSuffix(fresh(), def('speed')),
    `${fmt1(180)} → ${fmt1(180 * 1.08)} · → СВЕРХКАПСИД`,
    'speed fresh'
  );

  // 4. Additive satellite count, fresh and mid-run.
  eq(formatUpgradeEffectSuffix(fresh(), def('orbit')), '0 → 1 · → СВЕРХКАПСИД', 'orbit fresh');
  const orbit2 = fresh();
  applyTimes(orbit2, 'orbit', 2);
  eq(formatUpgradeEffectSuffix(orbit2, def('orbit')), '2 → 3 · → СВЕРХКАПСИД', 'orbit at 2 stacks');

  // 5. Additive projectile count, no evolutionHint → no synergy tag.
  eq(formatUpgradeEffectSuffix(fresh(), def('multi')), '1 → 2', 'multi fresh has no tag');

  // 6. Dual-stat card: values in the order the card name mentions them
  //    («+30% урон · +8% радиус» → damage first, radius second).
  eq(
    formatUpgradeEffectSuffix(fresh(), def('lysis')),
    `${fmt1(26)} → ${fmt1(26 * 1.3)} · ${fmt1(150)} → ${fmt1(150 * 1.08)}`,
    'lysis fresh'
  );
  const lysisLines = getUpgradeBeforeAfter(fresh(), def('lysis'));
  eq(
    lysisLines.map((l) => l.label).join('|'),
    'Урон взрыва|Радиус взрыва',
    'lysis line order'
  );

  // 7. Multiplicative magnet radius with the singularity hint.
  eq(
    formatUpgradeEffectSuffix(fresh(), def('magnet')),
    `${fmt1(90)} → ${fmt1(90 * 1.35)} · → СИНГУЛЯРНОСТЬ`,
    'magnet fresh'
  );

  // 8. Additive max-HP pool (the «сразу +25» heal stays in the card name).
  eq(formatUpgradeEffectSuffix(fresh(), def('hp')), '100 → 125', 'hp fresh');

  // 9. Filler heal card (HEAL is not exported, so the test uses a literal
  //    def with the same one-line apply): current HP → capped HP.
  const healState = fresh();
  healState.stage.hp = 64;
  const healDef = {
    id: 'heal',
    apply: (s) => {
      s.stage.hp = Math.min(s.stage.maxHp, s.stage.hp + 40);
    },
  };
  eq(formatUpgradeEffectSuffix(healState, healDef), '64 → 100', 'heal capped at maxHp');

  // 10. Ceremony cards and unknown ids get no suffix.
  eq(formatUpgradeEffectSuffix(fresh(), { id: 'dmg', kind: 'evolution' }), null, 'evolution kind');
  eq(formatUpgradeEffectSuffix(fresh(), { id: 'dmg', kind: 'legendary' }), null, 'legendary kind');
  eq(formatUpgradeEffectSuffix(fresh(), { id: 'nope' }), null, 'unknown id');

  // 11. The source state is never mutated by the computation.
  const probe = fresh();
  applyTimes(probe, 'dmg', 1);
  const mulBefore = probe.stage.damageMul;
  const stacksBefore = probe.stackOf('dmg');
  formatUpgradeEffectSuffix(probe, def('dmg'));
  eq(probe.stage.damageMul, mulBefore, 'damageMul untouched');
  eq(probe.stackOf('dmg'), stacksBefore, 'stacks untouched');

  // 12. Full table: every card in UPGRADES (13) yields a non-null suffix
  //     with a before→after arrow on a fresh state.
  eq(UPGRADES.length, 13, 'UPGRADES table size');
  for (const d of UPGRADES) {
    const suffix = formatUpgradeEffectSuffix(fresh(), d);
    assert(
      typeof suffix === 'string' && suffix.includes(' → '),
      `card ${d.id} must have a before→after suffix, got ${JSON.stringify(suffix)}`
    );
  }

  console.log('mutation-before-after: OK (13 cards, 12 checks)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

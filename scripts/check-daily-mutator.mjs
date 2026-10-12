import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-daily-mutator-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/DailyMutator.ts',
      'src/game/DifficultyProfile.ts',
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

  const {
    DAILY_MUTATORS,
    applyDailyMutator,
    dailyMutatorForDate,
    hashDateKey,
    todayDateKey,
  } = require(join(temp, 'game/DailyMutator.js'));
  const { STANDARD_DIFFICULTY, STRAINED_DIFFICULTY } = require(
    join(temp, 'game/DifficultyProfile.js')
  );

  // The whole point of the module: no runtime RNG anywhere. Determinism must
  // come from the dateKey hash alone (audio has no RNG to borrow either).
  const source = readFileSync(resolve('src/game/DailyMutator.ts'), 'utf8');
  assert(!/Math\.random/.test(source), 'DailyMutator.ts must not use Math.random');
  assert(!/RunRng|gameplayRng/.test(source), 'DailyMutator.ts must not consume run RNG streams');

  // Pool shape: ≥5 authored modifiers, unique ids, readable RU copy.
  assert(Array.isArray(DAILY_MUTATORS) && DAILY_MUTATORS.length >= 5, 'mutator pool too small');
  const ids = new Set(DAILY_MUTATORS.map((m) => m.id));
  assert(ids.size === DAILY_MUTATORS.length, 'duplicate mutator ids');
  for (const mutator of DAILY_MUTATORS) {
    assert(typeof mutator.title === 'string' && mutator.title.length > 0, `${mutator.id}: empty title`);
    assert(typeof mutator.subtitle === 'string' && mutator.subtitle.length > 0, `${mutator.id}: empty subtitle`);
    assert(!/[\u0000-\u001f]/.test(mutator.title + mutator.subtitle), `${mutator.id}: control chars in copy`);
    assert(Number.isInteger(mutator.color) && mutator.color > 0, `${mutator.id}: bad color`);
    assert(typeof mutator.apply === 'function', `${mutator.id}: apply missing`);
  }

  // Hash: pure, stable, unsigned 32-bit.
  assert(hashDateKey('2026-10-12') === hashDateKey('2026-10-12'), 'hash not deterministic');
  assert(hashDateKey('2026-10-12') !== hashDateKey('2026-10-13'), 'adjacent days hash identically');
  assert(hashDateKey('') >>> 0 === hashDateKey(''), 'hash must not be NaN-ish');
  for (let i = 0; i < 200; i++) {
    const h = hashDateKey(`2026-01-${String((i % 28) + 1).padStart(2, '0')}:${i}`);
    assert(h >= 0 && h <= 0xffffffff && Number.isInteger(h), 'hash outside uint32');
  }

  // Total function: empty/malformed dateKeys still resolve to a pool member.
  for (const bad of ['', 'not-a-date', '2026-13-40']) {
    const m = dailyMutatorForDate(bad);
    assert(DAILY_MUTATORS.includes(m), `dailyMutatorForDate(${JSON.stringify(bad)}) left the pool`);
  }

  // Same day → same modifier for every player, repeated calls included.
  for (const day of ['2026-10-12', '2026-10-13', '2027-01-01']) {
    const first = dailyMutatorForDate(day);
    for (let i = 0; i < 5; i++) {
      assert(dailyMutatorForDate(day).id === first.id, `mutator for ${day} not stable across calls`);
    }
    assert(applyDailyMutator(STANDARD_DIFFICULTY, day).mutator.id === first.id, 'applyDailyMutator disagrees with dailyMutatorForDate');
  }

  // The hash must actually spread across the pool over real calendar days.
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    seen.add(dailyMutatorForDate(key).id);
  }
  assert(seen.size >= 3, `mutator rotation too narrow: only ${seen.size} distinct over 120 days`);

  // apply(): returns a new profile, keeps identity/labels, input untouched.
  for (const base of [STANDARD_DIFFICULTY, STRAINED_DIFFICULTY]) {
    for (const mutator of DAILY_MUTATORS) {
      const before = JSON.parse(JSON.stringify(base));
      const patched = mutator.apply(base);
      assert(patched !== base, `${mutator.id}: apply must not return the input object`);
      assert(JSON.stringify(base) === JSON.stringify(before), `${mutator.id}: apply mutated its input`);
      assert(patched.id === base.id && patched.label === base.label && patched.shortLabel === base.shortLabel, `${mutator.id}: identity fields changed`);
      // Every numeric knob stays positive and finite.
      for (const key of [
        'enemyHpMultiplier', 'enemyDamageMultiplier', 'enemySpeedMultiplier',
        'spawnIntervalMultiplier', 'eliteIntervalMultiplier', 'bossHpMultiplier',
        'bossDamageMultiplier', 'bossSpeedMultiplier', 'bossMinionIntervalMultiplier',
        'heartbeatIntervalMultiplier', 'heartbeatPressureMultiplier',
      ]) {
        assert(Number.isFinite(patched[key]) && patched[key] > 0, `${mutator.id}: ${key} not positive after apply`);
      }
      for (const key of ['batchBonus', 'normalEnemyCapBonus', 'bossMinionBonus']) {
        assert(Number.isInteger(patched[key]) && patched[key] >= 0, `${mutator.id}: ${key} not a non-negative integer after apply`);
      }
      // Authored modifier must actually modify ≥1 knob.
      const changed = Object.keys(before).filter(
        (key) => typeof before[key] === 'number' && before[key] !== patched[key]
      );
      assert(changed.length >= 1, `${mutator.id}: applies no delta at all`);
    }
  }

  // Additive deltas must work from a zero baseline (× would be a no-op there).
  const swarm = DAILY_MUTATORS.find((m) => m.id === 'dense-swarm');
  assert(swarm, 'dense-swarm missing from pool');
  assert(swarm.apply(STANDARD_DIFFICULTY).batchBonus === STANDARD_DIFFICULTY.batchBonus + 1, 'dense-swarm batchBonus delta lost on zero base');
  const surge = DAILY_MUTATORS.find((m) => m.id === 'elite-surge');
  assert(surge, 'elite-surge missing from pool');
  assert(surge.apply(STANDARD_DIFFICULTY).normalEnemyCapBonus === STANDARD_DIFFICULTY.normalEnemyCapBonus + 30, 'elite-surge cap delta lost on zero base');

  // todayDateKey: local-calendar YYYY-MM-DD, zero-padded, pure for a fixed clock.
  assert(todayDateKey(new Date(2026, 9, 12, 23, 59, 59)) === '2026-10-12', 'todayDateKey wrong day');
  assert(todayDateKey(new Date(2026, 0, 5, 1, 2, 3)) === '2026-01-05', 'todayDateKey not zero-padded');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayDateKey()), 'todayDateKey format drifted');

  // Ruleset parity: client and server must agree, or daily submits die on 422.
  const runVersions = readFileSync(resolve('src/game/RunVersions.ts'), 'utf8');
  const serverIndex = readFileSync(resolve('server/index.mjs'), 'utf8');
  const clientMatch = runVersions.match(/SCORE_RULESET_VERSION\s*=\s*(\d+)/);
  const serverMatch = serverIndex.match(/CURRENT_RULESET_VERSION\s*=\s*(\d+)/);
  assert(clientMatch && serverMatch, 'ruleset version constants not found');
  assert(clientMatch[1] === serverMatch[1], `ruleset mismatch: client v${clientMatch[1]} vs server v${serverMatch[1]}`);
  assert(clientMatch[1] === '3', `ruleset must be v3 after the P0-3 bump, got v${clientMatch[1]}`);

  console.log('daily-mutator: pool, determinism, apply-semantics and ruleset parity OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

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
  const { STANDARD_DIFFICULTY, STRAINED_DIFFICULTY, heartbeatProfileForDifficulty } = require(
    join(temp, 'game/DifficultyProfile.js')
  );
  const { HEARTBEAT_PULSE_PROFILE } = require(join(temp, 'game/HeartbeatPulseDirector.js'));

  for (const [date, expectedHash, expectedId] of [
    ['2026-10-12', 1283409593, 'elite-surge'],
    ['2026-10-13', 1266631974, 'dense-swarm'],
    ['2027-01-01', 1431789288, 'dense-swarm'],
  ]) {
    assert(hashDateKey(date) === expectedHash, `golden date hash changed: ${date}`);
    assert(dailyMutatorForDate(date).id === expectedId, `authored date rotation changed: ${date}`);
  }

  const deltas = {
    'dense-swarm': { mul: { spawnIntervalMultiplier: 0.9 }, add: { batchBonus: 1 } },
    'frenzy-blood': { mul: { eliteIntervalMultiplier: 0.75, enemySpeedMultiplier: 1.12 } },
    'iron-sheath': { mul: { enemyHpMultiplier: 1.25, enemyDamageMultiplier: 0.9 } },
    'sparse-lethal': { mul: { spawnIntervalMultiplier: 1.15, enemyDamageMultiplier: 1.3, enemyHpMultiplier: 1.1 } },
    'cardiac-stress': { mul: { heartbeatIntervalMultiplier: 0.85, heartbeatPressureMultiplier: 1.2 } },
    'elite-surge': { mul: { eliteIntervalMultiplier: 0.6 }, add: { normalEnemyCapBonus: 30, batchBonus: 1 } },
  };
  assert(DAILY_MUTATORS.length === Object.keys(deltas).length, 'authored pool changed without updated contracts');
  for (const base of [STANDARD_DIFFICULTY, STRAINED_DIFFICULTY]) {
    for (const mutator of DAILY_MUTATORS) {
      const expected = { ...base };
      const patch = deltas[mutator.id];
      assert(patch, `no authored contract for ${mutator.id}`);
      for (const [key, multiplier] of Object.entries(patch.mul ?? {})) expected[key] = base[key] * multiplier;
      for (const [key, bonus] of Object.entries(patch.add ?? {})) expected[key] = base[key] + bonus;
      assert(JSON.stringify(mutator.apply(base)) === JSON.stringify(expected), `${mutator.id}: authored difficulty deltas drifted`);
    }
    const cardiac = DAILY_MUTATORS.find((mutator) => mutator.id === 'cardiac-stress').apply(base);
    const heartbeat = heartbeatProfileForDifficulty(cardiac);
    for (const key of ['firstImpactAtMs', 'intervalMs', 'bossIntervalMs', 'bossFirstImpactDelayMs']) {
      assert(heartbeat[key] === Math.round(HEARTBEAT_PULSE_PROFILE[key] * cardiac.heartbeatIntervalMultiplier), `${base.id}: daily Cardiac timing not applied to actual heartbeat ${key}`);
    }
    for (const key of ['pressureMultiplier', 'bossPressureMultiplier']) {
      const expected = 1 + (HEARTBEAT_PULSE_PROFILE[key] - 1) * cardiac.heartbeatPressureMultiplier;
      assert(Math.abs(heartbeat[key] - expected) < 1e-12, `${base.id}: daily Cardiac pressure not applied`);
    }
  }
  assert(JSON.stringify(heartbeatProfileForDifficulty(STANDARD_DIFFICULTY)) === JSON.stringify(HEARTBEAT_PULSE_PROFILE), 'ordinary Standard heartbeat changed');

  // Execute the production create() initialization statements on the same scene
  // object across launches. Phaser/UI adapters are outside this state contract.
  const gameSource = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  const gameAst = ts.createSourceFile('GameScene.ts', gameSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const gameClass = gameAst.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === 'GameScene');
  const createMethod = gameClass?.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(gameAst) === 'create');
  assert(createMethod?.body, 'GameScene.create initialization missing');
  const initialization = [];
  let foundRngBoundary = false;
  for (const statement of createMethod.body.statements) {
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
      && statement.expression.left.getText(gameAst) === 'this.gameplayRng') {
      foundRngBoundary = true;
      break;
    }
    initialization.push(statement.getText(gameAst));
  }
  assert(foundRngBoundary, 'GameScene RNG boundary missing');
  const compiledInitialization = ts.transpileModule(`function initialize() { ${initialization.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const initialize = new Function('StageDirector', 'STAGES', 'RunCheckpoint', 'validateRunCheckpoint',
    'getDifficultyProfile', 'readDifficultySelection', 'readDailyIntent', 'applyDailyMutator',
    `${compiledInitialization}\nreturn initialize;`)(class {}, [], { clear() {} }, () => null,
    () => STANDARD_DIFFICULTY, () => 'standard', (registry) => registry.get('dailyIntent') ?? null, applyDailyMutator);
  const registryValues = new Map([
    ['dailyIntent', { runId: 'daily-test' }], ['dailyTicket', { dateKey: '2026-10-12' }],
  ]);
  const scene = { registry: {
    get: (key) => registryValues.get(key), set: (key, value) => registryValues.set(key, value),
    remove: (key) => registryValues.delete(key),
  }, dailyMutator: null };
  initialize.call(scene);
  assert(scene.dailyMutator?.id === 'elite-surge', 'daily scene initialization ignored ticket mutator');
  registryValues.delete('dailyIntent');
  registryValues.delete('dailyTicket');
  initialize.call(scene);
  assert(scene.dailyMutator === null, 'ordinary run retained the previous daily banner');
  assert(scene.difficulty === STANDARD_DIFFICULTY && !scene.dailyRun, 'ordinary run retained daily difficulty/intent');
  registryValues.set('dailyIntent', { runId: 'second-daily-test' });
  registryValues.set('dailyTicket', { dateKey: '2026-10-13' });
  initialize.call(scene);
  assert(scene.dailyMutator?.id === 'dense-swarm', 'restarted scene did not replace the daily mutator');

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

/**
 * Deterministic difficulty comparison: EASY vs STANDARD vs STRAINED.
 *
 * The simulation drives the REAL WaveDirector, StageDirector, RunRng,
 * StageDefinitions and DifficultyProfile modules. Only Phaser itself is stubbed
 * (the two math helpers the wave code uses), so the spawn cadence, the elite
 * schedule, the mini-boss beat and the boss request all come from production
 * code — not from a re-implementation.
 *
 * The player model is IDENTICAL for every difficulty, which is what makes the
 * comparison meaningful: same seed, same scripted play, so every difference in
 * the outcome is attributable to the difficulty profile alone.
 *
 * Player model (shared, documented, difficulty-independent):
 *   - the player holds the centre of the arena and never stops shooting;
 *   - the player clears one enemy every KILL_INTERVAL_MS;
 *   - an enemy closes the real spawn ring at its real speed, so the time it
 *     needs to reach the player comes from the production constants;
 *   - contact hits honour the real global PLAYER.iframeMs window;
 *   - the player starts with PLAYER.hp and no regen inside the window, so the
 *     survival figure measures incoming pressure, not skill.
 *
 * These are deterministic automated scenarios. They are not human usability tests.
 */
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-difficulty-comparison-'));
const require = createRequire(import.meta.url);
const sourcePath = (path) => resolve(path).split(sep).join('/');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

/** Shared, difficulty-independent player model constants. */
const WINDOW_MS = 180_000;
const STEP_MS = 16;
/**
 * Scripted clear rate: one enemy per 350 ms (~2.9 kills/s). The bare base
 * weapon clears roughly 0.9 swarms/s; a mid-run build with damage stacks and
 * orbit reaches ~3/s. The same rate is applied to every tier.
 */
const KILL_INTERVAL_MS = 350;
/** Real spawn ring: max(camera.width, camera.height) / 2 + 90 + rand * 60. */
const RING_RADIUS_PX = 422 + 90 + 30;
const SEEDS = ['easy-cmp-seed-01', 'easy-cmp-seed-02', 'easy-cmp-seed-03'];
const TIERS = ['easy', 'standard', 'strained'];

try {
  // --- Phaser stub: the wave code only needs two math helpers ---------------
  const phaserStub = join(temp, 'phaser-stub.ts');
  writeFileSync(
    phaserStub,
    [
      'const Clamp = (value: number, min: number, max: number) => globalThis.Math.min(globalThis.Math.max(value, min), max);',
      'const Linear = (p0: number, p1: number, t: number) => p0 + (p1 - p0) * t;',
      'export const Math = { Clamp, Linear };',
      'export default { Math };',
    ].join('\n')
  );

  const entry = join(temp, 'comparison-entry.ts');
  const bundle = join(temp, 'comparison-entry.cjs');
  writeFileSync(
    entry,
    [
      `export { WaveDirector } from '${sourcePath('src/game/WaveDirector.ts')}';`,
      `export { StageDirector } from '${sourcePath('src/game/StageDirector.ts')}';`,
      `export { STAGES, BLOODSTREAM_STAGE, difficultyForStage } from '${sourcePath('src/game/StageDefinitions.ts')}';`,
      `export { RunRng } from '${sourcePath('src/game/RunRng.ts')}';`,
      `export { xpForLevel } from '${sourcePath('src/game/RunState.ts')}';`,
      `export { ENEMY_DEFS, ELITE, PLAYER, WEAPON } from '${sourcePath('src/game/config.ts')}';`,
      `export { getDifficultyProfile, pickEliteModifier } from '${sourcePath('src/game/DifficultyProfile.ts')}';`,
    ].join('\n')
  );
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    alias: { phaser: phaserStub },
    logLevel: 'warning',
  });

  const {
    WaveDirector,
    StageDirector,
    STAGES,
    BLOODSTREAM_STAGE,
    difficultyForStage,
    RunRng,
    xpForLevel,
    ENEMY_DEFS,
    ELITE,
    PLAYER,
    WEAPON,
    getDifficultyProfile,
    pickEliteModifier,
  } = require(bundle);

  // The real host-cell schedule, read from the production source so the
  // comparison stays bound to it instead of a local copy that could drift.
  const hostCellSource = readFileSync(resolve('src/systems/HostCellSystem.ts'), 'utf8');
  const firstCellMatch = hostCellSource.match(/runTimeMs\s*>=\s*(\d[\d_]*)/);
  const intervalMatch = hostCellSource.match(
    /Math\.max\(\s*(\d[\d_]*)\s*,\s*(\d[\d_]*)\s*-\s*runTimeMs\s*\*\s*([\d.]+)\s*\)/
  );
  assert(firstCellMatch, 'the real host-cell first-spawn time could not be read');
  assert(intervalMatch, 'the real host-cell interval could not be read');
  const hostCellFirstAtMs = Number(firstCellMatch[1].replace(/_/g, ''));
  const hostCellMinIntervalMs = Number(intervalMatch[1].replace(/_/g, ''));
  const hostCellBaseIntervalMs = Number(intervalMatch[2].replace(/_/g, ''));
  const hostCellDecay = Number(intervalMatch[3]);

  /**
   * Runs one difficulty tier for one seed and returns the measured envelope.
   */  function simulate(tier, seed) {
    const difficulty = getDifficultyProfile(tier);
    const stage = BLOODSTREAM_STAGE;
    const rng = new RunRng(seed);

    const live = [];
    const ctx = { wave: null, bossAlive: false };
    const metrics = {
      tier,
      seed,
      damageTaken: 0,
      hits: 0,
      enemiesSpawned: 0,
      elitesSpawned: 0,
      bossMinionsSpawned: 0,
      anomaliesSpawned: 0,
      peakConcurrent: 0,
      peakThreat: 0,
      kills: 0,
      highestLevel: 1,
      firstEliteAtMs: null,
      anomalyAtMs: null,
      bossRequestAtMs: null,
      bossSpawnedAtMs: null,
      survivalMs: null,
      hostCellsAvailable: 0,
      firstHostCellAtMs: null,
      damagePotential: 0,
      elapsedMs: 0,
    };

    const stageState = { timeMs: 0, hp: PLAYER.hp, maxHp: PLAYER.hp };
    const runState = { stage: stageState, run: { kills: 0, hostCellsInfected: 0, timeMs: 0 } };

    const scene = {
      runState,
      player: { x: 195, y: 422 },
      cameras: { main: { width: 390, height: 844, midPoint: { x: 195, y: 422 } } },
      time: { now: 0 },
      announceWaveEvent() {},
      announceMiniBoss() {},
      onAnomalySpawned() {},
      spawnEnemy(kind, x, y, elite) {
        // Mirrors GameScene.spawnEnemy exactly: the same stage scaling and the
        // same difficulty multipliers decide how tough this unit is.
        const isBoss = kind === 'boss';
        const { hpScale, dmgScale } = difficultyForStage(stage, stageState.timeMs);
        const hpScaleUsed = isBoss
          ? stage.difficulty.bossHpScale * difficulty.bossHpMultiplier
          : hpScale * difficulty.enemyHpMultiplier;
        const dmgScaleUsed = isBoss
          ? stage.difficulty.bossDamageScale * difficulty.bossDamageMultiplier
          : dmgScale * difficulty.enemyDamageMultiplier;
        const eliteModifier = elite
          ? pickEliteModifier(difficulty, () => rng.next('elite'))
          : null;
        const def = ENEMY_DEFS[kind];
        const maxHp = def.hp * hpScaleUsed * (elite ? ELITE.hpMul : 1);
        const dmg =
          def.dmg *
          dmgScaleUsed *
          (elite ? ELITE.dmgMul : 1) *
          (eliteModifier === 'frenzied' ? 1.15 : 1);
        // Real approach time: the spawn ring distance over the real unit speed
        // (including the difficulty speed multiplier).
        const speedMultiplier = isBoss ? difficulty.bossSpeedMultiplier : difficulty.enemySpeedMultiplier;
        const speed = def.speed * (elite ? 0.92 : 1) * speedMultiplier *
          (eliteModifier === 'frenzied' ? 1.22 : 1);
        const isBossMinion = ctx.bossAlive && kind === 'swarm' && !elite;
        const unit = {
          kind,
          elite,
          hp: maxHp,
          maxHp,
          dmg,
          xpValue: def.xp * (elite ? ELITE.xpMul : 1),
          spawnedAtMs: stageState.timeMs,
          reachedAtMs: stageState.timeMs + (RING_RADIUS_PX / Math.max(1, speed)) * 1000,
          dead: false,
        };
        live.push(unit);
        metrics.enemiesSpawned += 1;
        metrics.damagePotential += dmg;
        if (isBossMinion) metrics.bossMinionsSpawned += 1;
        if (elite) {
          metrics.elitesSpawned += 1;
          if (metrics.firstEliteAtMs === null) metrics.firstEliteAtMs = stageState.timeMs;
        }
        if (kind === 'boss') metrics.bossSpawnedAtMs = stageState.timeMs;
        if (kind === 'anomaly') {
          metrics.anomaliesSpawned += 1;
          metrics.anomalyAtMs = stageState.timeMs;
        }
        return unit;
      },
    };

    const enemies = {
      countActive: () => live.filter((unit) => !unit.dead).length,
      getChildren: () =>
        live
          .filter((unit) => !unit.dead)
          .map((unit) => ({
            active: true,
            isBoss: unit.kind === 'boss',
            kind: unit.kind,
            isElite: unit.elite,
          })),
    };

    const wave = new WaveDirector(
      scene,
      enemies,
      stage,
      difficulty,
      () => rng.next('enemy-kind'),
      () => rng.next('enemy-spawn'),
      () => rng.next('wave-event'),
      // Adaptive pacing stays a Strained-only feature, exactly as in production.
      difficulty.id === 'strained',
      () => rng.next('anomaly')
    );
    ctx.wave = wave;

    const director = new StageDirector(STAGES);
    for (const event of director.startRun()) {
      if (event.type === 'stage-started') wave.startStage(event.stage);
    }

    // --- Player model ---------------------------------------------------------
    let nextKillAtMs = 0;
    let nextHitAtMs = 0;
    let level = 1;
    let xp = 0;
    let xpNext = xpForLevel(1);
    let hostCellNextAtMs = hostCellFirstAtMs;

    for (let t = 0; t <= WINDOW_MS; t += STEP_MS) {
      stageState.timeMs = t;
      runState.run.timeMs = t;
      scene.time.now = t;
      ctx.bossAlive = wave.boss !== null;

      // The boss request comes from the real StageDirector.
      for (const event of director.update(t)) {
        if (event.type === 'boss-spawn-requested' && metrics.bossRequestAtMs === null) {
          metrics.bossRequestAtMs = t;
          wave.spawnBoss();
        }
        if (event.type === 'stage-started') wave.startStage(event.stage);
      }

      wave.update(STEP_MS);

      // The player clears one enemy every KILL_INTERVAL_MS, oldest first.
      if (t >= nextKillAtMs) {
        nextKillAtMs = t + KILL_INTERVAL_MS;
        const target = live.find((unit) => !unit.dead && unit.kind !== 'boss' && unit.kind !== 'anomaly')
          ?? live.find((unit) => !unit.dead);
        if (target) {
          target.dead = true;
          metrics.kills += 1;
          xp += target.xpValue;
          while (xp >= xpNext) {
            xp -= xpNext;
            level += 1;
            xpNext = xpForLevel(level);
            metrics.highestLevel = Math.max(metrics.highestLevel, level);
          }
        }
      }

      // Contact damage honours the real global i-frame window.
      const touching = live.find((unit) => !unit.dead && unit.reachedAtMs <= t);
      if (touching && t >= nextHitAtMs) {
        nextHitAtMs = t + PLAYER.iframeMs;
        metrics.damageTaken += touching.dmg;
        metrics.hits += 1;
        if (metrics.survivalMs === null && metrics.damageTaken >= PLAYER.hp) {
          metrics.survivalMs = t;
        }
      }

      // Host-cell infection opportunity. The schedule is read from the real
      // HostCellSystem source, so this stays bound to production behaviour
      // instead of a local copy that could drift.
      if (t >= hostCellNextAtMs) {
        metrics.hostCellsAvailable += 1;
        if (metrics.firstHostCellAtMs === null) metrics.firstHostCellAtMs = t;
        hostCellNextAtMs = t + Math.max(
          hostCellMinIntervalMs,
          hostCellBaseIntervalMs - t * hostCellDecay
        );
      }

      metrics.peakConcurrent = Math.max(metrics.peakConcurrent, enemies.countActive());
      metrics.peakThreat = Math.max(metrics.peakThreat, wave.debugThreatState.active);
      metrics.elapsedMs = t;
    }

    metrics.level = level;
    metrics.highestLevel = Math.max(metrics.highestLevel, level);
    if (metrics.survivalMs === null) metrics.survivalMs = WINDOW_MS;
    return metrics;
  }

  // --- Run the matrix --------------------------------------------------------
  const results = {};
  for (const tier of TIERS) {
    results[tier] = SEEDS.map((seed) => simulate(tier, seed));
  }

  const average = (tier, key) => {
    const values = results[tier].map((row) => row[key]);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const summary = {};
  for (const tier of TIERS) {
    summary[tier] = {
      damageTaken: average(tier, 'damageTaken'),
      hits: average(tier, 'hits'),
      enemiesSpawned: average(tier, 'enemiesSpawned'),
      elitesSpawned: average(tier, 'elitesSpawned'),
      peakConcurrent: average(tier, 'peakConcurrent'),
      peakThreat: average(tier, 'peakThreat'),
      kills: average(tier, 'kills'),
      highestLevel: average(tier, 'highestLevel'),
      hostCellsAvailable: average(tier, 'hostCellsAvailable'),
      survivalMs: average(tier, 'survivalMs'),
      damagePotential: average(tier, 'damagePotential'),
      firstEliteAtMs: results[tier].map((row) => row.firstEliteAtMs),
      anomalyAtMs: results[tier].map((row) => row.anomalyAtMs),
      bossRequestAtMs: results[tier].map((row) => row.bossRequestAtMs),
      bossSpawnedAtMs: results[tier].map((row) => row.bossSpawnedAtMs),
    };
  }

  console.log('deterministic difficulty comparison (identical seeds, shared player model)');
  console.log(
    `window ${WINDOW_MS / 1000}s · ${SEEDS.length} seeds · clear rate 1 enemy/${KILL_INTERVAL_MS}ms · ring ${RING_RADIUS_PX}px`
  );
  console.log(['metric', 'EASY', 'STANDARD', 'STRAINED'].join(' | '));
  const rows = [
    ['damage taken', 'damageTaken', 1],
    ['hits absorbed', 'hits', 1],
    ['damage on the field', 'damagePotential', 0],
    ['enemies spawned', 'enemiesSpawned', 1],
    ['elites spawned', 'elitesSpawned', 2],
    ['peak concurrent', 'peakConcurrent', 1],
    ['peak threat', 'peakThreat', 1],
    ['kills', 'kills', 1],
    ['highest level', 'highestLevel', 2],
    ['host cells', 'hostCellsAvailable', 1],
    ['survival ms', 'survivalMs', 0],
  ];
  for (const [label, key, digits] of rows) {
    console.log(
      [
        label,
        summary.easy[key].toFixed(digits),
        summary.standard[key].toFixed(digits),
        summary.strained[key].toFixed(digits),
      ].join(' | ')
    );
  }

  // --- Incoming pressure must order EASY < STANDARD < STRAINED ---------------
  const order = (key) => {
    const easy = summary.easy[key];
    const standard = summary.standard[key];
    const strained = summary.strained[key];
    assert(
      easy < standard && standard < strained,
      `incoming pressure ordering failed for ${key}: ${easy} / ${standard} / ${strained}`
    );
  };
  const reverseOrder = (key) => {
    const easy = summary.easy[key];
    const standard = summary.standard[key];
    const strained = summary.strained[key];
    assert(
      easy > standard && standard > strained,
      `incoming pressure ordering failed for ${key}: ${easy} / ${standard} / ${strained}`
    );
  };

  // Damage taken: fewer hits, softer hits. This is the incoming-pressure metric.
  order('damageTaken');
  // Survival time.
  reverseOrder('survivalMs');
  // Elite pressure.
  order('elitesSpawned');

  // Spawn pressure: EASY must be the gentlest tier. Standard and Strained are
  // deliberately NOT monotonic against each other: Strained spends a hard
  // threat budget (42 → 82) to trade raw unit count for tougher units and a
  // denser elite schedule, so only the new tier has to be the lowest.
  assert(
    summary.easy.enemiesSpawned < summary.standard.enemiesSpawned,
    `Easy must spawn fewer enemies than Standard: ${summary.easy.enemiesSpawned} vs ${summary.standard.enemiesSpawned}`
  );
  assert(
    summary.easy.enemiesSpawned < summary.strained.enemiesSpawned,
    `Easy must spawn fewer enemies than Strained: ${summary.easy.enemiesSpawned} vs ${summary.strained.enemiesSpawned}`
  );
  assert(
    summary.easy.damagePotential < summary.standard.damagePotential &&
      summary.easy.damagePotential < summary.strained.damagePotential,
    `Easy must put less damage on the field than every other tier: ${summary.easy.damagePotential}`
  );
  assert(
    summary.easy.peakThreat < summary.standard.peakThreat &&
      summary.easy.peakThreat < summary.strained.peakThreat,
    `Easy must never reach the threat density of another tier: ${summary.easy.peakThreat}`
  );

  // The player still kills and still levels up in every tier.
  for (const tier of TIERS) {
    assert(summary[tier].kills > 0, `${tier} produced no kills — the run would not teach anything`);
    assert(summary[tier].highestLevel >= 2, `${tier} never reached a mutation — the first mutation must stay reachable`);
    assert(summary[tier].hostCellsAvailable > 0, `${tier} had no infection opportunity in the window`);
  }
  // Easy must not be a walkover: it still has to be possible to die.
  assert(
    summary.easy.damageTaken > 0,
    'Easy never dealt any damage to the player — the tier must stay capable of killing the player'
  );
  assert(
    summary.easy.damageTaken < summary.standard.damageTaken,
    'Easy must deal strictly less damage than Standard'
  );

  // --- Difficulty-independent facts that must hold ---------------------------
  // Boss timing is a stage fact, not a difficulty fact.
  for (const tier of TIERS) {
    for (const row of results[tier]) {
      assertEqual(row.bossRequestAtMs, null, 'the boss must not appear inside the comparison window');
      assertEqual(row.bossSpawnedAtMs, null, 'the boss must not appear inside the comparison window');
    }
  }
  // The mini-boss beat is authored on the stage clock, so every tier meets it
  // at the same moment — only its surroundings differ.
  for (const tier of TIERS) {
    for (const row of results[tier]) {
      assert(row.anomalyAtMs !== null, `${tier}: the authored mini-boss never appeared`);
    }
  }
  const anomalyTimes = TIERS.map((tier) => results[tier].map((row) => row.anomalyAtMs).join(','));
  assert(
    anomalyTimes[0] === anomalyTimes[1] && anomalyTimes[1] === anomalyTimes[2],
    `the mini-boss beat must stay on the stage clock in every tier: ${anomalyTimes.join(' / ')}`
  );
  // Infection availability is authored, not difficulty-scaled.
  assertEqual(
    summary.easy.hostCellsAvailable,
    summary.standard.hostCellsAvailable,
    'host-cell availability must not differ between Easy and Standard'
  );
  assertEqual(
    summary.easy.hostCellsAvailable,
    summary.strained.hostCellsAvailable,
    'host-cell availability must not differ between Easy and Strained'
  );

  // The comparison must be reproducible: the same seed must give the same run.
  const first = simulate('easy', SEEDS[0]);
  const again = simulate('easy', SEEDS[0]);
  for (const key of ['damageTaken', 'enemiesSpawned', 'elitesSpawned', 'kills', 'highestLevel']) {
    assertEqual(first[key], again[key], `the comparison is not reproducible for ${key}`);
  }
  // Reproducibility is only meaningful if nothing reaches for an unseeded source.
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const source of [
    'src/game/WaveDirector.ts',
    'src/game/ThreatDirector.ts',
    'src/game/StageDirector.ts',
    'src/game/DifficultyProfile.ts',
    'src/game/StageDefinitions.ts',
  ]) {
    const body = stripComments(readFileSync(resolve(source), 'utf8'));
    assert(
      !/Math\.random\s*\(/.test(body),
      `${source} must not use Math.random — the comparison would stop being reproducible`
    );
  }
  // RunRng may only reach for Math.random inside the one-time seed generator,
  // which the comparison never calls: it always supplies an explicit seed.
  const runRngSource = readFileSync(resolve('src/game/RunRng.ts'), 'utf8');
  const seedGenerator = runRngSource.indexOf('generateRunSeed');
  assert(seedGenerator >= 0, 'the run seed generator could not be located');
  const runRngRest = stripComments(runRngSource).replace(
    /export function generateRunSeed[\s\S]*$/,
    ''
  );
  assert(
    !/Math\.random\s*\(/.test(runRngRest),
    'RunRng must not use Math.random outside the one-time seed generator'
  );
  assert(
    /Math\.random\s*\(/.test(runRngSource),
    'the one-time seed generator must still have its unseeded fallback'
  );

  console.log('deterministic difficulty comparison: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-threat-director-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approx(a, b, tolerance, message) {
  assert(Math.abs(a - b) <= tolerance, `${message} (${a} vs ${b})`);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/ThreatDirector.ts',
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

  const { ThreatDirector, THREAT_TUNING } = require(join(temp, 'game/ThreatDirector.js'));

  const sample = (over = {}) => ({
    nearbyPressure01: 0.25,
    hpFraction: 0.9,
    escapeSpaceRatio: 0.9,
    elitePressure01: 0,
    bossPhase01: 0,
    ...over,
  });

  const evaluateFresh = (input) => new ThreatDirector().update(input, 1_000).rawThreat;

  const baseline = evaluateFresh(sample());
  assert(
    evaluateFresh(sample({ hpFraction: 0.25 })) > baseline,
    'lower HP must monotonically increase threat'
  );
  assert(
    evaluateFresh(sample({ escapeSpaceRatio: 0.2 })) > baseline,
    'less escape space must monotonically increase threat'
  );
  assert(
    evaluateFresh(sample({ nearbyPressure01: 0.9 })) > baseline,
    'more nearby hostile pressure must increase threat'
  );
  assert(
    evaluateFresh(sample({ elitePressure01: 1 })) > baseline,
    'elite pressure must increase threat'
  );
  assert(
    evaluateFresh(sample({ bossPhase01: 1 })) > baseline,
    'boss phase pressure must increase threat'
  );

  const damaged = new ThreatDirector();
  damaged.update(sample(), 1_000);
  const beforeDamage = damaged.current.rawThreat;
  damaged.recordDamage(35, 100, 1_050);
  const afterDamage = damaged.update(sample(), 1_100);
  assert(afterDamage.rawThreat > beforeDamage, 'recent damage must increase raw threat');
  assert(afterDamage.recentDamageDanger > 0, 'recent damage ledger did not contribute danger');

  const quiet = new ThreatDirector();
  const quietState = quiet.update(
    sample({
      nearbyPressure01: 0,
      hpFraction: 1,
      escapeSpaceRatio: 1,
      elitePressure01: 0,
      bossPhase01: 0,
    }),
    1_000
  );
  assert(quietState.band === 'calm', 'empty safe arena must be calm');
  assert(quietState.directive.spawnIntervalMultiplier === 1, 'low threat must not accelerate authored spawning');
  assert(quietState.directive.batchScale === 1, 'low threat must not inflate authored batch size');

  const stressed = new ThreatDirector();
  stressed.recordDamage(45, 100, 900);
  const hot = stressed.update(
    sample({
      nearbyPressure01: 1,
      hpFraction: 0.1,
      escapeSpaceRatio: 0.05,
      elitePressure01: 1,
      bossPhase01: 1,
    }),
    1_000
  );
  assert(hot.band === 'critical', `max pressure should be critical, got ${hot.band}`);
  assert(hot.directive.spawnIntervalMultiplier > 1, 'high threat must add spawn recovery');
  assert(hot.directive.bossMinionIntervalMultiplier > 1, 'high threat must relax boss-minion cadence');
  assert(hot.directive.batchScale < 1, 'high threat must trim batch pressure');
  assert(!hot.directive.allowDangerousCombinations, 'critical threat must gate dangerous combinations');
  assert(hot.directive.recoveryWindowMs > 0, 'critical threat must expose a recovery window');

  // Hysteresis: after entering a band, a value between enter/exit bounds should not flap down.
  const hysteresis = new ThreatDirector();
  hysteresis.update(sample({ nearbyPressure01: 0.95, hpFraction: 0.45, escapeSpaceRatio: 0.4 }), 1_000);
  for (let t = 1_100; t <= 3_000; t += 100) {
    hysteresis.update(sample({ nearbyPressure01: 0.8, hpFraction: 0.55, escapeSpaceRatio: 0.5 }), t);
  }
  const peakBand = hysteresis.current.band;
  assert(peakBand !== 'calm', 'sustained pressure never entered a threat band');
  const priorThreat = hysteresis.current.smoothedThreat;
  hysteresis.update(sample({ nearbyPressure01: 0, hpFraction: 1, escapeSpaceRatio: 1 }), 3_050);
  assert(
    hysteresis.current.smoothedThreat < priorThreat && hysteresis.current.smoothedThreat > 0,
    'release smoothing must lower threat gradually rather than snap to zero'
  );

  // Damage expires entirely outside the rolling window.
  const decay = new ThreatDirector();
  decay.recordDamage(40, 100, 1_000);
  decay.update(sample(), 1_100);
  assert(decay.current.recentDamageDanger > 0, 'damage event missing before expiry');
  decay.update(sample(), 1_100 + THREAT_TUNING.damageWindowMs + 1);
  assert(decay.current.recentDamageDanger === 0, 'expired damage remained in the rolling window');

  // Snapshot/restore keeps the governor deterministic across checkpoint resume.
  const original = new ThreatDirector();
  original.recordDamage(20, 100, 1_200);
  original.update(sample({ nearbyPressure01: 0.7, hpFraction: 0.6 }), 1_500);
  original.update(sample({ nearbyPressure01: 0.5, hpFraction: 0.6 }), 1_800);
  const snap = original.snapshot(1_800);
  const restored = new ThreatDirector();
  restored.restore(snap, 1_800);
  const nextA = original.update(sample({ nearbyPressure01: 0.4, hpFraction: 0.65 }), 1_920);
  const nextB = restored.update(sample({ nearbyPressure01: 0.4, hpFraction: 0.65 }), 1_920);
  approx(nextA.smoothedThreat, nextB.smoothedThreat, 1e-12, 'checkpoint restore changed smoothed threat');
  approx(nextA.rawThreat, nextB.rawThreat, 1e-12, 'checkpoint restore changed raw threat');
  assert(nextA.band === nextB.band, 'checkpoint restore changed threat band');

  const source = readFileSync(resolve('src/game/ThreatDirector.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert(!/Math\.random\s*\(/.test(source), 'ThreatDirector must not use Math.random');
  assert(!/from ['"]phaser['"]/.test(source), 'ThreatDirector must stay Phaser-free');
  assert(!/RunRng|gameplayRng/.test(source), 'ThreatDirector must never consume gameplay RNG');

  // Competitive safety: initial rollout observes every run but only changes pacing in
  // non-daily Strained runs. Standard/fixed-seed duels keep the authored schedule.
  const gameSceneSource = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  assert(
    /this\.difficulty\.id === 'strained' && !this\.dailyRun/.test(gameSceneSource),
    'adaptive pacing must stay disabled for Standard and Daily runs during initial rollout'
  );
  const waveSource = readFileSync(resolve('src/game/WaveDirector.ts'), 'utf8');
  assert(
    /adaptivePacingEnabled = false/.test(waveSource) && /private get pacingDirective/.test(waveSource),
    'WaveDirector must fail closed to authored pacing when adaptive pacing is disabled'
  );

  console.log('adaptive threat director deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

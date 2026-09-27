import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-runtime-quality-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runFrames(governor, deltaMs, count, startAt = 0) {
  let now = startAt;
  let changes = 0;
  for (let i = 0; i < count; i++) {
    now += deltaMs;
    if (governor.recordFrame(deltaMs, now)) changes += 1;
  }
  return { now, changes, snapshot: governor.getSnapshot(now) };
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/RuntimeQualityGovernor.ts',
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

  const { RuntimeQualityGovernor } = require(join(temp, 'systems/RuntimeQualityGovernor.js'));

  const healthy = new RuntimeQualityGovernor();
  const healthyRun = runFrames(healthy, 16.67, 420);
  assert(healthy.profile.level === 'full', 'stable 60 fps should stay full quality');
  assert(
    healthyRun.snapshot.baselineFrameMs !== null &&
      healthyRun.snapshot.baselineFrameMs >= 14 &&
      healthyRun.snapshot.baselineFrameMs <= 18,
    '60 fps baseline calibration drifted'
  );

  const capped30 = new RuntimeQualityGovernor();
  const cappedRun = runFrames(capped30, 33.33, 360);
  assert(
    capped30.profile.level === 'full',
    'stable 30 fps shell must not be mistaken for an overloaded 60 fps device'
  );
  assert(
    cappedRun.snapshot.baselineFrameMs !== null &&
      cappedRun.snapshot.baselineFrameMs >= 31 &&
      cappedRun.snapshot.baselineFrameMs <= 34,
    '30 fps baseline calibration drifted'
  );

  const stressed = new RuntimeQualityGovernor();
  let cursor = runFrames(stressed, 16.67, 150).now;
  const beforeStress = stressed.profile.level;
  const stressRun = runFrames(stressed, 29, 260, cursor);
  cursor = stressRun.now;
  assert(beforeStress === 'full', 'stress fixture did not start at full quality');
  assert(
    stressed.profile.level === 'low' || stressed.profile.level === 'balanced',
    'sustained frame-time regression did not degrade presentation quality'
  );
  assert(stressRun.changes >= 1, 'sustained overload produced no tier change');

  const degradedLevel = stressed.profile.level;
  const recoveryRun = runFrames(stressed, 16.67, 720, cursor);
  assert(
    stressed.profile.level === 'full',
    `quality failed to recover from ${degradedLevel} after a long stable window`
  );
  assert(recoveryRun.changes >= 1, 'stable recovery produced no upward tier change');

  const suspended = new RuntimeQualityGovernor();
  let suspendedCursor = runFrames(suspended, 16.67, 160).now;
  suspendedCursor += 1_500;
  assert(
    suspended.recordFrame(1_500, suspendedCursor) === false,
    'background/resume delta must never trigger a tier change'
  );
  assert(suspended.profile.level === 'full', 'single suspension frame degraded quality');
  assert(
    suspended.getSnapshot(suspendedCursor).ignoredSuspensionFrames === 1,
    'suspension frame was not tracked as ignored'
  );

  const bounded = new RuntimeQualityGovernor({
    initialLevel: 'balanced',
    minLevel: 'low',
    maxLevel: 'balanced',
  });
  const boundedRun = runFrames(bounded, 8.4, 900);
  assert(bounded.profile.level === 'balanced', 'configured runtime quality ceiling was exceeded');
  assert(boundedRun.changes === 0, 'governor changed despite already sitting at its configured ceiling');

  // Identical frame traces must always yield identical quality history/snapshot.
  const a = new RuntimeQualityGovernor();
  const b = new RuntimeQualityGovernor();
  const trace = [
    ...Array(120).fill(16.67),
    ...Array(140).fill(25),
    ...Array(40).fill(16.67),
    250,
    ...Array(260).fill(16.67),
  ];
  let now = 0;
  const historyA = [];
  const historyB = [];
  for (const delta of trace) {
    now += delta;
    const ca = a.recordFrame(delta, now);
    const cb = b.recordFrame(delta, now);
    if (ca) historyA.push([now, a.profile.level]);
    if (cb) historyB.push([now, b.profile.level]);
  }
  assert(
    JSON.stringify(historyA) === JSON.stringify(historyB),
    'quality tier history is not deterministic for the same frame trace'
  );
  assert(
    JSON.stringify(a.getSnapshot(now)) === JSON.stringify(b.getSnapshot(now)),
    'quality snapshots diverged for identical frame traces'
  );

  const source = readFileSync(resolve('src/systems/RuntimeQualityGovernor.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert(!/Math\.random\s*\(/.test(source), 'RuntimeQualityGovernor must not use randomness');
  assert(!/Date\.now|performance\.now/.test(source), 'RuntimeQualityGovernor must not read wall time');
  assert(!/from ['"]phaser['"]/.test(source), 'RuntimeQualityGovernor must stay Phaser-free');

  const gameScene = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  assert(
    /runtimeQuality\.recordFrame\(delta, time\)/.test(gameScene),
    'GameScene does not feed active frame time into the runtime governor'
  );
  assert(
    /this\.runtimeQuality = new RuntimeQualityGovernor\(\)/.test(gameScene),
    'runtime quality must start at 1.0 relative to the static PerformanceProfile ceiling'
  );
  assert(
    /vfx\?\.setRuntimeQualityScale\(profile\.particleScale\)/.test(gameScene) &&
      /atmosphere\?\.setRuntimeQualityScale\(profile\.ambientScale\)/.test(gameScene),
    'runtime quality is not restricted to presentation systems'
  );

  const vfxSource = readFileSync(resolve('src/systems/VfxSystem.ts'), 'utf8');
  assert(
    /PERFORMANCE\.vfxScale \* this\.runtimeQualityScale/.test(vfxSource),
    'VFX particle counts do not consume the runtime quality scale'
  );

  const atmosphereSource = readFileSync(resolve('src/systems/AtmosphereSystem.ts'), 'utf8');
  assert(
    /applyRuntimeVisibility/.test(atmosphereSource) &&
      /if \(!cell\.image\.visible\) continue/.test(atmosphereSource) &&
      /if \(!p\.image\.visible\) continue/.test(atmosphereSource),
    'ambient runtime quality must hide and skip decorative work'
  );

  // Critical/gameplay telegraphs stay independent from adaptive quality.
  const enemySource = readFileSync(resolve('src/game/Enemy.ts'), 'utf8');
  const cardiacSource = readFileSync(resolve('src/game/CardiacLineHazard.ts'), 'utf8');
  assert(
    !/RuntimeQualityGovernor|runtimeQuality/.test(enemySource + cardiacSource),
    'gameplay telegraphs must never be degraded by runtime quality'
  );

  console.log('runtime quality governor deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

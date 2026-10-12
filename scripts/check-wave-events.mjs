import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-wave-events-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/WaveEvents.ts',
      'src/game/StageDefinitions.ts',
      'src/game/StageDirector.ts',
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
    pendingWaveEventIndex,
    validateWaveEvents,
    waveEventSpawns,
    waveEventTelegraph,
    WAVE_EVENT_LIMITS,
  } = require(join(temp, 'game/WaveEvents.js'));
  const { STAGES, BLOODSTREAM_STAGE, HEART_STAGE } = require(
    join(temp, 'game/StageDefinitions.js')
  );
  const { StageDirector } = require(join(temp, 'game/StageDirector.js'));

  // StageDirector constructor validates the live schedule.
  const director = new StageDirector(STAGES);
  assert(director.currentStage.id === 'bloodstream', 'stage order changed');

  for (const stage of [BLOODSTREAM_STAGE, HEART_STAGE]) {
    const events = stage.waveEvents ?? [];
    assert(events.length === 3, `${stage.id}: expected 3 wave events, got ${events.length}`);
    validateWaveEvents(events, stage.durationMs, stage.bossWarningLeadMs);
    for (const event of events) {
      assert(
        event.atMs <= stage.durationMs - 10_000,
        `${stage.id}/${event.id}: fires too close to the boss window`
      );
      assert(!/[\u0000-\u001f]/.test(event.title + event.subtitle), `${event.id}: control chars`);
    }
  }

  // Schedule validation rejects unordered / boss-overlapping events.
  let rejected = false;
  try {
    validateWaveEvents(
      [
        { id: 'a', atMs: 50_000, kind: 'encircle', telegraphMs: 1_000, title: 'A', subtitle: 'B', color: 1 },
        { id: 'b', atMs: 40_000, kind: 'encircle', telegraphMs: 1_000, title: 'A', subtitle: 'B', color: 1 },
      ],
      300_000,
      8_000
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'out-of-order wave events were accepted');

  rejected = false;
  try {
    validateWaveEvents(
      [{ id: 'late', atMs: 295_000, kind: 'encircle', telegraphMs: 1_000, title: 'A', subtitle: 'B', color: 1 }],
      300_000,
      8_000
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'wave event overlapping the boss window was accepted');

  // Geometry is deterministic for the same RNG sequence and bounded per pattern.
  const seq = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  for (const kind of ['encircle', 'flank-wedge', 'swarm-surge']) {
    const def = { id: `t-${kind}`, atMs: 10_000, kind, telegraphMs: 1_000, title: 'T', subtitle: 'S', color: 0xff00ff };
    const a = waveEventSpawns(def, { playerX: 100, playerY: 200, random: seq([0.13, 0.57, 0.91]) });
    const b = waveEventSpawns(def, { playerX: 100, playerY: 200, random: seq([0.13, 0.57, 0.91]) });
    assert(a.length === b.length && a.length > 0, `${kind}: empty plan`);
    for (let i = 0; i < a.length; i++) {
      assert(a[i].x === b[i].x && a[i].y === b[i].y && a[i].kind === b[i].kind, `${kind}: nondeterministic`);
      assert(Number.isFinite(a[i].x) && Number.isFinite(a[i].y), `${kind}: non-finite position`);
    }
    const expected =
      kind === 'encircle'
        ? WAVE_EVENT_LIMITS.encircle.count
        : kind === 'flank-wedge'
          ? WAVE_EVENT_LIMITS.flankWedge.count
          : WAVE_EVENT_LIMITS.swarmSurge.count + WAVE_EVENT_LIMITS.swarmSurge.brutes;
    assert(a.length === expected, `${kind}: expected ${expected} spawns, got ${a.length}`);
    // Every spawn lands a survivable distance away from the player anchor.
    for (const spawn of a) {
      const distance = Math.hypot(spawn.x - 100, spawn.y - 200);
      assert(distance >= 200, `${kind}: spawn too close to player (${distance.toFixed(1)})`);
    }

    const telegraph = waveEventTelegraph(def, a, 100, 200);
    assert(telegraph.durationMs === def.telegraphMs, `${kind}: telegraph duration mismatch`);
    if (kind === 'encircle') {
      assert(telegraph.shape === 'radial', 'encircle must be radial');
      assert(telegraph.radius === WAVE_EVENT_LIMITS.encircle.radius, 'encircle radius mismatch');
    } else {
      assert(telegraph.shape === 'direction', `${kind} must be directional`);
      assert(Number.isFinite(telegraph.angle), `${kind}: invalid telegraph angle`);
    }
  }

  // Restore derivation: index points at the first event that has not fired.
  const events = BLOODSTREAM_STAGE.waveEvents;
  assert(pendingWaveEventIndex(events, 0) === 0, 'restore at t=0');
  assert(pendingWaveEventIndex(events, events[0].atMs - 1) === 0, 'restore before first fire');
  assert(pendingWaveEventIndex(events, events[0].atMs) === 1, 'restore exactly at first fire');
  assert(pendingWaveEventIndex(events, 999_999) === events.length, 'restore after all events');

  console.log('wave-events: schedule, geometry, telegraph and restore derivation OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

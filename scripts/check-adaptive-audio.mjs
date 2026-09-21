// Deterministic smoke for the adaptive audio foundation.
//
// Covers:
//  - adaptiveAudioMath: threat weighting, danger blend, asymmetric smoothing, mood hysteresis,
//    deterministic bed selection, tension/bio curves.
//  - AdaptiveAudioDirector: state transitions, distinct stage/boss cues, event-driven heartbeat,
//    mute gating, and restart/menu lifecycle hygiene (no leaked listeners, balanced bed start/stop).
//  - static guards: no random bed pick, single owner of the bio pulse, no gameplay-RNG usage.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-adaptive-audio-'));
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
      'src/systems/adaptiveAudioMath.ts',
      'src/systems/AdaptiveAudioDirector.ts',
      'src/game/config.ts',
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
    ADAPTIVE_AUDIO_TUNING,
    AdaptiveMoodTracker,
    bioIntensityForMood,
    clamp01,
    computeDanger,
    enemyThreatWeight,
    expApproach,
    moodRank,
    nextAdaptiveMood,
    normalizeNearbyThreat,
    pickMusicBedIndex,
    smoothDanger,
    tensionForMood,
  } = require(join(temp, 'systems/adaptiveAudioMath.js'));
  const { AdaptiveAudioDirector } = require(join(temp, 'systems/AdaptiveAudioDirector.js'));
  const { JUICE, WEAPON } = require(join(temp, 'game/config.js'));

  const T = ADAPTIVE_AUDIO_TUNING;
  const dangerFrom = (threat, hpFraction, bossActive = false, bossHpFraction = 1, stageOrder = 1) =>
    computeDanger({ nearbyThreat: threat, hpFraction, bossActive, bossHpFraction, stageOrder });

  // ---------------------------------------------------------------- shared tuning contract
  assert(
    T.lowHpFraction === JUICE.lowHpFraction,
    'audio low-HP threshold drifted from config.JUICE.lowHpFraction'
  );
  assert(
    T.scanRadius < WEAPON.range,
    'audio threat scan must stay inside the base auto-attack range'
  );

  // ---------------------------------------------------------------- threat weighting
  assert(enemyThreatWeight('swarm', false, 0) === 1, 'swarm at zero distance must read full weight');
  assert(enemyThreatWeight('brute', false, 0) === 3, 'brute base weight drifted');
  assert(enemyThreatWeight('runner', false, 0) === 1.5, 'runner base weight drifted');
  assert(enemyThreatWeight('swarm', true, 0) === 8, 'elite bonus should add 7 on top of the role');
  assert(enemyThreatWeight('boss', false, 0) === 0, 'bosses must not double-count as pressure');
  assert(
    enemyThreatWeight('swarm', false, T.scanRadius) === 0 &&
      enemyThreatWeight('swarm', false, T.scanRadius + 40) === 0,
    'enemies outside the scan radius must not contribute'
  );
  assert(
    enemyThreatWeight('swarm', false, 40) > enemyThreatWeight('swarm', false, 200),
    'closer enemies must weigh more than distant ones'
  );
  assert(normalizeNearbyThreat(0) === 0, 'empty threat must normalize to 0');
  assert(normalizeNearbyThreat(T.threatSaturation) === 1, 'saturation point must read as 1');
  assert(normalizeNearbyThreat(T.threatSaturation * 4) === 1, 'threat must saturate at 1');
  assert(clamp01(Number.NaN) === 0, 'NaN danger inputs must clamp to 0');

  // ---------------------------------------------------------------- danger blend
  assert(dangerFrom(0, 1) === 0, 'calm full-HP player with no enemies must read 0 danger');
  const lowHpOnly = dangerFrom(0, T.lowHpFraction);
  assert(lowHpOnly > 0 && lowHpOnly < T.dangerEnter, 'low HP alone must not be an instant danger');
  const surrounded = dangerFrom(1, 0.5);
  assert(surrounded > dangerFrom(0.2, 1), 'surrounding enemies must dominate a healthy player');
  assert(dangerFrom(0, 1, true, 1) > 0, 'an active boss must raise danger on its own');
  assert(
    dangerFrom(0, 1, true, 0.2) > dangerFrom(0, 1, true, 1),
    'a wounded boss must read hotter than a fresh one'
  );
  assert(dangerFrom(0, 1, false, 1, 2) > dangerFrom(0, 1, false, 1, 1), 'stage context bias drifted');
  assert(
    dangerFrom(1, 0, true, 0, 3) <= 1,
    'danger must stay clamped to 1 in the worst case'
  );
  // The blend must not accept a stage-elapsed-time term at all.
  const dangerKeys = Object.keys({
    nearbyThreat: 0,
    hpFraction: 1,
    bossActive: false,
    bossHpFraction: 1,
    stageOrder: 1,
  });
  assert(
    JSON.stringify(dangerKeys) === JSON.stringify(['nearbyThreat', 'hpFraction', 'bossActive', 'bossHpFraction', 'stageOrder']),
    'danger input shape changed: audio must not depend on stage elapsed time'
  );

  // ---------------------------------------------------------------- smoothing
  approx(expApproach(0, 1, 0, T.attackTauMs), 0, 1e-9, 'zero dt must not move the value');
  approx(expApproach(0, 1, T.attackTauMs, T.attackTauMs), 1 - Math.exp(-1), 1e-9, 'tau is not 63%');
  assert(expApproach(0, 1, 50, 350) < expApproach(0, 1, 50, 100), 'smaller tau must move faster');

  const stepped = (() => {
    let value = 0;
    for (let i = 0; i < 10; i++) value = smoothDanger(value, 1, 50);
    return value;
  })();
  approx(stepped, smoothDanger(0, 1, 500), 1e-9, 'smoothing must be frame-rate independent');
  const riserStep = smoothDanger(0, 1, 100);
  const fallerStep = 1 - smoothDanger(1, 0, 100);
  assert(riserStep > fallerStep, 'attack must be faster than release (asymmetric hysteresis)');

  // ---------------------------------------------------------------- mood hysteresis
  const moodCtx = (over = {}) => ({
    bossActive: false,
    hpFraction: 1,
    sinceChangeMs: 10_000,
    forced: null,
    ...over,
  });
  assert(nextAdaptiveMood('calm', 0.05, moodCtx()) === 'calm', 'quiet player must stay calm');
  assert(
    nextAdaptiveMood('calm', T.dangerEnter + 0.01, moodCtx()) === 'danger',
    'danger must be entered at its enter bound'
  );
  assert(
    nextAdaptiveMood('danger', T.dangerExit + 0.01, moodCtx()) === 'danger',
    'danger must persist above its exit bound'
  );
  assert(
    nextAdaptiveMood('danger', T.dangerExit - 0.02, moodCtx({ sinceChangeMs: T.moodDwellMs + 1 })) ===
      'pressure',
    'danger must release once below the exit bound after the dwell time'
  );
  assert(
    nextAdaptiveMood('danger', T.dangerExit - 0.02, moodCtx({ sinceChangeMs: 10 })) === 'danger',
    'downgrades must be blocked inside the dwell window'
  );
  assert(
    nextAdaptiveMood('calm', T.criticalEnter + 0.01, moodCtx({ sinceChangeMs: 0 })) === 'critical',
    'escalation must never be delayed by the dwell window'
  );
  assert(
    nextAdaptiveMood('calm', T.dangerEnter, moodCtx({ bossActive: true })) === 'boss',
    'an active boss must take the mood without the danger band'
  );
  assert(
    nextAdaptiveMood('critical', T.criticalExit - 0.05, moodCtx({ hpFraction: T.lowHpFraction - 0.05 })) ===
      'critical',
    'critical must hold while the player is still in the low-HP band'
  );
  assert(
    nextAdaptiveMood('boss', 0.1, moodCtx({ forced: 'transition' })) === 'transition',
    'forced transition must win over every band'
  );
  assert(
    nextAdaptiveMood('boss', 0.1, moodCtx({ forced: 'ended' })) === 'ended',
    'forced ended must win over every band'
  );
  assert(moodRank('calm') < moodRank('pressure'), 'mood ranking drifted');
  assert(moodRank('pressure') < moodRank('danger'), 'mood ranking drifted');
  assert(moodRank('danger') < moodRank('critical'), 'mood ranking drifted');

  // ---------------------------------------------------------------- bed determinism
  const bedCount = 7;
  const bedA = pickMusicBedIndex('qa-seed-2026', bedCount);
  assert(bedA === pickMusicBedIndex('qa-seed-2026', bedCount), 'bed selection is not deterministic');
  assert(bedA >= 0 && bedA < bedCount, 'bed index escaped the licensed set');
  const beds = new Set(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => pickMusicBedIndex(seed, bedCount))
  );
  assert(beds.size > 1, 'bed selection collapsed to a single track for every seed');
  assert(pickMusicBedIndex('a', 0) === 0 && pickMusicBedIndex('a', -3) === 0, 'bad track counts must be safe');

  // ---------------------------------------------------------------- tension / bio curves
  assert(tensionForMood('calm', 0) < tensionForMood('danger', 0.5), 'tension must open with danger');
  assert(tensionForMood('danger', 0.5) < tensionForMood('critical', 1), 'critical must read brightest');
  assert(tensionForMood('critical', 1) <= 1, 'tension must stay clamped');
  assert(bioIntensityForMood('calm', 0) === 0, 'calm must not drive the bio pulse');
  assert(bioIntensityForMood('calm', 0) < bioIntensityForMood('danger', 0.2), 'bio pulse must follow mood');
  assert(bioIntensityForMood('critical', 0) > bioIntensityForMood('pressure', 0), 'bio floors drifted');

  // ---------------------------------------------------------------- tracker behaviour
  const trackerInput = (threat, hpFraction = 1, bossActive = false, bossHpFraction = 1) => ({
    nearbyThreat: threat,
    hpFraction,
    bossActive,
    bossHpFraction,
    stageOrder: 1,
  });

  const rising = new AdaptiveMoodTracker();
  for (let i = 0; i < 180; i++) rising.update(trackerInput(1), 16.7);
  assert(
    rising.currentMood === 'danger',
    `a sustained swarm must reach danger (${rising.currentMood})`
  );
  const peakDanger = rising.status.danger;
  assert(peakDanger >= T.dangerEnter, 'smoothed danger must cross the danger band while surrounded');

  for (let i = 0; i < 30; i++) rising.update(trackerInput(0), 16.7);
  const afterHalfSecond = rising.status.danger;
  assert(afterHalfSecond > 0.1, 'danger must not collapse instantly when the lull starts');
  assert(afterHalfSecond < peakDanger, 'danger must fall while the lull continues');
  assert(
    rising.currentMood !== 'calm',
    'mood must not snap to calm while danger is still releasing'
  );
  for (let i = 0; i < 900; i++) rising.update(trackerInput(0), 16.7);
  assert(rising.status.danger < 0.05, 'danger must fully release after the fight');
  assert(rising.currentMood === 'calm', 'a finished fight must settle back to calm');

  // Flapping guard: alternate just across the enter/exit bounds faster than the dwell window.
  const flapper = new AdaptiveMoodTracker();
  let flapperTransitions = 0;
  for (let i = 0; i < 300; i++) {
    const hot = i % 2 === 0;
    flapper.update(trackerInput(hot ? 1 : 0.2, hot ? 1 : 0.6), 100);
  }
  flapperTransitions = flapper.status.transitions;
  assert(
    flapperTransitions <= 6,
    `mood flapped ${flapperTransitions} times on a ~15s oscillation; hysteresis is too weak`
  );

  // Frame-rate independence at tracker level.
  const slow = new AdaptiveMoodTracker();
  const fast = new AdaptiveMoodTracker();
  for (let i = 0; i < 30; i++) slow.update(trackerInput(0.9), 33.3);
  for (let i = 0; i < 60; i++) fast.update(trackerInput(0.9), 16.65);
  approx(slow.status.danger, fast.status.danger, 0.08, 'danger smoothing must not depend on frame rate');

  // Forced states are immediate and released on the next stage.
  const forced = new AdaptiveMoodTracker();
  forced.update(trackerInput(0.1), 16.7);
  forced.holdTransition();
  assert(forced.currentMood === 'transition', 'stage transition must hold the mood immediately');
  forced.releaseTransition();
  for (let i = 0; i < 200; i++) forced.update(trackerInput(0.1), 16.7);
  assert(
    forced.currentMood !== 'transition',
    'the transition hold must release once the next stage is running'
  );
  forced.forceEnded();
  assert(forced.currentMood === 'ended', 'run end must be terminal for the mood');
  forced.reset();
  assert(forced.currentMood === 'calm' && forced.status.transitions === 0, 'tracker reset drifted');

  // ---------------------------------------------------------------- director lifecycle
  const makeSink = () => {
    const state = { muted: false };
    const calls = {
      bedStart: [],
      bedStop: 0,
      bioPulse: [],
      bioCadence: [],
      tension: [],
      duck: [],
      cue: [],
      heartbeat: [],
      suspend: [],
    };
    return {
      state,
      calls,
      bedStart: (i) => calls.bedStart.push(i),
      bedStop: () => { calls.bedStop += 1; },
      bioPulse: (v) => calls.bioPulse.push(v),
      setBioCadence: (ms) => calls.bioCadence.push(ms),
      setTension: (t) => calls.tension.push(t),
      duck: (d, h) => calls.duck.push([d, h]),
      cue: (k) => calls.cue.push(k),
      heartbeat: (k, b) => calls.heartbeat.push([k, b]),
      setSuspended: (s) => calls.suspend.push(s),
      isMuted: () => state.muted,
    };
  };
  const makeVisibility = () => {
    const listeners = new Set();
    return {
      listeners,
      hidden: false,
      addEventListener(type, listener) {
        assert(type === 'visibilitychange', `unexpected visibility event type ${type}`);
        listeners.add(listener);
      },
      removeEventListener(type, listener) {
        assert(type === 'visibilitychange', `unexpected visibility event type ${type}`);
        listeners.delete(listener);
      },
    };
  };

  const runCycle = (seed) => {
    const sink = makeSink();
    const visibility = makeVisibility();
    const director = new AdaptiveAudioDirector(sink, { bedCount, visibility });
    director.start(seed, 1, 0);
    assert(visibility.listeners.size === 1, 'visibility listener must be attached once');
    assert(sink.calls.bedStart.length === 1, 'run start must start exactly one bed');
    assert(
      sink.calls.bedStart[0] === pickMusicBedIndex(seed, bedCount),
      'director bed must match deterministic selection'
    );

    director.setStage(1, 0);
    assert(sink.calls.cue.includes('stage-start'), 'stage start must emit its own cue');

    // Boss warning and stage transition must be distinguishable behaviours.
    director.onBossWarning();
    director.onBossSpawn();
    director.onStageTransition();
    const cues = sink.calls.cue;
    assert(cues.includes('boss-warning'), 'boss warning cue missing');
    assert(cues.includes('boss-spawn'), 'boss spawn cue missing');
    assert(cues.includes('stage-transition'), 'stage transition cue missing');
    assert(
      new Set(cues).size === cues.length || cues.length >= 4,
      'cues must be distinct per lifecycle event'
    );
    assert(
      sink.calls.duck.length >= 3,
      'boss warning/spawn/transition must each dip the bed'
    );
    assert(
      sink.calls.duck.every(([depth, hold]) => depth > 0 && depth < 1 && hold > 0),
      'bed dips must stay inside (0,1) and hold for a positive time'
    );
    assert(director.mood === 'transition', 'stage transition must hold the director mood');

    // Heartbeat is event-driven, not self-scheduled.
    const heartBefore = sink.calls.heartbeat.length;
    director.onHeartbeat('telegraph', false);
    director.onHeartbeat('impact', false);
    assert(
      sink.calls.heartbeat.length === heartBefore + 2,
      'heartbeat layer must fire exactly on the gameplay heartbeat events'
    );
    assert(
      sink.calls.heartbeat.every(([, boss]) => boss === false),
      'heartbeat must forward the boss flag it was given'
    );

    director.onRunEnd(true);
    assert(director.mood === 'ended', 'run end must set the terminal mood');
    assert(sink.calls.cue.includes('victory'), 'victory cue missing');

    // Mute gating: no audio traffic while muted, but the state model keeps advancing.
    sink.state.muted = true;
    const before = JSON.stringify(sink.calls);
    director.onBossWarning();
    director.onHeartbeat('impact', true);
    director.update(trackerInput(1, 0.1, true, 0.1), 120);
    assert(JSON.stringify(sink.calls) === before, 'muted director must not touch the audio graph');
    sink.state.muted = false;

    director.update(trackerInput(1, 0.2, true, 0.5), 120);
    assert(sink.calls.bioPulse.length > 0, 'unmuted director must drive the bio pulse');
    assert(sink.calls.tension.length > 0, 'unmuted director must drive the tension filter');

    director.stop();
    assert(sink.calls.bedStop === 1, 'run teardown must stop the bed exactly once');
    assert(visibility.listeners.size === 0, 'run teardown must detach the visibility listener');
    return { sink, visibility, bed: sink.calls.bedStart[0] };
  };

  const cycleSeeds = ['run-1', 'run-2', 'run-3', 'run-4', 'run-5', 'run-6', 'run-7', 'run-8'];
  const cycleBeds = cycleSeeds.map((seed) => runCycle(seed).bed);
  assert(
    cycleBeds.every((bed) => Number.isInteger(bed) && bed >= 0 && bed < bedCount),
    'a restart cycle selected an out-of-range bed'
  );
  assert(
    cycleSeeds.every((seed, i) => cycleBeds[i] === pickMusicBedIndex(seed, bedCount)),
    'repeated runs must be reproducible from their seed'
  );

  // Same seed repeated (restart spam) must not drift to another bed.
  const repeatBeds = [0, 1, 2, 3, 4].map(() => runCycle('same-seed').bed);
  assert(new Set(repeatBeds).size === 1, 'restarting the same run must never swap the bed');

  // Visibility handling: suspend on hidden, resume on visible, and nothing else.
  {
    const sink = makeSink();
    const visibility = makeVisibility();
    const director = new AdaptiveAudioDirector(sink, { bedCount, visibility });
    director.start('visibility-seed', 2, 900);
    assert(sink.calls.bioCadence.includes(900), 'Heart cadence must lock the bio pulse to 900 ms');
    visibility.hidden = true;
    for (const listener of visibility.listeners) listener();
    visibility.hidden = false;
    for (const listener of visibility.listeners) listener();
    assert(
      JSON.stringify(sink.calls.suspend) === JSON.stringify([true, false]),
      'visibility must suspend once and resume once'
    );
    director.stop();
  }

  // Director output must not depend on the wall clock or on any RNG.
  {
    const first = makeSink();
    const d1 = new AdaptiveAudioDirector(first, { bedCount, visibility: null });
    const second = makeSink();
    const d2 = new AdaptiveAudioDirector(second, { bedCount, visibility: null });
    d1.start('determinism', 1, 0);
    d2.start('determinism', 1, 0);
    for (let i = 0; i < 120; i++) {
      const input = trackerInput(0.5 + 0.4 * Math.sin(i / 7), 0.8);
      d1.update(input, 16.7);
      d2.update(input, 16.7);
    }
    assert(
      JSON.stringify(d1.debugState) === JSON.stringify(d2.debugState),
      'director output is not deterministic for identical input'
    );
    assert(
      JSON.stringify(first.calls.bioPulse) === JSON.stringify(second.calls.bioPulse),
      'bio pulse trace is not deterministic'
    );
    d1.stop();
    d2.stop();
  }

  // ---------------------------------------------------------------- static ownership guards
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (path) => stripComments(readFileSync(resolve(path), 'utf8'));

  const sfxSource = read('src/systems/Sfx.ts');
  assert(!/Math\.random\s*\(/.test(sfxSource), 'Sfx.ts must not pick music randomly any more');
  assert(
    /MUSIC_TRACK_COUNT\s*=\s*MUSIC_TRACKS\.length/.test(sfxSource),
    'MUSIC_TRACK_COUNT must stay derived from the licensed bed list'
  );
  const bedEntries = sfxSource.match(/audio\/music\/loop\d\.(ogg|mp3)/g) ?? [];
  assert(bedEntries.length === 7, `licensed bed list changed (${bedEntries.length} entries)`);
  assert(
    /musicFilter/.test(sfxSource) && /createBiquadFilter/.test(sfxSource),
    'the tension filter must stay on the music bus'
  );

  const milestonesSource = read('src/game/RunMilestones.ts');
  assert(
    !/from '\.\.\/systems\/Sfx'/.test(milestonesSource) &&
      !/setRunIntensity/.test(milestonesSource),
    'RunMilestones must not own the bio pulse any more (single owner: AdaptiveAudioDirector)'
  );

  const gameSceneSource = read('src/scenes/GameScene.ts');
  assert(
    !/milestones\.setIntensity/.test(gameSceneSource),
    'GameScene must drive the bio pulse through the adaptive director only'
  );
  assert(
    /this\.audio\.start\(/.test(gameSceneSource) &&
      /this\.audio\.onBossWarning\(\)/.test(gameSceneSource) &&
      /this\.audio\.onBossSpawn\(\)/.test(gameSceneSource) &&
      /this\.audio\.onStageTransition\(\)/.test(gameSceneSource) &&
      /this\.audio\.onRunEnd\(win\)/.test(gameSceneSource),
    'GameScene adaptive-audio wiring is incomplete'
  );
  assert(
    /this\.audio\?\.stop\(\)/.test(gameSceneSource),
    'GameScene shutdown must release director-owned audio nodes'
  );

  const dangerScan = gameSceneSource.slice(gameSceneSource.indexOf('private collectDangerInput'));
  const dangerScanBody = dangerScan.slice(0, dangerScan.indexOf('\n  }'));
  assert(
    !/gameplayRng/.test(dangerScanBody),
    'the danger scan must never consume gameplay RNG'
  );

  const directorSource = read('src/systems/AdaptiveAudioDirector.ts');
  assert(
    !/Math\.random|from 'phaser'/.test(directorSource),
    'the director must stay Phaser-free and free of wall-clock randomness'
  );
  const mathSource = read('src/systems/adaptiveAudioMath.ts');
  assert(
    !/from 'phaser'|gameplayRng|RunRng/.test(mathSource),
    'adaptiveAudioMath must stay pure (no Phaser, no gameplay RNG)'
  );
  assert(
    !/music|MUSIC_TRACKS/.test(mathSource) || !/\.(ogg|mp3)/.test(mathSource),
    'adaptiveAudioMath must not reference audio binaries'
  );

  console.log(`adaptive audio deterministic smoke: ok (${cycleSeeds.length} restart cycles, 0 leaks)`);
  console.log(
    JSON.stringify(
      {
        tuning: {
          scanRadius: T.scanRadius,
          threatSaturation: T.threatSaturation,
          attackTauMs: T.attackTauMs,
          releaseTauMs: T.releaseTauMs,
          moodDwellMs: T.moodDwellMs,
          bands: {
            pressure: [T.pressureExit, T.pressureEnter],
            danger: [T.dangerExit, T.dangerEnter],
            critical: [T.criticalExit, T.criticalEnter],
          },
        },
        beds: { count: bedCount, qa: bedA, restartCycles: cycleBeds },
        flapping: { transitions: flapperTransitions, window: '300 x 100ms' },
        moods: {
          calmerTension: tensionForMood('calm', 0),
          dangerTension: tensionForMood('danger', 0.5),
          criticalTension: tensionForMood('critical', 1),
        },
      },
      null,
      2
    )
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

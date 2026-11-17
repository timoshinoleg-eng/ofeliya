/**
 * TEST-ONLY autonomous campaign harness API (`window.__ofeliyaTest`).
 *
 * Installed only under the gate in main.ts (`DEV || VITE_QA_TOOLS === '1'`);
 * in a production build Vite substitutes the env literals, the branch is dead
 * code, and this whole module is eliminated — `scripts/check-harness-absent.mjs`
 * gates that in CI. Never import this module (or anything under
 * `src/test-support/`) from production code.
 *
 * Contract: §1.3 of `ofeliya-autonomous-campaign-harness-design-2026-11-18.md`.
 * The API only reads state and feeds ordinary game input; there is deliberately
 * NO setHp / killBoss / setStage / finish / spawnEnemy / skipStage / grantRNA,
 * no direct RunState write and no score mutation — otherwise the test would
 * verify a fixture, not the game.
 *
 * Private game state is read through `as unknown as …Internals` casts. That is
 * intentional: this module is test-only, it never writes through those casts
 * (except calling the real `requestStageTransitionCommit` handler), and every
 * cast is typed in one place below so a game refactor fails loudly at
 * `tsc --noEmit` instead of silently.
 *
 * Deviations / extensions vs §1.3 (all additive unless noted):
 *
 * 1. Telegraph geometry comes from the PUBLIC `Enemy.getDangerEcho(now)` —
 *    `CombatTelegraphRenderer` only draws, it holds no state. `msToFire` reads
 *    the private `rolePhaseUntil` / `bossAttackUntil` / `anomalyStateUntil`
 *    fields: no clean accessor exists for the countdown. The cardiac line
 *    hazard has no public accessor either; its full spec is read from the
 *    director's private `active` slot. Lane telegraphs are reported by their
 *    CENTER (origin + dir * (start+end)/2) with `length = end - start`.
 * 2. Heartbeat: the game DOES track the safe pocket
 *    (`heartbeatSafeX/Y/radius` + indicator, GameScene.ts) — §3.3's claim that
 *    the bot must compute pockets itself is outdated. The pocket is exposed as
 *    `heartbeat.safePocket` (null when no pocket is currently shown), plus
 *    `nextImpactAtMs` / `msToNextImpact` from the public
 *    `heartbeatPulse.snapshot()`. Note the two time bases: protectedUntilMs /
 *    opportunityUntilMs are scene-clock (`scene.time.now`) timestamps, while
 *    nextImpactAtMs is stage-clock (`runState.stage.timeMs`).
 * 3. `advance()` disables `loop.smoothStep` while stepping (restored on
 *    `resume()`). `smoothStep` defaults to true and averages the delta over
 *    the last 10 frames; the first ~10 stepped frames would otherwise inherit
 *    wall-clock RAF deltas from the smoothing history and break replay
 *    determinism. `smoothStep` is a public Phaser config property documented
 *    as toggleable at runtime.
 * 3b. Deterministic synthetic clock: when stepping starts with NO run live,
 *    the clock restarts from a fixed epoch (0) — `simulationNow = 0` and
 *    `loop.lastTime = 0` — so the delta sequence (and every absolute-time
 *    `Math.sin(time * …)` / deadline in the game) is bit-identical across
 *    runs. A wall-time base leaks into `runTimeMs` through float rounding of
 *    `time - lastTime` in `TimeStep.step`: the determinism probe showed a
 *    ~5e-13 divergence at frame 8. When a run IS live, the wall base is kept
 *    — resetting mid-run would push absolute-time deadlines (hit-stop, fire
 *    timers, role phases) ~wall-time into the future. `resume()` re-syncs
 *    `lastTime` to wall time via `TimeStep.start()` → `resetDelta()`.
 * 4. `resume()` passes the captured step callback to `loop.start()` — the
 *    doc's bare `loop.start()` would install an `undefined` callback
 *    (TimeStep.start unconditionally assigns its argument). If the loop was
 *    slept rather than stopped (`started` still true), `resume()` uses
 *    `loop.wake()` instead, because `start()` is a no-op in that state.
 * 5. `chooseUpgrade` also dismisses the level-up modal (`hideModal` +
 *    `scene.resume`, the `stage-transition-smoke.cjs` pattern) — otherwise the
 *    Game scene stays paused and `advance()` makes no progress. The
 *    legendary/evolution ceremony splash is SKIPPED: it is presentation-only
 *    (its finish only tears down the modal and resumes or shows the next
 *    offers) and its auto-dismiss is wall-clock based (1.35 s setTimeout),
 *    which would inject wall time into stepped campaigns. Ceremony ids are
 *    consumed via the public `consumeLegendaryCeremony` /
 *    `consumeEvolutionCeremony` methods and recorded in the run log. When more
 *    choices are queued, `UIScene.update` re-opens the modal on the next frame
 *    by itself.
 * 6. Additive fields (contract fields unchanged): `boss.bossPhase`,
 *    `enemies[].maxHp/isElite`, `gems[].value`, `hostCells[].infection`,
 *    `telegraphs[].source`, `heartbeat.safePocket/nextImpactAtMs/msToNextImpact`.
 * 7. The run log and `stateHash` are fed by a `Phaser.Core.Events.POST_STEP`
 *    subscription (fires after every scene update, RAF or synthetic), not by
 *    polling `readState()` — so event capture and the hash are independent of
 *    the runner's poll rate. `stateHash` covers one digest line per Game
 *    frame (RunSnapshot scalars + all 8 RunRng stream states); `inputHash`
 *    covers API-issued inputs. Both are keyed by a RUN-RELATIVE tick (frames
 *    observed since RUN_START), never by `game.loop.frame`: the loop counter
 *    includes wall-dependent RAF frames from boot/Menu and would make
 *    identical runs hash differently.
 * 8. `readState()` before any run returns the menu shape (`phase: 'MENU'`)
 *    instead of throwing. A run counts as live while the Game scene is
 *    RUNNING *or PAUSED*: Phaser's `isActive()` is true only for RUNNING
 *    scenes (Systems.js), and the level-up modal pauses Game — using
 *    `isActive` alone would misread every mutation choice as "no run". The
 *    game itself uses the same `isActive || isPaused` pair.
 *
 * Known limitation: `resume()` realigns scene clocks to wall time. Absolute
 * scene-time deadlines scheduled during stepping (hit-stop, fire timers,
 * transition earliest-commit) then fire late by the synthetic lead. Stepped
 * campaigns should stay stepped until the run ends.
 */

import type { CardiacLineHazardDirector, CardiacLineHazardSpec } from '../game/CardiacLineHazard';
import type { DifficultyId } from '../game/DifficultyProfile';
import type { Enemy } from '../game/Enemy';
import type { Gem } from '../game/Gem';
import type { HeartbeatPulseDirector } from '../game/HeartbeatPulseDirector';
import type { RunResult } from '../game/RunContracts';
import type { RunRng, RunRngSnapshot } from '../game/RunRng';
import type { StageDirector } from '../game/StageDirector';
import type { WaveDirector } from '../game/WaveDirector';
import type { GameScene } from '../scenes/GameScene';
import type { HostCellSystem } from '../systems/HostCellSystem';
import { clearDailyIntent } from '../game/DailyRunIntent';
import { RunCheckpoint } from '../systems/RunCheckpoint';
import { Sha256 } from './sha256';

// ---------------------------------------------------------------------------
// Public contract (§1.3)
// ---------------------------------------------------------------------------

export interface HarnessInput {
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimX?: number; // -1..1, optional, only twin-stick
  aimY?: number;
}

export interface HarnessTelegraph {
  shape: 'circle' | 'line';
  x: number;
  y: number;
  radius?: number;
  angle?: number;
  length?: number;
  /** ms until the telegraph fires; negative while a line beam is already live; -1 if unknown. */
  msToFire: number;
  /** Extension: which system owns this telegraph. */
  source: 'runner' | 'brute' | 'boss' | 'anomaly' | 'cardiac-line';
}

export interface HarnessState {
  scene: 'Menu' | 'Game' | 'UI' | string;
  phase: string;
  stageId: string;
  stageOrder: number;
  stageTimeMs: number;
  runTimeMs: number;
  player: { x: number; y: number; hp: number; maxHp: number };
  boss: null | {
    kind: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
    behavior?: string;
    telegraph?: string;
    /** Extension: boss phase (1 | 2). */
    bossPhase: number;
  };
  enemies: Array<{ kind: string; x: number; y: number; hp: number; maxHp: number; isElite: boolean }>;
  hostCells: Array<{ x: number; y: number; active: boolean; infection: number }>;
  gems: Array<{ x: number; y: number; active: boolean; value: number }>;
  telegraphs: HarnessTelegraph[];
  heartbeat: {
    protectedUntilMs: number;
    opportunityUntilMs: number;
    /** Extension: current safe pocket, null when none is shown. */
    safePocket: { x: number; y: number; radius: number } | null;
    /** Extension: next heartbeat impact on the stage clock; null off the heart stage. */
    nextImpactAtMs: number | null;
    /** Extension: ms until the next heartbeat impact; null off the heart stage. */
    msToNextImpact: number | null;
  };
  awaitingChoice: boolean;
  pendingChoices: string[];
  runSeed: string;
  difficultyId: string;
}

export interface HarnessRunLogEvent {
  tick: number;
  /** Simulation time of the current run (runState.run.timeMs) when observed. */
  timeMs: number;
  type: string;
  [key: string]: unknown;
}

export interface HarnessRunLog {
  events: HarnessRunLogEvent[];
  inputHash: string;
  stateHash: string;
}

export interface HarnessPools {
  enemies: number;
  gems: number;
  bullets: number;
  listeners: number;
  timers: number;
  tweens: number;
}

export interface OfeliyaTestApi {
  version: 1;
  readState(): HarnessState;
  startCampaign(options?: { seed?: string; difficulty?: 'standard' | 'strained' }): Promise<void>;
  setInput(input: HarnessInput): void;
  clearInput(): void;
  advance(frames: number): Promise<void>;
  pause(): void;
  resume(): void;
  chooseUpgrade(id: string): void;
  acknowledgeTransition(): void;
  getRunLog(): HarnessRunLog;
  getRngState(): RunRngSnapshot;
  debugPools(): HarnessPools;
}

// ---------------------------------------------------------------------------
// Test-only views of private game state (read-only, except the real
// requestStageTransitionCommit handler and the UI modal teardown in
// chooseUpgrade, which mirror stage-transition-smoke.cjs).
// ---------------------------------------------------------------------------

interface GameSceneInternals {
  stageDirector: StageDirector;
  wave: WaveDirector;
  enemies: Phaser.Physics.Arcade.Group;
  gems: Phaser.Physics.Arcade.Group;
  bullets: Phaser.Physics.Arcade.Group;
  hostCells: HostCellSystem;
  gameplayRng: RunRng;
  cardiacHazard: CardiacLineHazardDirector;
  heartbeatPulse: HeartbeatPulseDirector;
  heartbeatProtectedUntil: number;
  heartbeatOpportunityUntil: number;
  heartbeatSafeX: number;
  heartbeatSafeY: number;
  heartbeatSafeRadius: number;
  heartbeatSafeIndicator: Phaser.GameObjects.Arc | null;
  stageTransition: { token: number } | null;
  requestStageTransitionCommit(token: number): void;
}

interface EnemyInternals {
  rolePhaseUntil: number;
  bossAttackUntil: number;
  bossAttackState: string;
  anomalyStateUntil: number;
}

interface CardiacHazardInternals {
  active: { hazard: CardiacLineHazardSpec; fired: boolean } | null;
}

interface UiSceneInternals {
  hideModal(): void;
  flushContextHint(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed synthetic timestep: one 60 Hz frame, always below the 50 ms delta clamp. */
const FIXED_DT = 1000 / 60;
/** Frames stepped synchronously before yielding to the browser event loop. */
const STEP_CHUNK = 120;
/** Ring-buffer cap for run-log events (oldest dropped first). */
const MAX_RUN_LOG_EVENTS = 4096;
/** Wall-clock budget for startCampaign to see an active Game scene. */
const START_TIMEOUT_MS = 10_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export function installAutonomousHarness(game: Phaser.Game): void {
  if (typeof window === 'undefined') return;
  if (window.__ofeliyaTest) return; // idempotent: never install twice
  // TimeStep.start(callback) requires the Game.step callback; stop() keeps it
  // but destroy() nulls it, so capture it once at install time.
  const stepCallback = game.loop.callback;

  // --- run-log state -------------------------------------------------------
  let events: HarnessRunLogEvent[] = [];
  let inputHasher = new Sha256();
  let stateHasher = new Sha256();
  /**
   * Run-relative tick: Game frames observed since RUN_START. Deliberately NOT
   * `game.loop.frame` — the loop counter includes wall-dependent RAF frames
   * from boot/Menu, so identical runs would hash differently.
   */
  let runTick = 0;

  // --- synthetic-stepping state --------------------------------------------
  let simulationNow: number | null = null;
  let stepping = false;
  let savedSmoothStep = true;

  // --- frame-observer state -------------------------------------------------
  let prevActive = false;
  let prevPhase = '';
  let prevStageId = '';
  let prevBossAlive = false;
  let prevBossId = '';
  let prevAwaitingChoice = false;
  let prevRunResultSeen = false;

  function getGameScene(): GameScene | null {
    return (game.scene.getScene('Game') as unknown as GameScene | null) ?? null;
  }

  /**
   * A run is live while the Game scene is RUNNING or PAUSED. Phaser's
   * `isActive()` is true only for RUNNING scenes (Systems.isActive checks
   * `status === RUNNING`) — the level-up modal pauses Game, so `isActive`
   * alone would misread every mutation choice as "no run". The game itself
   * uses the same `isActive || isPaused` pair (GameScene.ts, UIScene.ts).
   */
  function isGameLive(): boolean {
    return game.scene.isActive('Game') || game.scene.isPaused('Game');
  }

  function requireGameScene(): GameScene {
    const gs = getGameScene();
    if (!gs || !isGameLive() || !gs.runState) {
      throw new Error('harness: no active Game run (call startCampaign first)');
    }
    return gs;
  }

  function internalsOf(gs: GameScene): GameSceneInternals {
    return gs as unknown as GameSceneInternals;
  }

  function currentRunTimeMs(): number {
    const gs = getGameScene();
    return gs?.runState ? gs.runState.run.timeMs : 0;
  }

  function pushEvent(event: { type: string; [key: string]: unknown }): void {
    events.push({ tick: runTick, timeMs: currentRunTimeMs(), ...event });
    if (events.length > MAX_RUN_LOG_EVENTS) {
      events.splice(0, events.length - MAX_RUN_LOG_EVENTS);
    }
  }

  function resetRunLog(): void {
    events = [];
    inputHasher = new Sha256();
    stateHasher = new Sha256();
  }

  function hashInput(entry: unknown[]): void {
    inputHasher.update(`${JSON.stringify(entry)}\n`);
  }

  /**
   * Per-frame observer, subscribed to POST_STEP (fires after every scene
   * update, RAF-driven or synthetic). Feeds the state hash with one digest
   * line per Game frame and turns state transitions into run-log events, so
   * both are independent of how often the runner polls readState().
   */
  function onPostStep(): void {
    const gs = getGameScene();
    const active = Boolean(gs && isGameLive() && gs.runState);
    if (!active || !gs) {
      if (prevActive && !prevRunResultSeen) {
        // Game stopped without a runResult: the only such path is exitToMenu
        // (pause-menu "В МЕНЮ"), i.e. an abandoned run — finish() always
        // writes runResult first.
        pushEvent({ type: 'RUN_END', reason: 'abandoned', win: false });
      }
      prevActive = false;
      return;
    }
    const gi = internalsOf(gs);
    const stage = gi.stageDirector.currentStage;
    const phase = gi.stageDirector.phase;

    if (!prevActive) {
      // Run boundary: fresh hashes/log for the new run.
      resetRunLog();
      runTick = 0;
      pushEvent({ type: 'RUN_START', seed: gs.runSeed, difficulty: gs.difficulty.id, stage: stage.id });
      prevPhase = phase;
      prevStageId = stage.id;
      prevBossAlive = false;
      prevBossId = '';
      prevAwaitingChoice = gs.awaitingChoice;
      prevRunResultSeen = false;
      prevActive = true;
    }

    // State digest: RunSnapshot scalars + all 8 RunRng stream states. No
    // wall-clock values, no per-enemy positions (positions are covered
    // indirectly — any positional divergence moves hp/kills/bossHp/RNG).
    const st = gs.runState.stage;
    const run = gs.runState.run;
    const boss = gi.wave.boss;
    const rng = gi.gameplayRng.snapshot();
    const digest: unknown[] = [
      runTick,
      stage.id,
      phase,
      run.timeMs,
      st.timeMs,
      st.hp,
      st.maxHp,
      st.level,
      st.xp,
      st.xpNext,
      run.kills,
      run.hostCellsInfected,
      st.combo,
      boss ? stage.boss.id : '',
      boss ? boss.hp : 0,
      boss ? boss.maxHp : 0,
      gs.awaitingChoice ? 1 : 0,
      gs.pendingChoices.map((c) => c.id).join(','),
      rng.seed,
      rng.states.progression,
      rng.states['enemy-kind'],
      rng.states['enemy-spawn'],
      rng.states.elite,
      rng.states['host-cell'],
      rng.states.loot,
      rng.states['wave-event'],
      rng.states.anomaly,
    ];
    stateHasher.update(`${JSON.stringify(digest)}\n`);

    if (phase !== prevPhase) {
      pushEvent({ type: 'PHASE_CHANGED', from: prevPhase, to: phase, stage: stage.id });
    }
    if (stage.id !== prevStageId) {
      pushEvent({ type: 'STAGE_CHANGED', from: prevStageId, to: stage.id });
    }
    const bossAlive = Boolean(boss && boss.active && boss.hp > 0);
    const bossId = boss ? stage.boss.id : '';
    if (bossAlive && !prevBossAlive) {
      pushEvent({ type: 'BOSS_SPAWN', boss: bossId });
    }
    if (!bossAlive && prevBossAlive) {
      pushEvent({ type: 'BOSS_DEATH', boss: prevBossId });
    }
    if (gs.awaitingChoice && !prevAwaitingChoice) {
      pushEvent({ type: 'CHOICE_OFFERED', choices: gs.pendingChoices.map((c) => c.id) });
    }
    const result = game.registry.get('runResult') as RunResult | null | undefined;
    if (result && !prevRunResultSeen) {
      pushEvent({ type: 'RUN_END', reason: result.reason, win: result.win, stage: result.stageId });
    }

    prevPhase = phase;
    prevStageId = stage.id;
    prevBossAlive = bossAlive;
    prevBossId = bossId;
    prevAwaitingChoice = gs.awaitingChoice;
    prevRunResultSeen = prevRunResultSeen || Boolean(result);
    runTick += 1;
  }

  // --- readState ------------------------------------------------------------

  function activeSceneKey(): string {
    if (isGameLive()) return 'Game';
    for (const key of ['Menu', 'UI', 'Boot']) {
      if (game.scene.isActive(key)) return key;
    }
    return 'unknown';
  }

  function menuState(): HarnessState {
    return {
      scene: activeSceneKey(),
      phase: 'MENU',
      stageId: '',
      stageOrder: 0,
      stageTimeMs: 0,
      runTimeMs: 0,
      player: { x: 0, y: 0, hp: 0, maxHp: 0 },
      boss: null,
      enemies: [],
      hostCells: [],
      gems: [],
      telegraphs: [],
      heartbeat: {
        protectedUntilMs: 0,
        opportunityUntilMs: 0,
        safePocket: null,
        nextImpactAtMs: null,
        msToNextImpact: null,
      },
      awaitingChoice: false,
      pendingChoices: [],
      runSeed: (game.registry.get('runSeed') as string | undefined) ?? '',
      difficultyId: (game.registry.get('difficultyId') as string | undefined) ?? '',
    };
  }

  function readTelegraphs(gi: GameSceneInternals, now: number): HarnessTelegraph[] {
    const out: HarnessTelegraph[] = [];
    for (const child of gi.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active) continue;
      // getDangerEcho returns a SHARED scratch object — copy every field out
      // immediately and never retain the reference.
      const echo = enemy.getDangerEcho(now);
      if (!echo) continue;
      const priv = enemy as unknown as EnemyInternals;
      let msToFire: number;
      let source: HarnessTelegraph['source'];
      if (enemy.isBoss) {
        msToFire = priv.bossAttackUntil - now;
        source = 'boss';
      } else if (enemy.kind === 'anomaly') {
        msToFire = priv.anomalyStateUntil - now;
        source = 'anomaly';
      } else {
        msToFire = priv.rolePhaseUntil - now;
        source = enemy.kind === 'brute' ? 'brute' : 'runner';
      }
      if (!Number.isFinite(msToFire)) msToFire = -1;
      if (echo.shape === 'radial') {
        out.push({ shape: 'circle', x: echo.x, y: echo.y, radius: echo.radius, msToFire, source });
      } else {
        // Lane: report the segment center + angle + length.
        const angle = Math.atan2(echo.dirY, echo.dirX);
        const mid = (echo.start + echo.end) / 2;
        out.push({
          shape: 'line',
          x: echo.x + echo.dirX * mid,
          y: echo.y + echo.dirY * mid,
          angle,
          length: echo.end - echo.start,
          msToFire,
          source,
        });
      }
    }
    // Phase-two CARDIAC TITAN line hazard: full spec, no public accessor.
    const hazard = (gi.cardiacHazard as unknown as CardiacHazardInternals).active?.hazard;
    if (hazard) {
      out.push({
        shape: 'line',
        x: hazard.centerX,
        y: hazard.centerY,
        angle: hazard.angle,
        length: hazard.halfLength * 2,
        msToFire: hazard.fireAtMs - now,
        source: 'cardiac-line',
      });
    }
    return out;
  }

  function readState(): HarnessState {
    const gs = getGameScene();
    if (!gs || !isGameLive() || !gs.runState) return menuState();
    const gi = internalsOf(gs);
    const stage = gi.stageDirector.currentStage;
    const st = gs.runState.stage;
    const run = gs.runState.run;
    const now = gs.time.now;
    const boss = gi.wave.boss;

    const enemies: HarnessState['enemies'] = [];
    for (const child of gi.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active || enemy === boss) continue;
      enemies.push({
        kind: enemy.kind,
        x: enemy.x,
        y: enemy.y,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        isElite: enemy.isElite,
      });
    }

    const gems: HarnessState['gems'] = [];
    for (const child of gi.gems.getChildren()) {
      const gem = child as Gem;
      if (!gem.active) continue;
      gems.push({ x: gem.x, y: gem.y, active: true, value: gem.value });
    }

    const hostCells = gi.hostCells.snapshot().cells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      active: cell.active,
      infection: cell.infection,
    }));

    const isHeartStage = stage.signatureMechanic === 'heartbeat-pulse';
    const pulse = gi.heartbeatPulse.snapshot();

    return {
      scene: 'Game',
      phase: gi.stageDirector.phase,
      stageId: stage.id,
      stageOrder: stage.order,
      stageTimeMs: st.timeMs,
      runTimeMs: run.timeMs,
      player: { x: gs.player.x, y: gs.player.y, hp: st.hp, maxHp: st.maxHp },
      boss: boss
        ? {
            kind: stage.boss.id,
            hp: boss.hp,
            maxHp: boss.maxHp,
            x: boss.x,
            y: boss.y,
            behavior: stage.boss.behavior,
            telegraph:
              (boss as unknown as EnemyInternals).bossAttackState === 'telegraph'
                ? 'telegraph'
                : undefined,
            bossPhase: boss.bossPhase,
          }
        : null,
      enemies,
      hostCells,
      gems,
      telegraphs: readTelegraphs(gi, now),
      heartbeat: {
        protectedUntilMs: gi.heartbeatProtectedUntil,
        opportunityUntilMs: gi.heartbeatOpportunityUntil,
        safePocket: gi.heartbeatSafeIndicator
          ? { x: gi.heartbeatSafeX, y: gi.heartbeatSafeY, radius: gi.heartbeatSafeRadius }
          : null,
        nextImpactAtMs: isHeartStage ? pulse.nextImpactAtMs : null,
        msToNextImpact: isHeartStage ? pulse.nextImpactAtMs - st.timeMs : null,
      },
      awaitingChoice: gs.awaitingChoice,
      pendingChoices: gs.pendingChoices.map((c) => c.id),
      runSeed: gs.runSeed,
      difficultyId: gs.difficulty.id,
    };
  }

  // --- startCampaign --------------------------------------------------------
  //
  // Route: the SAME registry keys the real launch paths use, then the same
  // `scene.start('Game')`:
  //   - seed: registry `runSeedOverride` — consumed one-shot by
  //     GameScene.create() (duel path sets it in MenuScene.ts, daily path in
  //     DailyRunIntent.ts); without it GameScene generates a random seed.
  //   - difficulty: registry `difficultyId` — set by MenuScene.launchFreshRun,
  //     read by GameScene.create() (falls back to the saved selection).
  // The only thing skipped vs a menu tap is the start-intro VIDEO
  // (presentation, max 3.2 s) — the same shortcut
  // scripts/lib/combat-fixture.cjs takes. No parallel start path is invented.

  function enterSteppedMode(): void {
    if (!stepping) {
      stepping = true;
      savedSmoothStep = game.loop.smoothStep;
      game.loop.smoothStep = false;
      // Deterministic synthetic clock (header note 3b): with no run live,
      // restart from a fixed epoch so the delta sequence is bit-identical
      // across runs; with a run live, keep the wall base so absolute-time
      // deadlines already in flight are not pushed into the future.
      const gs = getGameScene();
      const runLive = Boolean(gs && isGameLive() && gs.runState);
      if (!runLive) {
        simulationNow = 0;
        game.loop.lastTime = 0;
      } else if (simulationNow === null) {
        simulationNow = game.loop.lastTime;
      }
    }
  }

  async function startCampaign(
    options: { seed?: string; difficulty?: 'standard' | 'strained' } = {}
  ): Promise<void> {
    const { seed, difficulty } = options;
    if (difficulty !== undefined && difficulty !== 'standard' && difficulty !== 'strained') {
      throw new Error(
        `startCampaign: unsupported difficulty '${difficulty}' (expected 'standard' | 'strained')`
      );
    }
    // Mirror MenuScene.launchFreshRun: fresh run, no daily intent, no resume.
    clearDailyIntent(game.registry);
    RunCheckpoint.clear();
    game.registry.remove('runCheckpointResume');
    game.registry.remove('runResult');
    game.registry.remove('duelChallenge');
    if (difficulty !== undefined) {
      game.registry.set('difficultyId', difficulty as DifficultyId);
    }
    if (seed !== undefined) {
      game.registry.set('runSeedOverride', seed);
    } else {
      game.registry.remove('runSeedOverride');
    }
    const from = game.scene.getScene('Menu') ?? game.scene.getScene('Game');
    from.scene.start('Game');

    // Game.create() runs on the next Game.step. With RAF alive, poll; with
    // the loop stopped, step it ourselves so the queued scene start processes.
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      const gs = getGameScene();
      if (gs && isGameLive() && gs.runState) return;
      if (Date.now() > deadline) {
        throw new Error('startCampaign: Game scene did not become active within 10s');
      }
      if (game.loop.running) {
        await sleep(16);
      } else {
        enterSteppedMode();
        if (simulationNow === null) simulationNow = game.loop.lastTime;
        simulationNow += FIXED_DT;
        game.loop.step(simulationNow);
        await sleep(0);
      }
    }
  }

  // --- input ----------------------------------------------------------------
  //
  // Same channel the real controls use: GameScene.update reads registry 'joy'
  // (GameScene.ts) and TwinStickControls publishes 'aimJoy' for the aim stick.

  function setInput(input: HarnessInput): void {
    const moveX = clampUnit(input.moveX);
    const moveY = clampUnit(input.moveY);
    game.registry.set('joy', { x: moveX, y: moveY });
    let aimX: number | null = null;
    let aimY: number | null = null;
    if (input.aimX !== undefined || input.aimY !== undefined) {
      aimX = clampUnit(input.aimX ?? 0);
      aimY = clampUnit(input.aimY ?? 0);
      game.registry.set('aimJoy', { x: aimX, y: aimY });
    }
    hashInput([runTick, currentRunTimeMs(), 'input', moveX, moveY, aimX, aimY]);
  }

  function clearInput(): void {
    game.registry.set('joy', { x: 0, y: 0 });
    game.registry.set('aimJoy', { x: 0, y: 0 });
    hashInput([runTick, currentRunTimeMs(), 'input', 0, 0, 0, 0]);
  }

  // --- synthetic stepping ---------------------------------------------------
  //
  // Phaser 3.90 TimeStep.step(time) derives delta from consecutive timestamps
  // (delta = max(0, time - lastTime)) and calls the Game.step callback
  // unconditionally — it does not check `running`, so it works after
  // loop.stop(). Smoothing is disabled while stepping (see header note 3).

  async function advance(frames: number): Promise<void> {
    const n = Math.floor(frames);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`advance: frames must be a non-negative integer, got ${frames}`);
    }
    if (n === 0) return;
    const loop = game.loop;
    if (loop.running) loop.stop();
    // enterSteppedMode picks the synthetic base: fixed epoch when no run is
    // live, wall base when a run is in flight (header note 3b).
    enterSteppedMode();
    if (simulationNow === null) simulationNow = loop.lastTime; // defensive; unreachable
    let remaining = n;
    while (remaining > 0) {
      const chunk = Math.min(remaining, STEP_CHUNK);
      for (let i = 0; i < chunk; i++) {
        simulationNow += FIXED_DT;
        loop.step(simulationNow);
      }
      remaining -= chunk;
      if (remaining > 0) await sleep(0);
    }
  }

  function pause(): void {
    game.loop.stop();
  }

  function resume(): void {
    const loop = game.loop;
    if (loop.running) return;
    if (stepping) {
      stepping = false;
      loop.smoothStep = savedSmoothStep;
    }
    // start() is a no-op when `started` is still true (loop slept, not
    // stopped) — wake() covers that state; otherwise start() needs the real
    // Game.step callback, captured at install time.
    if (loop.started) loop.wake();
    else loop.start(stepCallback);
  }

  // --- choices & transitions ------------------------------------------------

  function chooseUpgrade(id: string): void {
    const gs = requireGameScene();
    if (!gs.awaitingChoice) {
      throw new Error(`chooseUpgrade: no choice is pending (awaitingChoice is false)`);
    }
    const def = gs.pendingChoices.find((c) => c.id === id);
    if (!def) {
      throw new Error(
        `chooseUpgrade: '${id}' is not in pendingChoices [${gs.pendingChoices.map((c) => c.id).join(', ')}]`
      );
    }
    const kind = def.kind ?? 'upgrade';
    // Real game handler: applies the upgrade, burns RNG for re-rolled offers.
    const more = gs.chooseUpgrade(id);
    // Ceremony splash is presentation-only (see header note 5): consume the
    // pending ids so they cannot leak into a later choice, record them, and
    // do not present the wall-clock auto-dismissing modal.
    const legendaryId = gs.consumeLegendaryCeremony();
    const evolutionId = gs.consumeEvolutionCeremony();
    const ui = game.scene.getScene('UI') as unknown as UiSceneInternals | null;
    if (ui) {
      ui.hideModal();
      ui.flushContextHint();
    }
    gs.scene.resume();
    hashInput([runTick, currentRunTimeMs(), 'choose', id, more ? 1 : 0]);
    pushEvent({ type: 'MUTATION_SELECTED', id, kind, legendaryId, evolutionId, more });
  }

  function acknowledgeTransition(): void {
    const gs = requireGameScene();
    const gi = internalsOf(gs);
    const transaction = gi.stageTransition;
    if (!transaction) {
      throw new Error('acknowledgeTransition: no stage transition is pending');
    }
    // Real game handler (same call stage-transition-smoke.cjs makes): honors
    // earliestCommitAt by rescheduling when called too early.
    gi.requestStageTransitionCommit(transaction.token);
    hashInput([runTick, currentRunTimeMs(), 'transition-ack', transaction.token]);
    pushEvent({ type: 'TRANSITION_ACK', token: transaction.token });
  }

  // --- logs, RNG, pools ------------------------------------------------------

  function getRunLog(): HarnessRunLog {
    return {
      events: JSON.parse(JSON.stringify(events)) as HarnessRunLogEvent[],
      inputHash: inputHasher.digest(),
      stateHash: stateHasher.digest(),
    };
  }

  function getRngState(): RunRngSnapshot {
    const gs = requireGameScene();
    return internalsOf(gs).gameplayRng.snapshot();
  }

  function countListeners(emitter: Phaser.Events.EventEmitter | null | undefined): number {
    if (!emitter) return 0;
    let total = 0;
    for (const name of emitter.eventNames()) total += emitter.listenerCount(name);
    return total;
  }

  function countTimers(scene: Phaser.Scene | null | undefined): number {
    if (!scene) return 0;
    // Phaser 3.90 Clock has no public timer count; _active/_pendingInsertion
    // are the timer stores (Clock.js).
    const clock = scene.time as unknown as {
      _active?: unknown[];
      _pendingInsertion?: unknown[];
    };
    return (clock._active?.length ?? 0) + (clock._pendingInsertion?.length ?? 0);
  }

  function countTweens(scene: Phaser.Scene | null | undefined): number {
    return scene ? scene.tweens.getTweens().length : 0;
  }

  function debugPools(): HarnessPools {
    const gs = getGameScene();
    const gi = gs && isGameLive() ? internalsOf(gs) : null;
    const ui = game.scene.getScene('UI');
    return {
      enemies: gi ? gi.enemies.countActive(true) : 0,
      gems: gi ? gi.gems.countActive(true) : 0,
      bullets: gi ? gi.bullets.countActive(true) : 0,
      listeners:
        countListeners(game.events) +
        countListeners(gs?.sys.events) +
        countListeners(ui?.sys.events),
      timers: countTimers(gs) + countTimers(ui),
      tweens: countTweens(gs) + countTweens(ui),
    };
  }

  // --- wire up ----------------------------------------------------------------

  game.events.on(Phaser.Core.Events.POST_STEP, onPostStep);

  const api: OfeliyaTestApi = {
    version: 1,
    readState,
    startCampaign,
    setInput,
    clearInput,
    advance,
    pause,
    resume,
    chooseUpgrade,
    acknowledgeTransition,
    getRunLog,
    getRngState,
    debugPools,
  };
  window.__ofeliyaTest = api;
}

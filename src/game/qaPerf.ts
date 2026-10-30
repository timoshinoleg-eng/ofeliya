/**
 * QA perf overlay — measurement-only diagnostic for the high-enemy-density lag.
 *
 * What it measures (all durations in ms, via performance.now()):
 * - frame:   whole game step, PRE_STEP -> POST_RENDER game events (MEASURED).
 * - render:  renderer work, PRE_RENDER -> POST_RENDER game events (MEASURED).
 *            NOTE: this deliberately differs from the draft spec, which defined
 *            render as a residual (total - update - physics). The game emits
 *            PRE_RENDER/POST_RENDER around the actual render, so render is
 *            measured directly and the residual becomes `other` below.
 * - physics: Arcade world step, scene PRE_UPDATE -> UPDATE span (MEASURED,
 *            modulo event-emit overhead). ArcadePhysics registers World.update
 *            on the scene UPDATE event at scene boot; the overlay registers its
 *            own UPDATE listener later (in GameScene.create), so the overlay's
 *            UPDATE callback runs after World.update has finished. The
 *            overlay's PRE_UPDATE callback runs after GameObject preUpdate
 *            (UpdateList also registered at boot), so the PRE_UPDATE -> UPDATE
 *            span is exactly the world step, not preUpdate.
 * - update:  GameScene.update body for active gameplay frames (MEASURED).
 *            Frozen frames (RUN_ENDED / STAGE_TRANSITION / BOSS_DEFEATED /
 *            hitStop) return before beginUpdate and are NOT recorded.
 * - tryFire / syncBlades / legendary / director / wave / enemyHealth /
 *   hostCells / atmosphere: slices of update (MEASURED, begin/end pairs).
 *   They are a diagnostic subset, NOT a partition of update: input handling,
 *   audio, cardiac hazard, danger-echo rendering and player bars also live
 *   inside update but have no individual row.
 * - other:   DERIVED residual: frame - physics - update - render, clamped
 *            at >= 0. This absorbs GameObject preUpdate (enemy sprite
 *            preUpdate lives HERE, not in `update`), POST_UPDATE, the UI
 *            scene step, input/sound/scene-manager overhead, and any
 *            measurement slack. If `other` dominates, the next step is
 *            isolating preUpdate — not another blind optimisation.
 * - Paused frames are excluded: when the Game scene is paused (e.g. the
 *   mutation modal pauses it), its scene events stop firing, so the
 *   POST_RENDER handler skips the frame instead of recording a render-only
 *   sample into the averages.
 *
 * Gating (HARD REQUIREMENT): the overlay object is created ONLY when the
 * caller passes the existing QA gate (dev or VITE_QA_TOOLS=1 — the same
 * expression as FeatureFlags.init in main.ts). With the gate off, no overlay
 * object exists, no probe runs, and no performance.now() call happens in the
 * hot path: every probe call site in GameScene is guarded by
 * `if (this.qaPerf)`. This module itself never reads the build-time env flag, so the
 * pure parts (stats + formatting) stay node-testable.
 *
 * Self-inflicted overhead: one reused Text object, refreshed at most ~4 Hz
 * (every 250 ms of wall time). No per-frame Text creation, no graphics
 * clear+redraw per frame. Counters (countActive) are sampled only at refresh
 * time, not every frame. On scene SHUTDOWN the overlay detaches its event
 * listeners and drops its Text reference; Phaser destroys the Text with the
 * rest of the scene — the overlay deliberately does NOT call text.destroy()
 * during SHUTDOWN, when scene plugins may already be tearing down.
 *
 * No gameplay, balance, or dependency changes. Phaser-only, zero new deps.
 */

import type Phaser from 'phaser';

export type QaPerfKey =
  | 'frame'
  | 'render'
  | 'physics'
  | 'update'
  | 'tryFire'
  | 'syncBlades'
  | 'legendary'
  | 'director'
  | 'wave'
  | 'enemyHealth'
  | 'hostCells'
  | 'atmosphere'
  | 'other';

export const QA_PERF_KEYS: readonly QaPerfKey[] = [
  'frame',
  'render',
  'physics',
  'update',
  'tryFire',
  'syncBlades',
  'legendary',
  'director',
  'wave',
  'enemyHealth',
  'hostCells',
  'atmosphere',
  'other',
];

/** Rolling-window stats for one key: window average + session maximum. */
export class QaPerfStats {
  private readonly windowSize: number;
  private readonly samples: number[];
  private cursor = 0;
  private count = 0;
  private sum = 0;
  private sessionMax = 0;
  private frames = 0;

  constructor(windowSize = 120) {
    this.windowSize = Math.max(1, Math.floor(windowSize));
    this.samples = new Array<number>(this.windowSize).fill(0);
  }

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.count === this.windowSize) this.sum -= this.samples[this.cursor];
    else this.count += 1;
    this.samples[this.cursor] = ms;
    this.sum += ms;
    this.cursor = (this.cursor + 1) % this.windowSize;
    if (ms > this.sessionMax) this.sessionMax = ms;
    this.frames += 1;
  }

  avg(): number {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  max(): number {
    return this.sessionMax;
  }

  get sampleCount(): number {
    return this.count;
  }

  get frameCount(): number {
    return this.frames;
  }
}

export interface QaPerfCounters {
  enemies: number;
  bullets: number;
  gems: number;
  density: number;
  tier: string;
}

export interface QaPerfRow {
  avg: number;
  max: number;
}

export interface QaPerfSnapshot {
  rows: Record<QaPerfKey, QaPerfRow>;
  frames: number;
  fps: number;
  counters: QaPerfCounters;
  worstFrameMs: number;
  worstCounters: QaPerfCounters | null;
}

const fmt = (ms: number): string => ms.toFixed(1);

/** Pure formatter: stats + counters -> overlay lines. Node-testable. */
export function formatQaPerfLines(
  rows: Record<QaPerfKey, QaPerfRow>,
  frames: number,
  fps: number,
  counters: QaPerfCounters,
  worstFrameMs: number,
  worstCounters: QaPerfCounters | null,
): string[] {
  const pair = (key: QaPerfKey): string => `${fmt(rows[key].avg)}/${fmt(rows[key].max)}`;
  const lines = [
    `QA PERF avg/max ms (${frames}f) fps ${fps.toFixed(0)}`,
    `frame ${pair('frame')} | render ${pair('render')} (measured)`,
    `physics ${pair('physics')} (measured) | update ${pair('update')}`,
    `fire ${pair('tryFire')} | blades ${pair('syncBlades')} | leg ${pair('legendary')} | dir ${pair('director')}`,
    `wave ${pair('wave')} | hp ${pair('enemyHealth')} | cells ${pair('hostCells')} | atmo ${pair('atmosphere')}`,
    `other ${pair('other')} (derived: frame-physics-update-render)`,
    `E ${counters.enemies} B ${counters.bullets} G ${counters.gems} | density ${counters.density} | tier ${counters.tier}`,
  ];
  if (worstCounters) {
    lines.push(
      `worst ${fmt(worstFrameMs)}ms @ E${worstCounters.enemies} B${worstCounters.bullets} G${worstCounters.gems}`,
    );
  }
  return lines;
}

/**
 * The overlay itself. Construct ONLY under the QA gate (see header).
 * Probe methods are no-ops-safe: begin/end ignore unknown nesting, and a
 * missing begin yields no record instead of a garbage sample.
 */
export class QaPerfOverlay {
  private readonly stats = new Map<QaPerfKey, QaPerfStats>();
  private readonly starts = new Map<QaPerfKey, number>();
  private readonly scene: Phaser.Scene;
  private readonly readCounters: () => QaPerfCounters;
  private text: Phaser.GameObjects.Text | null;
  private lastTextAt = 0;
  private frameStart = 0;
  private preUpdateAt = 0;
  private renderStart = 0;
  private steppedThisFrame = false;
  private worstFrameMs = 0;
  private worstCounters: QaPerfCounters | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, readCounters: () => QaPerfCounters) {
    this.scene = scene;
    this.readCounters = readCounters;
    for (const key of QA_PERF_KEYS) this.stats.set(key, new QaPerfStats(120));

    // Listener order is the measurement (see header): ArcadePhysics and
    // UpdateList registered at scene boot, before create() runs, so:
    // - onPreUpdate runs AFTER GameObject preUpdate -> marks physics start;
    // - onUpdate runs AFTER World.update -> marks physics end.
    // Event names are Phaser's literal strings (phaser/src/scene/events/*,
    // phaser/src/core/events/*); the module keeps Phaser as a type-only
    // import so the pure parts stay node-testable without loading Phaser.
    scene.sys.events.on('preupdate', this.onPreUpdate, this);
    scene.sys.events.on('update', this.onUpdate, this);
    scene.game.events.on('prestep', this.onPreStep, this);
    scene.game.events.on('prerender', this.onPreRender, this);
    scene.game.events.on('postrender', this.onPostRender, this);
    scene.events.once('shutdown', this.destroy, this);

    this.text = scene.add
      .text(8, 8, 'QA PERF…', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#7dffb0',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshText();
  }

  /** GameScene.update entry for active gameplay frames (after early returns). */
  beginUpdate(): void {
    this.starts.set('update', performance.now());
  }

  endUpdate(): void {
    const ms = this.end('update');
    if (ms !== null) this.lastUpdateMs = ms;
  }

  begin(key: QaPerfKey): void {
    this.starts.set(key, performance.now());
  }

  /** Returns the measured duration, or null when no matching begin ran. */
  end(key: QaPerfKey): number | null {
    const start = this.starts.get(key);
    if (start === undefined) return null;
    this.starts.delete(key);
    const ms = performance.now() - start;
    this.stats.get(key)?.record(ms);
    return ms;
  }

  private onPreStep = (): void => {
    this.frameStart = performance.now();
  };

  private onPreUpdate = (): void => {
    this.preUpdateAt = performance.now();
  };

  private onUpdate = (): void => {
    // Runs after World.update (registration order, see header).
    this.lastPhysicsMs = performance.now() - this.preUpdateAt;
    this.stats.get('physics')?.record(this.lastPhysicsMs);
    // Reset: frames whose update() early-returns (hitStop, transitions)
    // never call endUpdate, so a stale update sample must not leak into
    // this frame's derived residual.
    this.lastUpdateMs = 0;
    this.steppedThisFrame = true;
  };

  private onPreRender = (): void => {
    this.renderStart = performance.now();
  };

  private onPostRender = (): void => {
    // Paused scene = no scene step this frame: skip, do not dilute averages
    // with a render-only sample.
    if (!this.steppedThisFrame) return;
    this.steppedThisFrame = false;
    const now = performance.now();
    const renderMs = now - this.renderStart;
    const frameMs = now - this.frameStart;
    this.lastRenderMs = renderMs;
    this.stats.get('render')?.record(renderMs);
    this.stats.get('frame')?.record(frameMs);
    // Derived residual from THIS frame's own component samples (see header).
    this.stats.get('other')?.record(this.lastOtherMs(frameMs));
    if (frameMs > this.worstFrameMs) {
      this.worstFrameMs = frameMs;
      this.worstCounters = this.readCounters();
    }
    if (now - this.lastTextAt >= 250) {
      this.lastTextAt = now;
      this.refreshText();
    }
  };

  // The per-frame component samples needed for the derived residual. Kept as
  // plain fields (no allocation) and updated by the same handlers that record
  // the window stats, so `other` always uses one consistent frame's numbers.
  private lastPhysicsMs = 0;
  private lastUpdateMs = 0;
  private lastRenderMs = 0;

  private lastOtherMs(frameMs: number): number {
    return Math.max(0, frameMs - this.lastPhysicsMs - this.lastUpdateMs - this.lastRenderMs);
  }

  private snapshot(): QaPerfSnapshot {
    const rows = {} as Record<QaPerfKey, QaPerfRow>;
    for (const key of QA_PERF_KEYS) {
      const s = this.stats.get(key)!;
      rows[key] = { avg: s.avg(), max: s.max() };
    }
    const frameAvg = rows.frame.avg;
    return {
      rows,
      frames: this.stats.get('frame')!.frameCount,
      fps: frameAvg > 0 ? 1000 / frameAvg : 0,
      counters: this.readCounters(),
      worstFrameMs: this.worstFrameMs,
      worstCounters: this.worstCounters,
    };
  }

  private refreshText(): void {
    if (!this.text) return;
    const snap = this.snapshot();
    this.text.setText(formatQaPerfLines(snap.rows, snap.frames, snap.fps, snap.counters, snap.worstFrameMs, snap.worstCounters));
  }

  /**
   * Detach only. The Text object is left for Phaser's scene teardown (see
   * header): calling text.destroy() during SHUTDOWN risks touching scene
   * plugins that are already tearing down.
   */
  destroy = (): void => {
    if (this.destroyed) return;
    this.destroyed = true;
    const sys = this.scene.sys.events;
    sys.off('preupdate', this.onPreUpdate, this);
    sys.off('update', this.onUpdate, this);
    this.scene.game.events.off('prestep', this.onPreStep, this);
    this.scene.game.events.off('prerender', this.onPreRender, this);
    this.scene.game.events.off('postrender', this.onPostRender, this);
    this.text = null;
  };
}

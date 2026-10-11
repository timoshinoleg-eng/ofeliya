import type { EnemyKind } from './config';

/**
 * Authored wave events: deterministic, stage-local surges layered on top of the
 * interval spawner (WaveDirector). Pure module — no Phaser imports — so the
 * schedule and geometry are unit-testable in plain Node.
 *
 * Design adapted from `giovanneluna/poke-survivors` (MIT):
 * - `src/systems/EventSystem.ts`: the pattern of a registry of named, timed
 *   events announced before they fire;
 * - `src/systems/SpawnSystem.ts` (`spawnRattataCircle`): the pattern of
 *   "warning first, then a delayed geometric burst" (their horde spawns a
 *   circle around the player after a warning flash).
 * OFELIYA rewrites both ideas around its own stage lifecycle, deterministic
 * run-seeded RNG, threat caps and combat telegraph language; no donor code,
 * assets or names are imported. See THIRD_PARTY_NOTICES.md.
 */

export type WaveEventKind = 'encircle' | 'flank-wedge' | 'swarm-surge';

export interface WaveEventDefinition {
  id: string;
  /** Stage time when the burst spawns. The telegraph leads it by `telegraphMs`. */
  atMs: number;
  kind: WaveEventKind;
  telegraphMs: number;
  /** Banner copy, shown through the same presentation path as milestones. */
  title: string;
  subtitle: string;
  color: number;
}

export interface WaveEventSpawn {
  kind: Exclude<EnemyKind, 'boss'>;
  x: number;
  y: number;
}

/** Geometry input shared by all patterns. */
export interface WaveEventGeometryContext {
  playerX: number;
  playerY: number;
  /** Deterministic random values in [0, 1), drawn from the run RNG. */
  random: () => number;
}

export const WAVE_EVENT_LIMITS = {
  /** Hard bound on enemies a single event may try to place. */
  maxAttempts: 40,
  encircle: { count: 22, radius: 265 },
  flankWedge: { count: 8, baseDistance: 340, rowSpacing: 46, spreadStep: 0.21 },
  swarmSurge: { count: 16, radius: 330, arcSpan: Math.PI * 0.62, brutes: 2 },
} as const;

/** Encircle: a full ring around the player (poke-survivors horde pattern). */
export function encircleSpawns(ctx: WaveEventGeometryContext): WaveEventSpawn[] {
  const { count, radius } = WAVE_EVENT_LIMITS.encircle;
  const rotation = ctx.random() * Math.PI * 2;
  const spawns: WaveEventSpawn[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rotation + (i / count) * Math.PI * 2;
    spawns.push({
      kind: 'swarm',
      x: ctx.playerX + Math.cos(angle) * radius,
      y: ctx.playerY + Math.sin(angle) * radius,
    });
  }
  return spawns;
}

/** Flank wedge: runners stacked in rows arriving from one direction. */
export function flankWedgeSpawns(ctx: WaveEventGeometryContext): WaveEventSpawn[] {
  const { count, baseDistance, rowSpacing, spreadStep } = WAVE_EVENT_LIMITS.flankWedge;
  const direction = ctx.random() * Math.PI * 2;
  const spawns: WaveEventSpawn[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 3);
    const lane = i % 3;
    const angle = direction + (lane - 1) * spreadStep * (1 + row * 0.35);
    const distance = baseDistance + row * rowSpacing + ctx.random() * 24;
    spawns.push({
      kind: 'runner',
      x: ctx.playerX + Math.cos(angle) * distance,
      y: ctx.playerY + Math.sin(angle) * distance,
    });
  }
  return spawns;
}

/** Swarm surge: a dense arc of swarm with a brute spearhead at its center. */
export function swarmSurgeSpawns(ctx: WaveEventGeometryContext): WaveEventSpawn[] {
  const { count, radius, arcSpan, brutes } = WAVE_EVENT_LIMITS.swarmSurge;
  const center = ctx.random() * Math.PI * 2;
  const spawns: WaveEventSpawn[] = [];
  for (let i = 0; i < count; i++) {
    const fraction = i / (count - 1);
    const angle = center - arcSpan / 2 + fraction * arcSpan;
    const jitter = ctx.random() * 56;
    spawns.push({
      kind: 'swarm',
      x: ctx.playerX + Math.cos(angle) * (radius + jitter),
      y: ctx.playerY + Math.sin(angle) * (radius + jitter),
    });
  }
  for (let i = 0; i < brutes; i++) {
    const angle = center + (i - (brutes - 1) / 2) * 0.3;
    spawns.push({
      kind: 'brute',
      x: ctx.playerX + Math.cos(angle) * (radius + 70),
      y: ctx.playerY + Math.sin(angle) * (radius + 70),
    });
  }
  return spawns;
}

export function waveEventSpawns(
  event: WaveEventDefinition,
  ctx: WaveEventGeometryContext
): WaveEventSpawn[] {
  switch (event.kind) {
    case 'encircle':
      return encircleSpawns(ctx);
    case 'flank-wedge':
      return flankWedgeSpawns(ctx);
    case 'swarm-surge':
      return swarmSurgeSpawns(ctx);
  }
}

/** Telegraph geometry handed to the scene for pre-spawn warning rendering. */
export interface WaveEventTelegraph {
  shape: 'radial' | 'direction';
  x: number;
  y: number;
  radius: number;
  /** Only for `direction`: world-space angle the burst arrives from. */
  angle: number;
  color: number;
  durationMs: number;
}

/**
 * Builds the telegraph from the cached spawn plan: the plan is computed at
 * telegraph time (so the run-RNG draws happen once), and the warning points
 * exactly where the cached burst will land.
 */
export function waveEventTelegraph(
  event: WaveEventDefinition,
  plan: readonly WaveEventSpawn[],
  playerX: number,
  playerY: number
): WaveEventTelegraph {
  if (event.kind === 'encircle') {
    return {
      shape: 'radial',
      x: playerX,
      y: playerY,
      radius: WAVE_EVENT_LIMITS.encircle.radius,
      angle: 0,
      color: event.color,
      durationMs: event.telegraphMs,
    };
  }
  let sumX = 0;
  let sumY = 0;
  for (const spawn of plan) {
    sumX += spawn.x - playerX;
    sumY += spawn.y - playerY;
  }
  const radius =
    event.kind === 'flank-wedge'
      ? WAVE_EVENT_LIMITS.flankWedge.baseDistance
      : WAVE_EVENT_LIMITS.swarmSurge.radius;
  return {
    shape: 'direction',
    x: playerX,
    y: playerY,
    radius,
    angle: Math.atan2(sumY, sumX),
    color: event.color,
    durationMs: event.telegraphMs,
  };
}

/**
 * Events are only valid if their telegraph and burst fully land before the
 * boss warning begins; surges must never collide with the boss reveal.
 */
export function validateWaveEvents(
  events: readonly WaveEventDefinition[],
  stageDurationMs: number,
  bossWarningLeadMs: number
): void {
  let lastAtMs = -1;
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.id)) throw new Error(`Duplicate wave event id: ${event.id}`);
    ids.add(event.id);
    if (
      !Number.isFinite(event.atMs) ||
      event.atMs <= lastAtMs ||
      event.atMs <= 0 ||
      !Number.isFinite(event.telegraphMs) ||
      event.telegraphMs < 600 ||
      event.telegraphMs > 5_000 ||
      event.atMs - event.telegraphMs < 0 ||
      event.atMs > stageDurationMs - Math.max(bossWarningLeadMs, 10_000)
    ) {
      throw new Error(`Invalid wave event schedule: ${event.id}`);
    }
    if (!event.title || !event.subtitle) {
      throw new Error(`Wave event missing copy: ${event.id}`);
    }
    lastAtMs = event.atMs;
  }
}

/** First event index whose telegraph has not yet started at `stageTimeMs`. */
export function pendingWaveEventIndex(
  events: readonly WaveEventDefinition[],
  stageTimeMs: number
): number {
  let index = 0;
  while (index < events.length && stageTimeMs >= events[index].atMs) index += 1;
  return index;
}

export type ChallengeObjective = 'clear' | 'survive';

export interface ChallengePayloadV1 {
  version: 1;
  objective: ChallengeObjective;
  /** Millisecond target. Clear challenges must be beaten faster; survival challenges longer. */
  timeMs: number;
  kills: number;
  hostCellsInfected: number;
  level: number;
  comboBest: number;
}

export interface ChallengeRunResult {
  win: boolean;
  timeMs: number;
  kills: number;
  hostCellsInfected: number;
  level: number;
  comboBest: number;
}

const PREFIX = 'sz1';
const MAX_START_PAYLOAD_LENGTH = 512;
const START_PAYLOAD_RE = /^[A-Za-z0-9_-]+$/;
const BASE36_RE = /^[0-9a-z]+$/;

// These are parser safety limits, not gameplay limits. Challenge data is untrusted social context
// and must never be used as authoritative score/reward input.
const LIMITS = {
  timeMs: 7_200_000,
  kills: 99_999,
  hostCellsInfected: 9_999,
  level: 999,
  comboBest: 99_999,
} as const;

function boundedInt(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

function encodeInt(value: number, max: number): string {
  return boundedInt(value, max).toString(36);
}

function parseInt36(token: string, max: number): number | null {
  if (!BASE36_RE.test(token)) return null;
  const value = Number.parseInt(token, 36);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) return null;
  return value;
}

/** Creates a compact, non-sensitive social target from a completed run. */
export function createChallengePayload(run: ChallengeRunResult): ChallengePayloadV1 {
  return {
    version: 1,
    objective: run.win ? 'clear' : 'survive',
    timeMs: boundedInt(run.timeMs, LIMITS.timeMs),
    kills: boundedInt(run.kills, LIMITS.kills),
    hostCellsInfected: boundedInt(run.hostCellsInfected, LIMITS.hostCellsInfected),
    level: boundedInt(run.level, LIMITS.level),
    comboBest: boundedInt(run.comboBest, LIMITS.comboBest),
  };
}

/**
 * MAX startapp-safe wire format. Example:
 * sz1_c_6fhc_2s_3_7_k
 *
 * Only documented MAX payload characters are emitted and the payload stays far below 512 chars.
 */
export function encodeChallengePayload(challenge: ChallengePayloadV1): string | null {
  if (challenge.version !== 1) return null;
  const mode = challenge.objective === 'clear' ? 'c' : challenge.objective === 'survive' ? 's' : null;
  if (!mode) return null;
  const payload = [
    PREFIX,
    mode,
    encodeInt(challenge.timeMs, LIMITS.timeMs),
    encodeInt(challenge.kills, LIMITS.kills),
    encodeInt(challenge.hostCellsInfected, LIMITS.hostCellsInfected),
    encodeInt(challenge.level, LIMITS.level),
    encodeInt(challenge.comboBest, LIMITS.comboBest),
  ].join('_');
  if (payload.length > MAX_START_PAYLOAD_LENGTH || !START_PAYLOAD_RE.test(payload)) return null;
  return payload;
}

/** Strict parser for untrusted start_param. Unknown versions/formats are ignored safely. */
export function parseChallengePayload(raw: string | null | undefined): ChallengePayloadV1 | null {
  if (!raw || raw.length > MAX_START_PAYLOAD_LENGTH || !START_PAYLOAD_RE.test(raw)) return null;
  const parts = raw.split('_');
  if (parts.length !== 7 || parts[0] !== PREFIX) return null;
  const objective: ChallengeObjective | null = parts[1] === 'c' ? 'clear' : parts[1] === 's' ? 'survive' : null;
  if (!objective) return null;

  const timeMs = parseInt36(parts[2], LIMITS.timeMs);
  const kills = parseInt36(parts[3], LIMITS.kills);
  const hostCellsInfected = parseInt36(parts[4], LIMITS.hostCellsInfected);
  const level = parseInt36(parts[5], LIMITS.level);
  const comboBest = parseInt36(parts[6], LIMITS.comboBest);
  if (
    timeMs === null ||
    kills === null ||
    hostCellsInfected === null ||
    level === null ||
    comboBest === null
  ) {
    return null;
  }

  return {
    version: 1,
    objective,
    timeMs,
    kills,
    hostCellsInfected,
    level,
    comboBest,
  };
}

/** Client-side social verdict only. It does not grant rewards or validate competitive results. */
export function isChallengeBeaten(target: ChallengePayloadV1, run: ChallengeRunResult): boolean {
  const timeMs = boundedInt(run.timeMs, LIMITS.timeMs);
  if (target.objective === 'clear') return run.win && timeMs > 0 && timeMs < target.timeMs;
  return timeMs > target.timeMs;
}

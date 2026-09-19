export type ChallengeObjective = 'boss1-clear' | 'campaign-clear' | 'survive';

interface ChallengeStats {
  timeMs: number;
  kills: number;
  hostCellsInfected: number;
  level: number;
  comboBest: number;
}

export interface ChallengePayloadV1 extends ChallengeStats {
  version: 1;
  /** Legacy sz1 clear challenges mean the original one-stage IMMUNE PRIME clear. */
  objective: 'boss1-clear' | 'survive';
}

export interface ChallengePayloadV2 extends ChallengeStats {
  version: 2;
  /** New clear challenges target the complete Bloodstream -> Heart campaign. */
  objective: 'campaign-clear' | 'survive';
}

export type ChallengePayload = ChallengePayloadV1 | ChallengePayloadV2;

export interface ChallengeRunResult {
  win: boolean;
  timeMs: number;
  /** Run-wide time when IMMUNE PRIME was defeated; 0/undefined means not defeated. */
  boss1ClearMs?: number;
  kills: number;
  hostCellsInfected: number;
  level: number;
  comboBest: number;
}

const PREFIX_V1 = 'sz1';
const PREFIX_V2 = 'sz2';
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

/** Creates the current compact, non-sensitive social target from a completed run. */
export function createChallengePayload(run: ChallengeRunResult): ChallengePayloadV2 {
  return {
    version: 2,
    objective: run.win ? 'campaign-clear' : 'survive',
    timeMs: boundedInt(run.timeMs, LIMITS.timeMs),
    kills: boundedInt(run.kills, LIMITS.kills),
    hostCellsInfected: boundedInt(run.hostCellsInfected, LIMITS.hostCellsInfected),
    level: boundedInt(run.level, LIMITS.level),
    comboBest: boundedInt(run.comboBest, LIMITS.comboBest),
  };
}

/**
 * MAX startapp-safe wire format.
 * - sz1_c_* remains the legacy IMMUNE PRIME clear contract.
 * - sz2_c_* is the complete multi-stage campaign clear contract.
 */
export function encodeChallengePayload(challenge: ChallengePayload): string | null {
  const prefix = challenge.version === 1 ? PREFIX_V1 : challenge.version === 2 ? PREFIX_V2 : null;
  if (!prefix) return null;
  const clearObjective = challenge.version === 1 ? 'boss1-clear' : 'campaign-clear';
  const mode =
    challenge.objective === clearObjective ? 'c' : challenge.objective === 'survive' ? 's' : null;
  if (!mode) return null;
  const payload = [
    prefix,
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
export function parseChallengePayload(raw: string | null | undefined): ChallengePayload | null {
  if (!raw || raw.length > MAX_START_PAYLOAD_LENGTH || !START_PAYLOAD_RE.test(raw)) return null;
  const parts = raw.split('_');
  if (parts.length !== 7) return null;
  const version = parts[0] === PREFIX_V1 ? 1 : parts[0] === PREFIX_V2 ? 2 : null;
  if (version === null) return null;
  const objective: ChallengeObjective | null =
    parts[1] === 's'
      ? 'survive'
      : parts[1] === 'c'
        ? version === 1
          ? 'boss1-clear'
          : 'campaign-clear'
        : null;
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
    version,
    objective,
    timeMs,
    kills,
    hostCellsInfected,
    level,
    comboBest,
  } as ChallengePayload;
}

/** Client-side social verdict only. It does not grant rewards or validate competitive results. */
export function isChallengeBeaten(target: ChallengePayload, run: ChallengeRunResult): boolean {
  if (target.objective === 'boss1-clear') {
    const boss1ClearMs = boundedInt(run.boss1ClearMs ?? 0, LIMITS.timeMs);
    return boss1ClearMs > 0 && boss1ClearMs < target.timeMs;
  }
  const timeMs = boundedInt(run.timeMs, LIMITS.timeMs);
  if (target.objective === 'campaign-clear') {
    return run.win && timeMs > 0 && timeMs < target.timeMs;
  }
  return timeMs > target.timeMs;
}

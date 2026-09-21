import type { ControlMode } from './ControlMode';

export const DUEL_START_PREFIX = 'd3';
export const DUEL_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;

export interface DuelChallengeSnapshot {
  challengeId: string;
  rulesetVersion: number;
  campaignVersion: number;
  runSeed: string;
  difficultyId: 'standard';
  controlMode: ControlMode;
  targetTimeMs: number;
  createdAt: number;
  expiresAt: number;
}

export interface DuelAttemptResult {
  ok: boolean;
  ranked: false;
  valid: boolean;
  beaten: boolean;
  targetTimeMs: number;
  attemptCount: number;
  bestTimeMs: number | null;
}

export function encodeDuelStartPayload(challengeId: string): string | null {
  if (!DUEL_ID_RE.test(challengeId)) return null;
  return `${DUEL_START_PREFIX}_${challengeId}`;
}

export function parseDuelStartPayload(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^d3_([A-Za-z0-9_-]{16,32})$/.exec(raw);
  return match && DUEL_ID_RE.test(match[1]) ? match[1] : null;
}

export function isDuelBeaten(targetTimeMs: number, win: boolean, timeMs: number): boolean {
  return (
    win === true &&
    Number.isFinite(targetTimeMs) &&
    targetTimeMs > 0 &&
    Number.isFinite(timeMs) &&
    timeMs > 0 &&
    timeMs < targetTimeMs
  );
}

import type { RunResult } from '../game/RunContracts';
import {
  type DuelAttemptResult,
  type DuelChallengeSnapshot,
  DUEL_ID_RE,
} from '../game/Duel';
import type { PlatformAdapter } from '../platform/PlatformBridge';
import { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from './ScoreClient';

const DUEL_TIMEOUT_MS = 3500;

type DuelEvent = 'open' | 'start' | 'rematch';

interface DuelCreateResponse {
  ok: true;
  ranked: false;
  challenge: DuelChallengeSnapshot;
}

function duelEndpoint(path = ''): string {
  if (typeof window === 'undefined') return `api/duel${path}`;
  return new URL(`api/duel${path}`, window.location.href).toString();
}

function verifiedIdentity(platform: PlatformAdapter): {
  platform: 'max' | 'telegram';
  initData: string;
} | null {
  if ((platform.kind !== 'max' && platform.kind !== 'telegram') || !platform.initData) return null;
  return { platform: platform.kind, initData: platform.initData };
}

function duelRunPayload(result: RunResult) {
  return {
    rulesetVersion: SCORE_RULESET_VERSION,
    campaignVersion: SCORE_CAMPAIGN_VERSION,
    difficultyId: result.difficultyId,
    completionStage: result.stageId,
    runSeed: result.runSeed,
    controlMode: result.controlMode,
    bossesDefeated: result.bossesDefeated,
    boss1ClearMs: result.boss1ClearMs > 0 ? Math.round(result.boss1ClearMs) : null,
    hostCellsInfected: result.hostCellsInfected,
    win: result.win,
    timeMs: Math.round(result.timeMs),
    kills: Math.round(result.kills),
    level: Math.round(result.highestLevel),
    resumed: result.resumed,
    daily: false as const,
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), DUEL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function loadDuelChallenge(
  challengeId: string
): Promise<DuelChallengeSnapshot | null> {
  if (!DUEL_ID_RE.test(challengeId)) return null;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), DUEL_TIMEOUT_MS);
  try {
    const response = await fetch(duelEndpoint(`/${challengeId}`), {
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; challenge?: DuelChallengeSnapshot };
    const challenge = body.challenge;
    if (
      body.ok !== true ||
      !challenge ||
      challenge.challengeId !== challengeId ||
      challenge.difficultyId !== 'standard' ||
      !DUEL_ID_RE.test(challenge.challengeId) ||
      typeof challenge.runSeed !== 'string' ||
      challenge.runSeed.length < 1 ||
      typeof challenge.targetTimeMs !== 'number' ||
      !Number.isFinite(challenge.targetTimeMs) ||
      challenge.targetTimeMs <= 0
    ) {
      return null;
    }
    return challenge;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function createFixedSeedDuel(
  result: RunResult,
  platform: PlatformAdapter
): Promise<DuelChallengeSnapshot | null> {
  const identity = verifiedIdentity(platform);
  if (!identity || result.resumed || result.difficultyId !== 'standard' || !result.win) return null;
  const response = await postJson<DuelCreateResponse>(duelEndpoint(), {
    ...identity,
    payload: duelRunPayload(result),
  });
  if (
    response?.ok !== true ||
    response.ranked !== false ||
    !response.challenge ||
    !DUEL_ID_RE.test(response.challenge.challengeId)
  ) {
    return null;
  }
  return response.challenge;
}

export async function submitDuelAttempt(
  challengeId: string,
  result: RunResult,
  platform: PlatformAdapter
): Promise<DuelAttemptResult | null> {
  if (!DUEL_ID_RE.test(challengeId) || result.resumed) return null;
  const identity = verifiedIdentity(platform);
  if (!identity) return null;
  const response = await postJson<DuelAttemptResult>(duelEndpoint(`/${challengeId}/attempt`), {
    ...identity,
    payload: duelRunPayload(result),
  });
  if (
    response?.ok !== true ||
    response.ranked !== false ||
    typeof response.valid !== 'boolean' ||
    typeof response.beaten !== 'boolean' ||
    typeof response.everBeaten !== 'boolean' ||
    typeof response.targetTimeMs !== 'number' ||
    typeof response.attemptCount !== 'number'
  ) {
    return null;
  }
  return response;
}

export async function trackDuelEvent(
  challengeId: string,
  event: DuelEvent,
  platform: PlatformAdapter
): Promise<boolean> {
  if (!DUEL_ID_RE.test(challengeId)) return false;
  const identity = verifiedIdentity(platform);
  if (!identity) return false;
  const response = await postJson<{ ok?: boolean }>(duelEndpoint(`/${challengeId}/event`), {
    ...identity,
    event,
  });
  return response?.ok === true;
}

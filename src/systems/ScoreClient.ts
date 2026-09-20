import type { RunResult } from '../game/RunContracts';
import type { PlatformAdapter } from '../platform/PlatformBridge';
import { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';

export { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';

const ANON_KEY = 'ofeliya_anon_score_id_v1';
const SCORE_TIMEOUT_MS = 2500;

export interface ScoreSubmitResponse {
  ok: boolean;
  rank: number | null;
  ranked: boolean;
  rulesetVersion: number;
  campaignVersion: number;
}

export interface ScoreSubmission {
  platform: 'max' | 'telegram' | 'browser';
  initData?: string;
  anonId?: string;
  payload: {
    rulesetVersion: number;
    campaignVersion: number;
    difficultyId: RunResult['difficultyId'];
    completionStage: RunResult['stageId'];
    runSeed: string;
    controlMode: RunResult['controlMode'];
    bossesDefeated: number;
    boss1ClearMs: number | null;
    hostCellsInfected: number;
    win: boolean;
    timeMs: number;
    kills: number;
    level: number;
    daily: false;
  };
}

function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function randomAnonId(): string {
  try {
    if (globalThis.crypto?.getRandomValues) {
      const words = new Uint32Array(3);
      globalThis.crypto.getRandomValues(words);
      return `anon-${Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('')}`;
    }
  } catch {
    // Restricted WebViews can deny crypto. Fall through to a non-authoritative browser id.
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function browserAnonId(): string {
  if (typeof localStorage === 'undefined') return randomAnonId();
  try {
    const current = localStorage.getItem(ANON_KEY);
    if (current && current.length >= 8 && current.length <= 64) return current;
    const created = randomAnonId();
    localStorage.setItem(ANON_KEY, created);
    return created;
  } catch {
    return randomAnonId();
  }
}

export function buildScoreSubmission(
  result: RunResult,
  platform: PlatformAdapter,
  dateKey = localDateKey()
): ScoreSubmission {
  const kind = platform.kind === 'max' || platform.kind === 'telegram' ? platform.kind : 'browser';
  const payload = {
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
    daily: false as const,
    dateKey,
  };

  if (kind === 'browser') {
    return {
      platform: 'browser',
      anonId: browserAnonId(),
      payload,
    } as ScoreSubmission;
  }

  return {
    platform: kind,
    initData: platform.initData,
    payload,
  } as ScoreSubmission;
}

function scoreEndpoint(): string {
  if (typeof window === 'undefined') return 'api/score';
  return new URL('api/score', window.location.href).toString();
}

export async function submitRunScore(
  result: RunResult,
  platform: PlatformAdapter
): Promise<ScoreSubmitResponse | null> {
  // Local checkpoint state is not server-authoritative. Never let a resumed Standard run
  // enter the canonical score submission path.
  if (result.resumed) return null;
  const submission = buildScoreSubmission(result, platform);
  // A messenger result without signed initData must never be downgraded to an anonymous trusted score.
  if (submission.platform !== 'browser' && !submission.initData) return null;

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), SCORE_TIMEOUT_MS);
  try {
    const response = await fetch(scoreEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ScoreSubmitResponse>;
    if (
      body.ok !== true ||
      typeof body.ranked !== 'boolean' ||
      typeof body.rulesetVersion !== 'number' ||
      typeof body.campaignVersion !== 'number'
    ) {
      return null;
    }
    return {
      ok: true,
      rank: typeof body.rank === 'number' ? body.rank : null,
      ranked: body.ranked,
      rulesetVersion: body.rulesetVersion,
      campaignVersion: body.campaignVersion,
    };
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

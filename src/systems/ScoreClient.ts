import type { RunResult } from '../game/RunContracts';
import type { PlatformAdapter } from '../platform/PlatformBridge';
import type { DailyRunTicket } from './DailyRunClient';
import { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';

export { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';

const ANON_KEY = 'ofeliya_anon_score_id_v1';
const SCORE_OUTBOX_KEY = 'ofeliya_score_outbox_v1';
const DAILY_OUTBOX_KEY = 'ofeliya_daily_score_outbox_v1';
const SCORE_TIMEOUT_MS = 2500;

export interface ScoreSubmitResponse {
  ok: boolean;
  rank: number | null;
  ranked: boolean;
  rulesetVersion: number;
  campaignVersion: number;
  dailyRunAccepted?: boolean;
}

export interface ScoreSubmission {
  submissionId?: string;
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
    daily: boolean;
    dailyRunId?: string;
    dateKey?: string;
  };
}

interface DailyScoreOutboxEntry {
  submissionId: string;
  submission: ScoreSubmission;
}

function createSubmissionId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '');
    if (globalThis.crypto?.getRandomValues) {
      return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (word) =>
        word.toString(16).padStart(8, '0')
      ).join('');
    }
  } catch {
    // The ID is only an idempotency key; the server still validates identity and ticket.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 22)}`;
}

function readDailyOutbox(): DailyScoreOutboxEntry | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(DAILY_OUTBOX_KEY) ?? 'null');
    if (
      parsed && typeof parsed.submissionId === 'string' &&
      parsed.submission && typeof parsed.submission === 'object' &&
      parsed.submission.payload?.dailyRunId
    ) return parsed as DailyScoreOutboxEntry;
  } catch {
    // Ignore malformed local data; the daily ticket will be rejected safely by the server.
  }
  return null;
}

function writeDailyOutbox(entry: DailyScoreOutboxEntry | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (entry) localStorage.setItem(DAILY_OUTBOX_KEY, JSON.stringify(entry));
    else localStorage.removeItem(DAILY_OUTBOX_KEY);
  } catch {
    // The current page still attempts the submission; retry is unavailable in restricted storage.
  }
}

function readScoreOutbox(): DailyScoreOutboxEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SCORE_OUTBOX_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry?.submissionId === 'string' && entry.submission?.payload)
      : [];
  } catch {
    return [];
  }
}

function writeScoreOutbox(entries: DailyScoreOutboxEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (entries.length) localStorage.setItem(SCORE_OUTBOX_KEY, JSON.stringify(entries));
    else localStorage.removeItem(SCORE_OUTBOX_KEY);
  } catch {
    // Submission is still attempted; persistence is best-effort on restricted WebViews.
  }
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

export function buildDailyScoreSubmission(
  result: RunResult,
  platform: PlatformAdapter,
  ticket: DailyRunTicket
): ScoreSubmission | null {
  if (
    result.resumed ||
    result.difficultyId !== 'standard' ||
    result.runSeed !== ticket.runSeed ||
    (platform.kind !== 'max' && platform.kind !== 'telegram') ||
    !platform.initData
  ) {
    return null;
  }
  const submission = buildScoreSubmission(result, platform, ticket.dateKey);
  submission.payload.daily = true;
  submission.payload.dailyRunId = ticket.runId;
  submission.payload.dateKey = ticket.dateKey;
  return submission;
}

async function postScoreSubmission(
  submission: ScoreSubmission
): Promise<ScoreSubmitResponse | null> {
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
      dailyRunAccepted:
        typeof body.dailyRunAccepted === 'boolean' ? body.dailyRunAccepted : undefined,
    };
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
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
  const entry: DailyScoreOutboxEntry = {
    submissionId: createSubmissionId(),
    submission: { ...submission },
  };
  entry.submission.submissionId = entry.submissionId;
  const outbox = readScoreOutbox();
  outbox.push(entry);
  writeScoreOutbox(outbox);
  const response = await postScoreSubmission(entry.submission);
  if (response) writeScoreOutbox(readScoreOutbox().filter((item) => item.submissionId !== entry.submissionId));
  return response;
}

/**
 * Client-visible daily submission outcome, derived ONLY from the HTTP status code the
 * server already returns plus `dailyRunAccepted`. No DTO change, no server change.
 */
export type DailySubmitStatus =
  | 'ok'
  | 'rejected'
  | 'closed'
  | 'expired'
  | 'denied'
  | 'http'
  | 'network'
  | 'unavailable';

/**
 * Additive daily submission entry point. Reports WHY a daily score was not accepted so
 * the result screen can render a specific status line without falling back to the
 * ordinary ranked path.
 */
export async function submitDailyRunScoreDetailed(
  result: RunResult,
  platform: PlatformAdapter,
  ticket: DailyRunTicket
): Promise<{ response: ScoreSubmitResponse | null; status: DailySubmitStatus }> {
  const submission = buildDailyScoreSubmission(result, platform, ticket);
  // Precondition unmet (resumed / seed mismatch / no messenger identity): no request at all.
  if (!submission) return { response: null, status: 'unavailable' };

  const previous = readDailyOutbox();
  if (previous && previous.submission.payload.dailyRunId !== ticket.runId) {
    return { response: null, status: 'network' };
  }
  const entry = previous ?? {
    submissionId: createSubmissionId(),
    submission: { ...submission },
  };
  entry.submission.initData = platform.initData;
  entry.submission.submissionId = entry.submissionId;
  writeDailyOutbox(entry);

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), SCORE_TIMEOUT_MS);
  try {
    const response = await fetch(scoreEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry.submission),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (response.status === 403) return { response: null, status: 'denied' };
    if (response.status === 409) {
      writeDailyOutbox(null);
      return { response: null, status: 'closed' };
    }
    if (response.status === 410) {
      writeDailyOutbox(null);
      return { response: null, status: 'expired' };
    }
    if (response.status === 422) {
      writeDailyOutbox(null);
      return { response: null, status: 'rejected' };
    }
    if (!response.ok) return { response: null, status: 'http' };
    let body: Partial<ScoreSubmitResponse>;
    try {
      body = (await response.json()) as Partial<ScoreSubmitResponse>;
    } catch {
      return { response: null, status: 'http' };
    }
    if (
      body.ok !== true ||
      typeof body.ranked !== 'boolean' ||
      typeof body.rulesetVersion !== 'number' ||
      typeof body.campaignVersion !== 'number'
    ) {
      return { response: null, status: 'http' };
    }
    const normalized: ScoreSubmitResponse = {
      ok: true,
      rank: typeof body.rank === 'number' ? body.rank : null,
      ranked: body.ranked,
      rulesetVersion: body.rulesetVersion,
      campaignVersion: body.campaignVersion,
      dailyRunAccepted:
        typeof body.dailyRunAccepted === 'boolean' ? body.dailyRunAccepted : undefined,
    };
    if (normalized.dailyRunAccepted !== true) return { response: null, status: 'rejected' };
    writeDailyOutbox(null);
    return { response: normalized, status: 'ok' };
  } catch {
    return { response: null, status: 'network' };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/** Retry the persisted final Daily submission after reload with the current signed session. */
export async function retryPendingDailySubmission(platform: PlatformAdapter): Promise<void> {
  await retryPendingScoreSubmissions(platform);
  const entry = readDailyOutbox();
  if (!entry || (platform.kind !== 'max' && platform.kind !== 'telegram') || !platform.initData) return;
  const submission = { ...entry.submission, initData: platform.initData, submissionId: entry.submissionId };
  const result = await submitDailySubmissionBody(submission);
  if (result === 'accepted' || result === 'expired' || result === 'rejected') writeDailyOutbox(null);
}

async function retryPendingScoreSubmissions(platform: PlatformAdapter): Promise<void> {
  const pending = readScoreOutbox();
  if (!pending.length) return;
  const remaining: DailyScoreOutboxEntry[] = [];
  for (const entry of pending) {
    if (entry.submission.platform !== 'browser') {
      if ((platform.kind !== 'max' && platform.kind !== 'telegram') || !platform.initData) {
        remaining.push(entry);
        continue;
      }
      entry.submission.initData = platform.initData;
    }
    const response = await postScoreSubmission(entry.submission);
    if (!response) remaining.push(entry);
  }
  writeScoreOutbox(remaining);
}

async function submitDailySubmissionBody(submission: ScoreSubmission): Promise<'accepted' | 'expired' | 'rejected' | 'retry'> {
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
    if (response.status === 410) return 'expired';
    if (response.status === 422) return 'rejected';
    if (!response.ok) return 'retry';
    const body = await response.json() as Partial<ScoreSubmitResponse>;
    return body.ok === true && body.dailyRunAccepted === true ? 'accepted' : 'retry';
  } catch {
    return 'retry';
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function submitDailyRunScore(
  result: RunResult,
  platform: PlatformAdapter,
  ticket: DailyRunTicket
): Promise<ScoreSubmitResponse | null> {
  const { response, status } = await submitDailyRunScoreDetailed(result, platform, ticket);
  return status === 'ok' ? response : null;
}

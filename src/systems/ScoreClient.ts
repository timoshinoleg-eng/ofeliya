import type { RunResult } from '../game/RunContracts';
import type { PlatformAdapter } from '../platform/PlatformBridge';
import type { DailyRunTicket } from './DailyRunClient';
import { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';

export { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';

const ANON_KEY = 'ofeliya_anon_score_id_v1';
const SCORE_OUTBOX_KEY = 'ofeliya_score_outbox_v1';
const DAILY_OUTBOX_KEY = 'ofeliya_daily_score_outbox_v1';
const SCORE_TIMEOUT_MS = 2500;
const MAX_SCORE_OUTBOX_ENTRIES = 8;
const MAX_OUTBOX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ScoreSubmitResponse {
  ok: boolean;
  rank: number | null;
  ranked: boolean;
  rulesetVersion: number;
  campaignVersion: number;
  dailyRunAccepted?: boolean;
}

export interface RunTokenGrant {
  runId: string;
  runToken: string;
  runSeed: string;
  controlMode: RunResult['controlMode'];
  difficultyId: RunResult['difficultyId'];
  rulesetVersion: number;
  campaignVersion: number;
  issuedAt: number;
  expiresAt: number;
}

export interface ScoreSubmission {
  submissionId?: string;
  runToken?: string;
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
  queuedAt?: number;
  ownerId?: string;
}

// Local replay ownership is a routing guard, never server authorization.
function platformOwnerId(platform: PlatformAdapter): string | undefined {
  const id = platform.getUser?.()?.id;
  return id == null ? undefined : String(id);
}

function removeDailyOutboxEntry(submissionId: string): void {
  if (readDailyOutbox()?.submissionId === submissionId) writeDailyOutbox(null);
}

function persistentEntry(entry: DailyScoreOutboxEntry): DailyScoreOutboxEntry {
  const { initData: _launchCredential, ...submission } = entry.submission;
  return { ...entry, submission, queuedAt: entry.queuedAt ?? Date.now() };
}

function outboxEntryExpired(entry: DailyScoreOutboxEntry): boolean {
  return typeof entry.queuedAt === 'number' && Date.now() - entry.queuedAt > MAX_OUTBOX_AGE_MS;
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
    ) {
      if (outboxEntryExpired(parsed)) { writeDailyOutbox(null); return null; }
      const sanitized = persistentEntry(parsed as DailyScoreOutboxEntry);
      // Migration also scrubs credentials written by releases before this fix.
      writeDailyOutbox(sanitized);
      return sanitized;
    }
  } catch {
    // Ignore malformed local data; the daily ticket will be rejected safely by the server.
  }
  return null;
}

function writeDailyOutbox(entry: DailyScoreOutboxEntry | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (entry) localStorage.setItem(DAILY_OUTBOX_KEY, JSON.stringify(persistentEntry(entry)));
    else localStorage.removeItem(DAILY_OUTBOX_KEY);
  } catch {
    // The current page still attempts the submission; retry is unavailable in restricted storage.
  }
}

function readScoreOutbox(): DailyScoreOutboxEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SCORE_OUTBOX_KEY) ?? '[]');
    const sanitized = Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry?.submissionId === 'string' && entry.submission?.payload && !outboxEntryExpired(entry))
        .map(persistentEntry)
      : [];
    writeScoreOutbox(sanitized);
    return sanitized;
  } catch {
    return [];
  }
}

function writeScoreOutbox(entries: DailyScoreOutboxEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const bounded = entries.slice(-MAX_SCORE_OUTBOX_ENTRIES).map(persistentEntry);
    if (bounded.length) localStorage.setItem(SCORE_OUTBOX_KEY, JSON.stringify(bounded));
    else localStorage.removeItem(SCORE_OUTBOX_KEY);
  } catch {
    // Submission is still attempted; persistence is best-effort on restricted WebViews.
  }
}

function removeScoreOutboxEntry(submissionId: string): void {
  // Read and write synchronously in this page's JS turn. Never write the pre-fetch
  // snapshot: submit/retry may have appended or removed entries during the await.
  writeScoreOutbox(readScoreOutbox().filter((entry) => entry.submissionId !== submissionId));
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

function runStartEndpoint(): string {
  if (typeof window === 'undefined') return 'api/run/start';
  return new URL('api/run/start', window.location.href).toString();
}

export async function beginRunCapability(
  platform: PlatformAdapter,
  run: Pick<RunResult, 'runSeed' | 'controlMode' | 'difficultyId'>
): Promise<RunTokenGrant | null> {
  if (
    run.difficultyId !== 'standard' ||
    (platform.kind !== 'max' && platform.kind !== 'telegram') ||
    !platform.initData
  ) {
    return null;
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), SCORE_TIMEOUT_MS);
  try {
    const response = await fetch(runStartEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: platform.kind,
        initData: platform.initData,
        run: {
          rulesetVersion: SCORE_RULESET_VERSION,
          campaignVersion: SCORE_CAMPAIGN_VERSION,
          difficultyId: run.difficultyId,
          runSeed: run.runSeed,
          controlMode: run.controlMode,
        },
      }),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const body = await response.json() as { ok?: boolean; grant?: Partial<RunTokenGrant> };
    const grant = body.grant;
    if (
      body.ok !== true ||
      !grant ||
      typeof grant.runId !== 'string' ||
      typeof grant.runToken !== 'string' ||
      grant.runSeed !== run.runSeed ||
      grant.controlMode !== run.controlMode ||
      grant.difficultyId !== run.difficultyId ||
      grant.rulesetVersion !== SCORE_RULESET_VERSION ||
      grant.campaignVersion !== SCORE_CAMPAIGN_VERSION ||
      typeof grant.issuedAt !== 'number' ||
      typeof grant.expiresAt !== 'number'
    ) {
      return null;
    }
    return grant as RunTokenGrant;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
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

type ScorePostOutcome =
  | { status: 'accepted'; response: ScoreSubmitResponse }
  | { status: 'rejected' | 'retry' };

async function postScoreSubmission(
  submission: ScoreSubmission
): Promise<ScorePostOutcome> {
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
    // These statuses reject this exact score permanently (ID conflict, expired
    // capability, invalid contract). Capacity 503 and other failures remain retryable.
    if (response.status === 409 || response.status === 410 || response.status === 422) {
      return { status: 'rejected' };
    }
    if (!response.ok) return { status: 'retry' };
    const body = (await response.json()) as Partial<ScoreSubmitResponse>;
    if (
      body.ok !== true ||
      typeof body.ranked !== 'boolean' ||
      typeof body.rulesetVersion !== 'number' ||
      typeof body.campaignVersion !== 'number'
    ) {
      return { status: 'retry' };
    }
    return {
      status: 'accepted',
      response: {
        ok: true,
        rank: typeof body.rank === 'number' ? body.rank : null,
        ranked: body.ranked,
        rulesetVersion: body.rulesetVersion,
        campaignVersion: body.campaignVersion,
        dailyRunAccepted:
          typeof body.dailyRunAccepted === 'boolean' ? body.dailyRunAccepted : undefined,
      },
    };
  } catch {
    return { status: 'retry' };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function submitRunScore(
  result: RunResult,
  platform: PlatformAdapter,
  runGrant?: RunTokenGrant | null
): Promise<ScoreSubmitResponse | null> {
  // Local checkpoint state is not server-authoritative. Never let a resumed Standard run
  // enter the canonical score submission path.
  if (result.resumed) return null;
  const submission = buildScoreSubmission(result, platform);
  // A messenger result without signed initData must never be downgraded to an anonymous trusted score.
  if (submission.platform !== 'browser' && !submission.initData) return null;
  const entry: DailyScoreOutboxEntry = {
    submissionId: createSubmissionId(),
    ownerId: platformOwnerId(platform),
    submission: { ...submission },
  };
  entry.submission.submissionId = entry.submissionId;
  if (
    runGrant &&
    runGrant.runSeed === result.runSeed &&
    runGrant.controlMode === result.controlMode &&
    runGrant.difficultyId === result.difficultyId &&
    runGrant.rulesetVersion === SCORE_RULESET_VERSION &&
    runGrant.campaignVersion === SCORE_CAMPAIGN_VERSION &&
    runGrant.expiresAt > Date.now()
  ) {
    entry.submission.runToken = runGrant.runToken;
  }
  const outbox = readScoreOutbox();
  outbox.push(entry);
  writeScoreOutbox(outbox);
  const outcome = await postScoreSubmission(entry.submission);
  if (outcome.status !== 'retry') removeScoreOutboxEntry(entry.submissionId);
  return outcome.status === 'accepted' ? outcome.response : null;
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

  let previous = readDailyOutbox();
  // The single Daily slot cannot reassign an old/unknown owner's result or block
  // a new account's run. An explicit new submission supersedes that local slot.
  if (previous && (previous.submission.platform !== submission.platform || previous.ownerId == null || previous.ownerId !== platformOwnerId(platform))) {
    removeDailyOutboxEntry(previous.submissionId);
    previous = null;
  }
  if (previous && previous.submission.payload.dailyRunId !== ticket.runId) {
    return { response: null, status: 'network' };
  }
  const entry = previous ?? {
    submissionId: createSubmissionId(),
    ownerId: platformOwnerId(platform),
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
      removeDailyOutboxEntry(entry.submissionId);
      return { response: null, status: 'closed' };
    }
    if (response.status === 410) {
      removeDailyOutboxEntry(entry.submissionId);
      return { response: null, status: 'expired' };
    }
    if (response.status === 422) {
      removeDailyOutboxEntry(entry.submissionId);
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
    removeDailyOutboxEntry(entry.submissionId);
    return { response: normalized, status: 'ok' };
  } catch {
    return { response: null, status: 'network' };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/** Retry persisted score submissions after boot without delaying the playable startup path. */
export async function retryPendingDailySubmission(platform: PlatformAdapter): Promise<void> {
  const dailyEntry = readDailyOutbox();
  if (
    dailyEntry &&
    (platform.kind === 'max' || platform.kind === 'telegram') &&
    dailyEntry.submission.platform === platform.kind &&
    dailyEntry.ownerId != null && dailyEntry.ownerId === platformOwnerId(platform) &&
    platform.initData
  ) {
    const submission = {
      ...dailyEntry.submission,
      initData: platform.initData,
      submissionId: dailyEntry.submissionId,
    };
    const result = await submitDailySubmissionBody(submission);
    if (result === 'accepted' || result === 'expired' || result === 'rejected') {
      removeDailyOutboxEntry(dailyEntry.submissionId);
    } else {
      // If the network is unhealthy, do not immediately spend more timeout budget
      // replaying lower-priority ordinary scores.
      return;
    }
  }

  await retryPendingScoreSubmissions(platform);
}

async function retryPendingScoreSubmissions(platform: PlatformAdapter): Promise<void> {
  const pending = readScoreOutbox();
  for (const entry of pending) {
    // Another submission/retry can settle an entry or evict it at the queue bound.
    if (!readScoreOutbox().some((item) => item.submissionId === entry.submissionId)) continue;
    const submission = { ...entry.submission, submissionId: entry.submissionId };
    if (submission.platform !== 'browser') {
      if (submission.platform !== platform.kind || !platform.initData ||
          entry.ownerId == null || entry.ownerId !== platformOwnerId(platform)) {
        continue;
      }
      submission.initData = platform.initData;
    }
    const outcome = await postScoreSubmission(submission);
    if (outcome.status === 'retry') break;
    removeScoreOutboxEntry(entry.submissionId);
  }
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
    if (response.status === 409 || response.status === 422) return 'rejected';
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

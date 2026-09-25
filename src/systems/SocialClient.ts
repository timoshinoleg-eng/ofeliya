import type { PlatformAdapter } from '../platform/PlatformBridge';

const SOCIAL_TIMEOUT_MS = 2500;

export interface SocialTopEntry {
  rank: number;
  platform: string;
  daily: boolean;
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  dateKey: string;
  rulesetVersion: number;
  campaignVersion: number;
  difficultyId: string;
  completionStage: string | null;
}

export interface SeasonSnapshot {
  index: number;
  start: number;
  end: number;
  daysLeft: number;
}

export interface FriendSnapshot {
  relation: 'invited' | 'inviter' | 'both';
  platform: string;
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  dateKey: string;
}

export interface DailySnapshot {
  dateKey: string | null;
  total: number;
  rank: number | null;
  you: {
    win: boolean;
    timeMs: number;
    kills: number;
    rulesetVersion: number;
  } | null;
}

export interface SocialSnapshot {
  season: SeasonSnapshot | null;
  seasonTop: SocialTopEntry[];
  daily: DailySnapshot | null;
  friends: FriendSnapshot[];
}

function apiUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.href).toString();
}

export type RemoteStatus = 'ok' | 'empty' | 'http' | 'network' | 'skipped';

export interface SocialChannelStatus {
  season: RemoteStatus;
  seasonTop: RemoteStatus;
  daily: RemoteStatus;
  friends: RemoteStatus;
}

export interface SocialSnapshotDetailed {
  snapshot: SocialSnapshot;
  status: SocialChannelStatus;
}

type FetchOutcome<T> =
  | { kind: 'data'; data: T }
  | { kind: 'http' }
  | { kind: 'network' };

async function fetchJsonOutcome<T>(
  path: string,
  platform?: PlatformAdapter,
  authenticated = false
): Promise<FetchOutcome<T>> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), SOCIAL_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(path), {
      method: authenticated ? 'POST' : 'GET',
      headers: authenticated ? { 'Content-Type': 'application/json' } : undefined,
      body: authenticated && platform
        ? JSON.stringify({ platform: platform.kind, initData: platform.initData })
        : undefined,
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) return { kind: 'http' };
    try {
      return { kind: 'data', data: (await response.json()) as T };
    } catch {
      return { kind: 'http' };
    }
  } catch {
    return { kind: 'network' };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

type ChannelAssessment = 'ok' | 'empty' | 'malformed';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve the remote status for a single channel.
 *
 * 'empty' is reserved for a valid, documented 2xx shape that simply carries no
 * records. Malformed 2xx payloads (wrong structure) and unaccepted 2xx payloads
 * (ok !== true) are reported as the closest error status ('http') so they can
 * never be mistaken for a legitimate empty board. A null outcome means the
 * request was never attempted (identity precondition) -> 'skipped'.
 */
function resolveRemoteStatus(
  outcome: FetchOutcome<unknown> | null,
  assess: (data: unknown) => ChannelAssessment
): RemoteStatus {
  if (outcome == null) return 'skipped';
  if (outcome.kind === 'network') return 'network';
  if (outcome.kind === 'http') return 'http';
  const assessment = assess(outcome.data);
  return assessment === 'malformed' ? 'http' : assessment;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSeasonSnapshot(value: unknown): value is SeasonSnapshot {
  return (
    isRecord(value) &&
    isFiniteNumber(value.index) &&
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.end) &&
    isFiniteNumber(value.daysLeft)
  );
}

function isTopEntry(value: unknown): value is SocialTopEntry {
  return (
    isRecord(value) &&
    isFiniteNumber(value.rank) &&
    typeof value.platform === 'string' &&
    typeof value.daily === 'boolean' &&
    typeof value.win === 'boolean' &&
    isFiniteNumber(value.timeMs) &&
    isFiniteNumber(value.kills) &&
    isFiniteNumber(value.level) &&
    typeof value.dateKey === 'string' &&
    isFiniteNumber(value.rulesetVersion) &&
    isFiniteNumber(value.campaignVersion) &&
    typeof value.difficultyId === 'string' &&
    (value.completionStage === null || typeof value.completionStage === 'string')
  );
}

function isDailySnapshot(value: unknown): value is DailySnapshot {
  if (!isRecord(value)) return false;
  if (!(value.dateKey === null || typeof value.dateKey === 'string')) return false;
  if (!isFiniteNumber(value.total)) return false;
  if (!(value.rank === null || isFiniteNumber(value.rank))) return false;
  if (value.you === null) return true;
  return (
    isRecord(value.you) &&
    typeof value.you.win === 'boolean' &&
    isFiniteNumber(value.you.timeMs) &&
    isFiniteNumber(value.you.kills) &&
    isFiniteNumber(value.you.rulesetVersion)
  );
}

function isFriendSnapshot(value: unknown): value is FriendSnapshot {
  return (
    isRecord(value) &&
    (value.relation === 'invited' || value.relation === 'inviter' || value.relation === 'both') &&
    typeof value.platform === 'string' &&
    typeof value.win === 'boolean' &&
    isFiniteNumber(value.timeMs) &&
    isFiniteNumber(value.kills) &&
    isFiniteNumber(value.level) &&
    typeof value.dateKey === 'string'
  );
}

function assessSeason(data: unknown): ChannelAssessment {
  if (!isRecord(data) || data.ok !== true) return 'malformed';
  if (data.season == null) return 'empty';
  return isSeasonSnapshot(data.season) ? 'ok' : 'malformed';
}

function assessSeasonTop(data: unknown): ChannelAssessment {
  if (!isRecord(data) || data.ok !== true) return 'malformed';
  const top = data.top;
  if (top == null) return 'empty';
  if (!Array.isArray(top) || !top.every(isTopEntry)) return 'malformed';
  return top.length > 0 ? 'ok' : 'empty';
}

function assessDaily(data: unknown): ChannelAssessment {
  if (!isRecord(data) || data.ok !== true || !isDailySnapshot(data)) return 'malformed';
  return data.dateKey === null ? 'empty' : 'ok';
}

function assessFriends(data: unknown): ChannelAssessment {
  if (!isRecord(data) || data.ok !== true) return 'malformed';
  const friends = data.friends;
  if (friends == null) return 'empty';
  if (!Array.isArray(friends) || !friends.every(isFriendSnapshot)) return 'malformed';
  return friends.length > 0 ? 'ok' : 'empty';
}

export function socialIdentity(platform: PlatformAdapter): {
  platform: 'max' | 'telegram';
  user: string;
} | null {
  if (platform.kind !== 'max' && platform.kind !== 'telegram') return null;
  const user = platform.getUser();
  if (user?.id == null) return null;
  const id = String(user.id);
  if (!id || id.length > 128) return null;
  return { platform: platform.kind, user: id };
}

export function socialRequestPaths(platform: PlatformAdapter): {
  season: string;
  seasonTop: string;
  daily: string | null;
  friends: string | null;
} {
  const identity = socialIdentity(platform);
  return {
    season: 'api/season',
    seasonTop: 'api/top?period=season',
    daily: identity ? 'api/daily' : null,
    friends: identity ? 'api/friends' : null,
  };
}

/**
 * Additive, non-breaking variant of loadSocialSnapshot that also reports a
 * per-channel remote status. The snapshot field is byte-for-byte identical to
 * what loadSocialSnapshot returns for the same responses.
 */
export async function loadSocialSnapshotDetailed(
  platform: PlatformAdapter
): Promise<SocialSnapshotDetailed> {
  const paths = socialRequestPaths(platform);
  const [seasonOutcome, topOutcome, dailyOutcome, friendsOutcome] = await Promise.all([
    fetchJsonOutcome<{ ok?: boolean; season?: SeasonSnapshot }>(paths.season),
    fetchJsonOutcome<{ ok?: boolean; top?: SocialTopEntry[] }>(paths.seasonTop),
    paths.daily
      ? fetchJsonOutcome<{ ok?: boolean } & DailySnapshot>(paths.daily, platform, true)
      : Promise.resolve(null),
    paths.friends
      ? fetchJsonOutcome<{ ok?: boolean; friends?: FriendSnapshot[] }>(paths.friends, platform, true)
      : Promise.resolve(null),
  ]);

  const seasonData = seasonOutcome?.kind === 'data' ? seasonOutcome.data : null;
  const topData = topOutcome?.kind === 'data' ? topOutcome.data : null;
  const dailyData = dailyOutcome?.kind === 'data' ? dailyOutcome.data : null;
  const friendsData = friendsOutcome?.kind === 'data' ? friendsOutcome.data : null;

  const snapshot: SocialSnapshot = {
    season: seasonData?.ok === true && seasonData.season ? seasonData.season : null,
    seasonTop: topData?.ok === true && Array.isArray(topData.top) ? topData.top : [],
    daily: dailyData?.ok === true ? dailyData : null,
    friends:
      friendsData?.ok === true && Array.isArray(friendsData.friends)
        ? friendsData.friends
        : [],
  };

  return {
    snapshot,
    status: {
      season: resolveRemoteStatus(seasonOutcome, assessSeason),
      seasonTop: resolveRemoteStatus(topOutcome, assessSeasonTop),
      daily: resolveRemoteStatus(dailyOutcome, assessDaily),
      friends: resolveRemoteStatus(friendsOutcome, assessFriends),
    },
  };
}

export async function loadSocialSnapshot(platform: PlatformAdapter): Promise<SocialSnapshot> {
  const { snapshot } = await loadSocialSnapshotDetailed(platform);
  return snapshot;
}

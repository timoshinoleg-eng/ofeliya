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

async function fetchJson<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), SOCIAL_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(path), {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
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
  const query = identity
    ? `user=${encodeURIComponent(identity.user)}&platform=${identity.platform}`
    : '';
  return {
    season: 'api/season',
    seasonTop: 'api/top?period=season',
    daily: identity ? `api/daily?${query}` : null,
    friends: identity ? `api/friends?${query}` : null,
  };
}

export async function loadSocialSnapshot(platform: PlatformAdapter): Promise<SocialSnapshot> {
  const paths = socialRequestPaths(platform);
  const [seasonResponse, topResponse, dailyResponse, friendsResponse] = await Promise.all([
    fetchJson<{ ok?: boolean; season?: SeasonSnapshot }>(paths.season),
    fetchJson<{ ok?: boolean; top?: SocialTopEntry[] }>(paths.seasonTop),
    paths.daily ? fetchJson<{ ok?: boolean } & DailySnapshot>(paths.daily) : Promise.resolve(null),
    paths.friends
      ? fetchJson<{ ok?: boolean; friends?: FriendSnapshot[] }>(paths.friends)
      : Promise.resolve(null),
  ]);

  return {
    season: seasonResponse?.ok === true && seasonResponse.season ? seasonResponse.season : null,
    seasonTop: topResponse?.ok === true && Array.isArray(topResponse.top) ? topResponse.top : [],
    daily: dailyResponse?.ok === true ? dailyResponse : null,
    friends:
      friendsResponse?.ok === true && Array.isArray(friendsResponse.friends)
        ? friendsResponse.friends
        : [],
  };
}

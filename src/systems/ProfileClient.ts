import type { PlatformAdapter } from '../platform/PlatformBridge';
import type { SaveData } from './SaveSystem';

/**
 * Server profile foundation V1 client.
 *
 * Read-only + one-time migration claim. Kept deliberately separate from
 * ScoreClient/DailyRunClient: profiles are advisory and must never influence
 * the ranked score path. Any non-conforming response yields `null` — the game
 * must keep working without a profile, never crash on one.
 */

const PROFILE_TIMEOUT_MS = 3000;
const profileReadCache = new WeakMap<PlatformAdapter, Promise<ServerProfile | null>>();

export interface ProfilePreferences {
  muted?: boolean;
  controlMode?: string;
  difficultyId?: string;
}

export interface ProfileRecords {
  bestSurvivalMs: number;
  bestBoss1ClearMs: number;
  bestCampaignClearMs: number;
  bestKills: number;
  bestLevel: number;
  runs: number;
  totalKills: number;
  achievements: string[];
  migrated: boolean;
}

export type ProfileItemSource = 'grant' | 'migration' | 'promo';

export interface ProfileInventoryItem {
  source: ProfileItemSource;
  grantedAt: number;
}

export interface ProfileInventory {
  schemaVersion: number;
  items: Record<string, ProfileInventoryItem>;
}

export interface ServerProfile {
  profileVersion: number;
  createdAt: number;
  updatedAt: number;
  preferences: ProfilePreferences;
  records: ProfileRecords;
  inventory: ProfileInventory;
}

export interface MigrationClaim {
  claimed: boolean;
  profile: ServerProfile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function profileEndpoint(path = ''): string {
  if (typeof window === 'undefined') return `api/profile${path}`;
  return new URL(`api/profile${path}`, window.location.href).toString();
}

/** Signed identity only; browser/no-initData never reaches the network. */
function verifiedIdentity(platform: PlatformAdapter): {
  platform: 'max' | 'telegram';
  initData: string;
} | null {
  if ((platform.kind !== 'max' && platform.kind !== 'telegram') || !platform.initData) return null;
  return { platform: platform.kind, initData: platform.initData };
}

async function postProfileJson(url: string, body: unknown): Promise<unknown | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

const PROFILE_ITEM_SOURCES: ProfileItemSource[] = ['grant', 'migration', 'promo'];

/**
 * Strict DTO parsing. The server contract is additive-only within
 * `profileVersion`, so unknown keys are tolerated — but any wrong-typed known
 * field, or any raw identity field (`uid`/`userKey`/`initData`) in a public
 * payload, invalidates the whole response.
 */
function parseServerProfile(value: unknown): ServerProfile | null {
  if (!isRecord(value)) return null;
  if ('uid' in value || 'userKey' in value || 'initData' in value) return null;
  const { profileVersion, createdAt, updatedAt, preferences, records, inventory } = value;
  if (!isFiniteNonNegative(profileVersion) || profileVersion < 1) return null;
  if (!isFiniteNonNegative(createdAt) || !isFiniteNonNegative(updatedAt)) return null;
  if (!isRecord(preferences)) return null;
  if (!isRecord(records)) return null;
  for (const key of [
    'bestSurvivalMs',
    'bestBoss1ClearMs',
    'bestCampaignClearMs',
    'bestKills',
    'bestLevel',
    'runs',
    'totalKills',
  ]) {
    if (!isFiniteNonNegative(records[key])) return null;
  }
  if (
    !Array.isArray(records.achievements) ||
    !records.achievements.every((id) => typeof id === 'string')
  ) {
    return null;
  }
  if (typeof records.migrated !== 'boolean') return null;
  if (!isRecord(inventory)) return null;
  if (!isFiniteNonNegative(inventory.schemaVersion) || inventory.schemaVersion < 1) return null;
  if (!isRecord(inventory.items)) return null;
  for (const item of Object.values(inventory.items)) {
    if (!isRecord(item)) return null;
    if (!PROFILE_ITEM_SOURCES.includes(item.source as ProfileItemSource)) return null;
    if (!isFiniteNonNegative(item.grantedAt)) return null;
  }
  return value as unknown as ServerProfile;
}

function parseProfileResponse(
  raw: unknown
): { profile: ServerProfile; claimed?: boolean } | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const profile = parseServerProfile(raw.profile);
  if (!profile) return null;
  if (raw.claimed === undefined) return { profile };
  return typeof raw.claimed === 'boolean' ? { profile, claimed: raw.claimed } : null;
}

/**
 * Clamp a local SaveSystem snapshot into the V1 advisory migration payload.
 * Legacy aliases follow the SaveSystem constructor rules: `bestTimeMs` folds
 * into survival history, `bestWinTimeMs` only into the IMMUNE PRIME record —
 * never invented as a full campaign clear.
 */
export function buildMigrationSave(save: SaveData): Record<string, unknown> {
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  const survival = num(save.bestSurvivalMs) || num(save.bestTimeMs);
  const boss1Clear = num(save.bestBoss1ClearMs) || num(save.bestWinTimeMs);
  return {
    bestSurvivalMs: survival,
    bestBoss1ClearMs: boss1Clear,
    bestCampaignClearMs: num(save.bestCampaignClearMs),
    bestKills: num(save.bestKills),
    bestLevel: num(save.bestLevel),
    runs: num(save.runs),
    totalKills: num(save.totalKills),
    achievements: Array.isArray(save.achievements)
      ? save.achievements.filter((id): id is string => typeof id === 'string')
      : [],
    muted: save.muted === true,
  };
}

/** Verified profile read. Stable/idempotent; `null` on any failure. */
export async function fetchServerProfile(
  platform: PlatformAdapter
): Promise<ServerProfile | null> {
  const identity = verifiedIdentity(platform);
  if (!identity) return null;

  const cached = profileReadCache.get(platform);
  if (cached) return cached;

  const request = (async () => {
    const parsed = parseProfileResponse(await postProfileJson(profileEndpoint(), identity));
    if (!parsed) {
      profileReadCache.delete(platform);
      return null;
    }
    return parsed.profile;
  })();
  profileReadCache.set(platform, request);
  return request;
}

/**
 * One-time advisory migration claim. The server treats the first valid claim as
 * binding; a later call returns the stored profile with `claimed:false`.
 * Migrated records are advisory only — never ranked, never paid value.
 */
export async function migrateLocalSave(
  platform: PlatformAdapter,
  save: SaveData
): Promise<MigrationClaim | null> {
  const identity = verifiedIdentity(platform);
  if (!identity) return null;
  const parsed = parseProfileResponse(
    await postProfileJson(profileEndpoint('/migrate'), {
      ...identity,
      save: buildMigrationSave(save),
    })
  );
  if (!parsed || typeof parsed.claimed !== 'boolean') return null;
  profileReadCache.set(platform, Promise.resolve(parsed.profile));
  return { claimed: parsed.claimed, profile: parsed.profile };
}

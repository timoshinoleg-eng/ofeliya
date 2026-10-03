#!/usr/bin/env node
/**
 * OFELIYA score-server (V3). НОЛЬ внешних зависимостей: node:http + crypto + fs.
 *
 * Задачи:
 *  - валидация initData (Telegram / MAX): HMAC-SHA256, окно auth_date 24h;
 *  - приём результатов (/api/score) с анти-читом (пороги, дедупликация по best);
 *  - топы: global / daily / weekly (/api/top) — топ-100, по best на юзера;
 *  - рефералы: граф «кто кого позвал» (/api/ref), награда за реф — один раз.
 *
 * Хранение: JSON-файл (атомарная запись tmp+rename) — достаточно для мини-апп
 * нагрузки. При росте — перенос в PocketBase/SQLite без изменения API
 * (см. README «Бэкенд»).
 *
 * Запуск: node server/index.mjs
 *   env: PORT=8787, DATA_DIR=server/data, TG_BOT_TOKEN,
 *        MAX_BOT_TOKEN (отдельный токен приложения, без shared fallback)
 */
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveTelegramPreparedMessage } from './telegram-share.mjs';
import { telegramApiJson } from './telegram-api.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'server', 'data');
const TG_TOKEN = process.env.TG_BOT_TOKEN ?? '';
// MAX initData не содержит app audience. A shared bot token would authenticate
// launch data from every Mini App attached to that bot, so fail closed without
// the dedicated application token.
const MAX_TOKEN = process.env.MAX_BOT_TOKEN ?? '';
// V6-server: секрет VK Mini Apps (Apps → Настройки → «Секретный ключ»).
// Пусто — VK-скоры остаются unverified (как browser). Задан — web_app_t
// валидируется и VK-скоры попадают в верифицированный общий топ.
const VK_SECURE_KEY = process.env.VK_SECURE_KEY ?? '';
const GAME_URL = process.env.GAME_URL ?? '';
const TELEGRAM_SHARE_COOLDOWN_MS = 2_500;
const telegramShareLastAt = new Map();

// ---------- сезон (C5) ----------
// Сезон = фиксированное окно от EPOCH (по умолчанию 2026-09-01), длина по
// умолчанию 14 дней. Сезонный топ считает только скоры, отправленные в текущее
// окно; при переходе к новому индексу — «лидерборд сбрасывается» (честная
// конкуренция внутри сезона). Настраивается env для теста/сдвига.
const SEASON_EPOCH_MS = Number(process.env.SEASON_EPOCH_MS ?? Date.UTC(2026, 8, 1));
const SEASON_DAYS = Number(process.env.SEASON_DAYS ?? 14);
const SEASON_LEN_MS = SEASON_DAYS * 86_400_000;

function currentSeason(now = Date.now()) {
  const index = Math.floor((now - SEASON_EPOCH_MS) / SEASON_LEN_MS);
  const start = SEASON_EPOCH_MS + index * SEASON_LEN_MS;
  const end = start + SEASON_LEN_MS;
  return {
    index,
    start,
    end,
    daysLeft: Math.max(0, Math.ceil((end - now) / 86_400_000)),
  };
}

// ---------- score ruleset / anti-cheat ----------
export const CURRENT_RULESET_VERSION = 2;
export const CURRENT_CAMPAIGN_VERSION = 2;

const ANTI_CHEAT = {
  // Legacy v1 represented the historical single-act Bloodstream clear.
  legacyMinWinTimeMs: 300_000,
  // Ruleset v2 is the two-act Bloodstream (5:00) + Heart (4:00) campaign.
  // Boss fights only add time, so a campaign win below 9:00 is impossible.
  campaignMinWinTimeMs: 540_000,
  maxTimeMs: 3_600_000,
  maxKillsPerSec: 30,
  maxLevel: 100,
  maxHostCellsInfected: 100_000,
};

const RUN_SEED_RE = /^[A-Za-z0-9_-]{1,32}$/;
const DIFFICULTY_IDS = new Set(['standard', 'strained']);
const CONTROL_MODES = new Set(['one-hand', 'two-hand', 'dual-move']);
const COMPLETION_STAGES = new Set(['bloodstream', 'heart']);

const DUEL_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const DUEL_TTL_MS = 7 * 86_400_000;
const MAX_DUELS = 5_000;
const MAX_DUEL_ATTEMPTS = 20_000;
const MAX_DUEL_EVENTS = 30_000;

function storedRulesetVersion(score) {
  return Number.isInteger(score?.rulesetVersion) ? score.rulesetVersion : 1;
}

function parseRulesetFilter(raw, fallback = CURRENT_RULESET_VERSION) {
  if (raw == null || raw === '') return fallback;
  if (raw === 'all') return null;
  if (raw === 'legacy') return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= CURRENT_RULESET_VERSION ? n : fallback;
}

function parseScoreContract(payload) {
  if (payload.rulesetVersion == null) {
    return {
      ok: true,
      contract: {
        rulesetVersion: 1,
        campaignVersion: 1,
        difficultyId: 'standard',
        completionStage: payload.win === true ? 'bloodstream' : null,
        runSeed: null,
        controlMode: null,
        bossesDefeated: payload.win === true ? 1 : 0,
        boss1ClearMs: payload.win === true ? Math.round(payload.timeMs) : null,
        hostCellsInfected: null,
        rankedEligible: true,
        legacy: true,
      },
    };
  }

  if (payload.rulesetVersion !== CURRENT_RULESET_VERSION) {
    return { ok: false, error: 'ruleset' };
  }
  if (payload.campaignVersion !== CURRENT_CAMPAIGN_VERSION) {
    return { ok: false, error: 'campaign' };
  }
  if (!DIFFICULTY_IDS.has(payload.difficultyId)) {
    return { ok: false, error: 'difficulty' };
  }
  if (!COMPLETION_STAGES.has(payload.completionStage)) {
    return { ok: false, error: 'completion-stage' };
  }
  if (typeof payload.runSeed !== 'string' || !RUN_SEED_RE.test(payload.runSeed)) {
    return { ok: false, error: 'seed' };
  }
  if (!CONTROL_MODES.has(payload.controlMode)) {
    return { ok: false, error: 'control-mode' };
  }
  if (!Number.isInteger(payload.bossesDefeated) || payload.bossesDefeated < 0 || payload.bossesDefeated > 2) {
    return { ok: false, error: 'bosses-defeated' };
  }
  if (
    payload.boss1ClearMs != null &&
    (!Number.isFinite(payload.boss1ClearMs) || payload.boss1ClearMs < 300_000 || payload.boss1ClearMs > payload.timeMs)
  ) {
    return { ok: false, error: 'boss1-clear' };
  }
  if (
    !Number.isInteger(payload.hostCellsInfected) ||
    payload.hostCellsInfected < 0 ||
    payload.hostCellsInfected > ANTI_CHEAT.maxHostCellsInfected
  ) {
    return { ok: false, error: 'host-cells' };
  }

  return {
    ok: true,
    contract: {
      rulesetVersion: CURRENT_RULESET_VERSION,
      campaignVersion: CURRENT_CAMPAIGN_VERSION,
      difficultyId: payload.difficultyId,
      completionStage: payload.completionStage,
      runSeed: payload.runSeed,
      controlMode: payload.controlMode,
      bossesDefeated: payload.bossesDefeated,
      boss1ClearMs: payload.boss1ClearMs == null ? null : Math.round(payload.boss1ClearMs),
      hostCellsInfected: payload.hostCellsInfected,
      rankedEligible: payload.difficultyId === 'standard',
      legacy: false,
    },
  };
}

// ---------- store ----------
mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = join(DATA_DIR, 'store.json');
const MAX_SCORES = 20_000;
const MAX_REFS = 10_000;
const MAX_ANALYTICS_EVENTS = 20_000;
const ANALYTICS_RATE_WINDOW_MS = 60_000;
const ANALYTICS_RATE_LIMIT = 60;
const analyticsRateByActor = new Map();

// Production hardening: every state-changing surface gets an actor bucket plus
// a deliberately looser IP backstop. The 12x ratio avoids turning carrier-grade
// NAT into a shared denial-of-service switch while still bounding floods.
const WRITE_RATE_WINDOW_MS = 60_000;
const configuredWriteRateLimit = Number.parseInt(process.env.WRITE_RATE_LIMIT ?? '', 10);
const WRITE_RATE_LIMIT =
  Number.isInteger(configuredWriteRateLimit) && configuredWriteRateLimit > 0
    ? configuredWriteRateLimit
    : 20;
const WRITE_IP_RATE_LIMIT = WRITE_RATE_LIMIT * 12;
const writeRateByActor = new Map();
const writeRateByIp = new Map();

const MAX_RUN_GRANTS = 10_000;
const RUN_GRANT_TTL_MS = 2 * 60 * 60 * 1000;
const RUN_WALL_CLOCK_GRACE_MS = 15_000;
const RUN_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

const MAX_DAILY_RUNS = 10_000;
const DAILY_RUN_TTL_MS = 2 * 60 * 60 * 1000;
const DAILY_RUN_GRACE_MS = 30 * 60 * 1000;
const DAILY_RUN_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const PRODUCT_EVENTS = new Set([
  'app_open', 'run_start', 'run_60s', 'boss1', 'heart', 'death',
  'win', 'replay', 'share', 'daily', 'referral',
  'first_enemy_hit', 'first_enemy_kill', 'first_rna_pickup',
  'first_mutation_opened', 'first_mutation_selected',
  'host_cell_approached', 'infection_started', 'infection_interrupted',
  'infection_resumed', 'first_lysis', 'second_host_cell_completed_without_hint',
  'onboarding_step', 'onboarding_exit',
]);

function emptyStore() {
  return {
    scores: [],
    refs: [],
    refRewards: {},
    duels: [],
    duelAttempts: [],
    duelEvents: [],
    analyticsEvents: [],
    runGrants: [],
    dailyRuns: [],
  };
}

function loadStore() {
  let raw;
  try {
    raw = readFileSync(STORE_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('store.json must contain an object; refusing to reset persisted data');
  }
  const arrays = ['scores', 'refs', 'duels', 'duelAttempts', 'duelEvents', 'analyticsEvents', 'runGrants', 'dailyRuns'];
  for (const key of arrays) {
    if (parsed[key] != null && !Array.isArray(parsed[key])) {
      throw new Error(`store.json field ${key} is invalid; refusing to reset persisted data`);
    }
  }
  if (parsed.refRewards != null && (!parsed.refRewards || typeof parsed.refRewards !== 'object' || Array.isArray(parsed.refRewards))) {
    throw new Error('store.json field refRewards is invalid; refusing to reset persisted data');
  }
  return {
    scores: parsed.scores ?? [],
    refs: parsed.refs ?? [],
    refRewards: parsed.refRewards ?? {},
    duels: parsed.duels ?? [],
    duelAttempts: parsed.duelAttempts ?? [],
    duelEvents: parsed.duelEvents ?? [],
    analyticsEvents: parsed.analyticsEvents ?? [],
    runGrants: parsed.runGrants ?? [],
    dailyRuns: parsed.dailyRuns ?? [],
  };
}

let store = loadStore();
function writeJsonAtomically(file, value) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    writeFileSync(tmp, JSON.stringify(value), { flag: 'wx' });
    fd = openSync(tmp, 'r+');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, file);
    try {
      const directoryFd = openSync(dirname(file), 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } catch (error) {
      if (!['EINVAL', 'EPERM', 'EISDIR', 'EBADF'].includes(error.code)) throw error;
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    throw error;
  }
}

const configuredStoreSaveDelayMs = Number.parseInt(process.env.STORE_SAVE_DELAY_MS ?? '', 10);
const STORE_SAVE_DELAY_MS =
  Number.isInteger(configuredStoreSaveDelayMs) && configuredStoreSaveDelayMs >= 0
    ? configuredStoreSaveDelayMs
    : 250;
const STORE_SAVE_RETRY_MS = Math.max(250, STORE_SAVE_DELAY_MS);

let storeSaveTimer = null;
let storeDirty = false;
let lastStoreFlushAt = 0;
let lastStoreFlushError = null;

export function flushStoreNow() {
  if (storeSaveTimer) {
    clearTimeout(storeSaveTimer);
    storeSaveTimer = null;
  }
  if (!storeDirty) return false;
  try {
    writeJsonAtomically(STORE_FILE, store);
    storeDirty = false;
    lastStoreFlushAt = Date.now();
    lastStoreFlushError = null;
    return true;
  } catch (error) {
    lastStoreFlushError = error?.message ?? String(error);
    throw error;
  }
}

function scheduleStoreFlush(delayMs = STORE_SAVE_DELAY_MS) {
  if (storeSaveTimer || !storeDirty) return;
  storeSaveTimer = setTimeout(() => {
    storeSaveTimer = null;
    try {
      flushStoreNow();
    } catch (error) {
      console.error('[store] scheduled save failed:', error?.message ?? error);
      // Keep the dirty state and retry without coupling request latency to fsync.
      scheduleStoreFlush(STORE_SAVE_RETRY_MS);
    }
  }, delayMs);
  storeSaveTimer.unref?.();
}

function saveStore() {
  storeDirty = true;
  scheduleStoreFlush();
}

function saveStoreBestEffort() {
  saveStore();
}

function allowFixedWindow(map, key, limit, now = Date.now()) {
  const current = map.get(key);
  if (!current || now - current.windowStart >= WRITE_RATE_WINDOW_MS) {
    map.set(key, { windowStart: now, count: 1 });
  } else {
    if (current.count >= limit) return false;
    current.count += 1;
  }
  if (map.size > 20_000) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  return true;
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded)
    ? forwarded[0]
    : String(forwarded ?? '').split(',')[0].trim();
  const raw = firstForwarded || req.socket?.remoteAddress || 'unknown';
  return raw.slice(0, 96);
}

function allowWriteRequest(req, scope, actor, now = Date.now()) {
  if (!allowFixedWindow(writeRateByIp, scope + ':' + requestIp(req), WRITE_IP_RATE_LIMIT, now)) return false;
  if (!actor) return true;
  return allowFixedWindow(writeRateByActor, scope + ':' + actor, WRITE_RATE_LIMIT, now);
}

function analyticsActorHash(platform, uid) {
  return createHash('sha256').update(`${platform}:${uid}`).digest('hex').slice(0, 24);
}

function sanitizeAnalyticsProps(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, 8)) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(key)) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.round(value * 1000) / 1000;
    else if (typeof value === 'string') out[key] = value.slice(0, 80);
  }
  return out;
}

function allowAnalyticsEvent(actor, now = Date.now()) {
  const current = analyticsRateByActor.get(actor);
  if (!current || now - current.windowStart >= ANALYTICS_RATE_WINDOW_MS) {
    analyticsRateByActor.set(actor, { windowStart: now, count: 1 });
  } else {
    if (current.count >= ANALYTICS_RATE_LIMIT) return false;
    current.count += 1;
  }

  if (analyticsRateByActor.size > 5_000) {
    const oldest = analyticsRateByActor.keys().next().value;
    if (oldest) analyticsRateByActor.delete(oldest);
  }
  return true;
}

// ---------- initData валидация ----------
/**
 * Telegram и MAX используют WebAppData-схему:
 * hash = HMAC_SHA256(data_check_string, HMAC_SHA256(key='WebAppData', data=bot_token)).
 *
 * MAX отдельно требует, чтобы каждый параметр встречался ровно один раз —
 * дубликаты не схлопываем через Object.fromEntries до этой проверки.
 */
export function validateInitData(initData, token, now = Date.now()) {
  if (!token || typeof initData !== 'string' || initData.length === 0) return null;

  let entries;
  try {
    entries = [...new URLSearchParams(initData).entries()];
  } catch {
    return null;
  }
  if (entries.length === 0) return null;

  const seen = new Set();
  for (const [key] of entries) {
    if (seen.has(key)) return null;
    seen.add(key);
  }

  const params = Object.fromEntries(entries);
  const { hash, ...rest } = params;
  const authDate = rest.auth_date;
  if (!hash || !authDate) return null;
  const age = (now - Number(authDate) * 1000) / 1000;
  if (!Number.isFinite(age) || age < -300 || age > 86_400) return null;

  // URLSearchParams уже URL-декодировал значения; сортируем ключи и собираем
  // launch_params/data_check_string ровно по спецификации WebAppData.
  const dataCheck = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');

  const secret = createHmac('sha256', Buffer.from('WebAppData')).update(token).digest();
  const computed = createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (computed.length !== hash.length) return null;
  if (!timingSafeEqual(Buffer.from(computed), Buffer.from(hash))) return null;

  let user = null;
  try {
    user = rest.user ? JSON.parse(rest.user) : null;
  } catch {
    user = null;
  }
  if (user?.id == null || String(user.id).length === 0) return null;
  return {
    uid: String(user.id),
    user,
    startParam: typeof rest.start_param === 'string' ? rest.start_param : null,
    queryId: typeof rest.query_id === 'string' ? rest.query_id : null,
  };
}

/**
 * V6-server: верификация VK Mini Apps web_app_t (web_app_init).
 *
 * web_app_t — base64(JSON { v:2, i:<init data query string>, t:<hmac-hex> }).
 * Алгоритм (официальный, VK):
 *   check_string = сортированные "k=v\n" из i;
 *   если есть auth_key: secret = HMAC_SHA256(secret_key, auth_key),
 *     data_check_string = check_string + "auth_key=<val>";
 *   иначе: secret = secret_key, data_check_string = check_string;
 *   t === HMAC_SHA256(secret, data_check_string) (hex).
 * Возвращает { uid, user } при успехе, иначе null.
 */
export function verifyVkWebAppT(webAppT, secretKey, now = Date.now()) {
  void now; // (placeholder для API-паритета; срок действия token у VK не ограничен)
  if (!secretKey || typeof webAppT !== 'string' || webAppT.length === 0) return null;
  let json;
  try {
    json = JSON.parse(Buffer.from(webAppT, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const t = json.t;
  const i = json.i;
  if (typeof t !== 'string' || typeof i !== 'string' || i.length === 0) return null;
  let data;
  try {
    data = Object.fromEntries(new URLSearchParams(i));
  } catch {
    return null;
  }
  if (Object.keys(data).length === 0) return null;

  const checkString =
    Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n') + '\n';

  let dataCheckString;
  let secret;
  if (typeof data.auth_key === 'string' && data.auth_key.length > 0) {
    dataCheckString = checkString + `auth_key=${data.auth_key}`;
    secret = createHmac('sha256', Buffer.from(secretKey, 'utf8'))
      .update(Buffer.from(data.auth_key, 'utf8'))
      .digest('hex');
  } else {
    dataCheckString = checkString;
    secret = secretKey;
  }

  const computed = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(dataCheckString, 'utf8'))
    .digest('hex');
  if (computed.length !== t.length) return null;
  if (!timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(t, 'utf8'))) return null;

  let user = null;
  try {
    user = data.user ? JSON.parse(data.user) : null;
  } catch {
    user = null;
  }
  const id = user?.id ?? data.user_id;
  if (id == null || String(id).length === 0) return null;
  return { uid: String(id), user };
}

function antiCheatCheck(p, contract) {
  if (!Number.isFinite(p.timeMs) || p.timeMs < 1000 || p.timeMs > ANTI_CHEAT.maxTimeMs) return 'time';
  const minWinTimeMs = contract.legacy
    ? ANTI_CHEAT.legacyMinWinTimeMs
    : ANTI_CHEAT.campaignMinWinTimeMs;
  if (p.win === true && p.timeMs < minWinTimeMs) return 'win-time';
  if (!contract.legacy && p.win === true) {
    if (contract.completionStage !== 'heart') return 'win-stage';
    if (contract.bossesDefeated !== 2) return 'win-bosses';
    if (contract.boss1ClearMs == null) return 'win-boss1-clear';
  }
  if (!Number.isFinite(p.kills) || p.kills < 0 || p.kills > ANTI_CHEAT.maxKillsPerSec * (p.timeMs / 1000)) return 'kills';
  if (!Number.isFinite(p.level) || p.level < 1 || p.level > ANTI_CHEAT.maxLevel) return 'level';
  return null;
}

const REF_PLATFORM_CODES = { t: 'telegram', m: 'max', b: 'browser', v: 'vk' };
const KNOWN_PLATFORMS = new Set(Object.values(REF_PLATFORM_CODES));

function parseReferralRef(raw) {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 64) return null;
  const modern = /^([tmbv])_([A-Za-z0-9-]{1,48})$/.exec(raw);
  if (modern) {
    const platform = REF_PLATFORM_CODES[modern[1]];
    return { token: raw, platform, uid: modern[2], key: `${platform}:${modern[2]}`, legacy: false };
  }
  // Backward compatibility for links already shared before referral V2.
  if (/^[A-Za-z0-9-]{1,64}$/.test(raw)) {
    return { token: raw, platform: null, uid: raw, key: raw, legacy: true };
  }
  return null;
}

function parseStoredIdentity(raw) {
  const value = String(raw ?? '');
  const split = value.indexOf(':');
  if (split > 0) {
    const platform = value.slice(0, split);
    const uid = value.slice(split + 1);
    if (KNOWN_PLATFORMS.has(platform) && uid) return { platform, uid, key: value };
  }
  return value ? { platform: null, uid: value, key: value } : null;
}

function verifyDuelIdentity(body) {
  const platform = body?.platform;
  if (platform !== 'max' && platform !== 'telegram') return null;
  const token = platform === 'telegram' ? TG_TOKEN : MAX_TOKEN;
  const verified = validateInitData(body?.initData, token);
  if (!verified) return null;
  return { platform, uid: verified.uid };
}

function publicRunGrant(run) {
  return {
    runId: run.runId,
    runToken: run.runToken,
    runSeed: run.runSeed,
    controlMode: run.controlMode,
    difficultyId: run.difficultyId,
    rulesetVersion: run.rulesetVersion,
    campaignVersion: run.campaignVersion,
    issuedAt: run.issuedAt,
    expiresAt: run.expiresAt,
  };
}

export function compactRunGrantEntries(runs, now = Date.now(), cap = MAX_RUN_GRANTS, reserve = 0) {
  const active = runs.filter((run) => run.consumedAt == null && run.expiresAt > now);
  return {
    runs: active,
    hasCapacity: active.length <= Math.max(0, cap - reserve),
  };
}

function issueRunGrant(identity, spec, now = Date.now()) {
  const existing = store.runGrants.find(
    (run) =>
      run.platform === identity.platform &&
      run.uid === identity.uid &&
      run.runSeed === spec.runSeed &&
      run.controlMode === spec.controlMode &&
      run.difficultyId === spec.difficultyId &&
      run.rulesetVersion === spec.rulesetVersion &&
      run.campaignVersion === spec.campaignVersion &&
      run.consumedAt == null &&
      run.expiresAt > now
  );
  if (existing) return { run: existing, reused: true, capacity: true };

  const compacted = compactRunGrantEntries(store.runGrants, now, MAX_RUN_GRANTS, 1);
  store.runGrants = compacted.runs;
  if (!compacted.hasCapacity) return { run: null, reused: false, capacity: false };

  const run = {
    runId: randomBytes(12).toString('base64url'),
    runToken: randomBytes(24).toString('base64url'),
    platform: identity.platform,
    uid: identity.uid,
    runSeed: spec.runSeed,
    controlMode: spec.controlMode,
    difficultyId: spec.difficultyId,
    rulesetVersion: spec.rulesetVersion,
    campaignVersion: spec.campaignVersion,
    issuedAt: now,
    expiresAt: now + RUN_GRANT_TTL_MS,
    consumedAt: null,
  };
  store.runGrants.push(run);
  return { run, reused: false, capacity: true };
}

function resolveRunGrant(runToken, identity, contract, payload, now = Date.now()) {
  if (typeof runToken !== 'string' || !RUN_TOKEN_RE.test(runToken)) {
    return { ok: false, status: 422, error: 'run capability invalid' };
  }
  const run = store.runGrants.find((candidate) => candidate.runToken === runToken) ?? null;
  if (!run) return { ok: false, status: 422, error: 'run capability not found' };
  if (run.consumedAt != null) return { ok: false, status: 422, error: 'run capability already used' };
  if (now >= run.expiresAt) return { ok: false, status: 410, error: 'run capability expired' };
  if (run.platform !== identity.platform || run.uid !== identity.uid) {
    return { ok: false, status: 403, error: 'run capability owner mismatch' };
  }
  if (
    contract.legacy ||
    contract.rulesetVersion !== run.rulesetVersion ||
    contract.campaignVersion !== run.campaignVersion ||
    contract.difficultyId !== run.difficultyId ||
    contract.runSeed !== run.runSeed ||
    contract.controlMode !== run.controlMode ||
    payload.daily === true
  ) {
    return { ok: false, status: 422, error: 'run capability does not match score contract' };
  }
  const elapsedWallMs = Math.max(0, now - run.issuedAt);
  if (payload.timeMs > elapsedWallMs + RUN_WALL_CLOCK_GRACE_MS) {
    run.consumedAt = now;
    return {
      ok: false,
      status: 422,
      error: 'anti-cheat: run-time-exceeds-wall-clock',
      consumed: true,
    };
  }
  return { ok: true, run };
}

function newDuelId() {
  return randomBytes(12).toString('base64url');
}

function dailyRunSeed(dateKey) {
  return createHash('sha256')
    .update(`ofeliya:daily:v2:${dateKey}:${CURRENT_RULESET_VERSION}:${CURRENT_CAMPAIGN_VERSION}`)
    .digest('hex')
    .slice(0, 16);
}

function findDailyRun(runId) {
  if (typeof runId !== 'string' || !DAILY_RUN_ID_RE.test(runId)) return null;
  return store.dailyRuns.find((run) => run.runId === runId) ?? null;
}

function publicDailyRun(run) {
  return {
    runId: run.runId,
    runSeed: run.runSeed,
    dateKey: run.dateKey,
    issuedAt: run.issuedAt,
    expiresAt: run.expiresAt,
    difficultyId: 'standard',
    rulesetVersion: run.rulesetVersion,
    campaignVersion: run.campaignVersion,
  };
}

export function compactDailyRunEntries(runs, now = Date.now(), cap = MAX_DAILY_RUNS, reserve = 0) {
  const active = runs.filter((run) => run.closedAt == null && run.expiresAt > now);
  return {
    runs: active,
    hasCapacity: active.length <= Math.max(0, cap - reserve),
  };
}

function issueDailyRun(identity, now = Date.now()) {
  const dateKey = localDateKey(now);
  const existing = store.dailyRuns.find(
    (run) =>
      run.platform === identity.platform &&
      run.uid === identity.uid &&
      run.dateKey === dateKey &&
      run.closedAt == null &&
      run.expiresAt > now
  );
  if (existing) return { run: existing, reused: true, capacity: true };

  const compacted = compactDailyRunEntries(store.dailyRuns, now, MAX_DAILY_RUNS, 1);
  store.dailyRuns = compacted.runs;
  if (!compacted.hasCapacity) return { run: null, reused: false, capacity: false };

  const dayEnd = new Date(now);
  dayEnd.setHours(24, 0, 0, 0);
  const expiresAt = Math.min(
    now + DAILY_RUN_TTL_MS,
    dayEnd.getTime() + DAILY_RUN_GRACE_MS
  );
  const run = {
    runId: randomBytes(12).toString('base64url'),
    platform: identity.platform,
    uid: identity.uid,
    dateKey,
    runSeed: dailyRunSeed(dateKey),
    rulesetVersion: CURRENT_RULESET_VERSION,
    campaignVersion: CURRENT_CAMPAIGN_VERSION,
    difficultyId: 'standard',
    issuedAt: now,
    expiresAt,
    closedAt: null,
  };
  store.dailyRuns.push(run);
  return { run, reused: false, capacity: true };
}

function findDuel(challengeId) {
  if (!DUEL_ID_RE.test(challengeId)) return null;
  return store.duels.find((duel) => duel.challengeId === challengeId) ?? null;
}

function publicDuelSnapshot(duel) {
  return {
    challengeId: duel.challengeId,
    rulesetVersion: duel.rulesetVersion,
    campaignVersion: duel.campaignVersion,
    runSeed: duel.runSeed,
    difficultyId: 'standard',
    controlMode: duel.controlMode,
    targetTimeMs: duel.targetTimeMs,
    createdAt: duel.createdAt,
    expiresAt: duel.expiresAt,
  };
}

function recordDuelEvent(challengeId, event, identity, ts = Date.now()) {
  store.duelEvents.push({
    challengeId,
    event,
    platform: identity.platform,
    uid: identity.uid,
    ts,
  });
  if (store.duelEvents.length > MAX_DUEL_EVENTS) {
    store.duelEvents.splice(0, store.duelEvents.length - MAX_DUEL_EVENTS);
  }
}

function duelAttemptStats(challengeId, identity) {
  const mine = store.duelAttempts.filter(
    (row) =>
      row.challengeId === challengeId &&
      row.platform === identity.platform &&
      row.uid === identity.uid &&
      row.valid
  );
  const winningTimes = mine.filter((row) => row.win).map((row) => row.timeMs);
  return {
    attemptCount: mine.length,
    bestTimeMs: winningTimes.length ? Math.min(...winningTimes) : null,
    everBeaten: mine.some((row) => row.beaten),
  };
}

// ---------- push-уведомление referrer'у (V7) ----------
/**
 * Outbound push разрешён только когда referral V2 криптографически не доказывает,
 * но явно сохраняет исходную платформу. Legacy bare uid никогда не пушим:
 * числовой MAX id нельзя ошибочно отправить как Telegram chat_id.
 */
async function notifyReferrer(ref) {
  if (!TG_TOKEN || !ref || ref.platform !== 'telegram') return;
  const fromUid = ref.uid;
  if (!/^\d+$/.test(fromUid)) return;
  const text = [
    '⚡️ OFELIYA: твой ход!',
    `Твой друг прошёл первый забег по твоей ссылке — он уже с бонусом.`,
    'Обнови его результат в игре.',
    GAME_URL ? `\n${GAME_URL}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    await telegramApiJson({
      token: TG_TOKEN,
      method: 'sendMessage',
      params: { chat_id: fromUid, text, disable_web_page_preview: true },
      timeoutMs: 5_000,
    });
  } catch {
    /* push — best effort, не трогаем ответ клиенту */
  }
}

function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- топы ----------
/**
 * Единый порядок результатов:
 * 1) победа выше поражения;
 * 2) среди побед быстрее = лучше;
 * 3) среди поражений дольше = лучше;
 * 4) при равном времени больше kills/level = лучше.
 */
function compareScores(a, b) {
  if (!!a.win !== !!b.win) return a.win ? -1 : 1;
  if (a.timeMs !== b.timeMs) return a.win ? a.timeMs - b.timeMs : b.timeMs - a.timeMs;
  if (a.kills !== b.kills) return b.kills - a.kills;
  return (b.level ?? 0) - (a.level ?? 0);
}

function bestByUser(entries) {
  const best = new Map();
  for (const s of entries) {
    const k = `${s.platform}:${s.uid}`;
    const cur = best.get(k);
    if (!cur || compareScores(s, cur) < 0) best.set(k, s);
  }
  return [...best.values()];
}

function sortTop(list) {
  return list
    .sort(compareScores)
    .slice(0, 100)
    .map((s, i) => ({
      rank: i + 1,
      platform: s.platform,
      uid: s.uid,
      daily: !!s.daily,
      win: !!s.win,
      timeMs: s.timeMs,
      kills: s.kills,
      level: s.level,
      dateKey: s.dateKey,
      rulesetVersion: storedRulesetVersion(s),
      campaignVersion: s.campaignVersion ?? 1,
      difficultyId: s.difficultyId ?? 'standard',
      completionStage: s.completionStage ?? (s.win ? 'bloodstream' : null),
    }));
}

function publicTop(list) {
  return list.map(({ uid, submissionId, submissionHash, scoreId, ...row }) => row);
}

function getTop({
  period = 'all',
  platform,
  includeUnverified = false,
  rulesetVersion = CURRENT_RULESET_VERSION,
} = {}) {
  const now = Date.now();
  const today = localDateKey(now);
  const weekAgo = now - 7 * 86_400_000;

  // Ranked eligibility combines verified platform identity with the current
  // score-contract rules. The server still applies plausibility/anti-cheat checks,
  // but does not claim deterministic replay verification of every run.
  let list = store.scores.filter((s) => (includeUnverified || (s.ranked ?? s.verified)));
  if (rulesetVersion != null) {
    list = list.filter((s) => storedRulesetVersion(s) === rulesetVersion);
  }
  if (platform) list = list.filter((s) => s.platform === platform);
  if (period === 'daily') list = list.filter((s) => s.dateKey === today && s.daily);
  if (period === 'weekly') list = list.filter((s) => s.ts >= weekAgo);
  if (period === 'season') list = list.filter((s) => s.ts >= currentSeason(now).start);
  return sortTop(bestByUser(list));
}

// V4: «общий» результат дня — «ты №7 из 412 сегодня».
// «Сегодня» = dateKey собственного daily-скор игрока (его локальный день).
// Daily statistics use the same ranked-eligibility boundary as the public top:
// anonymous/browser rows never affect a verified player's place.
function dailyStats(user, platform, rulesetVersion = CURRENT_RULESET_VERSION) {
  const scoped = (s) =>
    (s.ranked ?? s.verified) &&
    (rulesetVersion == null || storedRulesetVersion(s) === rulesetVersion);
  const mine = bestByUser(
    store.scores.filter((s) => scoped(s) && s.platform === platform && s.uid === user && s.daily)
  );
  if (mine.length === 0) return { dateKey: null, total: 0, rank: null, you: null };
  const today = mine[0].dateKey;
  const daily = store.scores.filter((s) => scoped(s) && s.daily && s.dateKey === today);
  const byUser = bestByUser(daily);
  const total = byUser.length;
  const sorted = [...byUser].sort(compareScores);
  const idx = sorted.findIndex((s) => s.platform === platform && s.uid === user);
  return {
    dateKey: today,
    total,
    rank: idx >= 0 ? idx + 1 : null,
    you: {
      win: mine[0].win,
      timeMs: mine[0].timeMs,
      kills: mine[0].kills,
      rulesetVersion: storedRulesetVersion(mine[0]),
    },
  };
}

// ---------- профили (V1): отдельный profiles.json ----------
/**
 * Профили живут в ОТДЕЛЬНОМ файле profiles.json, а НЕ ключом в store.json.
 * Причина (rollback safety): loadStore() возвращает только известные ему ключи,
 * а saveStore() перезаписывает store.json целиком — старая сборка после отката
 * молча стёрла бы неизвестный ей ключ `profiles` при первом же флеше. Отдельный
 * файл старые сборки просто игнорируют, данные переживают откат нетронутыми.
 *
 * Запись профилей СИНХРОННАЯ (tmp+rename) в пути запроса: 200 для профиля
 * означает «уже сохранено на диске», в отличие от дебаунса store.json.
 * Один writer, одна реплика: файл не защищён от конкурентного доступа.
 */
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');
const PROFILE_VERSION = 1;
const INVENTORY_SCHEMA_VERSION = 1;
const MAX_PROFILES = 50_000;
const MAX_PROFILE_ITEMS = 64;
const MAX_PROFILE_ACHIEVEMENTS = 64;
const MAX_PROFILE_SAVE_BYTES = 8_192;
const MAX_PROFILE_TIME_MS = 86_400_000;
const MAX_PROFILE_COUNTER = 1_000_000_000;
const FOUNDER_ELIGIBLE_IDS = new Set(
  String(process.env.FOUNDER_ELIGIBLE_IDS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^(?:max|telegram):[A-Za-z0-9_-]{1,64}$/.test(entry))
);
// Энтитлменты: source строго из allowlist. Значение 'purchase' ОСОЗНАННО
// отсутствует: платная ценность требует транзакционного стора, идемпотентного
// реестра заказов и серверной верификации чеков (см. README «Профили игрока»).
const ENTITLEMENT_SOURCES = new Set(['grant', 'migration', 'promo']);
// Статический серверный каталог косметики: клиент не может изобрести item id.
const PROFILE_CATALOG = new Set(['founder-badge-v1']);
// V1 выдаёт ровно один неконкурентный cosmetic за миграцию (courtesy grant,
// не verified achievement и не конкурентное преимущество).
const PROFILE_MIGRATION_GRANTS = [
  { itemId: 'founder-badge-v1', source: 'migration' },
];
const ACHIEVEMENT_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function emptyProfileStore() {
  return { version: 1, profiles: {}, migrations: {} };
}

function loadProfileStore() {
  let raw;
  try {
    raw = readFileSync(PROFILES_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyProfileStore();
    throw error;
  }
  const parsed = JSON.parse(raw);
  const isMap = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (!isMap(parsed) || (parsed.profiles != null && !isMap(parsed.profiles)) || (parsed.migrations != null && !isMap(parsed.migrations))) {
    throw new Error('profiles.json has an invalid shape; refusing to reset persisted data');
  }
  return {
    version: 1,
    profiles: parsed.profiles ?? {},
    migrations: parsed.migrations ?? {},
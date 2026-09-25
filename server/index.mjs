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
const apiWriteRate = new Map();
const API_WRITE_WINDOW_MS = 60_000;
const API_WRITE_LIMIT = 180;

function allowApiWrite(req, now = Date.now()) {
  const actor = req.socket.remoteAddress ?? 'unknown';
  const previous = apiWriteRate.get(actor);
  if (!previous || now - previous.windowStart >= API_WRITE_WINDOW_MS) {
    apiWriteRate.set(actor, { windowStart: now, count: 1 });
  } else {
    if (previous.count >= API_WRITE_LIMIT) return false;
    previous.count += 1;
  }
  if (apiWriteRate.size > 10_000) {
    const oldest = apiWriteRate.keys().next().value;
    if (oldest) apiWriteRate.delete(oldest);
  }
  return true;
}

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
  const arrays = ['scores', 'refs', 'duels', 'duelAttempts', 'duelEvents', 'analyticsEvents', 'dailyRuns'];
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

function saveStore() {
  writeJsonAtomically(STORE_FILE, store);
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
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: fromUid, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
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

  // Client-reported runs are not proof of completion. Only a future server-verified
  // run contract may set ranked=true; messenger identity alone is insufficient.
  let list = store.scores.filter((s) => (includeUnverified || s.ranked === true));
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
// Считаем по ВСЕМ daily-сорам за этот день (verified + unverified) — это
// социальное сравнение за день, а не постоянный лидерборд (сбросится завтра).
function dailyStats(user, platform, rulesetVersion = CURRENT_RULESET_VERSION) {
  const scoped = (s) =>
    s.ranked === true &&
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
  };
}

let profileStore = loadProfileStore();

function saveProfilesNow() {
  writeJsonAtomically(PROFILES_FILE, profileStore);
}

/**
 * Сериализация на пользователя: два конкурентных запроса одного userKey не
 * могут interleaved-прочитать-изменить-записать (идемпотентность миграции).
 */
const profileLocks = new Map();
function withProfileLock(userKey, task) {
  const previous = profileLocks.get(userKey) ?? Promise.resolve();
  const next = previous.then(task, task);
  profileLocks.set(userKey, next.then(() => {}, () => {}));
  if (profileLocks.size > 5_000) {
    const oldest = profileLocks.keys().next().value;
    if (oldest) profileLocks.delete(oldest);
  }
  return next;
}

function clampProfileNumber(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : 0;
}

function newProfile(now) {
  return {
    profileVersion: PROFILE_VERSION,
    createdAt: now,
    updatedAt: now,
    preferences: {},
    records: {
      bestSurvivalMs: 0,
      bestBoss1ClearMs: 0,
      bestCampaignClearMs: 0,
      bestKills: 0,
      bestLevel: 0,
      runs: 0,
      totalKills: 0,
      achievements: [],
      migrated: false,
    },
    inventory: { schemaVersion: INVENTORY_SCHEMA_VERSION, items: {} },
  };
}

function sanitizeAchievementIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  for (const id of raw) {
    if (typeof id === 'string' && ACHIEVEMENT_ID_RE.test(id)) seen.add(id);
    if (seen.size >= MAX_PROFILE_ACHIEVEMENTS) break;
  }
  return [...seen];
}

function applyMigrationSave(profile, save) {
  const records = save && typeof save === 'object' && !Array.isArray(save) ? save : {};
  const preferences = {};
  if (typeof records.muted === 'boolean') preferences.muted = records.muted;
  if (typeof records.controlMode === 'string' && CONTROL_MODES.has(records.controlMode)) {
    preferences.controlMode = records.controlMode;
  }
  if (typeof records.difficultyId === 'string' && DIFFICULTY_IDS.has(records.difficultyId)) {
    preferences.difficultyId = records.difficultyId;
  }
  profile.preferences = preferences;
  profile.records = {
    // Legacy-алиасы (bestTimeMs/bestWinTimeMs) сервер сознательно не читает:
    // клиент (ProfileClient) сам нормализует их по правилам SaveSystem.
    bestSurvivalMs: clampProfileNumber(records.bestSurvivalMs, MAX_PROFILE_TIME_MS),
    bestBoss1ClearMs: clampProfileNumber(records.bestBoss1ClearMs, MAX_PROFILE_TIME_MS),
    bestCampaignClearMs: clampProfileNumber(records.bestCampaignClearMs, MAX_PROFILE_TIME_MS),
    bestKills: clampProfileNumber(records.bestKills, MAX_PROFILE_COUNTER),
    bestLevel: clampProfileNumber(records.bestLevel, MAX_PROFILE_COUNTER),
    runs: clampProfileNumber(records.runs, MAX_PROFILE_COUNTER),
    totalKills: clampProfileNumber(records.totalKills, MAX_PROFILE_COUNTER),
    achievements: sanitizeAchievementIds(records.achievements),
    // Advisory-only: локальные рекорды клиента никогда не становятся
    // ranked/verified скорами и не конвертируются в платную ценность.
    migrated: true,
  };
}

/** Append-only грант: существующий item не переписывается, id только из каталога. */
function grantProfileItem(profile, itemId, source, now = Date.now()) {
  if (!PROFILE_CATALOG.has(itemId) || !ENTITLEMENT_SOURCES.has(source)) return false;
  const items = profile.inventory.items;
  if (items[itemId]) return false;
  if (Object.keys(items).length >= MAX_PROFILE_ITEMS) return false;
  items[itemId] = { source, grantedAt: now };
  return true;
}

/** Публичная read-модель: без raw uid/userKey/initData/имён/аватаров. */
function publicProfile(profile) {
  return {
    profileVersion: profile.profileVersion,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    preferences: profile.preferences,
    records: profile.records,
    inventory: profile.inventory,
  };
}

/** Только messenger-идентичность (max/telegram), как verifyDuelIdentity. */
function verifyMessengerProfileIdentity(body) {
  const platform = body?.platform;
  if (platform !== 'max' && platform !== 'telegram') return null;
  const token = platform === 'telegram' ? TG_TOKEN : MAX_TOKEN;
  const verified = validateInitData(body?.initData, token);
  if (!verified) return null;
  return { platform, uid: verified.uid, userKey: `${platform}:${verified.uid}` };
}

// ---------- HTTP ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.ALLOW_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
  });
}

const server = createServer(async (req, res) => {
  let url;
  try {
    if (req.headers.host) new URL(`http://${req.headers.host}`);
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, { ok: false, error: 'bad request URL' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': process.env.ALLOW_ORIGIN ?? '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Platform',
    });
    return res.end();
  }

  if (req.method === 'POST' && !allowApiWrite(req)) {
    return send(res, 429, { ok: false, error: 'write rate limited' });
  }

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        app: 'ofeliya-server',
        scores: store.scores.length,
        duels: store.duels.length,
        duelAttempts: store.duelAttempts.length,
        duelEvents: store.duelEvents.length,
        analyticsEvents: store.analyticsEvents.length,
        dailyRuns: store.dailyRuns.length,
        rulesetVersion: CURRENT_RULESET_VERSION,
        campaignVersion: CURRENT_CAMPAIGN_VERSION,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/ruleset') {
      return send(res, 200, {
        ok: true,
        rulesetVersion: CURRENT_RULESET_VERSION,
        campaignVersion: CURRENT_CAMPAIGN_VERSION,
        rankedDifficultyId: 'standard',
        minCampaignWinTimeMs: ANTI_CHEAT.campaignMinWinTimeMs,
        supportedRulesets: [1, CURRENT_RULESET_VERSION],
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/share') {
      const body = await readBody(req);
      const verified = validateInitData(body?.initData, TG_TOKEN);
      if (!verified) {
        return send(res, 403, { ok: false, error: 'verified Telegram identity required' });
      }

      const now = Date.now();
      const shareKey = `telegram:${verified.uid}`;
      const previous = telegramShareLastAt.get(shareKey) ?? 0;
      if (now - previous < TELEGRAM_SHARE_COOLDOWN_MS) {
        return send(res, 429, { ok: false, error: 'share rate limited' });
      }
      telegramShareLastAt.set(shareKey, now);
      if (telegramShareLastAt.size > 5_000) {
        const oldestKey = telegramShareLastAt.keys().next().value;
        if (oldestKey) telegramShareLastAt.delete(oldestKey);
      }

      const prepared = await saveTelegramPreparedMessage({
        token: TG_TOKEN,
        userId: verified.uid,
        text: body?.text,
        link: body?.link,
      });
      if (!prepared) {
        return send(res, 502, { ok: false, error: 'Telegram prepared share unavailable' });
      }
      return send(res, 200, {
        ok: true,
        messageId: prepared.id,
        expirationDate: prepared.expirationDate,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/event') {
      const body = await readBody(req);
      const platform = body?.platform;
      const event = body?.event;
      if (!['telegram', 'max'].includes(platform) || !PRODUCT_EVENTS.has(event)) {
        return send(res, 400, { ok: false, error: 'bad analytics event' });
      }

      const token = platform === 'telegram' ? TG_TOKEN : MAX_TOKEN;
      const verified = validateInitData(body?.initData, token);
      if (!verified) {
        return send(res, 403, { ok: false, error: 'analytics initData validation failed' });
      }

      const actor = analyticsActorHash(platform, verified.uid);
      if (!allowAnalyticsEvent(actor)) {
        return send(res, 429, { ok: false, error: 'analytics rate limited' });
      }

      store.analyticsEvents.push({
        event,
        platform,
        actor,
        props: sanitizeAnalyticsProps(body?.props),
        ts: Date.now(),
      });
      if (store.analyticsEvents.length > MAX_ANALYTICS_EVENTS) {
        store.analyticsEvents.splice(0, store.analyticsEvents.length - MAX_ANALYTICS_EVENTS);
      }
      saveStore();
      return send(res, 202, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/daily/run') {
      const body = await readBody(req);
      const identity = verifyDuelIdentity(body);
      if (!identity) {
        return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      }

      const issued = issueDailyRun(identity);
      if (!issued.capacity || !issued.run) {
        return send(res, 503, { ok: false, error: 'daily run capacity temporarily unavailable' });
      }
      saveStore();
      return send(res, issued.reused ? 200 : 201, {
        ok: true,
        reused: issued.reused,
        ticket: publicDailyRun(issued.run),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/duel') {
      const body = await readBody(req);
      const identity = verifyDuelIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      const payload = body?.payload;
      if (!payload || typeof payload !== 'object') return send(res, 400, { ok: false, error: 'no payload' });
      if (payload.resumed === true) return send(res, 422, { ok: false, error: 'resumed run cannot create duel' });

      const parsedContract = parseScoreContract(payload);
      if (!parsedContract.ok) {
        return send(res, 422, { ok: false, error: `score-contract: ${parsedContract.error}` });
      }
      const contract = parsedContract.contract;
      const cheat = antiCheatCheck(payload, contract);
      if (cheat) return send(res, 422, { ok: false, error: `anti-cheat: ${cheat}` });
      if (
        contract.legacy ||
        contract.rulesetVersion !== CURRENT_RULESET_VERSION ||
        contract.campaignVersion !== CURRENT_CAMPAIGN_VERSION ||
        contract.difficultyId !== 'standard' ||
        contract.completionStage !== 'heart' ||
        contract.bossesDefeated !== 2 ||
        payload.win !== true
      ) {
        return send(res, 422, { ok: false, error: 'duel requires verified Standard campaign clear' });
      }

      let challengeId = newDuelId();
      while (findDuel(challengeId)) challengeId = newDuelId();
      const now = Date.now();
      const duel = {
        challengeId,
        ownerPlatform: identity.platform,
        ownerUid: identity.uid,
        rulesetVersion: contract.rulesetVersion,
        campaignVersion: contract.campaignVersion,
        runSeed: contract.runSeed,
        difficultyId: 'standard',
        controlMode: contract.controlMode,
        targetTimeMs: Math.round(payload.timeMs),
        source: {
          kills: Math.round(payload.kills),
          level: Math.round(payload.level),
          bossesDefeated: contract.bossesDefeated,
          boss1ClearMs: contract.boss1ClearMs,
          hostCellsInfected: contract.hostCellsInfected,
        },
        createdAt: now,
        expiresAt: now + DUEL_TTL_MS,
      };
      store.duels.push(duel);
      if (store.duels.length > MAX_DUELS) store.duels.splice(0, store.duels.length - MAX_DUELS);
      recordDuelEvent(challengeId, 'create', identity, now);
      saveStore();
      return send(res, 201, { ok: true, ranked: false, challenge: publicDuelSnapshot(duel) });
    }

    const duelGetMatch = /^\/api\/duel\/([A-Za-z0-9_-]{16,32})$/.exec(url.pathname);
    if (req.method === 'GET' && duelGetMatch) {
      const duel = findDuel(duelGetMatch[1]);
      if (!duel) return send(res, 404, { ok: false, error: 'duel not found' });
      if (Date.now() >= duel.expiresAt) return send(res, 410, { ok: false, error: 'duel expired' });
      return send(res, 200, { ok: true, ranked: false, challenge: publicDuelSnapshot(duel) });
    }

    const duelEventMatch = /^\/api\/duel\/([A-Za-z0-9_-]{16,32})\/event$/.exec(url.pathname);
    if (req.method === 'POST' && duelEventMatch) {
      const duel = findDuel(duelEventMatch[1]);
      if (!duel) return send(res, 404, { ok: false, error: 'duel not found' });
      if (Date.now() >= duel.expiresAt) return send(res, 410, { ok: false, error: 'duel expired' });
      const body = await readBody(req);
      const identity = verifyDuelIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      if (!['open', 'start', 'rematch'].includes(body?.event)) {
        return send(res, 400, { ok: false, error: 'bad duel event' });
      }
      recordDuelEvent(duel.challengeId, body.event, identity);
      saveStore();
      return send(res, 200, { ok: true, ranked: false });
    }

    const duelAttemptMatch = /^\/api\/duel\/([A-Za-z0-9_-]{16,32})\/attempt$/.exec(url.pathname);
    if (req.method === 'POST' && duelAttemptMatch) {
      const duel = findDuel(duelAttemptMatch[1]);
      if (!duel) return send(res, 404, { ok: false, error: 'duel not found' });
      if (Date.now() >= duel.expiresAt) return send(res, 410, { ok: false, error: 'duel expired' });

      const body = await readBody(req);
      const identity = verifyDuelIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      const payload = body?.payload;
      if (!payload || typeof payload !== 'object') return send(res, 400, { ok: false, error: 'no payload' });
      if (payload.resumed === true) return send(res, 422, { ok: false, error: 'resumed duel attempt rejected' });

      const parsedContract = parseScoreContract(payload);
      if (!parsedContract.ok) {
        return send(res, 422, { ok: false, error: `score-contract: ${parsedContract.error}` });
      }
      const contract = parsedContract.contract;
      const cheat = antiCheatCheck(payload, contract);
      if (cheat) return send(res, 422, { ok: false, error: `anti-cheat: ${cheat}` });
      if (
        contract.legacy ||
        contract.rulesetVersion !== duel.rulesetVersion ||
        contract.campaignVersion !== duel.campaignVersion ||
        contract.difficultyId !== 'standard' ||
        contract.runSeed !== duel.runSeed ||
        contract.controlMode !== duel.controlMode
      ) {
        return send(res, 422, { ok: false, error: 'duel snapshot mismatch' });
      }

      const now = Date.now();
      const win =
        payload.win === true &&
        contract.completionStage === 'heart' &&
        contract.bossesDefeated === 2;
      const timeMs = Math.round(payload.timeMs);
      const beaten = win && timeMs < duel.targetTimeMs;
      store.duelAttempts.push({
        challengeId: duel.challengeId,
        platform: identity.platform,
        uid: identity.uid,
        valid: true,
        win,
        beaten,
        timeMs,
        ts: now,
      });
      if (store.duelAttempts.length > MAX_DUEL_ATTEMPTS) {
        store.duelAttempts.splice(0, store.duelAttempts.length - MAX_DUEL_ATTEMPTS);
      }
      recordDuelEvent(duel.challengeId, 'attempt', identity, now);
      if (beaten) recordDuelEvent(duel.challengeId, 'beaten', identity, now);
      saveStore();

      const stats = duelAttemptStats(duel.challengeId, identity);
      return send(res, 200, {
        ok: true,
        ranked: false,
        valid: true,
        beaten,
        targetTimeMs: duel.targetTimeMs,
        ...stats,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/score') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return send(res, 400, { ok: false, error: 'bad request body' });
      }
      const { platform, initData, anonId, webAppInit, payload } = body;
      if (!['telegram', 'max', 'browser', 'vk'].includes(platform)) {
        return send(res, 400, { ok: false, error: 'bad platform' });
      }
      if (!payload || typeof payload !== 'object') return send(res, 400, { ok: false, error: 'no payload' });

      let uid = null;
      let verified = false;
      let verifiedStartParam = null;
      if (platform === 'browser' || platform === 'vk') {
        // V6-server: VK — пробуем верифицировать web_app_t (нужен VK_SECURE_KEY).
        if (platform === 'vk' && webAppInit && VK_SECURE_KEY) {
          const v = verifyVkWebAppT(webAppInit, VK_SECURE_KEY);
          if (v) {
            uid = v.uid;
            verified = true;
          }
        }
        // Без верификации (нет token/secret/сбой) — unverified по anonId:
        // browser: сгенерированный anonId (>=8); vk: VK user id (число, >=1).
        if (!uid) {
          const minLen = platform === 'vk' ? 1 : 8;
          if (typeof anonId !== 'string' || anonId.length < minLen || anonId.length > 64) {
            return send(res, 400, { ok: false, error: 'bad anonId' });
          }
          uid = anonId;
          verified = false;
        }
      } else {
        const token = platform === 'telegram' ? TG_TOKEN : MAX_TOKEN;
        const v = validateInitData(initData, token);
        if (!v) return send(res, 403, { ok: false, error: 'initData validation failed' });
        uid = v.uid;
        verified = true;
        verifiedStartParam = v.startParam;
      }

      const parsedContract = parseScoreContract(payload);
      if (!parsedContract.ok) {
        return send(res, 422, { ok: false, error: `score-contract: ${parsedContract.error}` });
      }
      const contract = parsedContract.contract;
      const submissionId = typeof body.submissionId === 'string' ? body.submissionId : null;
      if (body.submissionId != null && (!submissionId || !/^[A-Za-z0-9_-]{16,64}$/.test(submissionId))) {
        return send(res, 422, { ok: false, error: 'bad submissionId' });
      }
      const submissionHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const cheat = antiCheatCheck(payload, contract);
      if (cheat) return send(res, 422, { ok: false, error: `anti-cheat: ${cheat}` });

      if (!contract.legacy && payload.daily === true && payload.dailyRunId == null) {
        return send(res, 422, { ok: false, error: 'current-ruleset daily run ticket required' });
      }

      let dailyRun = null;
      if (payload.dailyRunId != null) {
        if (!verified || (platform !== 'telegram' && platform !== 'max')) {
          return send(res, 403, { ok: false, error: 'verified messenger daily identity required' });
        }
        dailyRun = findDailyRun(payload.dailyRunId);
        if (!dailyRun) return send(res, 422, { ok: false, error: 'daily run not found' });
        if (dailyRun.platform !== platform || dailyRun.uid !== uid) {
          return send(res, 403, { ok: false, error: 'daily run owner mismatch' });
        }
        if (!submissionId || !/^[A-Za-z0-9_-]{16,64}$/.test(submissionId)) {
          return send(res, 422, { ok: false, error: 'daily submissionId required' });
        }
        if (dailyRun.closedAt != null) {
          if (dailyRun.submissionId === submissionId && dailyRun.submissionHash === submissionHash) {
            return send(res, 200, {
              ok: true,
              rank: null,
              ranked: false,
              rulesetVersion: dailyRun.rulesetVersion,
              campaignVersion: dailyRun.campaignVersion,
              dailyRunAccepted: true,
              scoreId: dailyRun.scoreId,
            });
          }
          return send(res, 409, { ok: false, error: 'daily run already closed' });
        }
        if (Date.now() >= dailyRun.expiresAt) {
          return send(res, 410, { ok: false, error: 'daily run expired' });
        }
        if (
          payload.daily !== true ||
          contract.legacy ||
          contract.rulesetVersion !== dailyRun.rulesetVersion ||
          contract.campaignVersion !== dailyRun.campaignVersion ||
          contract.difficultyId !== dailyRun.difficultyId ||
          contract.runSeed !== dailyRun.runSeed
        ) {
          return send(res, 422, { ok: false, error: 'dailyRunId does not match score contract' });
        }
      }

      if (!dailyRun && submissionId) {
        const previous = store.scores.find(
          (score) => score.platform === platform && score.uid === uid && score.submissionId === submissionId
        );
        if (previous) {
          if (previous.submissionHash !== submissionHash) {
            return send(res, 409, { ok: false, error: 'submissionId already used for another score' });
          }
          return send(res, 200, {
            ok: true,
            rank: null,
            ranked: false,
            rulesetVersion: previous.rulesetVersion,
            campaignVersion: previous.campaignVersion,
            dailyRunAccepted: false,
            scoreId: previous.scoreId,
          });
        }
      }

      const dateKey = dailyRun
        ? dailyRun.dateKey
        :
        typeof payload.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.dateKey)
          ? payload.dateKey
          : localDateKey();
      const record = {
        platform,
        uid,
        dateKey,
        daily: dailyRun ? true : payload.daily === true,
        dailyRunId: dailyRun?.runId ?? null,
        win: payload.win === true,
        timeMs: Math.round(payload.timeMs),
        kills: Math.round(payload.kills),
        level: Math.round(payload.level),
        ref: parseReferralRef(verifiedStartParam)?.token ?? null,
        verified,
        // The client currently submits final counters without a server-verifiable run
        // transcript. Keep the result for personal/social views, but never call it ranked.
        ranked: false,
        rulesetVersion: contract.rulesetVersion,
        campaignVersion: contract.campaignVersion,
        difficultyId: contract.difficultyId,
        completionStage: contract.completionStage,
        runSeed: contract.runSeed,
        controlMode: contract.controlMode,
        bossesDefeated: contract.bossesDefeated,
        boss1ClearMs: contract.boss1ClearMs,
        hostCellsInfected: contract.hostCellsInfected,
        submissionId,
        submissionHash: submissionId ? submissionHash : null,
        scoreId: randomBytes(12).toString('base64url'),
        ts: Date.now(),
      };

      if (store.scores.length >= MAX_SCORES) {
        const removable = store.scores.findIndex((score) => score.ranked !== true);
        if (removable < 0) return send(res, 503, { ok: false, error: 'score storage capacity reached' });
        store.scores.splice(removable, 1);
      }
      store.scores.push(record);
      if (dailyRun) {
        dailyRun.closedAt = record.ts;
        dailyRun.submissionId = submissionId;
        dailyRun.submissionHash = submissionHash;
        dailyRun.scoreId = record.scoreId;
      }

      // Реферал V2: from хранится как platform:uid. Legacy bare uid остаётся
      // читаемым, но не получает outbound push из-за неоднозначной платформы.
      let refReward = null;
      let refToNotify = null;
      const ref = parseReferralRef(record.ref);
      if (ref) {
        const toKey = `${platform}:${uid}`;
        const selfReferral = ref.uid === uid && (!ref.platform || ref.platform === platform);
        if (!selfReferral) {
          const edgeKey = `${ref.key}>${toKey}`;
          if (!store.refs.some((r) => r.edge === edgeKey)) {
            store.refs.push({ edge: edgeKey, from: ref.key, to: toKey, ts: record.ts });
            if (store.refs.length > MAX_REFS) store.refs.splice(0, store.refs.length - MAX_REFS);
          }
          if (!store.refRewards[edgeKey] && Object.keys(store.refRewards).length < MAX_REFS) {
            store.refRewards[edgeKey] = record.ts;
            refReward = { from: ref.key, to: toKey, first: true };
            refToNotify = ref;
          }
        }
      }

      saveStore();
      if (refToNotify) void notifyReferrer(refToNotify);
      const top = getTop({
        period: record.daily ? 'daily' : 'all',
        rulesetVersion: record.rulesetVersion,
      });
      const rank = top.find((t) => t.uid === uid && t.platform === platform)?.rank ?? null;
      return send(res, 200, {
        ok: true,
        rank,
        ranked: record.ranked,
        rulesetVersion: record.rulesetVersion,
        campaignVersion: record.campaignVersion,
        dailyRunAccepted: dailyRun != null,
        scoreId: record.scoreId,
        top: publicTop(top),
        refReward,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/top') {
      const rawPeriod = url.searchParams.get('period') ?? 'all';
      const period = ['all', 'daily', 'weekly', 'season'].includes(rawPeriod) ? rawPeriod : 'all';
      const rulesetVersion = parseRulesetFilter(url.searchParams.get('ruleset'));
      const top = getTop({
        period,
        platform: url.searchParams.get('platform') ?? undefined,
        includeUnverified: url.searchParams.get('includeUnverified') === '1',
        rulesetVersion,
      });
      return send(res, 200, {
        ok: true,
        top: publicTop(top),
        period,
        rulesetVersion,
        currentRulesetVersion: CURRENT_RULESET_VERSION,
        season: currentSeason(),
      });
    }

    // C5: текущий сезон (индекс, окно, дней до конца).
    if (req.method === 'GET' && url.pathname === '/api/season') {
      return send(res, 200, { ok: true, season: currentSeason() });
    }

    // V4: «общий» результат дня — «ты №7 из 412 сегодня».
    if (req.method === 'POST' && url.pathname === '/api/daily') {
      const body = await readBody(req);
      const identity = verifyDuelIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      const rulesetVersion = parseRulesetFilter(url.searchParams.get('ruleset'));
      return send(res, 200, {
        ok: true,
        rulesetVersion,
        ...dailyStats(identity.uid, identity.platform, rulesetVersion),
      });
    }

    // Legacy endpoint: текущий клиент пишет ref вместе с аутентифицированным
    // /api/score. Оставляем совместимость со старым клиентом, но жёстко
    // ограничиваем поля и размер store, чтобы endpoint нельзя было раздувать.
    if (req.method === 'POST' && url.pathname === '/api/ref') {
      return send(res, 410, { ok: false, error: 'referrals are accepted only from signed launch data' });
    }

    if (req.method === 'POST' && url.pathname === '/api/ref/status') {
      const body = await readBody(req);
      const identity = verifyDuelIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      const meKey = `${identity.platform}:${identity.uid}`;
      const mine = store.refs.filter((r) => {
        const from = parseStoredIdentity(r.from);
        return r.from === meKey || (from?.platform == null && from?.uid === identity.uid);
      }).length;
      return send(res, 200, { ok: true, platform: identity.platform, invited: mine });
    }

    // V2/V2-ref: friend graph keeps platform identity internally but public
    // response omits raw uid. Legacy bare ref ids remain readable.
    if (req.method === 'POST' && url.pathname === '/api/friends') {
      const body = await readBody(req);
      const identity = verifyDuelIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      const meKey = `${identity.platform}:${identity.uid}`;
      const user = identity.uid;
      const friends = new Map(); // identity -> { platform, uid, relation }
      const addFriend = (identity, relation) => {
        if (!identity?.uid) return;
        const key = identity.key;
        const prev = friends.get(key);
        friends.set(key, { ...identity, relation: prev && prev.relation !== relation ? 'both' : relation });
      };

      for (const r of store.refs) {
        const from = parseStoredIdentity(r.from);
        const to = parseStoredIdentity(r.to);
        const legacyFromMe = from?.platform == null && from?.uid === user;
        if (r.from === meKey || legacyFromMe) addFriend(to, 'invited');
        if (r.to === meKey) addFriend(from, 'inviter');
      }

      const out = [];
      for (const friend of friends.values()) {
        let best = null;
        for (const score of store.scores) {
          if (score.uid !== friend.uid) continue;
          if (friend.platform && score.platform !== friend.platform) continue;
          if (!best || compareScores(score, best) < 0) best = score;
        }
        if (best) {
          out.push({
            relation: friend.relation,
            platform: best.platform,
            win: !!best.win,
            timeMs: best.timeMs,
            kills: best.kills,
            level: best.level,
            dateKey: best.dateKey,
          });
        }
      }
      out.sort(compareScores);
      return send(res, 200, { ok: true, platform: identity.platform, friends: out.slice(0, 10) });
    }

    // V1 профили: только верифицированное чтение и одноразовая advisory-миграция.
    // Общего profile update / grant endpoint нет — мутационной поверхности,
    // доступной без подписи, этот этап не добавляет (см. README «Профили игрока»).
    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.platform !== 'string') {
        return send(res, 422, { ok: false, error: 'bad profile request' });
      }
      const identity = verifyMessengerProfileIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });

      const outcome = await withProfileLock(identity.userKey, () => {
        let profile = profileStore.profiles[identity.userKey];
        if (!profile) {
          // Lazy auto-vivify пустого V1 профиля (как lazy-create daily-тикета).
          if (Object.keys(profileStore.profiles).length >= MAX_PROFILES) return { capacity: true };
          profile = newProfile(Date.now());
          profileStore.profiles[identity.userKey] = profile;
          saveProfilesNow();
        }
        return { profile };
      });
      if (outcome.capacity) {
        return send(res, 503, { ok: false, error: 'profile capacity temporarily unavailable' });
      }
      return send(res, 200, { ok: true, profile: publicProfile(outcome.profile) });
    }

    if (req.method === 'POST' && url.pathname === '/api/profile/migrate') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.platform !== 'string') {
        return send(res, 422, { ok: false, error: 'bad profile request' });
      }
      const identity = verifyMessengerProfileIdentity(body);
      if (!identity) return send(res, 403, { ok: false, error: 'verified messenger identity required' });
      const save = body?.save;
      if (!save || typeof save !== 'object' || Array.isArray(save)) {
        return send(res, 422, { ok: false, error: 'bad save' });
      }
      let saveHash = null;
      try {
        const raw = JSON.stringify(save);
        if (raw == null || Buffer.byteLength(raw, 'utf8') > MAX_PROFILE_SAVE_BYTES) {
          return send(res, 422, { ok: false, error: 'save too large' });
        }
        saveHash = createHash('sha256').update(raw).digest('hex').slice(0, 32);
      } catch {
        return send(res, 422, { ok: false, error: 'bad save' });
      }

      const outcome = await withProfileLock(identity.userKey, () => {
        let profile = profileStore.profiles[identity.userKey];
        let mutated = false;
        if (!profile) {
          if (Object.keys(profileStore.profiles).length >= MAX_PROFILES) return { capacity: true };
          profile = newProfile(Date.now());
          profileStore.profiles[identity.userKey] = profile;
          mutated = true;
        }
        // One-time claim: первый валидный claim выигрывает, повторные получают
        // существующий профиль без ошибки (чтобы не провоцировать retry storms).
        if (profileStore.migrations[identity.userKey]) {
          if (mutated) saveProfilesNow();
          return { profile, claimed: false };
        }
        applyMigrationSave(profile, save);
        if (FOUNDER_ELIGIBLE_IDS.has(identity.userKey)) {
          for (const grant of PROFILE_MIGRATION_GRANTS) {
            grantProfileItem(profile, grant.itemId, grant.source);
          }
        }
        profile.updatedAt = Date.now();
        profileStore.migrations[identity.userKey] = { claimedAt: Date.now(), saveHash };
        saveProfilesNow();
        return { profile, claimed: true };
      });
      if (outcome.capacity) {
        return send(res, 503, { ok: false, error: 'profile capacity temporarily unavailable' });
      }
      return send(res, 200, { ok: true, claimed: outcome.claimed, profile: publicProfile(outcome.profile) });
    }

    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message ?? 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`[ofeliya-server] http://localhost:${PORT} (data: ${DATA_DIR})`);
  if (!TG_TOKEN) console.warn('[ofeliya-server] TG_BOT_TOKEN не задан — telegram-скоры не будут верифицироваться');
  if (!MAX_TOKEN) console.warn('[ofeliya-server] dedicated MAX_BOT_TOKEN не задан — MAX identity checks fail closed');
});

export { server };

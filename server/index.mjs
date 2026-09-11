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
 *        MAX_BOT_TOKEN (или production BOT_TOKEN как fallback)
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'server', 'data');
const TG_TOKEN = process.env.TG_BOT_TOKEN ?? '';
// Прод-бот из bot/index.mjs исторически читает BOT_TOKEN. Не требуем дублировать
// один и тот же MAX token в /opt/hub/.env только ради score-service.
const MAX_TOKEN = process.env.MAX_BOT_TOKEN || process.env.BOT_TOKEN || '';
// V6-server: секрет VK Mini Apps (Apps → Настройки → «Секретный ключ»).
// Пусто — VK-скоры остаются unverified (как browser). Задан — web_app_t
// валидируется и VK-скоры попадают в верифицированный общий топ.
const VK_SECURE_KEY = process.env.VK_SECURE_KEY ?? '';
const GAME_URL = process.env.GAME_URL ?? '';

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

// ---------- анти-чит пороги ----------
const ANTI_CHEAT = {
  // Босс появляется ровно на 5:00 игрового времени. Победа раньше физически
  // невозможна, даже если initData пользователя криптографически валиден.
  minWinTimeMs: 300_000,
  maxTimeMs: 3_600_000, // 1 час (обычный забег 5 мин, long-run 15)
  maxKillsPerSec: 30, // пик реального лейта ~15-20/с с нова
  maxLevel: 100,
};

// ---------- store ----------
mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = join(DATA_DIR, 'store.json');
const MAX_SCORES = 20_000;
const MAX_REFS = 10_000;

function emptyStore() {
  return { scores: [], refs: [], refRewards: {} };
}

function loadStore() {
  try {
    const raw = readFileSync(STORE_FILE, 'utf8');
    const s = JSON.parse(raw);
    return {
      scores: Array.isArray(s.scores) ? s.scores : [],
      refs: Array.isArray(s.refs) ? s.refs : [],
      refRewards: s.refRewards && typeof s.refRewards === 'object' ? s.refRewards : {},
    };
  } catch {
    return emptyStore();
  }
}

let store = loadStore();
let saveScheduled = false;
function saveStore() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => {
    saveScheduled = false;
    try {
      const tmp = `${STORE_FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(store));
      renameSync(tmp, STORE_FILE);
    } catch (e) {
      console.error('[store] save failed:', e.message);
    }
  });
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
  return { uid: String(user.id), user };
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

function antiCheatCheck(p) {
  if (!Number.isFinite(p.timeMs) || p.timeMs < 1000 || p.timeMs > ANTI_CHEAT.maxTimeMs) return 'time';
  if (p.win === true && p.timeMs < ANTI_CHEAT.minWinTimeMs) return 'win-time';
  if (!Number.isFinite(p.kills) || p.kills < 0 || p.kills > ANTI_CHEAT.maxKillsPerSec * (p.timeMs / 1000)) return 'kills';
  if (!Number.isFinite(p.level) || p.level < 1 || p.level > ANTI_CHEAT.maxLevel) return 'level';
  return null;
}

// ---------- push-уведомление referrer'у (V7) ----------
/**
 * Telegram: когда приглашённый завершает первый забег по реф-ссылке,
 * шлём referrer'у сообщение «твой ход» (Bot API sendMessage, fire-and-forget).
 * Работает только для TG-рефереров (uid — числовой chat id). MAX — TODO-V7
 * (webhook-бот после получения токена).
 */
async function notifyReferrer(fromUid) {
  if (!TG_TOKEN) return;
  if (!/^\d+$/.test(fromUid)) return; // только TG-uid (chat id)
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
    });
  } catch {
    /* push — best effort, не трогаем ответ клиенту */
  }
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
    }));
}

function getTop({ period = 'all', platform, includeUnverified = false } = {}) {
  const now = Date.now();
  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = dayKey(now);
  const weekAgo = now - 7 * 86_400_000;

  let list = store.scores.filter((s) => (includeUnverified || s.verified));
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
function dailyStats(user, platform) {
  const mine = bestByUser(
    store.scores.filter((s) => s.platform === platform && s.uid === user && s.daily)
  );
  if (mine.length === 0) return { dateKey: null, total: 0, rank: null, you: null };
  const today = mine[0].dateKey;
  const daily = store.scores.filter((s) => s.daily && s.dateKey === today);
  const byUser = bestByUser(daily);
  const total = byUser.length;
  const sorted = [...byUser].sort(compareScores);
  const idx = sorted.findIndex((s) => s.platform === platform && s.uid === user);
  return {
    dateKey: today,
    total,
    rank: idx >= 0 ? idx + 1 : null,
    you: { win: mine[0].win, timeMs: mine[0].timeMs, kills: mine[0].kills },
  };
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
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': process.env.ALLOW_ORIGIN ?? '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, app: 'ofeliya-server', scores: store.scores.length });
    }

    if (req.method === 'POST' && url.pathname === '/api/score') {
      const body = await readBody(req);
      const { platform, initData, anonId, webAppInit, payload } = body;
      if (!['telegram', 'max', 'browser', 'vk'].includes(platform)) {
        return send(res, 400, { ok: false, error: 'bad platform' });
      }
      if (!payload || typeof payload !== 'object') return send(res, 400, { ok: false, error: 'no payload' });

      let uid = null;
      let verified = false;
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
      }

      const cheat = antiCheatCheck(payload);
      if (cheat) return send(res, 422, { ok: false, error: `anti-cheat: ${cheat}` });

      const dateKey =
        typeof payload.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.dateKey)
          ? payload.dateKey
          : new Date().toISOString().slice(0, 10);
      const record = {
        platform,
        uid,
        dateKey,
        daily: payload.daily === true,
        win: payload.win === true,
        timeMs: Math.round(payload.timeMs),
        kills: Math.round(payload.kills),
        level: Math.round(payload.level),
        ref: typeof payload.ref === 'string' ? payload.ref.slice(0, 64) : null,
        verified,
        ts: Date.now(),
      };

      store.scores.push(record);
      if (store.scores.length > MAX_SCORES) store.scores.splice(0, store.scores.length - MAX_SCORES);

      // Реферал: записываем рёбро и разовую награду.
      let refReward = null;
      if (record.ref) {
        const edgeKey = `${record.ref}>${platform}:${uid}`;
        if (!store.refs.some((r) => r.edge === edgeKey)) {
          store.refs.push({ edge: edgeKey, from: record.ref, to: `${platform}:${uid}`, ts: record.ts });
          if (store.refs.length > MAX_REFS) store.refs.splice(0, store.refs.length - MAX_REFS);
        }
        if (!store.refRewards[edgeKey]) {
          store.refRewards[edgeKey] = record.ts;
          refReward = { from: record.ref, to: `${platform}:${uid}`, first: true };
          // V7: push referrer'у «твой ход» (best effort, не блокирует ответ).
          void notifyReferrer(record.ref);
        }
      }

      saveStore();
      const top = getTop({ period: record.daily ? 'daily' : 'all' });
      const rank = top.find((t) => t.uid === uid && t.platform === platform)?.rank ?? null;
      return send(res, 200, { ok: true, rank, top, refReward });
    }

    if (req.method === 'GET' && url.pathname === '/api/top') {
      const rawPeriod = url.searchParams.get('period') ?? 'all';
      const period = ['all', 'daily', 'weekly', 'season'].includes(rawPeriod) ? rawPeriod : 'all';
      const top = getTop({
        period,
        platform: url.searchParams.get('platform') ?? undefined,
        includeUnverified: url.searchParams.get('includeUnverified') === '1',
      });
      return send(res, 200, { ok: true, top, period, season: currentSeason() });
    }

    // C5: текущий сезон (индекс, окно, дней до конца).
    if (req.method === 'GET' && url.pathname === '/api/season') {
      return send(res, 200, { ok: true, season: currentSeason() });
    }

    // V4: «общий» результат дня — «ты №7 из 412 сегодня».
    if (req.method === 'GET' && url.pathname === '/api/daily') {
      const user = (url.searchParams.get('user') ?? '').slice(0, 128);
      const platform = (url.searchParams.get('platform') ?? '').toLowerCase();
      if (!user || !['telegram', 'max', 'browser', 'vk'].includes(platform)) {
        return send(res, 400, { ok: false, error: 'bad request' });
      }
      return send(res, 200, { ok: true, ...dailyStats(user, platform) });
    }

    // Legacy endpoint: текущий клиент пишет ref вместе с аутентифицированным
    // /api/score. Оставляем совместимость со старым клиентом, но жёстко
    // ограничиваем поля и размер store, чтобы endpoint нельзя было раздувать.
    if (req.method === 'POST' && url.pathname === '/api/ref') {
      const body = await readBody(req);
      const { from, to, platform } = body;
      if (
        typeof from !== 'string' ||
        typeof to !== 'string' ||
        from.length < 1 ||
        from.length > 64 ||
        to.length < 1 ||
        to.length > 64 ||
        !['telegram', 'max', 'browser', 'vk'].includes(platform)
      ) {
        return send(res, 400, { ok: false, error: 'bad ref' });
      }
      const edgeKey = `${from}>${platform}:${to}`;
      let first = false;
      if (!store.refs.some((r) => r.edge === edgeKey)) {
        store.refs.push({ edge: edgeKey, from, to: `${platform}:${to}`, ts: Date.now() });
        if (store.refs.length > MAX_REFS) store.refs.splice(0, store.refs.length - MAX_REFS);
        first = true;
      }
      if (!store.refRewards[edgeKey]) {
        store.refRewards[edgeKey] = Date.now();
        first = true;
      }
      saveStore();
      return send(res, 200, { ok: true, first });
    }

    if (req.method === 'GET' && url.pathname === '/api/ref') {
      const user = url.searchParams.get('user') ?? '';
      const platform = url.searchParams.get('platform') ?? '';
      const mine = store.refs.filter((r) => r.from === user).length;
      return send(res, 200, { ok: true, user, platform, invited: mine });
    }

    // V2: топ друзей по реферальным рёбрам (двунаправленно: кого позвал + кто позвал).
    if (req.method === 'GET' && url.pathname === '/api/friends') {
      const user = url.searchParams.get('user') ?? '';
      const platform = url.searchParams.get('platform') ?? '';
      if (!user) return send(res, 400, { ok: false, error: 'no user' });

      const friends = new Map(); // uid -> relation
      for (const r of store.refs) {
        if (r.from === user) {
          const toUid = String(r.to).split(':').slice(1).join(':');
          if (toUid) friends.set(toUid, friends.has(toUid) ? 'both' : 'invited');
        }
        if (platform && r.to === `${platform}:${user}`) {
          if (r.from) friends.set(r.from, friends.has(r.from) ? 'both' : 'inviter');
        }
      }

      // лучший скор каждого друга (по uid, любая платформа)
      const out = [];
      for (const [uid, relation] of friends) {
        let best = null;
        for (const s of store.scores) {
          if (s.uid !== uid) continue;
          if (!best || compareScores(s, best) < 0) best = s;
        }
        if (best) {
          out.push({
            relation,
            uid,
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
      return send(res, 200, { ok: true, user, platform, friends: out.slice(0, 10) });
    }

    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message ?? 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`[ofeliya-server] http://localhost:${PORT} (data: ${DATA_DIR})`);
  if (!TG_TOKEN) console.warn('[ofeliya-server] TG_BOT_TOKEN не задан — telegram-скоры не будут верифицироваться');
  if (!MAX_TOKEN) console.warn('[ofeliya-server] MAX_BOT_TOKEN/BOT_TOKEN не задан — max-скоры не будут верифицироваться');
});

export { server };

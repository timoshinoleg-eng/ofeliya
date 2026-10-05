#!/usr/bin/env node
/**
 * OFELIYA Telegram-бот (V7). НОЛЬ зависимостей — raw Bot API long polling.
 *
 * Задачи:
 *  - /start: регистрация пользователя, deep-link `ref_<uid>` → приветствие
 *    с игрой и напоминанием про бонус приглашённого;
 *  - произвольное сообщение → ссылка на игру;
 *  - реестр users (server/data/tg_users.json) — используется push-сервером:
 *    когда приглашённый завершает забег, score-сервер шлёт referrer'у
 *    push «твой ход» через тот же Bot API (см. notifyReferrer в index.mjs).
 *
 * MAX-бот: другой API (webhooks, dev.max.ru) — stub, подключается после
 * получения токена бота (заглушка ниже, TODO-V7).
 *
 * Запуск: node server/bot.mjs
 *   env: TG_BOT_TOKEN (обязателен), GAME_URL (ссылка на мини-апп)
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { telegramApiJson } from './telegram-api.mjs';
import { buildTelegramWebhookMethod, parseTelegramStartParam } from './telegram-webhook.mjs';

const TG_TOKEN = process.env.TG_BOT_TOKEN ?? '';
const GAME_URL = process.env.GAME_URL ?? '';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USERS_FILE = join(ROOT, 'server', 'data', 'tg_users.json');

if (!TG_TOKEN) {
  console.error('[bot] TG_BOT_TOKEN не задан — бот не запущен');
  process.exit(1);
}

// ---------- реестр пользователей ----------
let users = {};
try {
  users = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
} catch {
  users = {};
}

function saveUsers() {
  mkdirSync(dirname(USERS_FILE), { recursive: true });
  try {
    const tmp = `${USERS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(users));
    renameSync(tmp, USERS_FILE);
  } catch (e) {
    console.error('[bot] save users failed:', e.message);
  }
}

// ---------- Bot API ----------
async function api(method, params = {}) {
  const response = await telegramApiJson({
    token: TG_TOKEN,
    method,
    params,
    timeoutMs: method === 'getUpdates' ? 60_000 : 10_000,
  });
  const data = response.body ?? {};
  if (!response.ok || !data.ok) {
    throw new Error(`tg ${method}: ${data.description ?? response.status}`);
  }
  return data.result;
}

export function parseStartParam(text) {
  return parseTelegramStartParam(text);
}

const REPLY_GAME = GAME_URL
  ? `⚡️ OFELIYA — удержи ядро!\n\n${GAME_URL}\n\nПобеда над боссом, ежедневные испытания и рывки. Пригласи друга — оба получите выгоду.`
  : '⚡️ OFELIYA — удержи ядро! (GAME_URL не задан — ссылка появится после публикации)';

async function handleStart(msg, param) {
  const uid = String(msg.from?.id ?? '');
  const first = msg.from?.first_name ?? 'игрок';
  if (uid) {
    users[uid] = {
      chatId: uid,
      first,
      joinedAt: users[uid]?.joinedAt ?? Date.now(),
    };
    saveUsers();
  }
  const method = buildTelegramWebhookMethod({ message: msg }, { gameUrl: GAME_URL });
  if (method) {
    const { method: apiMethod, ...params } = method;
    await api(apiMethod, params).catch((e) => console.error('[bot] sendMessage failed:', e.message));
  }
}

// ---------- long polling ----------
let offset = 0;
let stopping = false;

export async function pollOnce() {
  const updates = await api('getUpdates', {
    offset,
    timeout: 50,
    allowed_updates: ['message'],
  });
  for (const update of updates) {
    offset = update.update_id + 1;
    const msg = update.message;
    if (!msg) continue;
    try {
      if (msg.text && msg.text.startsWith('/')) {
        const [cmdRaw] = msg.text.split(' ');
        const cmd = cmdRaw.replace(/@.+$/, ''); // /start@mybot → /start
        if (cmd === '/start') {
          await handleStart(msg, parseStartParam(msg.text));
        } else if (cmd === '/help') {
          if (msg.chat?.id != null) {
            const { method, ...params } = buildTelegramWebhookMethod({ message: msg }, { gameUrl: GAME_URL });
            await api(method, params).catch(() => {});
          }
        }
      } else {
        if (msg.chat?.id != null) {
          await api('sendMessage', {
            chat_id: msg.chat.id,
            text: REPLY_GAME,
            disable_web_page_preview: true,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[bot] update failed:', e.message);
    }
  }
  return updates.length;
}

async function main() {
  console.log('[bot] OFELIYA bot started (long polling)');
  for (;;) {
    if (stopping) break;
    try {
      await pollOnce();
    } catch (e) {
      // 409 = есть другой поллер; 429 = ретраи по retry_after; сети — пауза.
      console.error('[bot] poll error:', e.message);
      await new Promise((r) => setTimeout(r, e.message.includes('429') ? 3000 : 1000));
    }
  }
  console.log('[bot] stopped');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    process.exit(0);
  });
}

// Стартуем только при прямом запуске (node server/bot.mjs), а не при import.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

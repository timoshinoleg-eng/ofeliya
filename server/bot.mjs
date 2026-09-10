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
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`tg ${method}: ${data.description ?? res.status}`);
  return data.result;
}

export function parseStartParam(text) {
  if (typeof text !== 'string') return null;
  const p = text.split(' ').slice(1).join(' ').trim();
  return p.length > 0 ? p : null;
}

const REPLY_GAME = GAME_URL
  ? `⚡️ OFELIYA — удержи ядро!\n\n${GAME_URL}\n\nПобеда над боссом, ежедневные испытания и рывки. Пригласи друга — оба получите выгоду.`
  : '⚡️ OFELIYA — удержи ядро! (GAME_URL не задан — ссылка появится после публикации)';

async function handleStart(msg, param) {
  const uid = String(msg.from?.id ?? '');
  const first = msg.from?.first_name ?? 'игрок';
  const isNew = !users[uid];
  if (uid) {
    users[uid] = {
      chatId: uid,
      first,
      joinedAt: users[uid]?.joinedAt ?? Date.now(),
    };
    saveUsers();
  }
  let reply;
  if (param && param.startsWith('ref_')) {
    reply = `Привет, ${first}! 👋\nДруг позвал тебя в OFELIYA — на первом забеге получишь бонус: +1 HP и рывк быстрее.\n\n${REPLY_GAME}`;
  } else if (param) {
    reply = `Привет, ${first}! ${REPLY_GAME}`;
  } else {
    reply = isNew
      ? `Привет, ${first}! Это бот OFELIYA.\n\n${REPLY_GAME}\n\nКак пригласить друга: на экране «Итоги» — кнопка ПРИГЛАСИТЬ.`
      : REPLY_GAME;
  }
  if (msg.chat?.id != null) {
    await api('sendMessage', {
      chat_id: msg.chat.id,
      text: reply,
      disable_web_page_preview: true,
    }).catch((e) => console.error('[bot] sendMessage failed:', e.message));
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
        const [cmdRaw, ...rest] = msg.text.split(' ');
        const cmd = cmdRaw.replace(/@.+$/, ''); // /start@mybot → /start
        if (cmd === '/start') {
          await handleStart(msg, parseStartParam(`/${rest.join(' ')}`));
        } else if (cmd === '/help') {
          if (msg.chat?.id != null) {
            await api('sendMessage', {
              chat_id: msg.chat.id,
              text: '⚡️ OFELIYA\n\nКоманды:\n/start — играть\n/start ref_<id> — по приглашению друга (бонус на первый забег)\n/help — помощь',
            }).catch(() => {});
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

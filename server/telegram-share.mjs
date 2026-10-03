import { randomUUID } from 'node:crypto';
import { telegramApiJson } from './telegram-api.mjs';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_TEXT = 3000;
const MAX_LINK = 512;

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_TEXT);
}

function cleanTelegramLink(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > MAX_LINK) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 't.me') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function buildPreparedShareResult(text, link) {
  const safeText = cleanText(text);
  if (!safeText) return null;
  const safeLink = cleanTelegramLink(link);
  const messageText = safeLink ? `${safeText}\n\n${safeLink}` : safeText;
  return {
    type: 'article',
    id: randomUUID(),
    title: 'OFELIYA',
    input_message_content: {
      message_text: messageText,
      disable_web_page_preview: true,
    },
  };
}

export async function saveTelegramPreparedMessage({
  token,
  userId,
  text,
  link,
  fetchImpl = globalThis.fetch,
}) {
  if (!token || !/^\d+$/.test(String(userId ?? '')) || typeof fetchImpl !== 'function') return null;
  const result = buildPreparedShareResult(text, link);
  if (!result) return null;

  const params = {
    user_id: Number(userId),
    result,
    allow_user_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true,
    allow_bot_chats: false,
  };
  let responseOk = false;
  let body = null;
  if (fetchImpl !== globalThis.fetch) {
    const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/savePreparedInlineMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    responseOk = response.ok;
    body = await response.json().catch(() => null);
  } else {
    const response = await telegramApiJson({
      token,
      method: 'savePreparedInlineMessage',
      params,
      timeoutMs: 10_000,
    });
    responseOk = response.ok;
    body = response.body;
  }
  if (!responseOk || body?.ok !== true || typeof body?.result?.id !== 'string') return null;
  return {
    id: body.result.id,
    expirationDate:
      typeof body.result.expiration_date === 'number' ? body.result.expiration_date : null,
  };
}

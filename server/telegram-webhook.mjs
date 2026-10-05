import { timingSafeEqual } from 'node:crypto';

function safeText(value, max = 96) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function telegramWebhookSecretMatches(expected, provided) {
  if (typeof expected !== 'string' || expected.length < 16 || typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseTelegramStartParam(text) {
  if (typeof text !== 'string') return null;
  const firstSpace = text.indexOf(' ');
  if (firstSpace < 0) return null;
  const value = text.slice(firstSpace + 1).trim();
  return /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : null;
}

export function buildTelegramWebhookMethod(update, {
  gameUrl = '', miniAppUrl = process.env.OFELIYA_TELEGRAM_GAME_URL ?? '',
} = {}) {
  const message = update?.message;
  const chatId = message?.chat?.id;
  if (chatId == null || (typeof chatId !== 'number' && typeof chatId !== 'string')) return null;

  const text = safeText(message?.text, 1024);
  if (!text) return null;
  const firstName = safeText(message?.from?.first_name, 64) || 'игрок';
  const [rawCommand] = text.split(/\s+/, 1);
  const command = rawCommand.replace(/@[^\s]+$/, '');
  const param = parseTelegramStartParam(text);

  let reply;
  if (command === '/start') {
    reply = param?.startsWith('ref_')
      ? `Привет, ${firstName}! Друг позвал тебя в OFELIYA. Открой игру и начни первый забег.`
      : `Привет, ${firstName}! Это OFELIYA: STRAIN ZERO. Открой игру и удержи ядро.`;
  } else if (command === '/help') {
    reply = 'OFELIYA: STRAIN ZERO\n\n/start — открыть игру\n/help — помощь';
  } else {
    reply = 'OFELIYA: STRAIN ZERO — открой игру кнопкой ниже.';
  }

  const launchUrl = safeHttpsUrl(gameUrl);
  const isDirectLaunch = launchUrl && new URL(launchUrl).hostname === 't.me';
  let directUrl = safeHttpsUrl(miniAppUrl) || (isDirectLaunch ? launchUrl : '');
  if (directUrl) {
    const direct = new URL(directUrl);
    if (direct.hostname !== 't.me') directUrl = '';
    else if (param) {
      direct.searchParams.set('startapp', param);
      directUrl = direct.toString();
    }
  }
  const method = {
    method: 'sendMessage',
    chat_id: chatId,
    text: reply,
    disable_web_page_preview: true,
  };
  if (launchUrl || directUrl) {
    const useWebApp = message.chat.type === 'private' && !param && launchUrl && !isDirectLaunch;
    method.reply_markup = {
      inline_keyboard: [[useWebApp
        ? { text: 'Играть', web_app: { url: launchUrl } }
        : { text: 'Играть', url: directUrl || launchUrl }]],
    };
  }
  return method;
}

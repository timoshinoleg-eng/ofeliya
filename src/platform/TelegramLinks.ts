const TELEGRAM_BOT_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const TELEGRAM_APP_SHORT_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

export function buildTelegramStartLink(
  payload: string,
  botName: string,
  appShortName = ''
): string | null {
  const bot = String(botName ?? '').trim().replace(/^@/, '');
  if (!TELEGRAM_BOT_NAME_RE.test(bot)) return null;

  const encoded = encodeURIComponent(payload);
  const shortName = String(appShortName ?? '').trim();
  if (shortName && TELEGRAM_APP_SHORT_NAME_RE.test(shortName)) {
    return `https://t.me/${bot}/${shortName}?startapp=${encoded}`;
  }
  return `https://t.me/${bot}?startapp=${encoded}`;
}

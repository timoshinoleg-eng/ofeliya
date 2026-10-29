/**
 * stars-proxy.mjs — прокси Stars-апдейтов Telegram → Cloudflare Worker.
 *
 * Патч №14 (P0-4): у Telegram-бота ОДИН setWebhook-URL. Действующий бот
 * OFELIYA уже принимает апдейты на POST /api/telegram/webhook этого
 * сервера (команды /start, /help — см. server/telegram-webhook.mjs).
 * Перенастраивать setWebhook на воркер НЕЛЬЗЯ — умрут /start и запуск игры.
 *
 * Поэтому Stars-апдейты (pre_checkout_query, successful_payment) этот
 * сервер НЕ обрабатывает сам, а проксирует на воркер (worker/src/index.ts),
 * где живёт D1-журнал платежей. Воркер остаётся standalone-альтернативой
 * (можно слать setWebhook прямо на него, если /start не нужен).
 *
 * Конфигурация (env):
 *   OFELIYA_STARS_WORKER_URL     — https://<worker>/api/webhook
 *   OFELIYA_STARS_WORKER_SECRET  — WEBHOOK_SECRET воркера (НЕ TG_WEBHOOK_SECRET
 *                                  этого сервера — секреты разные!)
 *
 * Fail-closed: прокси настроен не полностью ИЛИ воркер недоступен →
 * forwardStarsUpdate бросает → роут отвечает 503 → Telegram переотправит
 * апдейт позже. Молча глотать Stars-апдейты (200 без обработки) ЗАПРЕЩЕНО:
 * это потерянные оплаты.
 *
 * Тайминги: pre_checkout_query Telegram требует ответить в течение 10с.
 * Прокси-таймаут 8с оставляет запас; воркер сам вызывает
 * answerPreCheckoutQuery напрямую через Bot API.
 */

/** True, если апдейт относится к Stars-платежам, а не к командам бота. */
export function isStarsUpdate(update) {
  if (!update || typeof update !== 'object') return false;
  if (update.pre_checkout_query && typeof update.pre_checkout_query === 'object') return true;
  const msg = update.message;
  return !!msg && typeof msg === 'object' && !!msg.successful_payment;
}

/**
 * Проксирует Stars-апдейт на воркер.
 * @returns {Promise<{status:number, body:unknown}>} ответ воркера как есть.
 * @throws при отсутствии конфигурации или недоступности воркера.
 */
export async function forwardStarsUpdate(
  update,
  { workerUrl, workerSecret, timeoutMs = 8000, request = fetch } = {}
) {
  const url = typeof workerUrl === 'string' ? workerUrl.trim().replace(/\/+$/, '') : '';
  if (!url || !url.startsWith('https://')) {
    throw new Error('stars worker url not configured');
  }
  if (typeof workerSecret !== 'string' || workerSecret.length < 16) {
    throw new Error('stars worker secret not configured');
  }
  const res = await request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Секрет ВОРКЕРА, не этого сервера: воркер сверяет его со своим
      // WEBHOOK_SECRET (fail-closed 401 без него).
      'x-telegram-bot-api-secret-token': workerSecret,
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: 'bad-worker-response' };
  }
  return { status: res.status, body };
}

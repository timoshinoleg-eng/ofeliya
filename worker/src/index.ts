/**
 * OFELIYA payments reference backend — Cloudflare Worker (TypeScript, zero deps).
 *
 * Зачем: Telegram Stars-инвойсы НЕЛЬЗЯ создавать из клиента (нужен bot token),
 * поэтому игре нужен минимальный бэкенд.
 *
 * Протокол v2 (патч №12, согласован с потоком клиента):
 *
 *  POST /api/invoice {initData, productId, nonce}
 *    → валидирует initData по HMAC-SHA256 (документация Telegram:
 *      https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 *    → сверяет товар с СЕРВЕРНЫМ whitelist (цену от клиента НЕ доверяет)
 *    → nonce обязан матчить ^[A-Za-z0-9_-]{8,64}$ (генерирует клиент)
 *    → Bot API createInvoiceLink (currency='XTR', provider_token='',
 *      prices=[{label, amount}] — amount в ЦЕЛЫХ звёздах, payload=nonce
 *      (лимит Telegram: 1–128 байт))
 *    → сохраняет order:{nonce}={userId, productId, createdAt} в KV (TTL 3600)
 *    → 200 {invoiceUrl, nonce}
 *
 *  POST /api/webhook  (Telegram → воркер)
 *    → WEBHOOK_SECRET ОБЯЗАТЕЛЕН: не задан в env → 401 fail-closed.
 *      Заголовок X-Telegram-Bot-Api-Secret-Token сверяется со значением.
 *    → pre_checkout_query: payload — это nonce; с KV резолвится через
 *      order:{nonce} → сверка (amount, currency) с SERVER_PRODUCTS →
 *      answerPreCheckoutQuery (ОБЯЗАТЕЛЬНО в течение 10 секунд, иначе
 *      платёж отменяется). Без KV — ok:true (цены зафиксированы сервером
 *      в самом инвойсе; деградация как раньше).
 *    → message.successful_payment {telegram_payment_charge_id,
 *      invoice_payload(=nonce), total_amount, currency, from:{id}}:
 *      проверки — order:{nonce} существует и from.id == order.userId;
 *      (amount, currency) == SERVER_PRODUCTS[productId] (XTR, amount==stars);
 *      идемпотентность: pay:{charge_id} уже существует → skip
 *      (повторная доставка Telegram).
 *      Записи: pay:{charge_id}={userId, productId, amount, currency,
 *      status:'paid', nonce, createdAt}; nonce:{nonce}→charge_id;
 *      user:{userId}:journal=append charge_id (dedupe).
 *
 *  POST /api/verify {initData, nonce}
 *    → {verified:true, chargeId, productId} | {verified:false, reason:
 *      'not_found' | 'mismatch'}. Без KV → 501 {error:'kv_unavailable'}.
 *
 *  POST /api/entitlements {initData}
 *    → {purchases:[{chargeId, productId, status, createdAt}]} в порядке
 *      журнала. Без KV → 501 {error:'kv_unavailable'}.
 *      ВНИМАНИЕ (v2, breaking): старый {products:[...]} заменён журналом;
 *      миграции не требуется — KV ещё не в проде.
 *
 *  GET /api/health → {ok:true} (проверка деплоя).
 *
 * Раскладка ключей KV:
 *  order:{nonce}          — {userId, productId, createdAt}, TTL 3600
 *  pay:{charge_id}        — {userId, productId, amount, currency,
 *                           status:'paid'|'credited', nonce, createdAt}
 *  nonce:{nonce}          — charge_id (для /api/verify)
 *  user:{userId}:journal  — [charge_id, ...], порядок покупок, без дублей
 *
 * Статус 'credited' зарезервирован в типах/доках под ручные возвраты и
 * ручные начисления — вне скоупа воркера (возвраты — отдельное решение Mark).
 *
 * KV (Cloudflare, бесплатный тир) — опционален: без биндинга PAYMENTS
 * /api/entitlements и /api/verify отвечают 501, а successful_payment
 * только логируется (как раньше). С биндингом клиент сверяет покупку
 * с сервером вместо доверия клиентскому колбэку openInvoice.
 *
 * Серверный контракт scripts/check-profile-client.mjs:162
 * ('purchase' must never be accepted) в этом скоупе НЕ меняется:
 * KV воркера — его собственное хранилище entitlements, а не inventory
 * профильного сервера. Отдельное решение.
 *
 * Секреты (wrangler secret put, НЕ в репозиторий):
 *  TELEGRAM_BOT_TOKEN — токен бота из BotFather;
 *  WEBHOOK_SECRET     — ОБЯЗАТЕЛЕН (fail-closed 401 без него); сверяется
 *                       с заголовком X-Telegram-Bot-Api-Secret-Token.
 *
 * KV: npx wrangler kv:namespace create PAYMENTS (см. worker/README_DEPLOY.md).
 *
 * Деплой: см. worker/README_DEPLOY.md. Ничего из этого файла не деплоится
 * автоматически — только руками Mark.
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  /** ОБЯЗАТЕЛЕН для /api/webhook: отсутствует → 401 fail-closed (патч №12). */
  WEBHOOK_SECRET?: string;
  /**
   * Пост-ревью (патч №11): Cloudflare KV для entitlements.
   * Минимальный интерфейс вместо @cloudflare/workers-types (zero deps).
   */
  PAYMENTS?: KVNamespace;
}

/** Минимальный сабсет KV API, достаточный воркеру. */
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Серверный каталог: ЦЕНА ВСЕГДА С СЕРВЕРА. Должен совпадать с
 * src/game/shop/products.ts (stars), но клиентскому значению не доверяем.
 * Экспортирован для Node-тестов.
 */
export const SERVER_PRODUCTS: Record<string, { title: string; description: string; stars: number }> = {
  'skin.virulent-magenta': {
    title: 'Штамм «Вирулентный»',
    description: 'Пурпурный боевой окрас STRAIN-0. Чистая косметика.',
    stars: 100,
  },
  'skin.abyssal-teal': {
    title: 'Штамм «Бездонный»',
    description: 'Глубоководный тил. Виден даже в темной плазме.',
    stars: 100,
  },
  'skin.gilded-prime': {
    title: 'Штамм «Позолоченный»',
    description: 'Праймовый золотой штамм для ветеранов кровотока.',
    stars: 250,
  },
  'booster.rna-x2-7d': {
    title: 'РНК ×2 — 7 дней',
    description: 'Двойной дроп РНК со всех гемов в течение недели.',
    stars: 75,
  },
  'currency.rna-pack-s': {
    title: 'Набор РНК ×500',
    description: 'Малая капсула чистой РНК для лаборатории мутаций.',
    stars: 35,
  },
  'currency.rna-pack-m': {
    title: 'Набор РНК ×1500',
    description: 'Средняя капсула. Выгоднее малого набора на 13%.',
    stars: 100,
  },
};

/**
 * Статус платежа в KV. 'credited' зарезервирован под ручные возвраты и
 * ручные начисления — воркер его не выставляет (вне скоупа).
 */
export type PaymentStatus = 'paid' | 'credited';

interface OrderRecord {
  userId: number;
  productId: string;
  createdAt: number;
}

interface PaymentRecord {
  userId: number;
  productId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  nonce: string;
  createdAt: number;
}

/** initData старше суток считаем протухшей. */
const INIT_DATA_MAX_AGE_S = 86400;

/** TTL заказа в KV: инвойс живёт дольше, но сверка нужна только на окне оплаты. */
const ORDER_TTL_S = 3600;

/** Nonce генерирует клиент; формат — как start_param в server/telegram-webhook.mjs. */
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

function isValidNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_RE.test(value);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Reference-реализация: initData-авторизация идёт в каждом запросе,
      // поэтому CORS открыт. Mark может сузить до своих доменов.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

/**
 * Валидация initData по официальной схеме Telegram:
 *   data_check_string = sorted "key=<value>" (кроме hash), join '\n'
 *   secret_key = HMAC_SHA256(bot_token, key="WebAppData")
 *   hex(HMAC_SHA256(data_check_string, secret_key)) == hash
 * Плюс проверка свежести auth_date.
 * Экспортирована для Node-тестов (tests/worker-payments.mjs).
 */
export async function validateInitData(
  initData: string,
  botToken: string
): Promise<{ ok: boolean; userId?: number; reason?: string }> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'bad-init-data' };
  }
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no-hash' };
  const authDate = Number(params.get('auth_date') ?? '0');
  if (!Number.isFinite(authDate) || authDate <= 0 || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_S) {
    return { ok: false, reason: 'stale-auth-date' };
  }
  // NB: lib.webworker в этой версии TS не объявляет URLSearchParams.keys(),
  // поэтому собираем ключи через forEach (семантика та же).
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (key === 'hash' || seen.has(key)) return;
    seen.add(key);
    pairs.push([key, value]);
  });
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const secretKey = await hmacSha256(enc.encode('WebAppData'), enc.encode(botToken));
  const check = await hmacSha256(secretKey, enc.encode(dataCheckString));
  const checkHex = [...check].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (checkHex.length !== hash.length) return { ok: false, reason: 'bad-hash' };
  let diff = 0;
  for (let i = 0; i < checkHex.length; i++) {
    diff |= checkHex.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: 'bad-hash' };
  let userId: number | undefined;
  try {
    const raw = params.get('user');
    if (raw) {
      const u = JSON.parse(raw) as { id?: unknown };
      if (typeof u.id === 'number') userId = u.id;
    }
  } catch {
    // user опционален для проверки подписи
  }
  return { ok: true, userId };
}

async function botApi(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || !data.ok) {
    throw new Error(`Bot API ${method} failed: ${data.description ?? res.status}`);
  }
  return data.result;
}

async function handleInvoice(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'backend-misconfigured' }, 500);
  let body: { productId?: unknown; initData?: unknown; nonce?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const productId = typeof body.productId === 'string' ? body.productId : '';
  const initData = typeof body.initData === 'string' ? body.initData : '';
  const nonce = body.nonce;
  const product = SERVER_PRODUCTS[productId];
  if (!product) return json({ error: 'unknown-product' }, 400);
  if (!isValidNonce(nonce)) return json({ error: 'bad-nonce' }, 400);
  const v = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok) return json({ error: 'bad-init-data', reason: v.reason }, 401);
  // Атрибуция платежа требует userId: без него вебхук не сможет сверить from.id.
  if (v.userId == null) return json({ error: 'bad-init-data', reason: 'no-user-id' }, 401);
  let invoiceUrl: string;
  try {
    invoiceUrl = (await botApi(env.TELEGRAM_BOT_TOKEN, 'createInvoiceLink', {
      title: product.title,
      description: product.description,
      payload: nonce, // v2: сырой nonce, не JSON (лимит Telegram 1–128 байт)
      provider_token: '', // пусто для Stars (цифровые товары)
      currency: 'XTR',
      prices: [{ label: product.title, amount: product.stars }],
    })) as string;
  } catch {
    return json({ error: 'invoice-create-failed' }, 502);
  }
  if (env.PAYMENTS) {
    try {
      const order: OrderRecord = { userId: v.userId, productId, createdAt: Date.now() };
      await env.PAYMENTS.put(`order:${nonce}`, JSON.stringify(order), {
        expirationTtl: ORDER_TTL_S,
      });
    } catch {
      // Инвойс уже создан Telegram, но заказ не сохранён: вебхук не сможет
      // его атрибутировать. Честно отвечаем 502 вместо битого трекинга.
      return json({ error: 'order-store-failed' }, 502);
    }
  }
  return json({ invoiceUrl, nonce });
}

interface PreCheckoutQuery {
  id: string;
  invoice_payload?: string;
  currency?: string;
  total_amount?: number;
}

interface SuccessfulPayment {
  currency?: string;
  total_amount?: number;
  invoice_payload?: string;
  telegram_payment_charge_id?: string;
  provider_payment_charge_id?: string;
}

function logEvent(event: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...extra }));
}

function parseOrder(raw: string | null): OrderRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { userId?: unknown; productId?: unknown; createdAt?: unknown };
    if (typeof o.userId !== 'number' || typeof o.productId !== 'string') return null;
    return {
      userId: o.userId,
      productId: o.productId,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/webhook (Telegram → воркер).
 * Fail-closed (патч №12, P3): без WEBHOOK_SECRET в env → 401, молчаливого
 * отключения проверки больше нет.
 */
async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.WEBHOOK_SECRET) {
    return new Response('webhook secret not configured', { status: 401 });
  }
  const got = request.headers.get('x-telegram-bot-api-secret-token');
  if (got !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  let update: {
    pre_checkout_query?: PreCheckoutQuery;
    message?: { successful_payment?: SuccessfulPayment; from?: { id?: number } };
  };
  try {
    update = (await request.json()) as typeof update;
  } catch {
    return json({ ok: false }, 400);
  }

  // 1. Pre-checkout: ответить ОБЯЗАТЕЛЬНО в течение 10 секунд.
  //    Payload — nonce (v2): с KV резолвим заказ и сверяем цену с серверным
  //    каталогом. Без KV трекать нечего, но цены зафиксированы сервером
  //    в самом инвойсе — отвечаем ok:true (деградация как раньше).
  const q = update.pre_checkout_query;
  if (q) {
    const nonce = q.invoice_payload ?? '';
    let ok = false;
    if (isValidNonce(nonce)) {
      if (env.PAYMENTS) {
        try {
          const order = parseOrder(await env.PAYMENTS.get(`order:${nonce}`));
          const server = order ? SERVER_PRODUCTS[order.productId] : undefined;
          ok = !!server && q.currency === 'XTR' && q.total_amount === server.stars;
        } catch {
          ok = false;
        }
      } else {
        ok = true;
      }
    }
    await botApi(env.TELEGRAM_BOT_TOKEN, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Товар недоступен. Попробуйте позже.' }),
    });
    return json({ ok: true });
  }

  // 2. Успешный платёж → идемпотентная запись в журнал KV (протокол v2).
  //    Без KV-биндинга — только структурированный лог, как раньше.
  const sp = update.message?.successful_payment;
  if (sp) {
    await recordSuccessfulPayment(sp, update.message?.from?.id, env);
  }
  return json({ ok: true });
}

async function recordSuccessfulPayment(
  sp: SuccessfulPayment,
  fromId: number | undefined,
  env: Env
): Promise<void> {
  const nonce = sp.invoice_payload ?? '';
  const chargeId = sp.telegram_payment_charge_id;
  const base = {
    stars: sp.total_amount,
    currency: sp.currency,
    telegramChargeId: chargeId,
    providerChargeId: sp.provider_payment_charge_id,
    nonce,
  };
  if (!env.PAYMENTS) {
    logEvent('stars_payment_unverified', { ...base, userId: fromId });
    return;
  }
  if (!isValidNonce(nonce) || !chargeId || typeof fromId !== 'number') {
    logEvent('stars_payment_invalid', { ...base, userId: fromId });
    return;
  }
  try {
    // Идемпотентность: повторная доставка того же charge_id — skip.
    const payKey = `pay:${chargeId}`;
    if (await env.PAYMENTS.get(payKey)) {
      logEvent('stars_payment_duplicate', { ...base, userId: fromId });
      return;
    }
    const order = parseOrder(await env.PAYMENTS.get(`order:${nonce}`));
    if (!order) {
      logEvent('stars_payment_unknown_order', { ...base, userId: fromId });
      return;
    }
    if (order.userId !== fromId) {
      logEvent('stars_payment_user_mismatch', {
        ...base,
        userId: fromId,
        orderUserId: order.userId,
      });
      return;
    }
    const server = SERVER_PRODUCTS[order.productId];
    if (!server || sp.currency !== 'XTR' || sp.total_amount !== server.stars) {
      logEvent('stars_payment_amount_mismatch', {
        ...base,
        userId: fromId,
        productId: order.productId,
        expected: server?.stars,
      });
      return;
    }
    const now = Date.now();
    const record: PaymentRecord = {
      userId: fromId,
      productId: order.productId,
      amount: sp.total_amount ?? 0,
      currency: sp.currency ?? '',
      status: 'paid',
      nonce,
      createdAt: now,
    };
    await env.PAYMENTS.put(payKey, JSON.stringify(record));
    await env.PAYMENTS.put(`nonce:${nonce}`, chargeId);
    // Журнал пользователя: append charge_id с дедупликацией.
    const journalKey = `user:${fromId}:journal`;
    const rawJournal = await env.PAYMENTS.get(journalKey);
    let journal: string[] = [];
    try {
      const parsed: unknown = rawJournal ? JSON.parse(rawJournal) : [];
      if (Array.isArray(parsed)) journal = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      journal = [];
    }
    if (!journal.includes(chargeId)) {
      journal.push(chargeId);
      await env.PAYMENTS.put(journalKey, JSON.stringify(journal));
    }
    logEvent('stars_payment_recorded', {
      ...base,
      userId: fromId,
      productId: order.productId,
    });
  } catch (err) {
    // KV не должен ронять вебхук: платёж уже подтверждён Telegram.
    // Разбор — по структурированным логам выше.
    logEvent('stars_payment_kv_error', { ...base, userId: fromId, error: String(err) });
  }
}

/**
 * POST /api/verify {initData, nonce} — точечная проверка одного платежа
 * (клиент зовёт после колбэка openInvoice вместо слепого доверия).
 * 501 — KV-биндинг не настроен.
 */
async function handleVerify(request: Request, env: Env): Promise<Response> {
  if (!env.PAYMENTS) return json({ error: 'kv_unavailable' }, 501);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'backend-misconfigured' }, 500);
  let body: { initData?: unknown; nonce?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const initData = typeof body.initData === 'string' ? body.initData : '';
  if (!isValidNonce(body.nonce)) return json({ error: 'bad-nonce' }, 400);
  const v = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok || v.userId == null) return json({ error: 'bad-init-data', reason: v.reason }, 401);
  try {
    const chargeId = await env.PAYMENTS.get(`nonce:${body.nonce}`);
    if (!chargeId) return json({ verified: false, reason: 'not_found' });
    const payRaw = await env.PAYMENTS.get(`pay:${chargeId}`);
    let pay: { userId?: unknown; productId?: unknown } | null = null;
    try {
      // NB: не `as typeof pay` — самореференция на объявляемую переменную
      // резолвится в never.
      pay = payRaw ? (JSON.parse(payRaw) as { userId?: unknown; productId?: unknown }) : null;
    } catch {
      pay = null;
    }
    const payUserId = typeof pay?.userId === 'number' ? pay.userId : undefined;
    const payProductId = typeof pay?.productId === 'string' ? pay.productId : undefined;
    if (payUserId === undefined || payProductId === undefined || payUserId !== v.userId) {
      return json({ verified: false, reason: 'mismatch' });
    }
    return json({ verified: true, chargeId, productId: payProductId });
  } catch {
    return json({ error: 'kv-read-failed' }, 502);
  }
}

/**
 * POST /api/entitlements {initData} — серверный журнал покупок (протокол v2).
 * ВНИМАНИЕ: формат ответа изменён с {products:[...]} на {purchases:[...]};
 * старый массив user:{id}:products больше не пишется и не читается.
 * Миграции не требуется — KV ещё не в проде.
 * 501 — KV-биндинг не настроен.
 */
async function handleEntitlements(request: Request, env: Env): Promise<Response> {
  if (!env.PAYMENTS) return json({ error: 'kv_unavailable' }, 501);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'backend-misconfigured' }, 500);
  let body: { initData?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const initData = typeof body.initData === 'string' ? body.initData : '';
  const v = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok || v.userId == null) return json({ error: 'bad-init-data', reason: v.reason }, 401);
  try {
    const journalRaw = await env.PAYMENTS.get(`user:${v.userId}:journal`);
    let journal: string[] = [];
    try {
      const parsed: unknown = journalRaw ? JSON.parse(journalRaw) : [];
      if (Array.isArray(parsed)) journal = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      journal = [];
    }
    const purchases: Array<{
      chargeId: string;
      productId: string;
      status: PaymentStatus;
      createdAt: number;
    }> = [];
    for (const chargeId of journal) {
      const payRaw = await env.PAYMENTS.get(`pay:${chargeId}`);
      try {
        const pay = payRaw
          ? (JSON.parse(payRaw) as {
              productId?: unknown;
              status?: unknown;
              createdAt?: unknown;
            })
          : null;
        if (pay && typeof pay.productId === 'string') {
          purchases.push({
            chargeId,
            productId: pay.productId,
            status: pay.status === 'credited' ? 'credited' : 'paid',
            createdAt: typeof pay.createdAt === 'number' ? pay.createdAt : 0,
          });
        }
      } catch {
        // Битый pay-запис пропускаем, журнал не роняем.
      }
    }
    return json({ purchases });
  } catch {
    return json({ error: 'kv-read-failed' }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({ ok: true });
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, ts: Date.now() });
    }
    if (request.method === 'POST' && url.pathname === '/api/invoice') {
      return handleInvoice(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/webhook') {
      return handleWebhook(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/verify') {
      return handleVerify(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/entitlements') {
      return handleEntitlements(request, env);
    }
    return new Response('not found', { status: 404 });
  },
};

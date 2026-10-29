/**
 * OFELIYA payments reference backend — Cloudflare Worker (TypeScript, zero deps).
 *
 * Зачем: Telegram Stars-инвойсы НЕЛЬЗЯ создавать из клиента (нужен bot token),
 * поэтому игре нужен минимальный бэкенд.
 *
 * Протокол v3 (патч №13, журнал на Cloudflare D1):
 *
 *  POST /api/invoice {initData, productId, nonce}
 *    → валидирует initData по HMAC-SHA256 (документация Telegram:
 *      https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 *    → сверяет товар с СЕРВЕРНЫМ whitelist (цену от клиента НЕ доверяет)
 *    → nonce обязан матчить ^[A-Za-z0-9_-]{8,64}$ (генерирует клиент)
 *    → INSERT INTO orders (nonce, user_id, product_id, status='pending', created_at)
 *    → Bot API createInvoiceLink (currency='XTR', provider_token='',
 *      prices=[{label, amount}] — amount в ЦЕЛЫХ звёздах, payload=nonce
 *      (лимит Telegram: 1–128 байт))
 *    → 200 {invoiceUrl, nonce}; без PAYMENTS_DB → 503 {error:'db_unavailable'};
 *      ошибка записи заказа → 502 (честно, вместо битого трекинга).
 *
 *  POST /api/webhook  (Telegram → воркер)
 *    → WEBHOOK_SECRET ОБЯЗАТЕЛЕН: не задан в env → 401 fail-closed.
 *      Заголовок X-Telegram-Bot-Api-Secret-Token сверяется со значением.
 *    → pre_checkout_query: payload — это nonce; order резолвится из D1,
 *      сверка (amount, currency) с SERVER_PRODUCTS →
 *      answerPreCheckoutQuery (ОБЯЗАТЕЛЬНО в течение 10 секунд, иначе
 *      платёж отменяется). Без PAYMENTS_DB — ok:false (fail-closed всей
 *      цепочки; раньше было ok:true при отсутствии KV — больше нет).
 *    → message.successful_payment {telegram_payment_charge_id,
 *      invoice_payload(=nonce), total_amount, currency, from:{id}}:
 *      проверки — order по nonce существует и from.id == order.user_id;
 *      (amount, currency) == SERVER_PRODUCTS[productId] (XTR, amount==stars);
 *      запись — ОДИН db.batch():
 *        INSERT OR IGNORE INTO payments (...)  +  UPDATE orders SET status='paid'
 *        WHERE nonce=? AND status='pending'.
 *      Идемпотентность: повторная доставка того же charge_id даёт
 *      meta.changes==0 у INSERT → skip+лог (без гонки: OR IGNORE атомарен).
 *      Ошибка batch → лог + 500 (Telegram переотправит; повтор безопасен
 *      благодаря OR IGNORE).
 *      Без PAYMENTS_DB — только структурированный лог (как раньше без KV).
 *
 *  POST /api/verify {initData, nonce} — СТРОГАЯ точечная проверка
 *  (клиент зовёт после колбэка openInvoice вместо слепого доверия):
 *    order по nonce (user_id совпадает) + payment по nonce
 *    (charge_id НЕПУСТОЙ, настоящий от Telegram — никаких синтетических) +
 *    payment.user_id == userId + payment.product_id == order.product_id
 *    → {verified:true, chargeId, productId}. Order есть, payment нет →
 *    {verified:false, reason:'pending'}. Иначе {verified:false, reason:
 *    'not_found' | 'mismatch'}. Без PAYMENTS_DB → 501 {error:'db_unavailable'}.
 *
 *  POST /api/entitlements {initData}
 *    → {purchases:[{chargeId, productId, status, createdAt}]} из payments
 *      WHERE user_id=? ORDER BY created_at. Без PAYMENTS_DB → 501.
 *      ВНИМАНИЕ (v2, breaking): старый {products:[...]} заменён журналом;
 *      миграции не требуется — KV ещё не в проде.
 *
 *  POST /api/ack {initData, chargeId} — bookkeeping, не защита:
 *    клиент зовёт ПОСЛЕ локальной выдачи товара; воркер помечает
 *    payments.status='fulfilled' (только из 'paid', только свой charge_id).
 *    → {ok:true|false}. Без PAYMENTS_DB → 501.
 *
 *  GET /api/health → {ok:true} (проверка деплоя).
 *
 * Схема: worker/schema.sql (orders, payments, индексы).
 * Статус 'refunded' — ТОЛЬКО вручную через SQL (см. schema.sql);
 * воркер его не выставляет. Возвраты Stars — отдельное решение Mark.
 *
 * Серверный контракт scripts/check-profile-client.mjs:162
 * ('purchase' must never be accepted) в этом скоупе НЕ меняется:
 * D1 воркера — его собственное хранилище entitlements, а не inventory
 * профильного сервера. Отдельное решение.
 *
 * Секреты (wrangler secret put, НЕ в репозиторий):
 *  TELEGRAM_BOT_TOKEN — токен бота из BotFather;
 *  WEBHOOK_SECRET     — ОБЯЗАТЕЛЕН (fail-closed 401 без него); сверяется
 *                       с заголовком X-Telegram-Bot-Api-Secret-Token.
 *
 * D1: wrangler d1 create ofeliya-payments (см. worker/README_DEPLOY.md и
 * worker/wrangler.toml.example). Без биндинга PAYMENTS_DB /api/invoice
 * отвечает 503, pre_checkout — ok:false, /api/entitlements, /api/verify
 * и /api/ack — 501, successful_payment только логируется.
 *
 * Деплой: см. worker/README_DEPLOY.md. Ничего из этого файла не деплоится
 * автоматически — только руками Mark.
 */

/**
 * Минимальный zero-deps сабсет Cloudflare D1 API, достаточный воркеру
 * (вместо @cloudflare/workers-types).
 */
interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  run(): Promise<D1RunResult>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

interface D1RunResult {
  success: boolean;
  meta: { changes: number };
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]>;
}

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  /** ОБЯЗАТЕЛЕН для /api/webhook: отсутствует → 401 fail-closed (патч №12). */
  WEBHOOK_SECRET?: string;
  /**
   * Патч №13: Cloudflare D1 для журнала платежей (схема — worker/schema.sql).
   * KV-биндинг PAYMENTS удалён полностью (чистая замена, не fallback).
   */
  PAYMENTS_DB?: D1Database;
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
 * Статус платежа в D1. 'refunded' выставляется ТОЛЬКО вручную через SQL
 * (см. worker/schema.sql) — воркер его не пишет.
 */
export type PaymentStatus = 'paid' | 'fulfilled' | 'refunded';

/** initData старше суток считаем протухшей. */
const INIT_DATA_MAX_AGE_S = 86400;

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

/**
 * POST /api/invoice {initData, productId, nonce} → {invoiceUrl, nonce}.
 * Payload инвойса — это nonce (лимит Telegram 1–128 байт): по нему вебхук
 * находит заказ в D1 и атрибутирует платёж. Без D1-биндинга — 503.
 */
async function handleInvoice(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'backend-misconfigured' }, 500);
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 503);
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
  // Заказ пишем ДО createInvoiceLink: ошибка записи → честный 502 до того,
  // как Telegram создаст инвойс (битый трекинг исключён).
  try {
    await env.PAYMENTS_DB.prepare(
      'INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)'
    )
      .bind(nonce, v.userId, productId, 'pending', Date.now())
      .run();
  } catch {
    return json({ error: 'order-store-failed' }, 502);
  }
  let invoiceUrl: string;
  try {
    invoiceUrl = (await botApi(env.TELEGRAM_BOT_TOKEN, 'createInvoiceLink', {
      title: product.title,
      description: product.description,
      payload: nonce, // сырой nonce, не JSON (лимит Telegram 1–128 байт)
      provider_token: '', // пусто для Stars (цифровые товары)
      currency: 'XTR',
      prices: [{ label: product.title, amount: product.stars }],
    })) as string;
  } catch {
    return json({ error: 'invoice-create-failed' }, 502);
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

interface DbOrderRow {
  user_id: number;
  product_id: string;
  status: string;
}

interface DbPaymentRow {
  charge_id: string;
  user_id: number;
  product_id: string;
  status: string;
  created_at: number;
}

async function getOrder(db: D1Database, nonce: string): Promise<DbOrderRow | null> {
  const row = await db
    .prepare('SELECT user_id, product_id, status FROM orders WHERE nonce=?')
    .bind(nonce)
    .first<DbOrderRow>();
  if (!row || typeof row.user_id !== 'number' || typeof row.product_id !== 'string') return null;
  return row;
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
  //    Payload — nonce: order резолвится из D1, цена сверяется с серверным
  //    каталогом. Без PAYMENTS_DB — ok:false (fail-closed всей цепочки,
  //    патч №13; раньше без KV было ok:true — больше нет).
  const q = update.pre_checkout_query;
  if (q) {
    const nonce = q.invoice_payload ?? '';
    let ok = false;
    if (isValidNonce(nonce) && env.PAYMENTS_DB) {
      try {
        const order = await getOrder(env.PAYMENTS_DB, nonce);
        const server = order && order.status !== 'expired' ? SERVER_PRODUCTS[order.product_id] : undefined;
        ok = !!server && q.currency === 'XTR' && q.total_amount === server.stars;
      } catch {
        ok = false;
      }
    }
    await botApi(env.TELEGRAM_BOT_TOKEN, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Товар недоступен. Попробуйте позже.' }),
    });
    return json({ ok: true });
  }

  // 2. Успешный платёж → атомарная запись в журнал D1 (протокол v3).
  //    Без D1-биндинга — только структурированный лог, как раньше без KV.
  const sp = update.message?.successful_payment;
  if (sp) {
    try {
      await recordSuccessfulPayment(sp, update.message?.from?.id, env);
    } catch (err) {
      // Сбой записи: платёж уже подтверждён Telegram, но журнал не обновлён.
      // 500 — Telegram переотправит апдейт; повтор безопасен (OR IGNORE).
      logEvent('stars_payment_db_error', {
        stars: sp.total_amount,
        currency: sp.currency,
        telegramChargeId: sp.telegram_payment_charge_id,
        nonce: sp.invoice_payload ?? '',
        userId: update.message?.from?.id,
        error: String(err),
      });
      return json({ ok: false }, 500);
    }
  }
  return json({ ok: true });
}

/**
 * successful_payment → ОДИН db.batch():
 *   INSERT OR IGNORE INTO payments (...)  +  UPDATE orders → 'paid'.
 * Бросает при сбое записи (вызывающий отвечает 500, Telegram переотправит).
 * Невалидные/чужие платежи только логируются (200, ретрай не поможет).
 */

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
  if (!env.PAYMENTS_DB) {
    logEvent('stars_payment_unverified', { ...base, userId: fromId });
    return;
  }
  if (!isValidNonce(nonce) || !chargeId || typeof fromId !== 'number') {
    logEvent('stars_payment_invalid', { ...base, userId: fromId });
    return;
  }
  const db = env.PAYMENTS_DB;
  const order = await getOrder(db, nonce);
  if (!order) {
    logEvent('stars_payment_unknown_order', { ...base, userId: fromId });
    return;
  }
  if (order.user_id !== fromId) {
    logEvent('stars_payment_user_mismatch', {
      ...base,
      userId: fromId,
      orderUserId: order.user_id,
    });
    return;
  }
  const server = SERVER_PRODUCTS[order.product_id];
  if (!server || sp.currency !== 'XTR' || sp.total_amount !== server.stars) {
    logEvent('stars_payment_amount_mismatch', {
      ...base,
      userId: fromId,
      productId: order.product_id,
      expected: server?.stars,
    });
    return;
  }
  const now = Date.now();
  // Атомарно: платёж + перевод заказа в 'paid'. OR IGNORE делает повторную
  // доставку того же charge_id безопасной: meta.changes==0 → дубликат.
  const results = await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO payments ' +
          '(charge_id, user_id, product_id, amount, currency, status, nonce, created_at, fulfilled_at) ' +
          'VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .bind(chargeId, fromId, order.product_id, sp.total_amount, sp.currency, 'paid', nonce, now, null),
    db
      .prepare("UPDATE orders SET status='paid' WHERE nonce=? AND status='pending'")
      .bind(nonce),
  ]);
  if (results[0]?.meta.changes === 0) {
    logEvent('stars_payment_duplicate', { ...base, userId: fromId });
    return;
  }
  logEvent('stars_payment_recorded', {
    ...base,
    userId: fromId,
    productId: order.product_id,
  });
}

/**
 * POST /api/verify {initData, nonce} — точечная проверка одного платежа
 * (клиент зовёт после колбэка openInvoice вместо слепого доверия).
 * СТРОГО (патч №13): order.user_id == userId И payment.charge_id непустой
 * И payment.user_id == userId И payment.product_id == order.product_id.
 * Никаких синтетических charge_id — только настоящий от Telegram.
 * 501 — D1-биндинг не настроен.
 */
async function handleVerify(request: Request, env: Env): Promise<Response> {
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 501);
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
    const db = env.PAYMENTS_DB;
    const order = await getOrder(db, body.nonce);
    if (!order) return json({ verified: false, reason: 'not_found' });
    if (order.user_id !== v.userId) return json({ verified: false, reason: 'mismatch' });
    const payment = await db
      .prepare(
        'SELECT charge_id, user_id, product_id, status, created_at FROM payments WHERE nonce=?'
      )
      .bind(body.nonce)
      .first<DbPaymentRow>();
    if (!payment) return json({ verified: false, reason: 'pending' });
    // Строгая сверка: настоящий charge_id от Telegram, свой userId,
    // товар совпадает с заказом.
    if (
      typeof payment.charge_id !== 'string' ||
      payment.charge_id.length === 0 ||
      payment.user_id !== v.userId ||
      payment.product_id !== order.product_id
    ) {
      return json({ verified: false, reason: 'mismatch' });
    }
    return json({ verified: true, chargeId: payment.charge_id, productId: payment.product_id });
  } catch {
    return json({ error: 'db-read-failed' }, 502);
  }
}

/**
 * POST /api/entitlements {initData} — серверный журнал покупок.
 * {purchases:[{chargeId, productId, status, createdAt}]}, сортировка по
 * created_at. 501 — D1-биндинг не настроен.
 */
async function handleEntitlements(request: Request, env: Env): Promise<Response> {
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 501);
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
    const { results } = await env.PAYMENTS_DB.prepare(
      'SELECT charge_id, product_id, status, created_at FROM payments WHERE user_id=? ORDER BY created_at ASC'
    )
      .bind(v.userId)
      .all<DbPaymentRow>();
    const purchases = results.map((row) => ({
      chargeId: row.charge_id,
      productId: row.product_id,
      status: (['paid', 'fulfilled', 'refunded'] as const).includes(row.status as PaymentStatus)
        ? (row.status as PaymentStatus)
        : ('paid' as PaymentStatus),
      createdAt: typeof row.created_at === 'number' ? row.created_at : 0,
    }));
    return json({ purchases });
  } catch {
    return json({ error: 'db-read-failed' }, 502);
  }
}

/**
 * POST /api/ack {initData, chargeId} — bookkeeping после локальной выдачи.
 * Помечает платёж 'paid' → 'fulfilled' (только свой charge_id, только из
 * 'paid'). Это учёт, а не защита: выдача уже произошла на клиенте.
 * → {ok:true} если пометка применена, иначе {ok:false}.
 * 501 — D1-биндинг не настроен.
 */
async function handleAck(request: Request, env: Env): Promise<Response> {
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 501);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'backend-misconfigured' }, 500);
  let body: { initData?: unknown; chargeId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const initData = typeof body.initData === 'string' ? body.initData : '';
  const chargeId = typeof body.chargeId === 'string' && body.chargeId.length > 0 ? body.chargeId : '';
  if (!chargeId) return json({ error: 'bad-charge-id' }, 400);
  const v = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok || v.userId == null) return json({ error: 'bad-init-data', reason: v.reason }, 401);
  try {
    const result = await env.PAYMENTS_DB.prepare(
      "UPDATE payments SET status='fulfilled', fulfilled_at=? WHERE charge_id=? AND user_id=? AND status='paid'"
    )
      .bind(Date.now(), chargeId, v.userId)
      .run();
    return json({ ok: result.meta.changes === 1 });
  } catch {
    return json({ error: 'db-write-failed' }, 502);
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
    if (request.method === 'POST' && url.pathname === '/api/ack') {
      return handleAck(request, env);
    }
    return new Response('not found', { status: 404 });
  },
};

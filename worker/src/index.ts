import { SERVER_GRANTS, grantForProduct, grantAmountText } from './grants';
import type { GrantKind, ServerGrant } from './grants';

/**
 * OFELIYA payments reference backend — Cloudflare Worker (TypeScript, zero deps).
 *
 * Зачем: Telegram Stars-инвойсы НЕЛЬЗЯ создавать из клиента (нужен bot token),
 * поэтому игре нужен минимальный бэкенд.
 *
 * Протокол v4 (патч №15, серверно-авторитетная выдача):
 *  Ключевое изменение: грант (РНК/бустер/скин) применяет СЕРВЕР — в том же
 *  атомарном D1-батче, что и запись платежа. Клиент выдачу НЕ начисляет сам:
 *  он тянет GET/POST /api/wallet и материализует серверный результат
 *  (watermark per-device). Threat model — см. раздел «Модель угроз» ниже.
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
 *      Ошибка batch или отсутствие PAYMENTS_DB → 503 (Telegram переотправит
 *      апдейт; повтор безопасен благодаря OR IGNORE). Ретраи Telegram:
 *      не-200 ответ → повторная доставка с бэкоффом до ~24ч; батч
 *      идемпотентен, двойной записи не будет.
 *      Невалидные/чужие платежи (плохой nonce, чужой user, amount mismatch)
 *      только логируются → 200: ретрай не поможет, платеж невалиден.
 *      Товар вне каталога (unknown-product): записывается как 'paid' +
 *      громкий лог, БЕЗ пометки fulfilled — ручное разрешение позже
 *      (выдача на клиенте упадёт на invalid-product, товар не потерян
 *      из виду).
 *
 *  POST /api/admin/refund {chargeId, reason, execute?} — двухшаговый возврат
 *    (патч №15; раньше — только пометка).
 *    Авторизация: заголовок Authorization: Bearer <ADMIN_TOKEN> (НЕ bot
 *    token). ADMIN_TOKEN обязателен в env (fail-closed 401). Возвраты Stars
 *    у Telegram не приходят автоматически — только руками Mark.
 *    execute !== true → только пометка + откат серверного кошелька;
 *    execute === true → сначала refundStarPayment, пометка — только после
 *    подтверждения Telegram. Повтор при уже 'refunded' → {ok:true, already:true}.
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
 *    клиент зовёт ПОСЛЕ применения серверного кошелька; воркер помечает
 *    payments.status='fulfilled' (только из 'paid', только свой charge_id).
 *    → {ok:true|false}. Без PAYMENTS_DB → 501.
 *
 *  POST /api/wallet {initData} — серверный кошелёк пользователя
 *    → {purchased_rna, booster_until_ms, skins[], ledger_tip}.
 *    purchased_rna — append-only сумма выданных сервером РНК (целые);
 *    уменьшается только при ручном refund (mark/execute). Без PAYMENTS_DB → 501.
 *
 *  GET /api/admin/stale-orders?olderThanMin=N — заказы 'pending' и платежи
 *    'paid'-без-fulfilled старше N минут (default 60) для ручной сверки.
 *    Авторизация: Authorization: Bearer <ADMIN_TOKEN>. Runbook — в
 *    worker/README_DEPLOY.md.
 *
 *  GET /api/health → {ok:true} (проверка деплоя).
 *
 * Схема: worker/schema.sql (orders, payments, wallets, wallet_ledger).
 * Статус 'refunded' — ТОЛЬКО вручную: POST /api/admin/refund
 * (патч №14 E-c, двухшаговый с патча №15); воркер сам его не выставляет.
 *
 * Модель угроз (патч №15, P0-3) — честно:
 *  - Сервер гарантирует: не записать ложный платёж (проверки webhook +
 *    строгий pre_checkout) и не потерять честный (атомарный батч,
 *    503→ретрай Telegram, идемпотентность по charge_id).
 *  - Клиент и так может править свой localStorage — подделка ЛОКАЛЬНОГО
 *    баланса вне модели угроз до полной серверной экономики
 *    (дизайн-док ofeliya-server-economy-design.md). Серверный кошелёк —
 *    источник правды о ПОКУПКАХ, а не античит локального баланса.
 *  - Два живых устройства материализуют покупки независимо (watermark
 *    per-device): окончательно решается только серверными расходуемыми
 *    балансами. Возврат (refunded) уменьшает серверный кошелёк, но уже
 *    материализованное локальное значение НЕ отзывается.
 *  - Подмена каталога на клиенте бессмысленна: цена и грант — с сервера.
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
  /**
   * Патч №14 (E-c): секрет для POST /api/admin/refund. ОБЯЗАТЕЛЕН для
   * ручной пометки возвратов (fail-closed 401). НЕ bot token — отдельный
   * случайный токен (wrangler secret put ADMIN_TOKEN).
   */
  ADMIN_TOKEN?: string;
}

/**
 * @deprecated Цены и гранты — в SERVER_GRANTS (worker/src/grants.ts).
 * Алиас оставлен для tests/worker-payments.mjs (сверка stars с клиентом).
 * Новый код использует SERVER_GRANTS напрямую.
 */
export const SERVER_PRODUCTS: Record<string, { title: string; description: string; stars: number }> =
  Object.fromEntries(
    Object.entries(SERVER_GRANTS).map(([id, g]) => [
      id,
      { title: g.title, description: g.description, stars: g.stars },
    ])
  );

/**
 * Статус платежа в D1. 'refunded' выставляется ТОЛЬКО вручную:
 * POST /api/admin/refund (патч №14, E-c), воркер сам — никогда.
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
  const product = SERVER_GRANTS[productId];
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
  /** Патч №15 (P0-2): обязателен для строгой проверки владельца заказа. */
  from?: { id?: number };
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
  //    СТРОГО (патч №15, P0-2): order.status ДОЛЖЕН быть 'pending'
  //    (раньше было `!== 'expired'` — оплаченный/неизвестный заказ проходил)
  //    И q.from.id ДОЛЖЕН совпадать с order.user_id (чужой инвойс — отказ:
  //    иначе пользователь платит, а платёж потом отвергается как чужой).
  //    Payload — nonce: order резолвится из D1, цена сверяется с серверным
  //    каталогом. Без PAYMENTS_DB — ok:false (fail-closed всей цепочки).
  //    Бюджет 10с: Telegram → Render-прокси (таймаут 8с) → воркер → D1 →
  //    answerPreCheckoutQuery. Замеряем латентность: warn при >7с —
  //    503-ретраи Telegram best-effort, а не гарантия (см. README_DEPLOY).
  const q = update.pre_checkout_query;
  if (q) {
    const t0 = Date.now();
    const nonce = q.invoice_payload ?? '';
    let ok = false;
    if (isValidNonce(nonce) && env.PAYMENTS_DB) {
      try {
        const order = await getOrder(env.PAYMENTS_DB, nonce);
        const fromId = q.from?.id;
        const server =
          order && order.status === 'pending' && typeof fromId === 'number' && fromId === order.user_id
            ? SERVER_GRANTS[order.product_id]
            : undefined;
        ok = !!server && q.currency === 'XTR' && q.total_amount === server.stars;
        if (!ok) {
          logEvent('pre_checkout_rejected', {
            nonce,
            orderStatus: order?.status ?? 'no-order',
            userMatch: typeof fromId === 'number' && !!order && fromId === order.user_id,
          });
        }
      } catch {
        ok = false;
      }
    }
    await botApi(env.TELEGRAM_BOT_TOKEN, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Товар недоступен. Попробуйте позже.' }),
    });
    const elapsedMs = Date.now() - t0;
    if (elapsedMs > 7000) {
      // Бюджет Telegram — 10с от отправки pre_checkout_query. 503-ретраи
      // не спасут уже истёкший pre-checkout: это сигнал, что цепочка
      // Render→воркер→D1 слишком медленная (см. runbook в README_DEPLOY).
      logEvent('pre_checkout_slow', { elapsedMs, nonce, ok });
    }
    return json({ ok: true });
  }

  // 2. Успешный платёж → атомарная запись в журнал D1 (протокол v3).
  //    Fail-closed (патч №14, P0-2): ЛЮБАЯ ошибка инфраструктуры (нет
  //    биндинга PAYMENTS_DB, сбой batch) → 503. Telegram считает апдейт
  //    необработанным и переотправит его (ретраи с бэкоффом до ~24ч);
  //    батч идемпотентен (INSERT OR IGNORE), двойной записи не будет.
  //    Возвращать 200 здесь — значит потерять оплату: Telegram больше
  //    не доставит апдейт, а журнал пуст. Невалидные платежи (плохой
  //    nonce, чужой user, amount mismatch) — 200: ретрай не поможет.
  const sp = update.message?.successful_payment;
  if (sp) {
    try {
      await recordSuccessfulPayment(sp, update.message?.from?.id, env);
    } catch (err) {
      logEvent('stars_payment_db_error', {
        stars: sp.total_amount,
        currency: sp.currency,
        telegramChargeId: sp.telegram_payment_charge_id,
        nonce: sp.invoice_payload ?? '',
        userId: update.message?.from?.id,
        error: String(err),
      });
      return json({ ok: false, error: 'db_unavailable' }, 503);
    }
  }
  return json({ ok: true });
}

/**
 * successful_payment → батч 1 (платёж + заказ → 'paid') + батч 2
 * (серверная выдача: wallets + wallet_ledger, патч №15).
 * Бросает при сбое инфраструктуры (вызывающий отвечает 503, Telegram
 * переотправит). Невалидные/чужие платежи только логируются (200,
 * ретрай не поможет). Товар вне каталога (unknown-product): записывается
 * как 'paid' + громкий лог, БЕЗ пометки fulfilled.
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
  // Патч №14 (P0-2): отсутствие биндинга — инфраструктурная ошибка,
  // а не повод молча вернуть 200. Бросаем → хендлер ответит 503,
  // Telegram переотправит апдейт, когда D1 появится.
  if (!env.PAYMENTS_DB) {
    throw new Error('db_unavailable');
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
  // Патч №15 (P0-2): backstop повторного использования nonce. Один nonce —
  // один платёж (UNIQUE(payments.nonce) в схеме). Основной гейт — строгий
  // pre_checkout (status==='pending'); это защита от гонки двух pre_checkout
  // до записи платежа. 200, не 503: ретрай не поможет, это не сбой
  // инфраструктуры.
  const nonceRow = await db
    .prepare('SELECT charge_id FROM payments WHERE nonce=?')
    .bind(nonce)
    .first<{ charge_id: string }>();
  if (nonceRow && nonceRow.charge_id !== chargeId) {
    logEvent('stars_payment_nonce_reuse', {
      ...base,
      userId: fromId,
      existingChargeId: nonceRow.charge_id,
    });
    return;
  }
  const resolved = grantForProduct(order.product_id);
  const now = Date.now();
  if (!resolved) {
    // E-a: товар оплачен, но его нет в каталоге (каталог сменился между
    // созданием инвойса и оплатой). НЕ silent-skip: пишем как 'paid' +
    // громкий лог; fulfilled НЕ ставим — ручное разрешение позже.
    // Клиентская выдача для него упадёт на invalid-product (без гранта),
    // запись останется видимой в журнале для разбора.
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
    logEvent('stars_payment_unknown_product', {
      ...base,
      userId: fromId,
      productId: order.product_id,
    });
    return;
  }
  const { kind, grant } = resolved;
  if (sp.currency !== 'XTR' || sp.total_amount !== grant.stars) {
    logEvent('stars_payment_amount_mismatch', {
      ...base,
      userId: fromId,
      productId: order.product_id,
      expected: grant.stars,
    });
    return;
  }
  // Батч 1 (атомарно): платёж + перевод заказа в 'paid'. OR IGNORE делает
  // повторную доставку того же charge_id безопасной: meta.changes==0 →
  // дубликат, грант повторно НЕ применяется (см. self-heal ниже).
  const r1 = await db.batch([
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
  if (r1[0]?.meta.changes === 0) {
    // Дубликат доставки. Грант уже применён? Self-heal на случай падения
    // между батчами в прошлой доставке: платёж есть, а гранта в журнале нет.
    const lg = await db
      .prepare('SELECT 1 AS one FROM wallet_ledger WHERE charge_id=?')
      .bind(chargeId)
      .first();
    if (!lg) await applyGrantBatch(db, fromId, chargeId, kind, grant, now);
    logEvent('stars_payment_duplicate', { ...base, userId: fromId });
    return;
  }
  // Батч 2: СЕРВЕРНО-АВТОРИТЕТНАЯ выдача (патч №15, P0-3) — кошелёк +
  // журнал. Клиент сам ничего не начисляет: он тянет /api/wallet.
  await applyGrantBatch(db, fromId, chargeId, kind, grant, now);
  logEvent('stars_payment_recorded', {
    ...base,
    userId: fromId,
    productId: order.product_id,
    grantKind: kind,
  });
}

/**
 * Серверная выдача гранта (патч №15, P0-3): UPSERT wallets + INSERT
 * wallet_ledger — одним батчем. Чтение текущего кошелька и вычисление новых
 * значений — в JS (D1 не умеет Decimal-арифметику; суммы целые, но держим
 * код явным). Конкурентные доставки Telegram по одному чату идут
 * последовательно; wallet_ledger.charge_id UNIQUE + INSERT OR IGNORE —
 * двойной грант невозможен даже при повторном вызове.
 *
 * Семантика гранта (зеркало клиентской выдачи до патча №15):
 *  - rna: purchased_rna += grant.rna (плоско, БЕЗ бонуса лаборатории);
 *  - booster: booster_until_ms = max(текущий, now) + days (время не сгорает);
 *  - skin: skins_json — аддитивное множество (union).
 */
async function applyGrantBatch(
  db: D1Database,
  userId: number,
  chargeId: string,
  kind: GrantKind,
  grant: ServerGrant,
  now: number
): Promise<void> {
  const wallet = await db
    .prepare('SELECT purchased_rna, booster_until_ms, skins_json FROM wallets WHERE user_id=?')
    .bind(userId)
    .first<{ purchased_rna: number; booster_until_ms: number; skins_json: string }>();
  const curRna =
    typeof wallet?.purchased_rna === 'number' && wallet.purchased_rna >= 0
      ? Math.floor(wallet.purchased_rna)
      : 0;
  const curBooster =
    typeof wallet?.booster_until_ms === 'number' && wallet.booster_until_ms > 0
      ? Math.floor(wallet.booster_until_ms)
      : 0;
  let curSkins: string[] = [];
  try {
    const parsed: unknown = JSON.parse(wallet?.skins_json ?? '[]');
    if (Array.isArray(parsed)) curSkins = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    curSkins = [];
  }
  let newRna = curRna;
  let newBooster = curBooster;
  let newSkins = curSkins;
  if (kind === 'rna') {
    newRna = curRna + Math.max(0, Math.floor(grant.rna));
  } else if (kind === 'booster') {
    newBooster = Math.max(curBooster, now) + Math.max(0, Math.floor(grant.boosterDays)) * 86_400_000;
  } else if (kind === 'skin' && grant.skinId && !newSkins.includes(grant.skinId)) {
    newSkins = [...newSkins, grant.skinId];
  }
  await db.batch([
    db
      .prepare(
        'INSERT INTO wallets (user_id, purchased_rna, booster_until_ms, skins_json, updated_at) ' +
          'VALUES (?,?,?,?,?) ' +
          'ON CONFLICT(user_id) DO UPDATE SET purchased_rna=excluded.purchased_rna, ' +
          'booster_until_ms=excluded.booster_until_ms, skins_json=excluded.skins_json, ' +
          'updated_at=excluded.updated_at'
      )
      .bind(userId, newRna, newBooster, JSON.stringify(newSkins), now),
    db
      .prepare(
        'INSERT OR IGNORE INTO wallet_ledger (user_id, charge_id, kind, amount_text, created_at) ' +
          'VALUES (?,?,?,?,?)'
      )
      .bind(userId, chargeId, kind, grantAmountText(kind, grant), now),
  ]);
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
    // товар совпадает с заказом. Патч №14 (P0-3): status='refunded'
    // ЯВНО исключается — возвращённый платёж нельзя перевыдать.
    if (
      typeof payment.charge_id !== 'string' ||
      payment.charge_id.length === 0 ||
      payment.user_id !== v.userId ||
      payment.product_id !== order.product_id
    ) {
      return json({ verified: false, reason: 'mismatch' });
    }
    if (payment.status === 'refunded') {
      return json({ verified: false, reason: 'refunded' });
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

/**
 * POST /api/wallet {initData} — серверный кошелёк (патч №15, P0-3).
 * Источник правды о ПОКУПКАХ: что сервер выдал этому user_id.
 * → {purchased_rna, booster_until_ms, skins[], ledger_tip}.
 * purchased_rna — append-only сумма выданных РНК (целые); уменьшается только
 * ручным refund (mark/execute). Клиент материализует дельту по watermark
 * (см. src/game/shop/ServerWalletSync.ts) и сам суммы не выдумывает.
 * POST, а не GET: initData в теле, а не в query (не светится в логах).
 * 501 — D1-биндинг не настроен; 401 — плохой initData.
 */
async function handleWallet(request: Request, env: Env): Promise<Response> {
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
    const wallet = await env.PAYMENTS_DB.prepare(
      'SELECT purchased_rna, booster_until_ms, skins_json FROM wallets WHERE user_id=?'
    )
      .bind(v.userId)
      .first<{ purchased_rna: number; booster_until_ms: number; skins_json: string }>();
    let skins: string[] = [];
    try {
      const parsed: unknown = JSON.parse(wallet?.skins_json ?? '[]');
      if (Array.isArray(parsed)) skins = parsed.filter((s): s is string => typeof s === 'string');
    } catch {
      skins = [];
    }
    const tip = await env.PAYMENTS_DB.prepare(
      'SELECT MAX(created_at) AS tip FROM wallet_ledger WHERE user_id=?'
    )
      .bind(v.userId)
      .first<{ tip: number | null }>();
    return json({
      purchased_rna:
        typeof wallet?.purchased_rna === 'number' && wallet.purchased_rna >= 0
          ? Math.floor(wallet.purchased_rna)
          : 0,
      booster_until_ms:
        typeof wallet?.booster_until_ms === 'number' && wallet.booster_until_ms > 0
          ? Math.floor(wallet.booster_until_ms)
          : 0,
      skins,
      ledger_tip: typeof tip?.tip === 'number' ? tip.tip : null,
    });
  } catch {
    return json({ error: 'db-read-failed' }, 502);
  }
}

/**
 * POST /api/admin/refund {chargeId, reason?, execute?} — ДВУХШАГОВЫЙ возврат
 * (патч №15, P1-4; раньше — только пометка в журнале).
 *
 * У Telegram Stars нет автоматического refund-webhook для ботов — возвраты
 * только руками Mark. Авторизация: Authorization: Bearer <ADMIN_TOKEN>
 * (НЕ bot token). ADMIN_TOKEN обязателен в env (fail-closed 401).
 *
 * Два РАЗНЫХ действия, не путать (см. README_DEPLOY §10):
 *  - execute !== true → «ПОМЕТИТЬ»: только статус payments→'refunded' +
 *    откат серверного кошелька (см. reverseWalletGrant). Для возвратов,
 *    выполненных вручную через BotFather/поддержку Telegram.
 *  - execute === true → «ВЫПОЛНИТЬ»: сначала Bot API refundStarPayment
 *    (тем же TELEGRAM_BOT_TOKEN — отдельный OFELIYA_BOT_TOKEN не нужен),
 *    пометка 'refunded' + откат кошелька — ТОЛЬКО после подтверждения
 *    Telegram. Без токена → 503 {error:'bot-token-misconfigured'}.
 *
 * Идемпотентность: повторный вызов при уже 'refunded' →
 * {ok:true, already:true} (однозначно; раньше было {ok:false} — аудит №5).
 * Не найден → {ok:false, error:'not-found'}.
 * Возврат НЕ отзывает уже материализованное локальное значение на клиенте
 * (отзыв локального — вне модели угроз; см. «Модель угроз» в шапке).
 * Без PAYMENTS_DB → 501.
 */
async function handleAdminRefund(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 501);
  let body: { chargeId?: unknown; reason?: unknown; execute?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const chargeId = typeof body.chargeId === 'string' && body.chargeId.length > 0 ? body.chargeId : '';
  if (!chargeId) return json({ error: 'bad-charge-id' }, 400);
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
  const execute = body.execute === true;
  try {
    const db = env.PAYMENTS_DB;
    const payment = await db
      .prepare('SELECT charge_id, user_id, product_id, status FROM payments WHERE charge_id=?')
      .bind(chargeId)
      .first<{ charge_id: string; user_id: number; product_id: string; status: string }>();
    if (!payment) return json({ ok: false, error: 'not-found' });
    if (payment.status === 'refunded') return json({ ok: true, already: true });
    if (execute) {
      // «Выполнить»: реальный возврат Stars через Bot API — ДО пометки.
      if (!env.TELEGRAM_BOT_TOKEN) {
        return json({ ok: false, error: 'bot-token-misconfigured' }, 503);
      }
      try {
        await botApi(env.TELEGRAM_BOT_TOKEN, 'refundStarPayment', {
          user_id: payment.user_id,
          telegram_payment_charge_id: chargeId,
        });
      } catch (e) {
        logEvent('stars_refund_failed', {
          telegramChargeId: chargeId,
          userId: payment.user_id,
          error: e instanceof Error ? e.message : String(e),
        });
        return json({ ok: false, error: 'refund-failed' }, 502);
      }
    }
    const result = await db
      .prepare("UPDATE payments SET status='refunded' WHERE charge_id=? AND status IN ('paid','fulfilled')")
      .bind(chargeId)
      .run();
    if (result.meta.changes === 0) {
      // Статус сменился между SELECT и UPDATE (конкурентный refund) —
      // идемпотентный ответ, состояние не портится.
      return json({ ok: true, already: true });
    }
    // Откат серверного кошелька: будущие устройства/синки этот грант
    // больше не материализуют. Локальное значение на устройстве НЕ
    // отзывается (честно задокументировано в «Модели угроз»).
    await reverseWalletGrant(db, payment.user_id, chargeId);
    logEvent('stars_payment_refunded_manual', {
      telegramChargeId: chargeId,
      reason,
      executed: execute,
    });
    return json({ ok: true, executed: execute });
  } catch {
    return json({ error: 'db-write-failed' }, 502);
  }
}

/**
 * Откат серверного гранта при refund (патч №15, P1-4).
 *  - rna: purchased_rna = max(0, purchased_rna − выданное);
 *  - skin: убрать skinId из skins_json (новые устройства не получат);
 *  - booster: НЕ трогаем — время вспять не отматывается; задокументировано.
 * Локальные значения на устройствах не отзываются (модель угроз).
 */
async function reverseWalletGrant(
  db: D1Database,
  userId: number,
  chargeId: string
): Promise<void> {
  const entry = await db
    .prepare('SELECT kind, amount_text FROM wallet_ledger WHERE charge_id=?')
    .bind(chargeId)
    .first<{ kind: string; amount_text: string }>();
  if (!entry) return; // гранта не было (unknown-product) — нечего откатывать
  const wallet = await db
    .prepare('SELECT purchased_rna, skins_json FROM wallets WHERE user_id=?')
    .bind(userId)
    .first<{ purchased_rna: number; skins_json: string }>();
  if (!wallet) return;
  const now = Date.now();
  if (entry.kind === 'rna') {
    const amount = Math.max(0, Math.floor(Number(entry.amount_text) || 0));
    const cur = typeof wallet.purchased_rna === 'number' && wallet.purchased_rna > 0 ? Math.floor(wallet.purchased_rna) : 0;
    await db
      .prepare('UPDATE wallets SET purchased_rna=?, updated_at=? WHERE user_id=?')
      .bind(Math.max(0, cur - amount), now, userId)
      .run();
  } else if (entry.kind === 'skin' && entry.amount_text) {
    let skins: string[] = [];
    try {
      const parsed: unknown = JSON.parse(wallet.skins_json ?? '[]');
      if (Array.isArray(parsed)) skins = parsed.filter((s): s is string => typeof s === 'string');
    } catch {
      skins = [];
    }
    const next = skins.filter((s) => s !== entry.amount_text);
    if (next.length !== skins.length) {
      await db
        .prepare('UPDATE wallets SET skins_json=?, updated_at=? WHERE user_id=?')
        .bind(JSON.stringify(next), now, userId)
        .run();
    }
  }
  // booster: время не отматываем (см. комментарий выше).
}

/**
 * GET /api/admin/stale-orders?olderThanMin=N — ручная сверка (патч №15, P1-5).
 * Возвращает заказы 'pending' и платежи 'paid' (без fulfilled) старше N минут
 * (default 60, кап 1440): кандидаты на разбор — платёж потерян, завис или
 * требует ручного refund. Авторизация: Authorization: Bearer <ADMIN_TOKEN>.
 * Runbook — worker/README_DEPLOY.md (§11).
 * → {orders:[...], unpaidPayments:[...]}. Без PAYMENTS_DB → 501.
 */
async function handleStaleOrders(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 501);
  const url = new URL(request.url);
  const rawN = Number(url.searchParams.get('olderThanMin'));
  const olderThanMin = Number.isFinite(rawN) ? Math.min(1440, Math.max(1, Math.floor(rawN))) : 60;
  const cutoff = Date.now() - olderThanMin * 60_000;
  try {
    const db = env.PAYMENTS_DB;
    const { results: orders } = await db
      .prepare(
        'SELECT nonce, user_id, product_id, status, created_at FROM orders ' +
          "WHERE status='pending' AND created_at < ? ORDER BY created_at ASC LIMIT 200"
      )
      .bind(cutoff)
      .all<{ nonce: string; user_id: number; product_id: string; status: string; created_at: number }>();
    const { results: unpaidPayments } = await db
      .prepare(
        'SELECT charge_id, user_id, product_id, created_at FROM payments ' +
          "WHERE status='paid' AND created_at < ? ORDER BY created_at ASC LIMIT 200"
      )
      .bind(cutoff)
      .all<{ charge_id: string; user_id: number; product_id: string; created_at: number }>();
    return json({ olderThanMin, orders, unpaidPayments });
  } catch {
    return json({ error: 'db-read-failed' }, 502);
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
    if (request.method === 'POST' && url.pathname === '/api/wallet') {
      return handleWallet(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/refund') {
      return handleAdminRefund(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/stale-orders') {
      return handleStaleOrders(request, env);
    }
    return new Response('not found', { status: 404 });
  },
};

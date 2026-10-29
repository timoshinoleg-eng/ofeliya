import { SERVER_GRANTS, GRANTS_VERSION, grantForProduct, grantAmountText } from './grants';
import type { ServerGrant } from './grants';
import {
  SQL_UPDATE_ORDER_PAID,
  SQL_INSERT_PAYMENT,
  SQL_INSERT_LEDGER_GRANT,
  SQL_INSERT_ORDER,
  SQL_INSERT_REFUND_OP,
  SQL_UPDATE_PAYMENT_REFUNDED,
  SQL_UPDATE_PAYMENT_REFUND_REQUESTED,
  SQL_COMPLETE_REFUND_OP,
  SQL_UPDATE_PAYMENT_REFUNDED_FROM_ANY,
  SQL_INSERT_LEDGER_REVERSAL,
} from './sql';

/**
 * OFELIYA payments reference backend — Cloudflare Worker (TypeScript, zero deps).
 *
 * Зачем: Telegram Stars-инвойсы НЕЛЬЗЯ создавать из клиента (нужен bot token),
 * поэтому игре нужен минимальный бэкенд.
 *
 * Протокол v5 (патч №16, один батч + SQL-триггер):
 *  Ключевое изменение: выдача гранта — ОДИН атомарный db.batch() из трёх
 *  statement'ов (orders→'paid', payments INSERT, wallet_ledger INSERT) +
 *  AFTER INSERT триггер trg_wallet_ledger_apply (worker/schema.sql),
 *  который ведёт wallets (purchased_rna, booster_until_ms) и wallet_skins.
 *  Патч №15 делал ДВА батча (запись платежа, затем applyGrantBatch с
 *  read→calc→write кошелька в JS) + self-heal на случай падения между ними —
 *  это были P0-баги A1/A2 (между батчами нет атомарности, а интерактивных
 *  транзакций в D1 нет вообще: вся логика решения — в SQL). applyGrantBatch
 *  и self-heal УДАЛЕНЫ как мёртвый код (честно зафиксировано в коммите).
 *  Дубликатная доставка: оба INSERT — ON CONFLICT DO NOTHING → вставки нет →
 *  триггер не срабатывает → ноль доп. начисления.
 *  wallet_ledger: kind='grant'|'reversal', grant_type='rna'|'booster'|'skin',
 *  amount — знаковый INTEGER, id — монотонный seq. Владение скинами —
 *  wallet_skins (active/reversed). Возвраты — state machine в refund_ops.
 *  POST /api/wallet → {server_id, schema_version:2, purchased_rna,
 *  booster_until_ms, skins[], ledger[] (по since_seq), tip_seq, ledger_tip}.
 *  SKU: GRANTS_VERSION=2 (worker/src/grants.ts); заказ иммутабелен
 *  (amount_stars+sku_version+снапшот гранта); вебхук сверяет sp.total_amount
 *  с заказом И каталогом; границы сумм — isSafeInteger, 1..10_000_000, XTR,
 *  fail-closed.
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
 *      границы: isSafeInteger(total_amount), 1..10_000_000, currency==='XTR'
 *      (fail-closed с диагностикой); total_amount === order.amount_stars
 *      (заказ иммутабелен, B2) И товар в серверном каталоге;
 *      запись — ОДИН db.batch() (атомарно, патч №16):
 *        UPDATE orders → 'paid'  +
 *        INSERT OR IGNORE INTO payments (...)  +
 *        INSERT OR IGNORE INTO wallet_ledger (grant) — запускает триггер
 *          trg_wallet_ledger_apply, который ведёт wallets/wallet_skins.
 *      Идемпотентность: повторная доставка того же charge_id даёт
 *      meta.changes==0 у INSERT → skip+лог (без гонки: OR IGNORE атомарен,
 *      триггер не срабатывает без вставки).
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
 *  POST /api/admin/refund {chargeId, reason?, execute?, operationId?,
 *    confirmExternalRefund?} — state machine возвратов (патч №16, A5;
 *    двухшаговый с патча №15).
 *    У Telegram Stars нет автоматического refund-webhook для ботов — возвраты
 *    только руками Mark. Авторизация: Authorization: Bearer <ADMIN_TOKEN>
 *    (НЕ bot token). ADMIN_TOKEN обязателен в env (fail-closed 401).
 *    - execute !== true → «ПОМЕТИТЬ»: требует confirmExternalRefund===true
 *      + reason (иначе 400 {error:'confirm-required'} — «подтверди, что
 *      деньги реально возвращены вне системы»). ОДИН батч: refund_ops +
 *      payments→'refunded' + reversal в ledger. Для возвратов, выполненных
 *      вручную через BotFather/поддержку Telegram.
 *    - execute === true → «ВЫПОЛНИТЬ»: батч1 (refund_ops 'requested' +
 *      payments→'refund_requested'), затем Bot API refundStarPayment (тем же
 *      TELEGRAM_BOT_TOKEN), затем батч2 (refund_ops→'completed',
 *      payments→'refunded', reversal). Ошибка 'already refunded' от Telegram
 *      = подтверждение (идемпотентный повтор). Сетевая ошибка → операция
 *      остаётся 'requested' → повтор с тем же operationId продолжает.
 *    operation_id: UNIQUE; клиент может прислать, иначе crypto.randomUUID().
 *    Идемпотентность: уже 'refunded' → {ok:true, already:true}.
 *    Журнал админа = refund_ops (reason, operation_id, timestamps; секреты
 *    не логируются — см. аудит logEvent).
 *    Без PAYMENTS_DB → 501.
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
 *  POST /api/wallet {initData, since_seq?} — серверный кошелёк (v5, патч №16)
 *    → {ok, user_id, server_id, schema_version:2, purchased_rna,
 *    booster_until_ms, skins[] (активные из wallet_skins),
 *    ledger[] (по since_seq, seq=id, LIMIT 5000), tip_seq, ledger_tip}.
 *    purchased_rna — append-only сумма выданных сервером РНК (целые);
 *    уменьшается только reversal при refund. Клиент материализует дельту
 *    по seq (см. src/game/shop/ServerWalletSync.ts) и сам суммы не выдумывает.
 *    server_id — env.PAYMENTS_SERVER_ID (дефолт 'ofeliya-d1-v1'): Mark держит
 *    стабильным; смена = другой серверный источник правды.
 *    POST, а не GET: initData в теле, а не в query (не светится в логах).
 *    501 — D1-биндинг не настроен; 401 — плохой initData.
 *
 *  GET /api/admin/stale-orders?olderThanMin=N — заказы 'pending' и платежи
 *    'paid'-без-fulfilled старше N минут (default 60) для ручной сверки.
 *    Авторизация: Authorization: Bearer <ADMIN_TOKEN>. Runbook — в
 *    worker/README_DEPLOY.md.
 *
 *  GET /api/health → {ok:true} (проверка деплоя).
 *
 * Схема: worker/schema.sql (orders, payments, wallets, wallet_ledger,
 * wallet_skins, refund_ops, duplicate_payments, schema_migrations).
 * Статус 'refund_requested' — бронь execute-возврата (патч №16, A5);
 * 'refunded' — ТОЛЬКО через POST /api/admin/refund (патч №14 E-c;
 * state machine с патча №16); воркер сам его не выставляет.
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
  /**
   * Патч №16 (A1): идентификатор серверного источника правды. Отдаётся в
   * POST /api/wallet как server_id (дефолт 'ofeliya-d1-v1'). Mark должен
   * держать его СТАБИЛЬНЫМ на бэкенд: смена значения = смена D1-базы/сброс,
   * клиент по нему детектирует «другой сервер». Менять только осознанно
   * (см. worker/README_DEPLOY.md).
   */
  PAYMENTS_SERVER_ID?: string;
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
 * Статус платежа в D1. 'refund_requested' — бронь execute-возврата (патч №16,
 * A5); 'refunded' выставляется ТОЛЬКО через POST /api/admin/refund
 * (патч №14, E-c; state machine с патча №16), воркер сам — никогда.
 */
export type PaymentStatus = 'paid' | 'fulfilled' | 'refund_requested' | 'refunded';

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
      // CORS-оценка (патч №16, D): '*' осознанно. Воркер не использует
      // cookie/credentials — каждый запрос авторизуется отдельно (initData
      // HMAC / ADMIN_TOKEN / X-Telegram-Bot-Api-Secret-Token), поэтому '*'
      // не открывает ничего, что было бы закрыто иначе. 'authorization'
      // добавлен в allow-headers: иначе браузерные админ-панели не смогли
      // бы слать Bearer <redacted> через preflight (было сломано).
      // Mark может сузить origin при желании — это deployment-решение.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
    },
  });
}

/**
 * Лимит тела входящих запросов (патч №16, D): 256 КБ на /api/webhook и
 * /api/invoice. Telegram-апдейты и invoice-запросы — единицы килобайт;
 * всё большее — аномалия. Проверка best-effort по content-length (заголовок
 * выставляет и Telegram, и fetch-клиенты); злонамеренно врущий
 * content-length — вне модели угроз reference-бэкенда (см. runbook).
 */
const MAX_BODY_BYTES = 256 * 1024;

async function readJsonBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; error: string; status: number }> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return { ok: false, error: 'body-too-large', status: 413 };
  }
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, error: 'bad-json', status: 400 };
  }
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
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body as { productId?: unknown; initData?: unknown; nonce?: unknown };
  const productId = typeof body.productId === 'string' ? body.productId : '';
  const initData = typeof body.initData === 'string' ? body.initData : '';
  const nonce = body.nonce;
  const product = SERVER_GRANTS[productId];
  if (!product) return json({ error: 'unknown-product' }, 400);
  // B2: каталог — серверная истина; битая цена в каталоге — 500, а не
  // создание инвойса с мусором (fail-closed, диагностика в логе).
  if (!Number.isSafeInteger(product.stars) || product.stars < 1 || product.stars > 10_000_000) {
    logEvent('invoice_catalog_misconfigured', { productId, stars: product.stars });
    return json({ error: 'catalog-misconfigured' }, 500);
  }
  if (!isValidNonce(nonce)) return json({ error: 'bad-nonce' }, 400);
  const v = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok) return json({ error: 'bad-init-data', reason: v.reason }, 401);
  // Атрибуция платежа требует userId: без него вебхук не сможет сверить from.id.
  if (v.userId == null) return json({ error: 'bad-init-data', reason: 'no-user-id' }, 401);
  // Заказ пишем ДО createInvoiceLink: ошибка записи → честный 502 до того,
  // как Telegram создаст инвойс (битый трекинг исключён).
  // B2 (патч №16): заказ иммутабелен — amount_stars, sku_version и снапшот
  // гранта (P1-2) пишутся один раз здесь; вебхук сверяет платёж именно с заказом.
  try {
    await env.PAYMENTS_DB.prepare(SQL_INSERT_ORDER)
      .bind(
        nonce, v.userId, productId, product.stars, GRANTS_VERSION,
        product.rna, product.boosterDays, product.skinId,
        Date.now()
      )
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
  /** B2: иммутабельная цена заказа (может быть NULL у строк до миграции). */
  amount_stars: number | null;
  /** B2: версия каталога на момент создания заказа. */
  sku_version: number | null;
  /** P1-2: снапшот гранта (NULL у заказов до миграции-16r2 — legacy fallback). */
  grant_rna: number | null;
  grant_booster_days: number | null;
  grant_skin_id: string | null;
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
    .prepare('SELECT user_id, product_id, status, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id FROM orders WHERE nonce=?')
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
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return json({ ok: false }, parsed.status);
  const update = parsed.body as {
    pre_checkout_query?: PreCheckoutQuery;
    message?: { successful_payment?: SuccessfulPayment; from?: { id?: number } };
  };

  // 1. Pre-checkout: ответить ОБЯЗАТЕЛЬНО в течение 10 секунд.
  //    СТРОГО (патч №15, P0-2): order.status ДОЛЖЕН быть 'pending'
  //    (раньше было `!== 'expired'` — оплаченный/неизвестный заказ проходил)
  //    И q.from.id ДОЛЖЕН совпадать с order.user_id (чужой инвойс — отказ:
  //    иначе пользователь платит, а платёж потом отвергается как чужой).
  //    Payload — nonce: order резолвится из D1. P1-3 (патч №16): цена
  //    сверяется с НЕИЗМЕНЯЕМЫМ ЗАКАЗОМ (order.amount_stars), а не с
  //    текущим каталогом — иначе снижение цены ломает легитимные инвойсы,
  //    созданные по старой цене (рассинхрон с вебхуком, который сверяет
  //    с order.amount_stars). Каталог здесь больше не нужен.
  //    Без PAYMENTS_DB — ok:false (fail-closed всей цепочки).
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
        // P1-3 (независимый review): сверка с НЕИЗМЕНЯЕМЫМ ЗАКАЗОМ, а не с
        // текущим каталогом. Иначе снижение цены ломает легитимные инвойсы,
        // созданные по старой цене (рассинхрон с вебхуком, который сверяет
        // с order.amount_stars). Каталог здесь больше не нужен.
        const orderOk =
          !!order &&
          order.status === 'pending' &&
          typeof fromId === 'number' &&
          fromId === order.user_id &&
          q.currency === 'XTR' &&
          typeof order.amount_stars === 'number' &&
          q.total_amount === order.amount_stars;
        ok = orderOk;
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
 * successful_payment → ОДИН db.batch() из трёх statement'ов (патч №16, A1):
 *   1. UPDATE orders → 'paid' (гейт status='pending');
 *   2. INSERT OR IGNORE INTO payments (...);
 *   3. INSERT OR IGNORE INTO wallet_ledger (grant) — запускает триггер
 *      trg_wallet_ledger_apply, который ведёт wallets/wallet_skins.
 * Атомарность: db.batch() — одна транзакция; при ошибке любого statement
 * весь батч откатывается (Cloudflare D1 docs; см. worker/src/sql.ts —
 * источники зафиксированы). Интерактивных транзакций в D1 нет, поэтому
 * read→calc→write кошелька в JS (патч №15: applyGrantBatch) удалён —
 * вся логика решения живёт в SQL-триггере.
 * Дубликатная доставка: оба INSERT — no-op (ON CONFLICT DO NOTHING) →
 * вставки нет → триггер не срабатывает → ноль доп. начисления.
 * Бросает при сбое инфраструктуры (нет PAYMENTS_DB, ошибка batch):
 * вызывающий отвечает 503, Telegram переотправит апдейт.
 * Невалидные/чужие платежи только логируются (200, ретрай не поможет).
 * Товар вне каталога (unknown-product): записывается как 'paid' батчем из
 * ДВУХ statement'ов (без ledger — выдавать нечего) + громкий лог, БЕЗ
 * пометки fulfilled — ручное разрешение позже (патч №14, E-a).
 */

/**
 * P1-2 (независимый review): грант из снапшота заказа.
 * Возвращает {kind, grant} как grantForProduct, но по зафиксированным
 * в заказе значениям. Legacy (все три поля NULL) → fallback на текущий
 * каталог (возвращает null, если товара нет и там — unknown-product).
 * Частичный снапшот (только часть полей NULL) — битые данные → null.
 */
function grantFromOrderSnapshot(
  order: DbOrderRow
): { kind: 'rna' | 'booster' | 'skin'; grant: ServerGrant } | null {
  const { grant_rna, grant_booster_days, grant_skin_id } = order;
  const hasSnapshot =
    typeof grant_rna === 'number' ||
    typeof grant_booster_days === 'number' ||
    typeof grant_skin_id === 'string';
  if (!hasSnapshot) {
    // Legacy-заказ без снимка: текущий каталог (громкий лог — у вызывающего).
    return grantForProduct(order.product_id);
  }
  // Снапшот должен быть полным; иначе — битые данные, не выдаём.
  if (
    typeof grant_rna !== 'number' ||
    typeof grant_booster_days !== 'number' ||
    (grant_skin_id !== null && typeof grant_skin_id !== 'string')
  ) {
    return null;
  }
  const grant: ServerGrant = {
    title: '',
    description: '',
    stars: 0, // цена — из order.amount_stars, не из снимка гранта
    rna: Math.max(0, Math.floor(grant_rna)),
    boosterDays: Math.max(0, Math.floor(grant_booster_days)),
    skinId: grant_skin_id,
  };
  if (grant.skinId) return { kind: 'skin', grant };
  if (grant.boosterDays > 0) return { kind: 'booster', grant };
  if (grant.rna > 0) return { kind: 'rna', grant };
  return null;
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
  // B2: границы суммы — fail-closed с диагностикой. Stars — целые;
  // всё вне [1, 10_000_000] или не-XTR — аномалия, не платёж.
  const amount = sp.total_amount;
  if (
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 10_000_000 ||
    sp.currency !== 'XTR'
  ) {
    logEvent('stars_payment_bounds', { ...base, userId: fromId });
    return;
  }
  // Патч №15 (P0-2): backstop повторного использования nonce. Один nonce —
  // один платёж (UNIQUE(payments.nonce) в схеме). Основной гейт — строгий
  // pre_checkout (status==='pending'); это защита от гонки двух pre_checkout
  // до записи платежа. 200, не 503: ретрай не поможет, это не сбой
  // инфраструктуры.
  // P1-5 (независимый review): молча отбрасывать нельзя — Stars уже списаны
  // Telegram. Пишем в duplicate_payments БЕЗ гранта: платёж видим в D1,
  // возвращаем вручную через /api/admin/refund (reversal будет 0 строк —
  // гранта не было, это ок).
  const nonceRow = await db
    .prepare('SELECT charge_id FROM payments WHERE nonce=?')
    .bind(nonce)
    .first<{ charge_id: string }>();
  if (nonceRow && nonceRow.charge_id !== chargeId) {
    try {
      const dupNow = Date.now();
      await db
        .prepare(
          'INSERT INTO duplicate_payments ' +
            '(charge_id, nonce, user_id, product_id, amount, currency, reason, created_at) ' +
            'VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(charge_id) DO NOTHING'
        )
        .bind(chargeId, nonce, fromId, order.product_id, amount, sp.currency, 'nonce_reuse', dupNow)
        .run();
    } catch {
      // Не смогли записать дубликат — логируем, платёж не теряем из виду:
      // reconcile с токеном найдёт его как telegram_without_d1.
    }
    logEvent('stars_payment_nonce_reuse', {
      ...base,
      userId: fromId,
      existingChargeId: nonceRow.charge_id,
    });
    return;
  }
  // P1-2 (независимый review): грант — из СНАПШОТА заказа, а не из текущего
  // каталога. Заказ — иммутабельный контракт: что зафиксировано в инвойсе,
  // то и выдаётся, даже если каталог сменил грант без смены цены.
  // Legacy-заказы (снимка нет, NULL): fallback на текущий каталог + громкий
  // лог — такие заказы либо уже оплачены, либо протухли.
  const resolved = grantFromOrderSnapshot(order);
  const now = Date.now();
  const skuVersion = typeof order.sku_version === 'number' ? order.sku_version : GRANTS_VERSION;
  if (!resolved) {
    // E-a: товар оплачен, но его нет в каталоге (каталог сменился между
    // созданием инвойса и оплатой). НЕ silent-skip: пишем как 'paid' +
    // громкий лог; fulfilled НЕ ставим — ручное разрешение позже.
    // Батч из ДВУХ statement'ов — ledger-строки нет, выдавать нечего.
    const results = await db.batch([
      db.prepare(SQL_INSERT_PAYMENT).bind(
        chargeId, fromId, order.product_id, amount, sp.currency, 'paid', nonce, skuVersion, now, null
      ),
      db.prepare(SQL_UPDATE_ORDER_PAID).bind(nonce),
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
  // B2: платёж сверяется с НЕИЗМЕНЯЕМЫМ заказом (amount_stars зафиксирован
  // в /api/invoice), а не только с текущим каталогом. NULL у строк,
  // созданных до миграции-16 без backfill, — тоже fail-closed: такие заказы
  // либо уже оплачены, либо протухли; честный путь — новый инвойс.
  if (typeof order.amount_stars !== 'number' || amount !== order.amount_stars) {
    logEvent('stars_payment_amount_mismatch', {
      ...base,
      userId: fromId,
      productId: order.product_id,
      expectedStars: order.amount_stars,
      catalogStars: grant.stars,
    });
    return;
  }
  // Дрейф каталога между инвойсом и оплатой: заказ — иммутабельный контракт
  // (игрок заплатил ровно то, что просили), поэтому выдача идёт, но дрейф
  // логируется громко — Mark видит расхождение цен в логах.
  if (order.amount_stars !== grant.stars || skuVersion !== GRANTS_VERSION) {
    logEvent('stars_payment_sku_drift', {
      ...base,
      userId: fromId,
      productId: order.product_id,
      orderStars: order.amount_stars,
      orderSku: skuVersion,
      catalogStars: grant.stars,
      catalogSku: GRANTS_VERSION,
    });
  }
  // amount для журнала (знаковый INTEGER, см. schema.sql):
  // rna +N; booster +мс; skin 0. Триггер применит к wallets/wallet_skins.
  const ledgerAmount =
    kind === 'rna'
      ? Math.max(0, Math.floor(grant.rna))
      : kind === 'booster'
        ? Math.max(0, Math.floor(grant.boosterDays)) * 86_400_000
        : 0;
  const skinId = kind === 'skin' ? grant.skinId : null;
  // ОДИН батч — одна транзакция: либо платёж+грант+кошелёк, либо ничего.
  // Ошибка → throw → 503 → Telegram переотправит (идемпотентно).
  const results = await db.batch([
    db.prepare(SQL_UPDATE_ORDER_PAID).bind(nonce),
    db.prepare(SQL_INSERT_PAYMENT).bind(
      chargeId, fromId, order.product_id, amount, sp.currency, 'paid', nonce, skuVersion, now, null
    ),
    db.prepare(SQL_INSERT_LEDGER_GRANT).bind(
      fromId, chargeId, 'grant', kind, ledgerAmount, skinId, null, grantAmountText(kind, grant), now
    ),
  ]);
  if (results[1]?.meta.changes === 0) {
    // Дубликат доставки: INSERT — no-op, триггер не сработал, грант уже
    // применён первой доставкой (атомарно — self-heal больше не нужен).
    logEvent('stars_payment_duplicate', { ...base, userId: fromId });
    return;
  }
  logEvent('stars_payment_recorded', {
    ...base,
    userId: fromId,
    productId: order.product_id,
    grantKind: kind,
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
    // Патч №14 (P0-3): status='refunded' ЯВНО исключается — возвращённый
    // платёж нельзя перевыдать. Патч №16: 'refund_requested' (возврат
    // в процессе) — тоже: выдача по нему гонялась бы с reversal.
    if (payment.status === 'refunded' || payment.status === 'refund_requested') {
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
      status: (['paid', 'fulfilled', 'refund_requested', 'refunded'] as const).includes(
        row.status as PaymentStatus
      )
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
/**
 * POST /api/wallet {initData, since_seq?} — серверный кошелёк (v5, патч №16).
 * Источник правды о ПОКУПКАХ: что сервер выдал этому user_id.
 * → {ok, user_id, server_id, schema_version:2, purchased_rna,
 *    booster_until_ms, skins[] (активные из wallet_skins),
 *    ledger[] (строки с id>since_seq, seq=id, LIMIT 5000),
 *    tip_seq (MAX(id)), ledger_tip (legacy: MAX(created_at))}.
 * Клиент синкается по seq (монотонен): since_seq=0 → весь журнал.
 * server_id — env.PAYMENTS_SERVER_ID (дефолт 'ofeliya-d1-v1'): Mark держит
 * стабильным; смена значения = другой серверный источник правды.
 * POST, а не GET: initData в теле, а не в query (не светится в логах).
 * 501 — D1-биндинг не настроен; 401 — плохой initData.
 */
async function handleWallet(request: Request, env: Env): Promise<Response> {
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 501);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'backend-misconfigured' }, 500);
  let body: { initData?: unknown; since_seq?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const initData = typeof body.initData === 'string' ? body.initData : '';
  const v = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok || v.userId == null) return json({ error: 'bad-init-data', reason: v.reason }, 401);
  const sinceSeq =
    typeof body.since_seq === 'number' &&
    Number.isSafeInteger(body.since_seq) &&
    body.since_seq >= 0
      ? Math.floor(body.since_seq)
      : 0;
  try {
    const db = env.PAYMENTS_DB;
    const wallet = await db
      .prepare('SELECT purchased_rna, booster_until_ms FROM wallets WHERE user_id=?')
      .bind(v.userId)
      .first<{ purchased_rna: number; booster_until_ms: number }>();
    const { results: skinRows } = await db
      .prepare("SELECT skin_id FROM wallet_skins WHERE user_id=? AND status='active' ORDER BY granted_at ASC")
      .bind(v.userId)
      .all<{ skin_id: string }>();
    const { results: ledgerRows } = await db
      .prepare(
        'SELECT id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, created_at FROM wallet_ledger ' +
          'WHERE user_id=? AND id>? ORDER BY id ASC LIMIT 5000'
      )
      .bind(v.userId, sinceSeq)
      .all<{
        id: number;
        charge_id: string;
        kind: string;
        grant_type: string;
        amount: number;
        skin_id: string | null;
        reverses_charge_id: string | null;
        created_at: number;
      }>();
    const tip = await db
      .prepare('SELECT MAX(id) AS tip_seq, MAX(created_at) AS tip_created FROM wallet_ledger WHERE user_id=?')
      .bind(v.userId)
      .first<{ tip_seq: number | null; tip_created: number | null }>();
    return json({
      ok: true,
      user_id: v.userId,
      server_id: env.PAYMENTS_SERVER_ID || 'ofeliya-d1-v1',
      schema_version: 2,
      purchased_rna:
        typeof wallet?.purchased_rna === 'number' && wallet.purchased_rna >= 0
          ? Math.floor(wallet.purchased_rna)
          : 0,
      booster_until_ms:
        typeof wallet?.booster_until_ms === 'number' && wallet.booster_until_ms > 0
          ? Math.floor(wallet.booster_until_ms)
          : 0,
      skins: skinRows
        .map((r) => r.skin_id)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
      ledger: ledgerRows.map((r) => ({
        seq: r.id,
        charge_id: r.charge_id,
        kind: r.kind,
        grant_type: r.grant_type,
        amount: typeof r.amount === 'number' ? r.amount : 0,
        skin_id: typeof r.skin_id === 'string' ? r.skin_id : null,
        reverses_charge_id: typeof r.reverses_charge_id === 'string' ? r.reverses_charge_id : null,
        created_at: r.created_at,
      })),
      tip_seq: typeof tip?.tip_seq === 'number' ? tip.tip_seq : 0,
      // ledger_tip — legacy для клиентов до патча №16 (watermark по created_at).
      ledger_tip: typeof tip?.tip_created === 'number' ? tip.tip_created : null,
    });
  } catch {
    return json({ error: 'db-read-failed' }, 502);
  }
}

/**
 * POST /api/admin/refund {chargeId, reason?, execute?, operationId?,
 * confirmExternalRefund?} — state machine возвратов (патч №16, A5).
 *
 * У Telegram Stars нет автоматического refund-webhook для ботов — возвраты
 * только руками Mark. Авторизация: Authorization: Bearer <ADMIN_TOKEN>
 * (НЕ bot token). ADMIN_TOKEN обязателен в env (fail-closed 401).
 *
 * Два РАЗНЫХ действия, не путать (см. README_DEPLOY §10):
 *  - execute !== true → «ПОМЕТИТЬ»: требует confirmExternalRefund===true
 *    + reason, иначе 400 {error:'confirm-required'} («подтверди, что деньги
 *    реально возвращены вне системы»). ОДИН батч: INSERT refund_ops
 *    (action='mark', status='completed') + UPDATE payments→'refunded' +
 *    INSERT reversal в ledger (SELECT из grant-строки; если её нет —
 *    0 строк, это ок). Для возвратов, выполненных вручную через
 *    BotFather/поддержку Telegram.
 *  - execute === true → «ВЫПОЛНИТЬ»: батч1 — INSERT refund_ops
 *    (action='execute', status='requested') + UPDATE payments→
 *    'refund_requested' (бронь; 0 changes → уже в процессе/refunded →
 *    {ok:true, already:true} или not-found). Затем Bot API refundStarPayment
 *    (тем же TELEGRAM_BOT_TOKEN). Успех ИЛИ ошибка 'already refunded' от
 *    Telegram → батч2: [refund_ops→'completed' (+telegram_confirmed_at),
 *    payments→'refunded', reversal в ledger]. Сетевая ошибка → операция
 *    остаётся 'requested' → повтор с тем же operationId продолжает
 *    (идемпотентно, без двойного списания: повторный refundStarPayment при
 *    'already refunded' трактуем как confirmed).
 *
 * operation_id — UNIQUE; клиент может прислать, иначе crypto.randomUUID().
 * Чужой operationId на другой chargeId → 400 {error:'operation-id-mismatch'}.
 * Журнал админа = refund_ops (reason обрезан до 200; секреты НЕ логируются —
 * см. аудит logEvent в патче №16, D).
 * Откат серверного кошелька — reversal-строкой в ledger: триггер
 * trg_wallet_ledger_apply применяет её атомарно в том же батче
 * (rna: max(0, −N); booster: время вспять не отматываем; skin: гасим только
 * строку своего charge_id). Локальное значение на устройстве НЕ отзывается
 * (модель угроз).
 * Без PAYMENTS_DB → 501.
 */
async function handleAdminRefund(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.PAYMENTS_DB) return json({ error: 'db_unavailable' }, 501);
  let body: {
    chargeId?: unknown;
    reason?: unknown;
    execute?: unknown;
    operationId?: unknown;
    confirmExternalRefund?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const chargeId = typeof body.chargeId === 'string' && body.chargeId.length > 0 ? body.chargeId : '';
  if (!chargeId) return json({ error: 'bad-charge-id' }, 400);
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
  const execute = body.execute === true;
  const operationId =
    typeof body.operationId === 'string' && body.operationId.length > 0
      ? body.operationId.slice(0, 64)
      : crypto.randomUUID();
  try {
    const db = env.PAYMENTS_DB;
    const now = Date.now();
    // Идемпотентность по operation_id: повтор того же вызова — тот же ответ.
    const existingOp = await db
      .prepare('SELECT operation_id, charge_id, action, status FROM refund_ops WHERE operation_id=?')
      .bind(operationId)
      .first<{ operation_id: string; charge_id: string; action: string; status: string }>();
    if (existingOp) {
      if (existingOp.charge_id !== chargeId) {
        return json({ ok: false, error: 'operation-id-mismatch' }, 400);
      }
      if (existingOp.status === 'completed') return json({ ok: true, already: true });
      // status='requested' → execute-флоу в процессе: падаем ниже и
      // продолжаем с refundStarPayment (идемпотентный повтор).
      // mark-флоу 'requested' не оставляет — это чужой незавершённый
      // execute: продолжать его пометкой нельзя.
      if (!execute) return json({ ok: false, error: 'operation-in-progress' }, 409);
    }
    const payment = await db
      .prepare('SELECT charge_id, user_id, product_id, status FROM payments WHERE charge_id=?')
      .bind(chargeId)
      .first<{ charge_id: string; user_id: number; product_id: string; status: string }>();
    if (!payment) return json({ ok: false, error: 'not-found' });
    if (payment.status === 'refunded') return json({ ok: true, already: true });
    // P1-6 (независимый review): mark во время чужого execute ('refund_requested')
    // НЕ ДОЛЖЕН применять reversal: батч mark коммитится (reversal в журнале),
    // а UPDATE payments даёт 0 строк → уже было {ok:true, already:true} при
    // неоткаченном... точнее, при ОТКАЧЕННОМ, но незавершённом возврате —
    // state machine нарушена. Требуем строго paid/fulfilled, иначе 409.
    if (!execute && payment.status !== 'paid' && payment.status !== 'fulfilled') {
      return json({ ok: false, error: 'refund-in-progress' }, 409);
    }

    const revChargeId = `rev:${operationId}`;

    if (!execute) {
      // «ПОМЕТИТЬ»: деньги уже возвращены ВНЕ системы (BotFather/поддержка).
      // Требуем явного подтверждения — иначе легко пометить refund, не
      // вернув деньги: грант откатится, а Stars останутся у игрока.
      if (body.confirmExternalRefund !== true || !reason) {
        return json(
          {
            ok: false,
            error: 'confirm-required',
            message:
              'подтверди, что деньги реально возвращены вне системы: ' +
              'confirmExternalRefund:true + reason',
          },
          400
        );
      }
      // ОДИН батч: журнал + статус + reversal (атомарно; reversal SELECT
      // даёт 0 строк, если grant-строки нет — откатывать нечего, это ок).
      const results = await db.batch([
        db.prepare(SQL_INSERT_REFUND_OP).bind(
          operationId, chargeId, payment.user_id, 'mark', 'completed', reason, null, now, now
        ),
        db.prepare(SQL_UPDATE_PAYMENT_REFUNDED).bind(chargeId),
        db.prepare(SQL_INSERT_LEDGER_REVERSAL).bind(revChargeId, now, chargeId, chargeId, chargeId),
      ]);
      if (results[1]?.meta.changes === 0) {
        // Статус сменился между SELECT и батчем (конкурентный refund) —
        // идемпотентный ответ, состояние не портится.
        return json({ ok: true, already: true });
      }
      logEvent('stars_payment_refunded_mark', {
        telegramChargeId: chargeId,
        operationId,
        reason,
      });
      return json({ ok: true, executed: false, operationId });
    }

    // «ВЫПОЛНИТЬ»: двухшаговый, с бронью перед внешним вызовом.
    const resumeRequested = !!existingOp && existingOp.status === 'requested';
    if (!resumeRequested) {
      const b1 = await db.batch([
        db.prepare(SQL_INSERT_REFUND_OP).bind(
          operationId, chargeId, payment.user_id, 'execute', 'requested', reason, null, now, now
        ),
        db.prepare(SQL_UPDATE_PAYMENT_REFUND_REQUESTED).bind(chargeId),
      ]);
      if (b1[1]?.meta.changes === 0) {
        // Платёж не в ('paid','fulfilled'): его забрал конкурентный вызов
        // (mark/execute) между нашим SELECT и батчем. Наша операция ничего
        // не сделала — честно помечаем её 'failed', чтобы не висела
        // вечным 'requested' (reconcile.mjs такое находит).
        await db
          .prepare("UPDATE refund_ops SET status='failed', updated_at=? WHERE operation_id=?")
          .bind(now, operationId)
          .run();
        // Перечитываем для точного ответа.
        const cur = await db
          .prepare('SELECT status FROM payments WHERE charge_id=?')
          .bind(chargeId)
          .first<{ status: string }>();
        if (!cur || cur.status === 'refunded') return json({ ok: true, already: true });
        // 'refund_requested' чужим operationId — второй админ в том же
        // флоу: не мешаем, сообщаем честно.
        return json({ ok: false, error: 'refund-in-progress' }, 409);
      }
    }
    if (!env.TELEGRAM_BOT_TOKEN) {
      return json({ ok: false, error: 'bot-token-misconfigured' }, 503);
    }
    try {
      await botApi(env.TELEGRAM_BOT_TOKEN, 'refundStarPayment', {
        user_id: payment.user_id,
        telegram_payment_charge_id: chargeId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already refunded/i.test(msg)) {
        // Сетевая/прочая ошибка: операция остаётся 'requested' — повтор
        // с тем же operationId продолжит (refundStarPayment идемпотентен
        // на стороне Telegram; двойного списания не будет).
        logEvent('stars_refund_failed', {
          telegramChargeId: chargeId,
          operationId,
          userId: payment.user_id,
          error: msg,
        });
        return json({ ok: false, error: 'refund-failed' }, 502);
      }
      // 'already refunded' — деньги уже возвращены (повтор/ручной возврат):
      // трактуем как подтверждение и завершаем пометку.
    }
    // Батч2: завершение — атомарно (журнал + статус + reversal через триггер).
    await db.batch([
      db.prepare(SQL_COMPLETE_REFUND_OP).bind(now, now, operationId),
      db.prepare(SQL_UPDATE_PAYMENT_REFUNDED_FROM_ANY).bind(chargeId),
      db.prepare(SQL_INSERT_LEDGER_REVERSAL).bind(revChargeId, now, chargeId, chargeId, chargeId),
    ]);
    logEvent('stars_payment_refunded_execute', {
      telegramChargeId: chargeId,
      operationId,
      reason,
    });
    return json({ ok: true, executed: true, operationId });
  } catch {
    return json({ error: 'db-write-failed' }, 502);
  }
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

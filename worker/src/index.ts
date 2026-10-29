/**
 * OFELIYA payments reference backend — Cloudflare Worker (TypeScript, zero deps).
 *
 * Зачем: Telegram Stars-инвойсы НЕЛЬЗЯ создавать из клиента (нужен bot token),
 * поэтому игре нужен минимальный бэкенд. Воркер делает ровно две вещи:
 *
 *  POST /api/invoice {productId, initData}
 *    → валидирует initData по HMAC-SHA256 (документация Telegram:
 *      https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 *    → сверяет товар с СЕРВЕРНЫМ whitelist (цену от клиента НЕ доверяет)
 *    → Bot API createInvoiceLink (currency='XTR', provider_token='',
 *      prices=[{label, amount}] — amount в ЦЕЛЫХ звёздах)
 *    → {invoiceUrl}
 *
 *  POST /api/webhook  (Telegram → воркер)
 *    → pre_checkout_query: сверка payload/цены → answerPreCheckoutQuery
 *      (ОБЯЗАТЕЛЬНО в течение 10 секунд, иначе платёж отменяется)
 *    → message.successful_payment: идемпотентная запись в KV (по
 *      telegram_payment_charge_id) + пополнение списка товаров пользователя.
 *
 *  POST /api/entitlements {initData}
 *    → валидирует initData (та же схема, что /api/invoice)
 *    → {products: [...]} — товары пользователя из KV;
 *      501, если KV-биндинг не настроен.
 *
 *  GET /api/health → {ok:true} (проверка деплоя).
 *
 * KV (Cloudflare, бесплатный тир) — опционален: без биндинга PAYMENTS
 * /api/entitlements отвечает 501, а successful_payment только логируется
 * (как раньше). С биндингом клиент сверяет покупку с сервером вместо
 * доверия клиентскому колбэку openInvoice.
 *
 * Серверный контракт scripts/check-profile-client.mjs:162
 * ('purchase' must never be accepted) в этом скоупе НЕ меняется:
 * KV воркера — его собственное хранилище entitlements, а не inventory
 * профильного сервера. Отдельное решение.
 *
 * Секреты (wrangler secret put, НЕ в репозиторий):
 *  TELEGRAM_BOT_TOKEN — токен бота из BotFather;
 *  WEBHOOK_SECRET     — опционально; сверяется с заголовком
 *                       X-Telegram-Bot-Api-Secret-Token.
 *
 * KV: npx wrangler kv:namespace create PAYMENTS (см. worker/README_DEPLOY.md).
 *
 * Деплой: см. worker/README_DEPLOY.md. Ничего из этого файла не деплоится
 * автоматически — только руками Mark.
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string;
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
  put(key: string, value: string): Promise<void>;
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

/** initData старше суток считаем протухшей. */
const INIT_DATA_MAX_AGE_S = 86400;

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
  let body: { productId?: unknown; initData?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  const productId = typeof body.productId === 'string' ? body.productId : '';
  const initData = typeof body.initData === 'string' ? body.initData : '';
  const product = SERVER_PRODUCTS[productId];
  if (!product) return json({ error: 'unknown-product' }, 400);
  const v = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!v.ok) return json({ error: 'bad-init-data', reason: v.reason }, 401);
  try {
    const invoiceUrl = (await botApi(env.TELEGRAM_BOT_TOKEN, 'createInvoiceLink', {
      title: product.title,
      description: product.description,
      payload: JSON.stringify({ productId, userId: v.userId ?? 0, ts: Date.now() }),
      provider_token: '', // пусто для Stars (цифровые товары)
      currency: 'XTR',
      prices: [{ label: product.title, amount: product.stars }],
    })) as string;
    return json({ invoiceUrl });
  } catch {
    return json({ error: 'invoice-create-failed' }, 502);
  }
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

function parsePayload(raw: string | undefined): { productId?: string; userId?: number } {
  try {
    if (!raw) return {};
    const p = JSON.parse(raw) as { productId?: unknown; userId?: unknown };
    return {
      productId: typeof p.productId === 'string' ? p.productId : undefined,
      userId: typeof p.userId === 'number' ? p.userId : undefined,
    };
  } catch {
    return {};
  }
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (env.WEBHOOK_SECRET) {
    const got = request.headers.get('x-telegram-bot-api-secret-token');
    if (got !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  }
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
  const q = update.pre_checkout_query;
  if (q) {
    const { productId } = parsePayload(q.invoice_payload);
    const server = productId ? SERVER_PRODUCTS[productId] : undefined;
    const ok =
      !!server && q.currency === 'XTR' && q.total_amount === server.stars;
    await botApi(env.TELEGRAM_BOT_TOKEN, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Товар недоступен. Попробуйте позже.' }),
    });
    return json({ ok: true });
  }

  // 2. Успешный платёж: структурированный лог + идемпотентная запись
  // в KV (пост-ревью, патч №11). Без KV-биндинга — только лог, как раньше.
  const sp = update.message?.successful_payment;
  if (sp) {
    const { productId } = parsePayload(sp.invoice_payload);
    const userId = update.message?.from?.id;
    const chargeId = sp.telegram_payment_charge_id;
    console.log(
      JSON.stringify({
        event: 'stars_payment',
        productId,
        userId,
        stars: sp.total_amount,
        currency: sp.currency,
        telegramChargeId: chargeId,
        providerChargeId: sp.provider_payment_charge_id,
      })
    );
    if (env.PAYMENTS && chargeId && productId && typeof userId === 'number') {
      try {
        // Идемпотентность: повторный вебхук того же charge_id не дублирует выдачу.
        const chargeKey = `charge:${chargeId}`;
        if (!(await env.PAYMENTS.get(chargeKey))) {
          await env.PAYMENTS.put(
            chargeKey,
            JSON.stringify({ productId, userId, stars: sp.total_amount ?? 0, ts: Date.now() })
          );
          const userKey = `user:${userId}:products`;
          const raw = await env.PAYMENTS.get(userKey);
          const list: unknown = raw ? JSON.parse(raw) : [];
          const products = Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
          if (!products.includes(productId)) {
            products.push(productId);
            await env.PAYMENTS.put(userKey, JSON.stringify(products));
          }
        }
      } catch {
        // KV не должен ронять вебхук: платёж уже подтверждён Telegram.
      }
    }
  }
  return json({ ok: true });
}

/**
 * Пост-ревью (патч №11): серверный список покупок пользователя.
 * Клиент сверяет с ним колбэк openInvoice вместо слепого доверия.
 * 501 — KV-биндинг не настроен (клиент падает на fallback-выдачу с варном).
 */
async function handleEntitlements(request: Request, env: Env): Promise<Response> {
  if (!env.PAYMENTS) return json({ error: 'entitlements-unavailable' }, 501);
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
    const raw = await env.PAYMENTS.get(`user:${v.userId}:products`);
    const list: unknown = raw ? JSON.parse(raw) : [];
    const products = Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
    return json({ products });
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
    if (request.method === 'POST' && url.pathname === '/api/entitlements') {
      return handleEntitlements(request, env);
    }
    return new Response('not found', { status: 404 });
  },
};

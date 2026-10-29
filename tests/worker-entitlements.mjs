/**
 * Worker entitlements — KV-запись платежей и POST /api/entitlements
 * (пост-ревью, патч №11; порт партии 4а).
 *
 * Covers:
 * - webhook successful_payment → идемпотентная KV-запись
 *   (charge:<telegram_payment_charge_id> + user:<id>:products);
 * - повторный вебхук того же charge_id не дублирует выдачу;
 * - POST /api/entitlements → {products} по валидной initData;
 * - без KV-биндинга → 501; плохая initData → 401.
 *
 * Подпись initData считается НЕЗАВИСИМО от кода воркера (node:crypto
 * по схеме из документации Telegram), как в tests/worker-payments.mjs.
 * Компилирует worker/src/index.ts через tsc; KV — in-memory стаб.
 * Никакого реального Cloudflare/KV здесь нет — только код воркера.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-ent-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-entitlements: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// Тестовый токен (фиктивный, только для подписи в этом тесте).
const BOT_TOKEN = '123456:TEST-ENTITLEMENTS-ONLY-NOT-A-REAL-TOKEN';

function signInitData(fields) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function buildInitData(userId) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE-test-entitlements',
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', signInitData(fields));
  return params.toString();
}

/** In-memory KV-стаб с интерфейсом воркера (get/put). */
function makeKv() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, value);
    },
  };
}

function webhookBody({ userId, productId, chargeId, stars }) {
  return {
    message: {
      from: { id: userId },
      successful_payment: {
        currency: 'XTR',
        total_amount: stars,
        invoice_payload: JSON.stringify({ productId, userId }),
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: `provider-${chargeId}`,
      },
    },
  };
}

async function post(worker, env, path, body) {
  const res = await worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env
  );
  let json = null;
  try {
    json = await res.json();
  } catch {
    // не-JSON ответ (например, plain 501/401 — здесь всегда JSON, но страховка)
  }
  return { status: res.status, json };
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'worker/src/index.ts',
      '--target',
      'ES2021',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'pipe' }
  );

  const worker = require(join(temp, 'index.js')).default;
  const kv = makeKv();
  const env = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, PAYMENTS: kv };

  // --- webhook → KV-запись ---
  const first = await post(worker, env, '/api/webhook', webhookBody({
    userId: 777001,
    productId: 'skin.virulent-magenta',
    chargeId: 'charge-test-1',
    stars: 100,
  }));
  eq(first.status, 200, 'webhook ok');
  const chargeRaw = await kv.get('charge:charge-test-1');
  assert(chargeRaw !== null, 'charge key written');
  eq(JSON.parse(chargeRaw).productId, 'skin.virulent-magenta', 'charge stores product');
  eq(JSON.parse(chargeRaw).userId, 777001, 'charge stores user');
  eq(
    await kv.get('user:777001:products'),
    JSON.stringify(['skin.virulent-magenta']),
    'user products list written'
  );

  // --- повторный вебхук не дублирует ---
  await post(worker, env, '/api/webhook', webhookBody({
    userId: 777001,
    productId: 'skin.virulent-magenta',
    chargeId: 'charge-test-1',
    stars: 100,
  }));
  eq(
    await kv.get('user:777001:products'),
    JSON.stringify(['skin.virulent-magenta']),
    'duplicate webhook does not duplicate'
  );

  // --- второй товар того же пользователя дописывается ---
  await post(worker, env, '/api/webhook', webhookBody({
    userId: 777001,
    productId: 'booster.rna-x2-7d',
    chargeId: 'charge-test-2',
    stars: 75,
  }));
  eq(
    await kv.get('user:777001:products'),
    JSON.stringify(['skin.virulent-magenta', 'booster.rna-x2-7d']),
    'second product appended'
  );

  // --- /api/entitlements → {products} по валидной initData ---
  const ent = await post(worker, env, '/api/entitlements', { initData: buildInitData(777001) });
  eq(ent.status, 200, 'entitlements ok');
  eq(
    JSON.stringify(ent.json.products),
    JSON.stringify(['skin.virulent-magenta', 'booster.rna-x2-7d']),
    'entitlements returns user products'
  );

  // --- чужой пользователь — пустой список, не чужие товары ---
  const other = await post(worker, env, '/api/entitlements', { initData: buildInitData(555000) });
  eq(other.status, 200, 'entitlements ok for unknown user');
  eq(JSON.stringify(other.json.products), JSON.stringify([]), 'unknown user has no products');

  // --- без KV-биндинга → 501 ---
  const noKv = await post(worker, { TELEGRAM_BOT_TOKEN: BOT_TOKEN }, '/api/entitlements', {
    initData: buildInitData(777001),
  });
  eq(noKv.status, 501, 'no KV binding → 501');

  // --- плохая initData → 401 ---
  const bad = await post(worker, env, '/api/entitlements', { initData: 'garbage' });
  eq(bad.status, 401, 'bad initData → 401');

  // --- вебхук без KV не падает (только лог, как раньше) ---
  const noKvHook = await post(worker, { TELEGRAM_BOT_TOKEN: BOT_TOKEN }, '/api/webhook', webhookBody({
    userId: 777001,
    productId: 'skin.abyssal-teal',
    chargeId: 'charge-test-3',
    stars: 100,
  }));
  eq(noKvHook.status, 200, 'webhook without KV still ok');

  console.log('worker-entitlements: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

/**
 * Worker payments backend — initData HMAC-валидация и серверный каталог.
 *
 * Строит тестовый вектор НЕЗАВИСИМО от кода воркера (node:crypto по схеме
 * из документации Telegram) и проверяет, что validateInitData его принимает,
 * а поддельные/протухшие данные отвергает. Компилирует worker/src/index.ts
 * через tsc (модуль экспортирует validateInitData/SERVER_PRODUCTS).
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-payments: ${message}`);
};

const BOT_TOKEN = '123456:TEST-TOKEN-ABCDEF';

/**
 * Независимый расчёт подписи по документации Telegram
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret_key = HMAC_SHA256(bot_token, key="WebAppData").
 */
function signInitData(fields) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function buildInitData(fields) {
  const hash = signInitData(fields);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', hash);
  return params.toString();
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
    { stdio: 'inherit' }
  );

  const { validateInitData, SERVER_PRODUCTS } = require(join(temp, 'index.js'));

  const now = Math.floor(Date.now() / 1000);
  const fields = {
    auth_date: String(now),
    query_id: 'AAE-test-query',
    user: JSON.stringify({ id: 777001, first_name: 'Test' }),
  };

  // --- валидная подпись принимается ---
  let v = await validateInitData(buildInitData(fields), BOT_TOKEN);
  assert(v.ok === true, 'valid signature accepted');
  assert(v.userId === 777001, 'user id extracted');

  // --- подмена user.id ломает подпись ---
  const tampered = { ...fields, user: JSON.stringify({ id: 999 }) };
  const tamperedParams = new URLSearchParams();
  for (const [k, val] of Object.entries(tampered)) tamperedParams.set(k, val);
  // подпись от ОРИГИНАЛЬНЫХ полей, данные — подменённые
  tamperedParams.set('hash', signInitData(fields));
  v = await validateInitData(tamperedParams.toString(), BOT_TOKEN);
  assert(v.ok === false && v.reason === 'bad-hash', 'tampered payload rejected');

  // --- чужой bot token не проходит ---
  v = await validateInitData(buildInitData(fields), '000000:WRONG');
  assert(v.ok === false && v.reason === 'bad-hash', 'wrong token rejected');

  // --- протухшая auth_date ---
  const stale = { ...fields, auth_date: String(now - 90000) };
  v = await validateInitData(buildInitData(stale), BOT_TOKEN);
  assert(v.ok === false && v.reason === 'stale-auth-date', 'stale auth_date rejected');

  // --- нет hash ---
  const noHash = new URLSearchParams();
  noHash.set('auth_date', String(now));
  v = await validateInitData(noHash.toString(), BOT_TOKEN);
  assert(v.ok === false && v.reason === 'no-hash', 'missing hash rejected');

  // --- мусор ---
  v = await validateInitData('not-a-query-string%%%', BOT_TOKEN);
  assert(v.ok === false, 'garbage rejected');

  // --- серверный каталог совпадает с клиентским (цены!) ---
  const { SHOP_CATALOG } = await (async () => {
    const t2 = mkdtempSync(join(tmpdir(), 'ofeliya-wcat-'));
    writeFileSync(join(t2, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    try {
      execFileSync(
        process.execPath,
        [
          resolve('node_modules/typescript/bin/tsc'),
          'src/game/shop/PaymentProvider.ts',
          'src/game/shop/products.ts',
          '--target',
          'ES2020',
          '--module',
          'commonjs',
          '--moduleResolution',
          'node',
          '--outDir',
          t2,
          '--skipLibCheck',
          'true',
          '--esModuleInterop',
          'true',
        ],
        { stdio: 'inherit' }
      );
      return require(join(t2, 'products.js'));
    } finally {
      rmSync(t2, { recursive: true, force: true });
    }
  })();
  for (const p of SHOP_CATALOG) {
    const srv = SERVER_PRODUCTS[p.id];
    assert(srv !== undefined, `server catalog has ${p.id}`);
    assert(srv.stars === p.stars, `stars price match for ${p.id}: server=${srv.stars} client=${p.stars}`);
  }
  assert(
    Object.keys(SERVER_PRODUCTS).length === SHOP_CATALOG.length,
    'server catalog has no extra products'
  );

  console.log('worker-payments: all assertions passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

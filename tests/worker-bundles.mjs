/**
 * Worker bundles — монетизация v3 (мульти-грант, схема v17).
 *
 * Covers:
 * - grantsForProduct: одиночный товар — список из 1 элемента (эквивалент
 *   grantForProduct); неизвестный товар — null;
 * - seeded bundle order (снапшот grant_bundle_json: rna + booster +
 *   skin) → webhook → 3 строки wallet_ledger с одним charge_id,
 *   кошелёк отражает все компоненты, скин во владении, заказ paid;
 * - дубликатная доставка бандла — без двойного гранта;
 * - refund (mark) бандла — откатывает ВСЕ компоненты (РНК, бустер,
 *   скин), reversal-строк — по одной на компонент;
 * - skin-trio: 3 скина с одним charge_id → 3 строки wallet_skins;
 * - битый bundle JSON / пустой массив / невалидный компонент —
 *   unknown-product путь (paid без гранта, без ledger-строк).
 *
 * Грант идёт ИЗ СНАПШОТА заказа, поэтому полный путь бандла тестируется
 * без товара в каталоге (товары появятся в коммите 5; инвойс-путь для
 * бандлов — там же). D1 — общий стаб tests/d1-v16-stub.mjs.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeD1, seedOrder } from './d1-v16-stub.mjs';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-bundles-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-bundles: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BOT_TOKEN = 'test-bot-token-bnd-0123456789';
const WEBHOOK_SECRET = 'test-webhook-secret-bnd-0123456789';
const ADMIN_TOKEN = 'test-admin-token-bnd-0123456789';
const USER_ID = 777005;
const DAY_MS = 86_400_000;

function signInitData(fields) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function buildInitData(userId) {
  const now = Math.floor(Date.now() / 1000);
  const fields = {
    auth_date: String(now),
    query_id: 'AAE-bnd-test',
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', signInitData(fields));
  return params.toString();
}

function paymentBody(chargeId, nonce, { userId = USER_ID, amount = 150 } = {}) {
  return {
    message: {
      from: { id: userId },
      successful_payment: {
        currency: 'XTR',
        total_amount: amount,
        invoice_payload: nonce,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: 'prov-bnd-1',
      },
    },
  };
}

async function post(handler, path, body, env, headers = {}) {
  const req = new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return handler.fetch(req, env);
}

const secretHeader = () => ({ 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET });
const adminHeader = () => ({ authorization: `Bearer ${ADMIN_TOKEN}` });

const STARTER_BUNDLE = JSON.stringify([
  { kind: 'skin', skinId: 'skin.abyssal-teal' },
  { kind: 'rna', rna: 500 },
  { kind: 'booster', boosterDays: 3 },
]);
const TRIO_BUNDLE = JSON.stringify([
  { kind: 'skin', skinId: 'skin.virulent-magenta' },
  { kind: 'skin', skinId: 'skin.abyssal-teal' },
  { kind: 'skin', skinId: 'skin.gilded-prime' },
]);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'worker/src/index.ts',
      'worker/src/grants.ts',
      'worker/src/sql.ts',
      '--target',
      'ES2021',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--strict',
      'true',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
    ],
    { stdio: 'pipe' }
  );

  const worker = require(join(temp, 'index.js'));
  const handler = worker.default;
  assert(handler && typeof handler.fetch === 'function', 'worker exports default.fetch');
  const grants = require(join(temp, 'grants.js'));

  const initData = buildInitData(USER_ID);
  const baseEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET };

  // === grantsForProduct: одиночные — список из 1 ===
  const single = grants.grantsForProduct('currency.rna-pack-s');
  eq(single.length, 1, 'single product → 1 grant');
  eq(single[0].kind, 'rna', 'single kind rna');
  eq(single[0].grant.rna, 500, 'single grant value');
  eq(grants.grantsForProduct('nope'), null, 'unknown product → null');
  eq(grants.grantForProduct('currency.rna-pack-s').kind, 'rna', 'grantForProduct unchanged for singles');

  // === бандл: 3 компонента одним платежом ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN };
    await seedOrder(db, 'nonce-bnd-1', USER_ID, 'bundle.test-starter', 150, {
      skuVersion: 3, grantRna: 0, grantBoosterDays: 0, grantBundleJson: STARTER_BUNDLE,
    });
    const before = Date.now();
    const r1 = await post(handler, '/api/webhook', paymentBody('ch-bnd-1', 'nonce-bnd-1'), env, secretHeader());
    eq(r1.status, 200, 'bundle payment 200');
    const rows = [...db.ledger.values()].filter((r) => r.charge_id === 'ch-bnd-1' && r.kind === 'grant');
    eq(rows.length, 3, 'three ledger rows, one charge_id');
    eq(rows.filter((r) => r.grant_type === 'rna')[0].amount, 500, 'rna component 500');
    eq(rows.filter((r) => r.grant_type === 'booster')[0].amount, 3 * DAY_MS, 'booster component 3d');
    eq(rows.filter((r) => r.grant_type === 'skin')[0].skin_id, 'skin.abyssal-teal', 'skin component id');
    const w = db.wallets.get(USER_ID);
    eq(w.purchased_rna, 500, 'wallet rna +500');
    assert(
      w.booster_until_ms >= before + 3 * DAY_MS - 1000 && w.booster_until_ms <= Date.now() + 3 * DAY_MS + 1000,
      'wallet booster ≈ now+3d'
    );
    const skins = [...db.walletSkins.values()].filter((r) => r.user_id === USER_ID && r.status === 'active');
    eq(skins.length, 1, 'one skin owned');
    eq(skins[0].skin_id, 'skin.abyssal-teal', 'skin id');
    eq(db.orders.get('nonce-bnd-1').status, 'paid', 'order paid');

    // /api/wallet: скин в списке, бустер в поле.
    const wj = await (await post(handler, '/api/wallet', { initData }, env)).json();
    assert(wj.skins.includes('skin.abyssal-teal'), 'wallet skins include bundle skin');
    eq(wj.purchased_rna, 500, 'wallet rna 500');

    // Дубликатная доставка — без двойного гранта.
    const r2 = await post(handler, '/api/webhook', paymentBody('ch-bnd-1', 'nonce-bnd-1'), env, secretHeader());
    eq(r2.status, 200, 'duplicate delivery 200');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'no double rna on redelivery');
    eq([...db.ledger.values()].filter((r) => r.charge_id === 'ch-bnd-1' && r.kind === 'grant').length, 3, 'still 3 grant rows');

    // Refund (mark) — откатывает все компоненты.
    const rf = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-bnd-1', execute: false, confirmExternalRefund: true, reason: 'test', operationId: 'op-bnd-1' },
      env, adminHeader()
    );
    eq(rf.status, 200, 'refund mark 200');
    const rfj = await rf.json();
    eq(rfj.ok, true, 'refund mark ok');
    eq(db.wallets.get(USER_ID).purchased_rna, 0, 'rna rolled back');
    const skinsAfter = [...db.walletSkins.values()].filter((r) => r.user_id === USER_ID && r.status === 'active');
    eq(skinsAfter.length, 0, 'skin reversed');
    const revs = [...db.ledger.values()].filter((r) => r.kind === 'reversal' && r.reverses_charge_id === 'ch-bnd-1');
    eq(revs.length, 3, 'three reversal rows (one per component)');
    const revIds = revs.map((r) => r.charge_id).sort();
    eq(
      JSON.stringify(revIds),
      JSON.stringify(['rev:op-bnd-1:booster:', 'rev:op-bnd-1:rna:', 'rev:op-bnd-1:skin:skin.abyssal-teal']),
      'reversal charge_ids are per-component'
    );
  }

  // === skin-trio: 3 скина, один charge_id ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-bnd-2', USER_ID, 'bundle.test-trio', 300, {
      skuVersion: 3, grantRna: 0, grantBoosterDays: 0, grantBundleJson: TRIO_BUNDLE,
    });
    const r = await post(handler, '/api/webhook', paymentBody('ch-bnd-2', 'nonce-bnd-2', { amount: 300 }), env, secretHeader());
    eq(r.status, 200, 'trio payment 200');
    const skins = [...db.walletSkins.values()]
      .filter((x) => x.user_id === USER_ID && x.status === 'active')
      .map((x) => x.skin_id)
      .sort();
    eq(JSON.stringify(skins), JSON.stringify(['skin.abyssal-teal', 'skin.gilded-prime', 'skin.virulent-magenta']), 'all three skins owned');
    eq([...db.ledger.values()].filter((x) => x.charge_id === 'ch-bnd-2').length, 3, 'three ledger rows for trio');
  }

  // === битые снапшоты бандла — unknown-product путь (paid, без гранта) ===
  for (const [name, bundleJson] of [
    ['bad-json', '{not json'],
    ['empty-array', '[]'],
    ['bad-component', JSON.stringify([{ kind: 'rna', rna: -5 }])],
    ['unknown-kind', JSON.stringify([{ kind: 'spaceship', x: 1 }])],
    ['not-an-array', JSON.stringify({ kind: 'rna', rna: 100 })],
  ]) {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, `nonce-bnd-bad-${name}`, USER_ID, 'bundle.test-bad', 150, {
      skuVersion: 3, grantRna: 0, grantBoosterDays: 0, grantBundleJson: bundleJson,
    });
    const r = await post(handler, '/api/webhook', paymentBody(`ch-bnd-bad-${name}`, `nonce-bnd-bad-${name}`), env, secretHeader());
    eq(r.status, 200, `${name}: webhook 200`);
    eq(db.orders.get(`nonce-bnd-bad-${name}`).status, 'paid', `${name}: order paid (unknown-product path)`);
    eq([...db.ledger.values()].length, 0, `${name}: no ledger rows`);
    assert(!db.wallets.has(USER_ID), `${name}: no wallet created`);
  }

  console.log('worker-bundles: all assertions passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

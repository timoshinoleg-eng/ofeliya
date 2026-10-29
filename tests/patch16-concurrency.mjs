/**
 * patch16-concurrency — НАСТОЯЩИЙ конкурентный прогон выдачи (ТЗ патча №16, C).
 *
 * node:sqlite, файловая БД (WAL), worker_threads (N=8 воркеров). Схема и
 * триггер — из worker/schema.sql; SQL батчей — НАПРЯМУЮ из worker/src/sql.ts
 * через node type stripping (единый источник правды; parity-grep не нужен —
 * импорт, а не копия). Каждый воркер выполняет ТОЧНЫЙ production-батч
 * successful_payment (3 statement'а, тот же порядок bind'ов, что в
 * worker/src/index.ts::recordSuccessfulPayment) в одной транзакции
 * (эквивалент D1 db.batch()).
 *
 * Сценарии ТЗ (строгие assert'ы):
 *  (a) 500+1500 одновременно → ровно 2000;
 *  (b) 20×500 → ровно 10000;
 *  (c) два продления бустера → max(cur,now)+E оба раза (детерминировано
 *      фиксированным now: итог === now + 2E);
 *  (d) два разных скина → оба active в wallet_skins;
 *  (e) 100 redelivery одного charge_id → ровно 1 грант;
 *  (f) interleaving грант+рефанд → инварианты консистентности
 *      (reversal ⇒ грант был и итог 0; иначе итог 500).
 *
 * Запуск: node --experimental-strip-types tests/patch16-concurrency.mjs
 * (флаг нужен для импорта worker/src/*.ts). Живой Cloudflare/Telegram/
 * Docker/Chrome не используются. Exit code: 0 — все OK, 1 — есть FAIL.
 */
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Единый источник правды: SQL и каталог — те же модули, что использует воркер.
import * as sql from '../worker/src/sql.ts';
import { GRANTS_VERSION, grantForProduct, grantAmountText } from '../worker/src/grants.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = readFileSync(join(REPO, 'worker/schema.sql'), 'utf8');
const WORKER_PATH = join(REPO, 'tests/patch16-conc-worker.mjs');
const N_WORKERS = 8;
const USER = 777005;

const results = [];
const ok = (id, detail = '') => {
  results.push({ id, status: 'OK' });
  console.log(`[OK] ${id}${detail ? ` — ${detail}` : ''}`);
};
const fail = (id, detail) => {
  results.push({ id, status: 'FAIL', detail });
  console.log(`[FAIL] ${id} — ${detail}`);
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (a, e, msg) => assert(a === e, `${msg}: ожидалось ${e}, получено ${a}`);

/** Задача гранта: bind-параметры 1:1 с recordSuccessfulPayment. */
function grantTask(name, { userId = USER, productId, chargeId, nonce, now = Date.now() }) {
  const resolved = grantForProduct(productId);
  assert(resolved, `unknown product ${productId}`);
  const { kind, grant } = resolved;
  const ledgerAmount =
    kind === 'rna' ? Math.max(0, Math.floor(grant.rna))
    : kind === 'booster' ? Math.max(0, Math.floor(grant.boosterDays)) * 86_400_000
    : 0;
  return {
    type: 'grant', name, userId, productId, chargeId, nonce,
    amount: grant.stars, skuVersion: GRANTS_VERSION, now,
    kind, ledgerAmount,
    skinId: kind === 'skin' ? grant.skinId : null,
    amountText: grantAmountText(kind, grant),
  };
}

function refundMarkTask(name, { userId = USER, chargeId, operationId, now = Date.now() }) {
  return {
    type: 'refund-mark', name, userId, chargeId, operationId,
    revChargeId: `rev:${operationId}`, reason: 'p16-concurrency', now,
  };
}

function seedOrder(db, nonce, productId) {
  const g = grantForProduct(productId);
  assert(g, `seed: unknown product ${productId}`);
  db.prepare(
    'INSERT INTO orders (nonce, user_id, product_id, amount_stars, sku_version, status, created_at) ' +
    "VALUES (?, ?, ?, ?, ?, 'pending', ?)"
  ).run(nonce, USER, productId, g.grant.stars, GRANTS_VERSION, Date.now());
}

const getRna = (db, u) => db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(u)?.purchased_rna ?? 0;
const getBooster = (db, u) => db.prepare('SELECT booster_until_ms FROM wallets WHERE user_id=?').get(u)?.booster_until_ms ?? 0;
const activeSkins = (db, u) =>
  db.prepare("SELECT skin_id FROM wallet_skins WHERE user_id=? AND status='active' ORDER BY skin_id").all(u).map((r) => r.skin_id);
const ledgerRowsFor = (db, charge) =>
  db.prepare('SELECT kind, grant_type, amount FROM wallet_ledger WHERE charge_id=?').all(charge);
const paymentStatus = (db, charge) =>
  db.prepare('SELECT status FROM payments WHERE charge_id=?').get(charge)?.status ?? null;

async function runScenario(label, { seed, tasks, check }) {
  const dir = mkdtempSync(join(tmpdir(), 'p16-conc-'));
  const dbPath = join(dir, 'conc.db');
  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec(SCHEMA);
    seed(db);
    db.close();
    db = null;

    const buckets = Array.from({ length: N_WORKERS }, () => []);
    tasks.forEach((t, i) => buckets[i % N_WORKERS].push(t));
    const workers = buckets.map(
      (bucket) => new Worker(WORKER_PATH, { workerData: { dbPath, sql: { ...sql }, tasks: bucket } })
    );
    const done = workers.map(
      (w) => new Promise((res, rej) => { w.once('message', res); w.once('error', rej); })
    );
    for (const w of workers) w.postMessage('start'); // барьер: старт одновременно
    const all = await Promise.all(done);
    for (const w of workers) await w.terminate();
    const taskResults = all.flatMap((m) => m.results);
    const errors = taskResults.filter((r) => !r.ok);
    assert(errors.length === 0, `ошибки воркеров: ${JSON.stringify(errors.slice(0, 3))}`);

    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL');
    check(db, taskResults);
    ok(label);
  } catch (e) {
    fail(label, e.message);
  } finally {
    try { db && db.close(); } catch { /* ignore */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function main() {
  console.log('patch16-concurrency: реальный конкурентный прогон (node:sqlite, WAL, 8 воркеров)');
  console.log('='.repeat(80));

  // (a) 500 + 1500 одновременно → ровно 2000.
  await runScenario('(a) 500+1500 одновременно → 2000', {
    seed: (db) => { seedOrder(db, 'ca-n1', 'currency.rna-pack-s'); seedOrder(db, 'ca-n2', 'currency.rna-pack-m'); },
    tasks: [
      grantTask('a1', { productId: 'currency.rna-pack-s', chargeId: 'ca-ch-1', nonce: 'ca-n1' }),
      grantTask('a2', { productId: 'currency.rna-pack-m', chargeId: 'ca-ch-2', nonce: 'ca-n2' }),
    ],
    check: (db) => eq(getRna(db, USER), 2000, 'purchased_rna'),
  });

  // (b) 20 × 500 → ровно 10000.
  await runScenario('(b) 20×500 → 10000', {
    seed: (db) => { for (let i = 0; i < 20; i++) seedOrder(db, `cb-n${i}`, 'currency.rna-pack-s'); },
    tasks: Array.from({ length: 20 }, (_, i) =>
      grantTask(`b${i}`, { productId: 'currency.rna-pack-s', chargeId: `cb-ch-${i}`, nonce: `cb-n${i}` })),
    check: (db) => eq(getRna(db, USER), 10000, 'purchased_rna'),
  });

  // (c) два продления бустера: max(cur,now)+E оба раза (now фиксирован).
  {
    const now = Date.now();
    const E = 7 * 86_400_000;
    await runScenario('(c) 2× бустер → now+2E', {
      seed: (db) => { seedOrder(db, 'cc-n1', 'booster.rna-x2-7d'); seedOrder(db, 'cc-n2', 'booster.rna-x2-7d'); },
      tasks: [
        grantTask('c1', { productId: 'booster.rna-x2-7d', chargeId: 'cc-ch-1', nonce: 'cc-n1', now }),
        grantTask('c2', { productId: 'booster.rna-x2-7d', chargeId: 'cc-ch-2', nonce: 'cc-n2', now }),
      ],
      check: (db) => eq(getBooster(db, USER), now + 2 * E, 'booster_until_ms'),
    });
  }

  // (d) два разных скина → оба active.
  await runScenario('(d) два скина → оба active', {
    seed: (db) => { seedOrder(db, 'cd-n1', 'skin.virulent-magenta'); seedOrder(db, 'cd-n2', 'skin.abyssal-teal'); },
    tasks: [
      grantTask('d1', { productId: 'skin.virulent-magenta', chargeId: 'cd-ch-1', nonce: 'cd-n1' }),
      grantTask('d2', { productId: 'skin.abyssal-teal', chargeId: 'cd-ch-2', nonce: 'cd-n2' }),
    ],
    check: (db) => {
      const skins = activeSkins(db, USER);
      eq(skins.length, 2, 'active skins count');
      assert(skins.includes('skin.virulent-magenta') && skins.includes('skin.abyssal-teal'),
        `skins: ${skins.join(',')}`);
    },
  });

  // (e) 100 redelivery одного charge_id → ровно 1 грант.
  await runScenario('(e) 100 redelivery → 1 грант', {
    seed: (db) => seedOrder(db, 'ce-n', 'currency.rna-pack-s'),
    tasks: Array.from({ length: 100 }, (_, i) =>
      grantTask(`e${i}`, { productId: 'currency.rna-pack-s', chargeId: 'ce-ch', nonce: 'ce-n' })),
    check: (db, taskResults) => {
      eq(getRna(db, USER), 500, 'purchased_rna');
      eq(ledgerRowsFor(db, 'ce-ch').length, 1, 'ledger rows for charge');
      const inserted = taskResults.filter((r) => r.changes && r.changes[1] === 1).length;
      eq(inserted, 1, 'только один воркер вставил платёж');
    },
  });

  // (f) interleaving грант + рефанд → инварианты консистентности.
  await runScenario('(f) грант+рефанд interleaving → консистентно', {
    seed: (db) => seedOrder(db, 'cf-n', 'currency.rna-pack-s'),
    tasks: [
      grantTask('f-grant', { productId: 'currency.rna-pack-s', chargeId: 'cf-ch', nonce: 'cf-n' }),
      refundMarkTask('f-refund', { chargeId: 'cf-ch', operationId: 'cf-op' }),
    ],
    check: (db) => {
      const rna = getRna(db, USER);
      const reversal = db.prepare(
        "SELECT charge_id FROM wallet_ledger WHERE reverses_charge_id='cf-ch' AND kind='reversal'"
      ).get();
      const status = paymentStatus(db, 'cf-ch');
      assert(rna === 0 || rna === 500, `purchased_rna=${rna} вне {0,500}`);
      if (reversal) {
        // Рефанд после гранта: итог 0, платёж refunded.
        eq(rna, 0, 'итог после reversal');
        eq(status, 'refunded', 'статус платежа');
      } else {
        // Рефанд до гранта: reversal вставить не во что (0 строк), итог 500.
        eq(rna, 500, 'итог без reversal');
      }
    },
  });

  console.log('='.repeat(80));
  const nFail = results.filter((r) => r.status === 'FAIL').length;
  const nOk = results.filter((r) => r.status === 'OK').length;
  console.log(`ИТОГ: ${nOk} OK, ${nFail} FAIL из ${results.length}`);
  if (nFail > 0) process.exitCode = 1;
}

await main();

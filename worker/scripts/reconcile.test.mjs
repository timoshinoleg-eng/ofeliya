/**
 * reconcile.test.mjs — тест worker/scripts/reconcile.mjs (node --test, zero deps).
 *
 * Telegram HTTP стаббится через инжектируемый fetchFn (никаких реальных
 * запросов). Проверяем: D1-внутренние проверки без токена, пагинацию
 * getStarTransactions (offset/limit по документации Bot API) и кросс-чек
 * telegram↔D1, exit-код через findings.
 *
 * Запуск: node --test worker/scripts/reconcile.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcile, fetchStarTransactions } from './reconcile.mjs';

function writeTmp(name, obj) {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-test-'));
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

const NOW = 1_700_000_000_000;
const OLD = NOW - 3600_000 * 5; // 5 часов назад

function baseDump() {
  return {
    payments: [
      { charge_id: 'ch-ok', user_id: 1, product_id: 'currency.rna-pack-s', amount: 35, currency: 'XTR', status: 'paid', nonce: 'n1', created_at: NOW },
      { charge_id: 'ch-nogrant', user_id: 1, product_id: 'currency.rna-pack-s', amount: 35, currency: 'XTR', status: 'paid', nonce: 'n2', created_at: NOW },
      { charge_id: 'ch-refund-ok', user_id: 2, product_id: 'skin.virulent-magenta', amount: 100, currency: 'XTR', status: 'refunded', nonce: 'n3', created_at: NOW },
      { charge_id: 'ch-refund-norev', user_id: 2, product_id: 'skin.virulent-magenta', amount: 100, currency: 'XTR', status: 'refunded', nonce: 'n4', created_at: NOW },
      { charge_id: 'ch-dup-nonce-a', user_id: 3, product_id: 'currency.rna-pack-s', amount: 35, currency: 'XTR', status: 'paid', nonce: 'DUP', created_at: NOW },
      { charge_id: 'ch-dup-nonce-b', user_id: 3, product_id: 'currency.rna-pack-s', amount: 35, currency: 'XTR', status: 'paid', nonce: 'DUP', created_at: NOW },
    ],
    orders: [
      { nonce: 'stale1', user_id: 9, product_id: 'currency.rna-pack-s', amount_stars: 35, sku_version: 2, status: 'pending', created_at: OLD },
      { nonce: 'fresh1', user_id: 9, product_id: 'currency.rna-pack-s', amount_stars: 35, sku_version: 2, status: 'pending', created_at: NOW },
    ],
    refund_ops: [
      { operation_id: 'op-stuck', charge_id: 'ch-x', user_id: 5, action: 'execute', status: 'requested', created_at: OLD },
      { operation_id: 'op-fresh', charge_id: 'ch-y', user_id: 5, action: 'execute', status: 'requested', created_at: NOW },
    ],
  };
}

function baseLedger() {
  return [
    { id: 1, user_id: 1, charge_id: 'ch-ok', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 2, user_id: 2, charge_id: 'ch-refund-ok', kind: 'grant', grant_type: 'skin', amount: 0, skin_id: 'skin.x', reverses_charge_id: null, created_at: NOW },
    { id: 3, user_id: 2, charge_id: 'rev:op1', kind: 'reversal', grant_type: 'skin', amount: 0, skin_id: 'skin.x', reverses_charge_id: 'ch-refund-ok', created_at: NOW },
    { id: 4, user_id: 3, charge_id: 'ch-dup-nonce-a', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 5, user_id: 3, charge_id: 'ch-dup-nonce-b', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 6, user_id: 7, charge_id: 'ch-orphan', kind: 'grant', grant_type: 'rna', amount: 100, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 7, user_id: 7, charge_id: 'rev:op2', kind: 'reversal', grant_type: 'rna', amount: -100, skin_id: null, reverses_charge_id: 'ch-missing', created_at: NOW },
  ];
}

test('D1-внутренние проверки без токена', async () => {
  const dump = writeTmp('dump.json', baseDump());
  const ledger = writeTmp('ledger.json', baseLedger());
  const { findings } = await reconcile({ dump, ledger, stuckMin: 60, now: NOW });
  const codes = findings.map((f) => f.code).sort();
  assert.deepEqual(codes, [
    'duplicate_nonce',
    'grant_without_payment',
    'paid_without_grant',
    'refunded_without_reversal',
    'reversal_without_grant',
    'stale_pending_order',
    'stuck_refund_op',
  ]);
  assert.ok(findings.every((f) => f.severity === 'error' || f.code === 'stale_pending_order'));
});

test('чистые данные — findings пуст', async () => {
  const dump = writeTmp('dump.json', {
    payments: [
      { charge_id: 'c1', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', status: 'paid', nonce: 'nn1', created_at: NOW },
    ],
    orders: [],
    refund_ops: [],
  });
  const ledger = writeTmp('ledger.json', [
    { id: 1, user_id: 1, charge_id: 'c1', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, reverses_charge_id: null, created_at: NOW },
  ]);
  const { findings } = await reconcile({ dump, ledger, stuckMin: 60, now: NOW });
  assert.deepEqual(findings, []);
});

test('getStarTransactions: пагинация offset/limit + кросс-чек', async () => {
  const calls = [];
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: `tg-${i}`,
    amount: 35,
    date: 1700000000,
    source: { type: 'user', transaction_type: 'invoice_payment', user: { id: 1 } },
  }));
  const page2 = [
    // входящий платёж, которого нет в D1 — потерянный платёж
    { id: 'tg-lost', amount: 100, date: 1700000000, source: { type: 'user', transaction_type: 'invoice_payment', user: { id: 2 } } },
    // исходящий (возврат) — не матчится как входящий
    { id: 'tg-out', amount: 50, date: 1700000000, receiver: { type: 'user', user: { id: 2 } } },
  ];
  const fetchFn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const offset = Number(u.searchParams.get('offset'));
    const limit = Number(u.searchParams.get('limit'));
    assert.equal(limit, 100);
    const txs = offset === 0 ? page1 : page2;
    return { ok: true, json: async () => ({ ok: true, result: { transactions: txs } }) };
  };
  const txs = await fetchStarTransactions({ apiBase: 'https://api.telegram.org', botToken: 'T', fetchFn });
  assert.equal(txs.length, 102);
  assert.ok(calls[0].includes('offset=0&limit=100'));
  assert.ok(calls[1].includes('offset=100&limit=100'));

  const dump = writeTmp('dump.json', {
    payments: [
      { charge_id: 'tg-0', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', status: 'paid', nonce: 'a', created_at: NOW },
      { charge_id: 'ch-not-in-tg', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', status: 'paid', nonce: 'b', created_at: NOW },
    ],
    orders: [],
    refund_ops: [],
  });
  const ledger = writeTmp('ledger.json', [
    { id: 1, user_id: 1, charge_id: 'tg-0', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 2, user_id: 1, charge_id: 'ch-not-in-tg', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, reverses_charge_id: null, created_at: NOW },
  ]);
  const { findings } = await reconcile({ dump, ledger, stuckMin: 60, now: NOW, botToken: 'T', fetchFn });
  const byCode = new Map(findings.map((f) => [f.code, f]));
  assert.ok(byCode.has('telegram_without_d1'), 'потерянный платёж найден');
  assert.ok(byCode.get('telegram_without_d1').detail.includes('tg-lost'));
  assert.ok(byCode.has('d1_without_telegram'), 'платёж без tx в Telegram — warning');
  assert.equal(byCode.get('d1_without_telegram').severity, 'warning');
  // tg-out (исходящий) не должен дать telegram_without_d1
  assert.ok(![...byCode.values()].some((f) => f.detail.includes('tg-out')));
});

test('дубликаты (P1-1/P1-2): stale pending без возврата — ошибка; остальные — нет', async () => {
  const dump = writeTmp('dump.json', {
    payments: [
      { charge_id: 'c1', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', status: 'paid', nonce: 'nn1', created_at: NOW },
    ],
    orders: [],
    refund_ops: [
      // Завершённый возврат дубликата dup-refunded — находки быть не должно.
      { operation_id: 'op-dup-done', charge_id: 'dup-refunded', user_id: 1, action: 'execute', status: 'completed', created_at: OLD },
    ],
    duplicate_payments: [
      { charge_id: 'dup-stale', nonce: 'n-dup-1', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', reason: 'nonce_reuse', status: 'pending', created_at: OLD },
      { charge_id: 'dup-fresh', nonce: 'n-dup-2', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', reason: 'subscription_active', status: 'pending', created_at: NOW },
      { charge_id: 'dup-refunded', nonce: 'n-dup-3', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', reason: 'nonce_reuse', status: 'pending', created_at: OLD },
      { charge_id: 'dup-done', nonce: 'n-dup-4', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', reason: 'nonce_reuse', status: 'refunded', created_at: OLD },
    ],
  });
  const ledger = writeTmp('ledger.json', [
    { id: 1, user_id: 1, charge_id: 'c1', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, reverses_charge_id: null, created_at: NOW },
  ]);
  const { findings, counts } = await reconcile({ dump, ledger, stuckMin: 60, now: NOW });
  assert.equal(counts.duplicates, 4);
  assert.deepEqual(findings.map((f) => f.code), ['duplicate_without_refund']);
  assert.equal(findings[0].severity, 'error');
  assert.ok(findings[0].detail.includes('dup-stale'));
});

test('P2-N1: перекрывающиеся season_pass-гранты флагятся; продления и repurchase — нет', async () => {
  const MONTH = 30 * 86_400_000;
  const dump = writeTmp('dump.json', {
    payments: [
      // user 1: два первых платежа при активном пропуске (гонка до guard).
      { charge_id: 'sp-1a', user_id: 1, product_id: 'season-pass.basic-30d', amount: 250, currency: 'XTR', status: 'paid', nonce: 'sp-n1', created_at: NOW },
      { charge_id: 'sp-1b', user_id: 1, product_id: 'season-pass.basic-30d', amount: 250, currency: 'XTR', status: 'paid', nonce: 'sp-n2', created_at: NOW },
      // user 2: первая оплата + продление (derived nonce) — легитимно.
      { charge_id: 'sp-2a', user_id: 2, product_id: 'season-pass.basic-30d', amount: 250, currency: 'XTR', status: 'paid', nonce: 'sp-n3', created_at: NOW },
      { charge_id: 'sp-2r', user_id: 2, product_id: 'season-pass.basic-30d', amount: 250, currency: 'XTR', status: 'paid', nonce: 'sp-n3:r:sp-2r', created_at: NOW },
      // user 3: repurchase после истечения — легитимно.
      { charge_id: 'sp-3a', user_id: 3, product_id: 'season-pass.basic-30d', amount: 250, currency: 'XTR', status: 'paid', nonce: 'sp-n4', created_at: NOW },
      { charge_id: 'sp-3b', user_id: 3, product_id: 'season-pass.basic-30d', amount: 250, currency: 'XTR', status: 'paid', nonce: 'sp-n5', created_at: NOW + MONTH + 1000 },
    ],
    orders: [],
    refund_ops: [],
  });
  const ledger = writeTmp('ledger.json', [
    { id: 1, user_id: 1, charge_id: 'sp-1a', kind: 'grant', grant_type: 'season_pass', amount: MONTH, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 2, user_id: 1, charge_id: 'sp-1b', kind: 'grant', grant_type: 'season_pass', amount: MONTH, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 3, user_id: 2, charge_id: 'sp-2a', kind: 'grant', grant_type: 'season_pass', amount: MONTH, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 4, user_id: 2, charge_id: 'sp-2r', kind: 'grant', grant_type: 'season_pass', amount: MONTH, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 5, user_id: 3, charge_id: 'sp-3a', kind: 'grant', grant_type: 'season_pass', amount: MONTH, skin_id: null, reverses_charge_id: null, created_at: NOW },
    { id: 6, user_id: 3, charge_id: 'sp-3b', kind: 'grant', grant_type: 'season_pass', amount: MONTH, skin_id: null, reverses_charge_id: null, created_at: NOW + MONTH + 1000 },
  ]);
  const { findings } = await reconcile({ dump, ledger, stuckMin: 60, now: NOW });
  assert.deepEqual(findings.map((f) => f.code), ['overlapping_season_pass_grants']);
  assert.equal(findings[0].severity, 'error');
  assert.ok(findings[0].detail.includes('sp-1b'), 'flags the second first-payment grant');
  assert.ok(!findings[0].detail.includes('sp-2r'), 'renewal not flagged');
  assert.ok(!findings[0].detail.includes('sp-3b'), 'post-expiry repurchase not flagged');
});

test('кросс-чек Telegram: дубликат считается «в D1»', async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      result: {
        transactions: [
          { id: 'dup-tg', amount: 35, date: 1700000000, source: { type: 'user', transaction_type: 'invoice_payment', user: { id: 1 } } },
          { id: 'tg-lost-2', amount: 35, date: 1700000000, source: { type: 'user', transaction_type: 'invoice_payment', user: { id: 1 } } },
        ],
      },
    }),
  });
  const dump = writeTmp('dump.json', {
    payments: [],
    orders: [],
    refund_ops: [],
    duplicate_payments: [
      { charge_id: 'dup-tg', nonce: 'n-dup-tg', user_id: 1, product_id: 'p', amount: 35, currency: 'XTR', reason: 'nonce_reuse', status: 'pending', created_at: NOW },
    ],
  });
  const ledger = writeTmp('ledger.json', []);
  const { findings } = await reconcile({ dump, ledger, stuckMin: 60, now: NOW, botToken: 'T', fetchFn });
  assert.deepEqual(findings.map((f) => f.code), ['telegram_without_d1']);
  assert.ok(findings[0].detail.includes('tg-lost-2'));
  assert.ok(!findings[0].detail.includes('dup-tg'));
});

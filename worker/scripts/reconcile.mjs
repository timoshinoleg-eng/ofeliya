#!/usr/bin/env node
/**
 * reconcile.mjs — read-only сверка платежей OFELIYA (патч №16, B1).
 *
 * Что делает: сверяет три источника правды друг с другом и печатает
 * расхождения. НИЧЕГО не меняет: никаких авто-списаний, возвратов,
 * начислений, пометок — только отчёт. Exit code 1 при любом расхождении.
 *
 * Источники:
 *  1. D1-дампы (JSON-файлы). Как получить:
 *       wrangler d1 execute ofeliya-payments --remote \
 *         --command "SELECT charge_id,user_id,product_id,amount,currency,status,nonce,sku_version,created_at FROM payments" \
 *         --json > payments.json
 *     (аналогично orders → заказы можно дописать в тот же файл под ключом
 *     "orders"; ledger — под ключом "ledger" в --ledger файле, refund_ops —
 *     под ключом "refund_ops" в любом из файлов)
 *     Формат файлов — объект {payments:[...], orders:[...], ledger:[...],
 *     refund_ops:[...]}; для --ledger допускается голый массив строк.
 *  2. Telegram Bot API getStarTransactions (только с --bot-token):
 *     https://core.telegram.org/bots/api#getstartransactions
 *     Параметры сверены с документацией: offset — Integer (сколько
 *     транзакций пропустить), limit — Integer 1..100 (дефолт 100).
 *     Ответ: {ok, result:{transactions:[StarTransaction]}}.
 *     StarTransaction.id совпадает с SuccessfulPayment.telegram_payment_charge_id
 *     для входящих платежей (там же, раздел StarTransaction) — по нему
 *     и матчим. Метод только читает — баланс не трогает.
 *
 * Проверки без токена (только D1-внутренние):
 *  - paid_without_grant: платёж 'paid'/'fulfilled' без grant-строки в ledger;
 *  - refunded_without_reversal: 'refunded' без reversal-строки;
 *  - duplicate_nonce / duplicate_charge_id в payments;
 *  - stuck_refund_op: refund_ops в 'requested' старше --stuck-min;
 *  - stale_pending_order: orders 'pending' старше --stuck-min;
 *  - grant_without_payment: grant-строка без платежа в payments;
 *  - reversal_without_grant: reversal без исходного гранта.
 * С токеном:
 *  - telegram_without_d1: входящий invoice_payment в Telegram без записи
 *    в D1 (потерянный платёж — главный кейс скрипта);
 *  - d1_without_telegram: платёж D1 без транзакции в Telegram (warning:
 *    история getStarTransactions может быть неполной для старых записей).
 *
 * Использование:
 *   node worker/scripts/reconcile.mjs --dump payments.json --ledger ledger.json
 *   node worker/scripts/reconcile.mjs --dump payments.json --ledger ledger.json \
 *     --bot-token "$TELEGRAM_BOT_TOKEN" --stuck-min 120
 *
 * Тест со стабом Telegram HTTP: worker/scripts/reconcile.test.mjs
 * (node --experimental-strip-types --test worker/scripts/reconcile.test.mjs).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'https://api.telegram.org';
const DEFAULT_STUCK_MIN = 60;

function parseArgs(argv) {
  const out = { stuckMin: DEFAULT_STUCK_MIN, apiBase: DEFAULT_API_BASE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dump') out.dump = next();
    else if (a === '--ledger') out.ledger = next();
    else if (a === '--bot-token') out.botToken = next();
    else if (a === '--api-base') out.apiBase = next();
    else if (a === '--stuck-min') out.stuckMin = Math.max(1, Number(next()) || DEFAULT_STUCK_MIN);
    else if (a === '--now') out.now = Number(next());
    else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.dump) throw new Error('--dump <payments.json> обязателен');
  if (!out.ledger) throw new Error('--ledger <ledger.json> обязателен');
  return out;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function loadTable(obj, key) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) return asArray(obj[key]);
  return [];
}

/**
 * P1-4 (независимый review): реальный `wrangler d1 execute --json` отдаёт
 * `[{results:[...], success, meta}]`, а не `{payments:[...]}`. Распаковываем
 * envelope: массив с .results → результаты первого запроса; объект с
 * .results → его результаты. Иначе — прежние форматы.
 */
function unwrapWrangler(raw) {
  if (Array.isArray(raw) && raw.length > 0 && raw[0] && typeof raw[0] === 'object' && Array.isArray(raw[0].results)) {
    return raw[0].results;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.results)) {
    return raw.results;
  }
  return raw;
}

/** Дамп: {payments, orders, refund_ops}, голый массив (=payments) или wrangler --json envelope. */
function loadDump(path) {
  const raw = unwrapWrangler(JSON.parse(readFileSync(path, 'utf8')));
  if (Array.isArray(raw)) return { payments: raw, orders: [], refundOps: [] };
  return {
    payments: loadTable(raw, 'payments'),
    orders: loadTable(raw, 'orders'),
    refundOps: loadTable(raw, 'refund_ops'),
  };
}

/** Ledger-файл: {ledger}, голый массив или wrangler --json envelope. */
function loadLedger(path) {
  const raw = unwrapWrangler(JSON.parse(readFileSync(path, 'utf8')));
  if (Array.isArray(raw)) return raw;
  return loadTable(raw, 'ledger');
}

/**
 * Основная проверка. fetchFn инжектится (в проде — global fetch, в тестах —
 * стаб). Возвращает {findings:[{severity:'error'|'warning', code, detail}]}.
 * Read-only: только GET к Bot API, никаких записей никуда.
 */
export async function reconcile(opts) {
  const { payments, orders, refundOps } = loadDump(opts.dump);
  const ledger = loadLedger(opts.ledger);
  const now = typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : Date.now();
  const stuckCutoff = now - opts.stuckMin * 60_000;
  const findings = [];
  const add = (severity, code, detail) => findings.push({ severity, code, detail });

  const byCharge = new Map(payments.map((p) => [p.charge_id, p]));
  const grantsByCharge = new Map();
  const reversalsByOrig = new Map();
  for (const row of ledger) {
    if (row.kind === 'grant') grantsByCharge.set(row.charge_id, row);
    else if (row.kind === 'reversal' && row.reverses_charge_id) {
      if (!reversalsByOrig.has(row.reverses_charge_id)) reversalsByOrig.set(row.reverses_charge_id, []);
      reversalsByOrig.get(row.reverses_charge_id).push(row);
    }
  }

  for (const p of payments) {
    if ((p.status === 'paid' || p.status === 'fulfilled') && !grantsByCharge.has(p.charge_id)) {
      add('error', 'paid_without_grant', `charge_id=${p.charge_id} status=${p.status} — нет grant-строки в ledger`);
    }
    if (p.status === 'refunded' && !reversalsByOrig.has(p.charge_id)) {
      add('error', 'refunded_without_reversal', `charge_id=${p.charge_id} — нет reversal-строки`);
    }
  }

  const seenNonce = new Map();
  const seenCharge = new Map();
  for (const p of payments) {
    if (p.nonce != null) {
      if (seenNonce.has(p.nonce)) {
        add('error', 'duplicate_nonce', `nonce=${p.nonce}: ${seenNonce.get(p.nonce)} и ${p.charge_id}`);
      } else seenNonce.set(p.nonce, p.charge_id);
    }
    if (seenCharge.has(p.charge_id)) {
      add('error', 'duplicate_charge_id', `charge_id=${p.charge_id} встречается дважды в дампе`);
    } else seenCharge.set(p.charge_id, true);
  }

  for (const row of ledger) {
    if (row.kind === 'grant' && !byCharge.has(row.charge_id)) {
      add('error', 'grant_without_payment', `ledger seq=${row.id} charge_id=${row.charge_id} — нет платежа в payments`);
    }
    if (row.kind === 'reversal' && row.reverses_charge_id && !grantsByCharge.has(row.reverses_charge_id)) {
      add('error', 'reversal_without_grant', `ledger seq=${row.id} reverses ${row.reverses_charge_id} — исходного гранта нет`);
    }
  }

  for (const op of refundOps) {
    if (op.status === 'requested' && typeof op.created_at === 'number' && op.created_at < stuckCutoff) {
      add('error', 'stuck_refund_op', `operation_id=${op.operation_id} charge_id=${op.charge_id} висит в 'requested'`);
    }
  }

  for (const o of orders) {
    if (o.status === 'pending' && typeof o.created_at === 'number' && o.created_at < stuckCutoff) {
      add('warning', 'stale_pending_order', `nonce=${o.nonce} product=${o.product_id} висит в 'pending'`);
    }
  }

  // --- Telegram cross-check (read-only GET) ---
  let telegramTxs = null;
  if (opts.botToken) {
    telegramTxs = await fetchStarTransactions({
      apiBase: opts.apiBase || DEFAULT_API_BASE,
      botToken: opts.botToken,
      fetchFn: opts.fetchFn,
    });
    const tgIds = new Set(telegramTxs.map((t) => t.id));
    for (const t of telegramTxs) {
      const isIncomingPayment =
        t.source && t.source.type === 'user' && t.source.transaction_type === 'invoice_payment';
      if (isIncomingPayment && !byCharge.has(t.id)) {
        add('error', 'telegram_without_d1', `tx id=${t.id} amount=${t.amount} — платёж Telegram без записи в D1`);
      }
    }
    for (const p of payments) {
      if ((p.status === 'paid' || p.status === 'fulfilled') && !tgIds.has(p.charge_id)) {
        add('warning', 'd1_without_telegram', `charge_id=${p.charge_id} — платёж D1 без транзакции в Telegram (история может быть неполной)`);
      }
    }
  }

  return { findings, counts: { payments: payments.length, orders: orders.length, ledger: ledger.length, telegramTxs: telegramTxs ? telegramTxs.length : null } };
}

/**
 * Пагинация getStarTransactions по документации Bot API:
 * offset — сколько пропустить, limit — 1..100 (дефолт 100).
 * Только чтение; при пустой странице — стоп.
 */
export async function fetchStarTransactions({ apiBase, botToken, fetchFn }) {
  const fetchImpl = fetchFn || fetch;
  const out = [];
  let offset = 0;
  for (;;) {
    const url = `${apiBase}/bot${botToken}/getStarTransactions?offset=${offset}&limit=100`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`getStarTransactions HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`getStarTransactions failed: ${data.description || 'unknown'}`);
    const txs = (data.result && data.result.transactions) || [];
    out.push(...txs);
    if (txs.length < 100) break;
    offset += txs.length;
    if (offset > 100_000) throw new Error('getStarTransactions: слишком много транзакций, стоп');
  }
  return out;
}

function printReport({ findings, counts }) {
  console.log(`reconcile: payments=${counts.payments} orders=${counts.orders} ledger=${counts.ledger}` +
    (counts.telegramTxs == null ? ' telegram=—' : ` telegram_txs=${counts.telegramTxs}`));
  if (findings.length === 0) {
    console.log('OK: расхождений нет');
    return;
  }
  for (const f of findings) {
    console.log(`[${f.severity.toUpperCase()}] ${f.code}: ${f.detail}`);
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  console.log(`ИТОГ: ${findings.length} расхождений (${errors} ошибок) — только отчёт, изменений не вносилось`);
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  (async () => {
    try {
      const opts = parseArgs(process.argv.slice(2));
      const result = await reconcile(opts);
      printReport(result);
      process.exit(result.findings.length > 0 ? 1 : 0);
    } catch (e) {
      console.error(`reconcile error: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    }
  })();
}

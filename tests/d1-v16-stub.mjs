/**
 * d1-v16-stub — общий in-memory D1-стаб под протокол воркера патча №16.
 *
 * Используется legacy воркер-тестами (worker-payments*.mjs,
 * worker-entitlements.mjs) вместо их собственных стабов под старые схемы.
 * Покрывает весь SQL, который использует worker/src/index.ts:
 *  - мутации из worker/src/sql.ts (заказ, платёж, грант, reversal, refund_ops);
 *  - чтения хендлеров (getOrder, verify, entitlements, ack, wallet, refund);
 *  - эмуляция триггера trg_wallet_ledger_apply (см. worker/schema.sql);
 *  - атомарность batch(): snapshot/restore — ошибка любого statement
 *    откатывает весь батч (как D1).
 *
 * Хуки: _failNext (следующий run() бросит), failBatchAtStatement (n-й
 * statement батча бросит), parkLedgerInsert (парковка перед вставкой
 * гранта — для интерливинг-тестов). Карты orders/payments/wallets/ledger/
 * walletSkins/refundOps доступны для assert'ов и сидинга.
 *
 * Не регистрируется как test:* — это хелпер.
 */
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

export function makeD1() {
  const orders = new Map();
  const payments = new Map();
  const wallets = new Map();
  const ledger = new Map(); // charge_id -> row (id монотонный)
  const walletSkins = new Map(); // charge_id -> row
  const refundOps = new Map();
  const hooks = { failBatchAtStatement: -1, parkLedgerInsert: false };
  const parked = [];
  let batchCalls = 0;
  const batchSizes = [];
  let failNext = false;

  const snapshot = () => ({
    orders: structuredClone(orders),
    payments: structuredClone(payments),
    wallets: structuredClone(wallets),
    ledger: structuredClone(ledger),
    walletSkins: structuredClone(walletSkins),
    refundOps: structuredClone(refundOps),
  });
  const restore = (s) => {
    for (const [m, v] of [
      [orders, s.orders], [payments, s.payments], [wallets, s.wallets],
      [ledger, s.ledger], [walletSkins, s.walletSkins], [refundOps, s.refundOps],
    ]) {
      m.clear();
      for (const [k, val] of v) m.set(k, val);
    }
  };

  /** Эмуляция trg_wallet_ledger_apply (worker/schema.sql). */
  function applyTrigger(row) {
    const { user_id, kind, grant_type, amount, skin_id, charge_id, reverses_charge_id, created_at } = row;
    let w = wallets.get(user_id);
    if (!w) {
      w = { user_id, purchased_rna: 0, booster_until_ms: 0, skins_json: '[]', updated_at: created_at };
      wallets.set(user_id, w);
    }
    if (kind === 'grant' && grant_type === 'rna') w.purchased_rna += amount;
    else if (kind === 'grant' && grant_type === 'booster') w.booster_until_ms = Math.max(w.booster_until_ms, created_at) + amount;
    else if (kind === 'grant' && grant_type === 'skin' && skin_id) {
      if (!walletSkins.has(charge_id)) {
        walletSkins.set(charge_id, { user_id, skin_id, charge_id, status: 'active', granted_at: created_at });
      }
    } else if (kind === 'reversal' && grant_type === 'rna') w.purchased_rna = Math.max(0, w.purchased_rna + amount);
    else if (kind === 'reversal' && grant_type === 'booster') w.booster_until_ms = Math.max(created_at, w.booster_until_ms + amount);
    else if (kind === 'reversal' && grant_type === 'skin' && reverses_charge_id) {
      const s = walletSkins.get(reverses_charge_id);
      if (s && s.status === 'active') s.status = 'reversed';
    }
    w.updated_at = created_at;
  }

  function execRun(sql, params, batchCtx) {
    const q = norm(sql);
    if (batchCtx && hooks.failBatchAtStatement === batchCtx.index) {
      throw new Error('d1-stub: injected statement failure');
    }
    // SQL_INSERT_ORDER (v16, B2): заказ иммутабелен.
    if (q.startsWith('INSERT INTO orders')) {
      const [nonce, user_id, product_id, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id, created_at] = params;
      if (orders.has(nonce)) throw new Error('UNIQUE constraint failed: orders.nonce');
      orders.set(nonce, { nonce, user_id, product_id, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id, status: 'pending', created_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (q === "UPDATE orders SET status='paid' WHERE nonce=? AND status='pending'") {
      const [nonce] = params;
      const row = orders.get(nonce);
      if (row && row.status === 'pending') {
        row.status = 'paid';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    // SQL_INSERT_PAYMENT: ON CONFLICT(charge_id) DO NOTHING (тесты также
    // используют эквивалентный OR IGNORE-синтаксис для прямого сидинга).
    if (q.startsWith('INSERT INTO payments (charge_id,') || q.startsWith('INSERT OR IGNORE INTO payments (charge_id,')) {
      const [charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at] = params;
      if (payments.has(charge_id)) return { success: true, meta: { changes: 0 } };
      for (const row of payments.values()) {
        if (row.nonce === nonce && nonce != null) throw new Error('UNIQUE constraint failed: payments.nonce');
      }
      payments.set(charge_id, { charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at });
      return { success: true, meta: { changes: 1 } };
    }
    // SQL_INSERT_LEDGER_GRANT (+ триггер).
    if (q.startsWith('INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type,') && q.includes('VALUES')) {
      const [user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at] = params;
      if (ledger.has(charge_id)) return { success: true, meta: { changes: 0 } };
      const row = { id: ledger.size + 1, user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at };
      ledger.set(charge_id, row);
      applyTrigger(row);
      return { success: true, meta: { changes: 1 } };
    }
    // SQL_INSERT_LEDGER_REVERSAL (+ триггер). Params: (rev_charge_id, created_at, orig, orig, orig).
    // P1-6: EXISTS-guard по payments.status='refunded' — стаб проверяет payments Map.
    if (q.startsWith('INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type,') && q.includes('SELECT')) {
      const [rev_charge_id, created_at, orig_charge_id] = params;
      if (ledger.has(rev_charge_id)) return { success: true, meta: { changes: 0 } };
      const grant = ledger.get(orig_charge_id);
      const alreadyReversed = [...ledger.values()].some(
        (r) => r.kind === 'reversal' && r.reverses_charge_id === orig_charge_id
      );
      const payment = payments.get(orig_charge_id);
      if (!grant || grant.kind !== 'grant' || alreadyReversed) return { success: true, meta: { changes: 0 } };
      if (!payment || payment.status !== 'refunded') return { success: true, meta: { changes: 0 } };
      const row = {
        id: ledger.size + 1, user_id: grant.user_id, charge_id: rev_charge_id, kind: 'reversal',
        grant_type: grant.grant_type, amount: -grant.amount, skin_id: grant.skin_id,
        reverses_charge_id: orig_charge_id, amount_text: `reversal-of:${orig_charge_id}`, created_at,
      };
      ledger.set(rev_charge_id, row);
      applyTrigger(row);
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith('INSERT INTO refund_ops')) {
      const [operation_id, charge_id, user_id, action, status, reason, telegram_confirmed_at, created_at, updated_at] = params;
      if (refundOps.has(operation_id)) throw new Error('UNIQUE constraint failed: refund_ops.operation_id');
      refundOps.set(operation_id, { operation_id, charge_id, user_id, action, status, reason, telegram_confirmed_at, created_at, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (q === "UPDATE payments SET status='refunded' WHERE charge_id=? AND status IN ('paid','fulfilled')") {
      const [charge_id] = params;
      const row = payments.get(charge_id);
      if (row && (row.status === 'paid' || row.status === 'fulfilled')) {
        row.status = 'refunded';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q === "UPDATE payments SET status='refund_requested' WHERE charge_id=? AND status IN ('paid','fulfilled')") {
      const [charge_id] = params;
      const row = payments.get(charge_id);
      if (row && (row.status === 'paid' || row.status === 'fulfilled')) {
        row.status = 'refund_requested';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q === "UPDATE payments SET status='refunded' WHERE charge_id=? AND status IN ('paid','fulfilled','refund_requested')") {
      const [charge_id] = params;
      const row = payments.get(charge_id);
      if (row && (row.status === 'paid' || row.status === 'fulfilled' || row.status === 'refund_requested')) {
        row.status = 'refunded';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith("UPDATE refund_ops SET status='completed'")) {
      const [telegram_confirmed_at, updated_at, operation_id] = params;
      const row = refundOps.get(operation_id);
      if (row) {
        row.status = 'completed';
        row.telegram_confirmed_at = telegram_confirmed_at;
        row.updated_at = updated_at;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith("UPDATE refund_ops SET status='failed'")) {
      const [updated_at, operation_id] = params;
      const row = refundOps.get(operation_id);
      if (row) {
        row.status = 'failed';
        row.updated_at = updated_at;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith("UPDATE payments SET status='fulfilled'")) {
      const [fulfilled_at, charge_id, user_id] = params;
      const row = payments.get(charge_id);
      if (row && row.user_id === user_id && row.status === 'paid') {
        row.status = 'fulfilled';
        row.fulfilled_at = fulfilled_at;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    throw new Error(`d1-stub: unsupported run SQL: ${q}`);
  }

  function execSelect(sql, params) {
    const q = norm(sql);
    if (q === 'SELECT user_id, product_id, status, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id FROM orders WHERE nonce=?') {
      const row = orders.get(params[0]);
      return row
        ? [{ user_id: row.user_id, product_id: row.product_id, status: row.status, amount_stars: row.amount_stars, sku_version: row.sku_version, grant_rna: row.grant_rna ?? null, grant_booster_days: row.grant_booster_days ?? null, grant_skin_id: row.grant_skin_id ?? null }]
        : [];
    }
    // handleStaleOrders: заказы pending старше cutoff.
    if (q === "SELECT nonce, user_id, product_id, status, created_at FROM orders WHERE status='pending' AND created_at < ? ORDER BY created_at ASC LIMIT 200") {
      const cutoff = params[0];
      return [...orders.values()]
        .filter((r) => r.status === 'pending' && r.created_at < cutoff)
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, 200)
        .map((r) => ({ nonce: r.nonce, user_id: r.user_id, product_id: r.product_id, status: r.status, created_at: r.created_at }));
    }
    // handleStaleOrders: платежи paid старше cutoff.
    if (q === "SELECT charge_id, user_id, product_id, created_at FROM payments WHERE status='paid' AND created_at < ? ORDER BY created_at ASC LIMIT 200") {
      const cutoff = params[0];
      return [...payments.values()]
        .filter((r) => r.status === 'paid' && r.created_at < cutoff)
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, 200)
        .map((r) => ({ charge_id: r.charge_id, user_id: r.user_id, product_id: r.product_id, created_at: r.created_at }));
    }
    if (q === 'SELECT charge_id FROM payments WHERE nonce=?') {
      for (const row of payments.values()) if (row.nonce === params[0]) return [{ charge_id: row.charge_id }];
      return [];
    }
    if (q === 'SELECT charge_id, user_id, product_id, status, created_at FROM payments WHERE nonce=?') {
      for (const row of payments.values()) {
        if (row.nonce === params[0]) {
          return [{ charge_id: row.charge_id, user_id: row.user_id, product_id: row.product_id, status: row.status, created_at: row.created_at }];
        }
      }
      return [];
    }
    if (q === 'SELECT charge_id, product_id, status, created_at FROM payments WHERE user_id=? ORDER BY created_at ASC') {
      return [...payments.values()]
        .filter((r) => r.user_id === params[0])
        .sort((a, b) => a.created_at - b.created_at)
        .map((r) => ({ charge_id: r.charge_id, product_id: r.product_id, status: r.status, created_at: r.created_at }));
    }
    if (q === 'SELECT charge_id, user_id, product_id, status FROM payments WHERE charge_id=?') {
      const row = payments.get(params[0]);
      return row ? [{ charge_id: row.charge_id, user_id: row.user_id, product_id: row.product_id, status: row.status }] : [];
    }
    if (q === 'SELECT status FROM payments WHERE charge_id=?') {
      const row = payments.get(params[0]);
      return row ? [{ status: row.status }] : [];
    }
    if (q === 'SELECT operation_id, charge_id, action, status FROM refund_ops WHERE operation_id=?') {
      const row = refundOps.get(params[0]);
      return row ? [{ operation_id: row.operation_id, charge_id: row.charge_id, action: row.action, status: row.status }] : [];
    }
    if (q === 'SELECT purchased_rna, booster_until_ms FROM wallets WHERE user_id=?') {
      const w = wallets.get(params[0]);
      return w ? [{ purchased_rna: w.purchased_rna, booster_until_ms: w.booster_until_ms }] : [];
    }
    if (q === "SELECT skin_id FROM wallet_skins WHERE user_id=? AND status='active' ORDER BY granted_at ASC") {
      return [...walletSkins.values()]
        .filter((r) => r.user_id === params[0] && r.status === 'active')
        .sort((a, b) => a.granted_at - b.granted_at)
        .map((r) => ({ skin_id: r.skin_id }));
    }
    if (q.startsWith('SELECT id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, created_at FROM wallet_ledger')) {
      const [userId, sinceSeq] = params;
      return [...ledger.values()]
        .filter((r) => r.user_id === userId && r.id > sinceSeq)
        .sort((a, b) => a.id - b.id)
        .slice(0, 5000)
        .map((r) => ({ id: r.id, charge_id: r.charge_id, kind: r.kind, grant_type: r.grant_type, amount: r.amount, skin_id: r.skin_id, reverses_charge_id: r.reverses_charge_id ?? null, created_at: r.created_at }));
    }
    if (q.startsWith('SELECT MAX(id) AS tip_seq')) {
      let tipSeq = null;
      let tipCreated = null;
      for (const r of ledger.values()) {
        if (r.user_id !== params[0]) continue;
        if (tipSeq == null || r.id > tipSeq) tipSeq = r.id;
        if (tipCreated == null || r.created_at > tipCreated) tipCreated = r.created_at;
      }
      return [{ tip_seq: tipSeq, tip_created: tipCreated }];
    }
    throw new Error(`d1-stub: unsupported select SQL: ${q}`);
  }

  const db = {
    orders, payments, wallets, ledger, walletSkins, refundOps, hooks, parked,
    batchCalls: () => batchCalls,
    batchSizes,
    /** Тестовый хук (legacy): следующий run() бросит. */
    get _failNext() { return failNext; },
    set _failNext(v) { failNext = !!v; },
    prepare(sql) {
      const st = {
        _params: [],
        _sql: sql,
        bind(...params) { st._params = params; return st; },
        async run() {
          if (failNext) {
            failNext = false;
            throw new Error('d1-stub: injected failure');
          }
          return execRun(sql, st._params, null);
        },
        async first(column) {
          const rows = execSelect(sql, st._params);
          const row = rows[0] ?? null;
          if (row == null) return null;
          return column != null ? (row[column] ?? null) : row;
        },
        async all() { return { results: execSelect(sql, st._params) }; },
      };
      return st;
    },
    async batch(statements) {
      batchCalls += 1;
      batchSizes.push(statements.length);
      if (failNext) {
        failNext = false;
        throw new Error('d1-stub: injected failure');
      }
      const snap = snapshot();
      try {
        const out = [];
        let i = 0;
        for (const st of statements) {
          i += 1;
          const nq = norm(st._sql);
          if (hooks.parkLedgerInsert && nq.startsWith('INSERT INTO wallet_ledger') && nq.includes('VALUES')) {
            await new Promise((res) => parked.push(res));
          }
          out.push(execRun(st._sql, st._params, { index: i }));
        }
        return out;
      } catch (e) {
        restore(snap);
        throw e;
      }
    },
  };
  return db;
}

/** Засеять заказ новым SQL (как его пишет /api/invoice v16). */
export async function seedOrder(db, nonce, userId, productId, amountStars, opts = {}) {
  const { skuVersion = 2, status = 'pending', createdAt = Date.now(),
    grantRna = null, grantBoosterDays = null, grantSkinId = null } =
    typeof opts === 'object' && opts !== null ? opts : {};
  await db
    .prepare("INSERT INTO orders (nonce, user_id, product_id, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id, status, created_at) VALUES (?,?,?,?,?,?,?,?, 'pending',?)")
    .bind(nonce, userId, productId, amountStars, skuVersion, grantRna, grantBoosterDays, grantSkinId, createdAt)
    .run();
  if (status !== 'pending') {
    const row = db.orders.get(nonce);
    if (row) row.status = status;
  }
}

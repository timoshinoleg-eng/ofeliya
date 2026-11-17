/**
 * d1-v16-stub — общий in-memory D1-стаб под протокол воркера патча №16
 * (+ монетизация v3 / v17: season_pass, subscription_events).
 *
 * Используется legacy воркер-тестами (worker-payments*.mjs,
 * worker-entitlements.mjs) вместо их собственных стабов под старые схемы.
 * Покрывает весь SQL, который использует worker/src/index.ts:
 *  - мутации из worker/src/sql.ts (заказ, платёж, грант, reversal, refund_ops);
 *  - чтения хендлеров (getOrder, verify, entitlements, ack, wallet, refund);
 *  - эмуляция триггера trg_wallet_ledger_apply (см. worker/schema.sql);
 *  - эмуляция guard-триггера trg_wallet_ledger_season_pass_guard (P2-N1):
 *    НЕ-продлённый season_pass-грант при активном пропуске бросает
 *    (батч откатывается целиком — как RAISE(ABORT) в D1);
 *  - атомарность batch(): snapshot/restore — ошибка любого statement
 *    откатывает весь батч (как D1).
 *
 * Хуки: _failNext (следующий run() бросит), failBatchAtStatement (n-й
 * statement батча бросит), parkLedgerInsert (парковка перед вставкой
 * гранта — для интерливинг-тестов). Карты orders/payments/wallets/ledger/
 * walletSkins/refundOps/subscriptionEvents доступны для assert'ов и сидинга.
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
  const subscriptionEvents = []; // {id, user_id, nonce, charge_id, state, source, created_at}
  const duplicatePayments = new Map(); // charge_id -> row (P1-1: возврат дубликатов)
  const hooks = { failBatchAtStatement: -1, parkLedgerInsert: false, disableTrigger: false };
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
    subscriptionEvents: structuredClone(subscriptionEvents),
    duplicatePayments: structuredClone(duplicatePayments),
  });
  const restore = (s) => {
    for (const [m, v] of [
      [orders, s.orders], [payments, s.payments], [wallets, s.wallets],
      [ledger, s.ledger], [walletSkins, s.walletSkins], [refundOps, s.refundOps],
      [duplicatePayments, s.duplicatePayments],
    ]) {
      m.clear();
      for (const [k, val] of v) m.set(k, val);
    }
    subscriptionEvents.length = 0;
    subscriptionEvents.push(...s.subscriptionEvents);
  };

  /** Эмуляция trg_wallet_ledger_apply (worker/schema.sql). Хук
   *  disableTrigger=true симулирует отсутствующий триггер (P1-3): вставка
   *  в журнал проходит, а кошелёк НЕ меняется (включая создание строки
   *  wallets — INSERT OR IGNORE тоже часть триггера). */
  function applyTrigger(row) {
    if (hooks.disableTrigger) return;
    const { user_id, kind, grant_type, amount, skin_id, charge_id, reverses_charge_id, created_at } = row;
    let w = wallets.get(user_id);
    if (!w) {
      w = { user_id, purchased_rna: 0, booster_until_ms: 0, season_pass_until_ms: 0, skins_json: '[]', updated_at: created_at };
      wallets.set(user_id, w);
    }
    if (kind === 'grant' && grant_type === 'rna') w.purchased_rna += amount;
    else if (kind === 'grant' && grant_type === 'booster') w.booster_until_ms = Math.max(w.booster_until_ms, created_at) + amount;
    else if (kind === 'grant' && grant_type === 'season_pass') w.season_pass_until_ms = Math.max(w.season_pass_until_ms, created_at) + amount;
    else if (kind === 'grant' && grant_type === 'skin' && skin_id) {
      // Монетизация v3: ключ wallet_skins — (user, skin, charge): бандл
      // пишет три скина с одним charge_id (UNIQUE с charge_id снят).
      const sk = `${user_id}|${skin_id}|${charge_id}`;
      if (!walletSkins.has(sk)) {
        walletSkins.set(sk, { user_id, skin_id, charge_id, status: 'active', granted_at: created_at });
      }
    } else if (kind === 'reversal' && grant_type === 'rna') w.purchased_rna = Math.max(0, w.purchased_rna + amount);
    else if (kind === 'reversal' && grant_type === 'booster') w.booster_until_ms = Math.max(created_at, w.booster_until_ms + amount);
    else if (kind === 'reversal' && grant_type === 'season_pass') w.season_pass_until_ms = Math.max(created_at, w.season_pass_until_ms + amount);
    else if (kind === 'reversal' && grant_type === 'skin' && reverses_charge_id) {
      // SQL UPDATE гасит ВСЕ активные строки этого charge_id (бандл).
      for (const s of walletSkins.values()) {
        if (s.charge_id === reverses_charge_id && s.status === 'active') s.status = 'reversed';
      }
    }
    w.updated_at = created_at;
  }

  // Ключ журнала — UNIQUE (charge_id, grant_type, skin_id) v17:
  // skin_id нормализуется в '' (как COALESCE в SQL_INSERT_LEDGER_GRANT).
  const ledgerKey = (charge_id, grant_type, skin_id) => `${charge_id}\0${grant_type}\0${skin_id ?? ''}`;

  function execRun(sql, params, batchCtx) {
    const q = norm(sql);
    if (batchCtx && hooks.failBatchAtStatement === batchCtx.index) {
      throw new Error('d1-stub: injected statement failure');
    }
    // SQL_INSERT_ORDER (v16, B2): заказ иммутабелен. v17: + grant_season_pass_days + grant_bundle_json.
    // CR-R4-2: invoice_url NULL до первой успешной выдачи инвойса.
    if (q.startsWith('INSERT INTO orders')) {
      const [nonce, user_id, product_id, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id, grant_season_pass_days, grant_bundle_json, created_at] = params;
      if (orders.has(nonce)) throw new Error('UNIQUE constraint failed: orders.nonce');
      orders.set(nonce, { nonce, user_id, product_id, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id, grant_season_pass_days, grant_bundle_json, invoice_url: null, status: 'pending', created_at });
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
    // SQL_INSERT_LEDGER_GRANT (+ триггер). UNIQUE v17 — (charge_id,
    // grant_type, skin_id); skin_id нормализуется в '' (COALESCE в SQL).
    if (q.startsWith('INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type,') && q.includes('VALUES')) {
      const [user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at] = params;
      const normSkinId = skin_id ?? '';
      if (ledger.has(ledgerKey(charge_id, grant_type, normSkinId))) return { success: true, meta: { changes: 0 } };
      // P2-N1: эмуляция guard-триггера trg_wallet_ledger_season_pass_guard
      // (worker/schema.sql). Дубликатная доставка уже отсеяна выше
      // (changes=0 — как NOT EXISTS в триггере); продление отличается по
      // payments.nonce с ':' (derived nonce recordSubscriptionRenewal).
      // Кошелёк здесь — ДО вставки (applyTrigger ниже), как в BEFORE.
      if (kind === 'grant' && grant_type === 'season_pass') {
        const w = wallets.get(user_id);
        const payment = payments.get(charge_id);
        const isRenewal = typeof payment?.nonce === 'string' && payment.nonce.includes(':');
        if (w && w.season_pass_until_ms > created_at && !isRenewal) {
          throw new Error('season pass already active for user');
        }
      }
      const row = { id: ledger.size + 1, user_id, charge_id, kind, grant_type, amount, skin_id: normSkinId, reverses_charge_id, amount_text, created_at };
      ledger.set(ledgerKey(charge_id, grant_type, normSkinId), row);
      applyTrigger(row);
      return { success: true, meta: { changes: 1 } };
    }
    // SQL_INSERT_LEDGER_REVERSAL (+ триггер). Params: (operation_id,
    // created_at, orig, orig, orig). Монетизация v3: один charge_id — N
    // grant-строк (бандл) → N reversal-строк, charge_id построчный
    // 'rev:<op>:<grant_type>:<skin_id>'. P1-6: EXISTS-guard по
    // payments.status='refunded' — стаб проверяет payments Map.
    if (q.startsWith('INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type,') && q.includes('SELECT')) {
      const [operation_id, created_at, orig_charge_id] = params;
      const grants = [...ledger.values()].filter(
        (r) => r.charge_id === orig_charge_id && r.kind === 'grant'
      );
      const alreadyReversed = [...ledger.values()].some(
        (r) => r.kind === 'reversal' && r.reverses_charge_id === orig_charge_id
      );
      const payment = payments.get(orig_charge_id);
      if (grants.length === 0 || alreadyReversed) return { success: true, meta: { changes: 0 } };
      if (!payment || payment.status !== 'refunded') return { success: true, meta: { changes: 0 } };
      let inserted = 0;
      for (const grant of grants) {
        const revChargeId = `rev:${operation_id}:${grant.grant_type}:${grant.skin_id ?? ''}`;
        const key = ledgerKey(revChargeId, grant.grant_type, grant.skin_id ?? '');
        if (ledger.has(key)) continue;
        const row = {
          id: ledger.size + 1, user_id: grant.user_id, charge_id: revChargeId, kind: 'reversal',
          grant_type: grant.grant_type, amount: -grant.amount, skin_id: grant.skin_id ?? '',
          reverses_charge_id: orig_charge_id, amount_text: `reversal-of:${orig_charge_id}`, created_at,
        };
        ledger.set(key, row);
        applyTrigger(row);
        inserted++;
      }
      return { success: true, meta: { changes: inserted } };
    }
    // SQL_INSERT_SUBSCRIPTION_EVENT (v17): аудит BotSubscriptionUpdated.
    // P2-3: админская запись — 6 параметров (source='admin'); апдейт
    // Telegram — 5 (source='telegram' по умолчанию схемы).
    if (q.startsWith('INSERT INTO subscription_events')) {
      if (params.length === 6) {
        const [user_id, nonce, charge_id, state, source, created_at] = params;
        subscriptionEvents.push({
          id: subscriptionEvents.length + 1, user_id, nonce, charge_id, state, source, created_at,
        });
        return { success: true, meta: { changes: 1 } };
      }
      const [user_id, nonce, charge_id, state, created_at] = params;
      subscriptionEvents.push({
        id: subscriptionEvents.length + 1, user_id, nonce, charge_id, state, source: 'telegram', created_at,
      });
      return { success: true, meta: { changes: 1 } };
    }
    // SQL_INSERT_DUPLICATE_PAYMENT (P1-1/P1-2): ON CONFLICT DO NOTHING.
    // status по умолчанию 'pending' (как DEFAULT в schema.sql).
    if (q.startsWith('INSERT INTO duplicate_payments')) {
      const [charge_id, nonce, user_id, product_id, amount, currency, reason, created_at] = params;
      if (duplicatePayments.has(charge_id)) return { success: true, meta: { changes: 0 } };
      duplicatePayments.set(charge_id, { charge_id, nonce, user_id, product_id, amount, currency, reason, status: 'pending', created_at });
      return { success: true, meta: { changes: 1 } };
    }
    // P1-1: state machine возврата дубликата (зеркало payments).
    if (q === "UPDATE duplicate_payments SET status='refund_requested' WHERE charge_id=? AND status='pending'") {
      const [charge_id] = params;
      const row = duplicatePayments.get(charge_id);
      if (row && row.status === 'pending') {
        row.status = 'refund_requested';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q === "UPDATE duplicate_payments SET status='refunded' WHERE charge_id=? AND status='pending'") {
      const [charge_id] = params;
      const row = duplicatePayments.get(charge_id);
      if (row && row.status === 'pending') {
        row.status = 'refunded';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q === "UPDATE duplicate_payments SET status='refunded' WHERE charge_id=? AND status IN ('pending','refund_requested')") {
      const [charge_id] = params;
      const row = duplicatePayments.get(charge_id);
      if (row && (row.status === 'pending' || row.status === 'refund_requested')) {
        row.status = 'refunded';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    // P1-2: заказ отклонённой подписки — терминальный статус 'denied'
    // (продления такого заказа тоже не грантятся).
    if (q === "UPDATE orders SET status='denied' WHERE nonce=? AND status='pending'") {
      const [nonce] = params;
      const row = orders.get(nonce);
      if (row && row.status === 'pending') {
        row.status = 'denied';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    // CR-R3-2: заказ без созданного инвойса — терминальный 'invoice_failed'.
    // CR-R4-2: пометка — только если инвойс ещё не выдавался
    // (invoice_url IS NULL), иначе упавший ретрай убивал бы первый URL.
    if (q === "UPDATE orders SET status='invoice_failed' WHERE nonce=? AND status='pending' AND invoice_url IS NULL") {
      const [nonce] = params;
      const row = orders.get(nonce);
      if (row && row.status === 'pending' && row.invoice_url == null) {
        row.status = 'invoice_failed';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    // CR-R4-2: фиксация выданного инвойса (SQL_UPDATE_ORDER_INVOICE_ISSUED).
    // CASE оживляет заказ, который конкурентный близнец успел пометить
    // invoice_failed между createInvoiceLink и этой записью.
    if (q === "UPDATE orders SET invoice_url=?, status=CASE WHEN status='invoice_failed' THEN 'pending' ELSE status END WHERE nonce=?") {
      const [invoice_url, nonce] = params;
      const row = orders.get(nonce);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.invoice_url = invoice_url;
      if (row.status === 'invoice_failed') row.status = 'pending';
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
    if (q === 'SELECT user_id, product_id, status, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id, grant_season_pass_days, grant_bundle_json, invoice_url FROM orders WHERE nonce=?') {
      const row = orders.get(params[0]);
      return row
        ? [{ user_id: row.user_id, product_id: row.product_id, status: row.status, amount_stars: row.amount_stars, sku_version: row.sku_version, grant_rna: row.grant_rna ?? null, grant_booster_days: row.grant_booster_days ?? null, grant_skin_id: row.grant_skin_id ?? null, grant_season_pass_days: row.grant_season_pass_days ?? null, grant_bundle_json: row.grant_bundle_json ?? null, invoice_url: row.invoice_url ?? null }]
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
    if (q === 'SELECT charge_id, user_id, product_id, status FROM payments WHERE charge_id=?' ||
        q === 'SELECT charge_id, user_id, product_id, status, nonce FROM payments WHERE charge_id=?') {
      const row = payments.get(params[0]);
      return row ? [{ charge_id: row.charge_id, user_id: row.user_id, product_id: row.product_id, status: row.status, nonce: row.nonce ?? null }] : [];
    }
    // P1-2: свежие pending-заказы пользователя (один pending subscription
    // order на пользователя).
    if (q === "SELECT nonce, product_id, created_at FROM orders WHERE user_id=? AND status='pending'") {
      return [...orders.values()]
        .filter((r) => r.user_id === params[0] && r.status === 'pending')
        .map((r) => ({ nonce: r.nonce, product_id: r.product_id, created_at: r.created_at }));
    }
    // P1-1: дубликат по charge_id (возврат + админ-подписка).
    if (q === 'SELECT charge_id, nonce, user_id, product_id, amount, currency, reason, status, created_at FROM duplicate_payments WHERE charge_id=?') {
      const row = duplicatePayments.get(params[0]);
      return row ? [{ ...row }] : [];
    }
    if (q === 'SELECT status FROM duplicate_payments WHERE charge_id=?') {
      const row = duplicatePayments.get(params[0]);
      return row ? [{ status: row.status }] : [];
    }
    // P2-N2 (a): дубликат по nonce (verify: 'duplicate' вместо 'pending').
    if (q === 'SELECT charge_id FROM duplicate_payments WHERE nonce=?') {
      for (const row of duplicatePayments.values()) {
        if (row.nonce === params[0]) return [{ charge_id: row.charge_id }];
      }
      return [];
    }
    if (q === 'SELECT status FROM payments WHERE charge_id=?') {
      const row = payments.get(params[0]);
      return row ? [{ status: row.status }] : [];
    }
    if (q === 'SELECT operation_id, charge_id, action, status FROM refund_ops WHERE operation_id=?') {
      const row = refundOps.get(params[0]);
      return row ? [{ operation_id: row.operation_id, charge_id: row.charge_id, action: row.action, status: row.status }] : [];
    }
    if (q === 'SELECT purchased_rna, booster_until_ms, season_pass_until_ms FROM wallets WHERE user_id=?') {
      const w = wallets.get(params[0]);
      return w ? [{ purchased_rna: w.purchased_rna, booster_until_ms: w.booster_until_ms, season_pass_until_ms: w.season_pass_until_ms }] : [];
    }
    // Кросс-чек продления (v17): season_pass_until_ms после гранта.
    if (q === 'SELECT season_pass_until_ms FROM wallets WHERE user_id=?') {
      const w = wallets.get(params[0]);
      return w ? [{ season_pass_until_ms: w.season_pass_until_ms }] : [];
    }
    if (q === "SELECT skin_id FROM wallet_skins WHERE user_id=? AND status='active' ORDER BY granted_at ASC") {
      return [...walletSkins.values()]
        .filter((r) => r.user_id === params[0] && r.status === 'active')
        .sort((a, b) => a.granted_at - b.granted_at)
        .map((r) => ({ skin_id: r.skin_id }));
    }
    if (q.startsWith('SELECT id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, created_at FROM wallet_ledger')) {
      const [userId, sinceSeq] = params;
      // P3-10: LIMIT 5001 — 5001-я строка только детектирует усечение.
      return [...ledger.values()]
        .filter((r) => r.user_id === userId && r.id > sinceSeq)
        .sort((a, b) => a.id - b.id)
        .slice(0, 5001)
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
    orders, payments, wallets, ledger, walletSkins, refundOps, subscriptionEvents, duplicatePayments, hooks, parked,
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

/**
 * Засеять строки журнала реальным INSERT (триггер применяется, id —
 * монотонный по порядку вставки). Для объёмных фикстур (P3-10: >5000
 * строк) — одним батчем.
 */
export async function seedLedgerBulk(db, rows) {
  const stmts = rows.map((r) =>
    db
      .prepare(
        'INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .bind(
        r.user_id,
        r.charge_id,
        r.kind,
        r.grant_type,
        r.amount,
        r.skin_id ?? null,
        r.reverses_charge_id ?? null,
        r.amount_text ?? null,
        r.created_at ?? Date.now()
      )
  );
  await db.batch(stmts);
}

/** Засеять заказ новым SQL (как его пишет /api/invoice v16/v17). */
export async function seedOrder(db, nonce, userId, productId, amountStars, opts = {}) {
  const { skuVersion = 2, status = 'pending', createdAt = Date.now(),
    grantRna = null, grantBoosterDays = null, grantSkinId = null, grantSeasonPassDays = null,
    grantBundleJson = null, invoiceUrl = null } =
    typeof opts === 'object' && opts !== null ? opts : {};
  await db
    .prepare("INSERT INTO orders (nonce, user_id, product_id, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id, grant_season_pass_days, grant_bundle_json, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending',?)")
    .bind(nonce, userId, productId, amountStars, skuVersion, grantRna, grantBoosterDays, grantSkinId, grantSeasonPassDays, grantBundleJson, createdAt)
    .run();
  const row = db.orders.get(nonce);
  // CR-R4-2: посеять выданный инвойс (по умолчанию — не выдавался).
  if (row && invoiceUrl != null) row.invoice_url = invoiceUrl;
  if (status !== 'pending') {
    if (row) row.status = status;
  }
}

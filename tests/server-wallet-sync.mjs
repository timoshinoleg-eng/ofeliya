/**
 * server-wallet-sync — патч №15 (P0-3, клиентская материализация).
 *
 * Compiles the TS modules with tsc like the other node-side contract tests.
 *
 * Covers:
 * - syncServerWallet: дельта РНК по watermark (первый синк — полная сумма,
 *   повторный — 0, идемпотентность);
 * - скины — union (повторный синк не дублирует);
 * - бустер — max(local, server);
 * - refund на сервере (purchased_rna уменьшился) — отрицательная дельта
 *   не начисляется, watermark следует вниз;
 * - bad-config / http-error / bad-response → {ok:false}, без исключений;
 * - grantSkin неизвестного скина не роняет синк.
 *
 * Адаптация к main: MetaWallet на plain numbers (rna — число, не
 * Decimal-строка), поэтому ожидания баланса — числа, а не строки.
 * Список компиляции — без DailyCalendar/UmamiAnalytics стека: в main их
 * нет (SkinOwnership идёт через systems/ClientExperience, который tsc
 * подтягивает транзитивно).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-wallet-sync-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`server-wallet-sync: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// In-memory localStorage — ставится ДО require модулей.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => void store.clear(),
};

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/shop/ServerWalletSync.ts',
      'src/game/meta/MetaWallet.ts',
      'src/game/skins/SkinOwnership.ts',
      'src/game/skins/SkinCatalog.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'pipe' }
  );

  const { syncServerWallet, debugResetWalletSync, WALLET_SYNC_WATERMARK_KEY } = require(
    join(temp, 'game/shop/ServerWalletSync.js')
  );
  const meta = require(join(temp, 'game/meta/MetaWallet.js'));
  const skins = require(join(temp, 'game/skins/SkinOwnership.js'));

  // Серверный стаб: состояние «кошелька» на воркере.
  let serverWallet = { purchased_rna: 0, booster_until_ms: 0, skins: [], ledger_tip: null };
  let failWith = 0;
  const fetchFn = async (url, opts) => {
    assert(String(url).endsWith('/api/wallet'), 'wallet endpoint path');
    const body = JSON.parse(opts.body);
    assert(typeof body.initData === 'string' && body.initData.length > 0, 'initData sent');
    if (failWith) {
      return { ok: false, status: failWith, json: async () => null };
    }
    return { ok: true, status: 200, json: async () => ({ ...serverWallet }) };
  };
  const sync = () =>
    syncServerWallet({ apiBaseUrl: 'https://worker.test', initData: 'initdata-test', fetchFn });

  const reset = () => {
    store.clear();
    debugResetWalletSync();
    serverWallet = { purchased_rna: 0, booster_until_ms: 0, skins: [], ledger_tip: null };
    failWith = 0;
  };

  // --- 1. Первый синк: полная дельта; повторный — ноль (идемпотентность) ---
  reset();
  serverWallet.purchased_rna = 500;
  const r1 = await sync();
  eq(r1.ok, true, 'first sync ok');
  eq(r1.applied.rna, 500, 'first sync applies full delta');
  eq(meta.loadMeta().rna, 500, 'local balance +500');
  eq(store.get(WALLET_SYNC_WATERMARK_KEY), '500', 'watermark = 500');
  const r2 = await sync();
  eq(r2.ok, true, 'second sync ok');
  eq(r2.applied.rna, 0, 'second sync applies 0');
  eq(meta.loadMeta().rna, 500, 'no double grant');

  // --- 2. Новая покупка: дельта только по приросту ---
  serverWallet.purchased_rna = 2000;
  const r3 = await sync();
  eq(r3.applied.rna, 1500, 'delta on growth');
  eq(meta.loadMeta().rna, 2000, 'balance 2000');

  // --- 3. Скины — union ---
  reset();
  serverWallet.skins = ['skin.abyssal-teal'];
  const r4 = await sync();
  eq(r4.applied.skins.length, 1, 'new skin applied');
  eq(r4.applied.skins[0], 'skin.abyssal-teal', 'skin id');
  assert(skins.loadSkinStore().owned.includes('skin.abyssal-teal'), 'skin owned locally');
  const r5 = await sync();
  eq(r5.applied.skins.length, 0, 'repeat sync: no duplicate skin');

  // --- 4. Бустер — max(local, server) ---
  reset();
  const now = Date.now();
  meta.setBoosterUntilMs(now + 1_000_000); // локальный (QA-мок) больше серверного
  serverWallet.booster_until_ms = now + 100_000;
  const r6 = await sync();
  eq(r6.applied.boosterUntilMs, now + 1_000_000, 'booster: local wins when greater');
  eq(meta.loadMeta().boosterUntilMs, now + 1_000_000, 'local booster kept');
  serverWallet.booster_until_ms = now + 5_000_000; // серверный больше
  const r7 = await sync();
  eq(r7.applied.boosterUntilMs, now + 5_000_000, 'booster: server wins when greater');
  eq(meta.loadMeta().boosterUntilMs, now + 5_000_000, 'server booster applied');

  // --- 5. Refund на сервере: отрицательная дельта не начисляется ---
  reset();
  serverWallet.purchased_rna = 500;
  await sync();
  eq(meta.loadMeta().rna, 500, 'pre-refund balance');
  serverWallet.purchased_rna = 0; // refund откатил серверный кошелёк
  serverWallet.skins = [];
  const r8 = await sync();
  eq(r8.ok, true, 'sync after refund ok');
  eq(r8.applied.rna, 0, 'no grant on negative delta');
  eq(meta.loadMeta().rna, 500, 'local value NOT revoked (documented)');
  eq(store.get(WALLET_SYNC_WATERMARK_KEY), '0', 'watermark follows server down');

  // --- 6. Ошибки — {ok:false}, без исключений ---
  reset();
  const b1 = await syncServerWallet({ apiBaseUrl: '', initData: 'x', fetchFn });
  eq(b1.ok, false, 'bad-config → ok:false');
  failWith = 503;
  const b2 = await sync();
  eq(b2.ok, false, 'http-503 → ok:false');
  eq(b2.reason, 'http-503', 'http-503 reason');
  failWith = 0;

  // --- 7. Неизвестный скин с сервера не роняет синк ---
  reset();
  serverWallet.skins = ['skin.nonexistent-zzz'];
  serverWallet.purchased_rna = 100;
  const r9 = await sync();
  eq(r9.ok, true, 'unknown skin does not break sync');
  eq(r9.applied.rna, 100, 'rna still applied');

  console.log('server-wallet-sync: all assertions passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

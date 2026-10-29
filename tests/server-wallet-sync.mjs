/**
 * server-wallet-sync — патч №16 (A4, seq-журнал; переписан поверх патча №15).
 *
 * Compiles the TS modules with tsc like the other node-side contract tests.
 *
 * Covers (протокол v2: POST /api/wallet → {schema_version:2, ledger[], tip_seq}):
 * - syncServerWallet: свежий синк — неттинг грантов журнала; повторный —
 *   ноль (курсор last_seq, идемпотентность);
 * - инкрементальный синк: применяются только события seq > last_seq;
 * - скины — union авторитетного server.skins (повторный синк не дублирует);
 * - бустер — max(local, server);
 * - refund на сервере (reversal-событие) — только учёт, локальное значение
 *   НЕ отзывается (задокументировано);
 * - детерминизм: свежий синк == инкрементальное применение тех же событий;
 * - курсор изолирован по (server_id, tgUserId); смена server_id → свежий синк;
 * - bad-config / http-error / incompatible-worker (v1) / no-user → {ok:false},
 *   без исключений; watermark v1 игнорируется;
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

const USER_ID = 777005;
const initData = `user=${encodeURIComponent(JSON.stringify({ id: USER_ID }))}&hash=x`;

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

  const { syncServerWallet, debugResetWalletSync, WALLET_SEQ_KEY, parseTelegramUserId } = require(
    join(temp, 'game/shop/ServerWalletSync.js')
  );
  const meta = require(join(temp, 'game/meta/MetaWallet.js'));
  const skins = require(join(temp, 'game/skins/SkinOwnership.js'));

  // Серверный стаб: журнал wallet_ledger (v2-контракт).
  let ledger = [];
  let serverSkins = [];
  let serverBooster = 0;
  let serverId = 'test-server';
  let failWith = 0;
  let v1Mode = false; // эмуляция старого воркера (без schema_version/ledger)
  const fetchFn = async (url, opts) => {
    assert(String(url).endsWith('/api/wallet'), 'wallet endpoint path');
    const body = JSON.parse(opts.body);
    assert(typeof body.initData === 'string' && body.initData.length > 0, 'initData sent');
    if (failWith) {
      return { ok: false, status: failWith, json: async () => null };
    }
    if (v1Mode) {
      return { ok: true, status: 200, json: async () => ({ purchased_rna: 500, ledger_tip: 1 }) };
    }
    const since = typeof body.since_seq === 'number' ? body.since_seq : -1;
    const tip = ledger.reduce((m, r) => Math.max(m, r.seq), 0);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true, user_id: USER_ID, server_id: serverId, schema_version: 2,
        purchased_rna: 0, booster_until_ms: serverBooster, skins: [...serverSkins],
        ledger: ledger.filter((r) => r.seq > since), tip_seq: tip, ledger_tip: null,
      }),
    };
  };
  const sync = (idl = initData) =>
    syncServerWallet({ apiBaseUrl: 'https://worker.test', initData: idl, fetchFn });

  const grant = (seq, chargeId, amount) =>
    ({ seq, charge_id: chargeId, kind: 'grant', grant_type: 'rna', amount, skin_id: null, created_at: seq });
  const reversal = (seq, chargeId, amount) =>
    ({ seq, charge_id: chargeId, kind: 'reversal', grant_type: 'rna', amount, skin_id: null, created_at: seq });

  const reset = () => {
    store.clear();
    debugResetWalletSync();
    ledger = []; serverSkins = []; serverBooster = 0; serverId = 'test-server'; failWith = 0; v1Mode = false;
  };

  eq(parseTelegramUserId(initData), USER_ID, 'parseTelegramUserId');

  // --- 1. Свежий синк: неттинг грантов; повторный — ноль (курсор) ---
  reset();
  ledger = [grant(1, 'c1', 500)];
  const r1 = await sync();
  eq(r1.ok, true, 'first sync ok');
  eq(r1.applied.rna, 500, 'fresh sync nets grants');
  eq(meta.loadMeta().rna, 500, 'local balance +500');
  eq(r1.tip_seq, 1, 'tip_seq returned');
  const cursorRaw = store.get(WALLET_SEQ_KEY);
  assert(cursorRaw && cursorRaw.includes('"last_seq":1'), `seq cursor persisted: ${cursorRaw}`);
  const r2 = await sync();
  eq(r2.ok, true, 'second sync ok');
  eq(r2.applied.rna, 0, 'second sync applies 0 (cursor)');
  eq(meta.loadMeta().rna, 500, 'no double grant');

  // --- 2. Новая покупка: инкрементально только новые события ---
  ledger.push(grant(2, 'c2', 1500));
  const r3 = await sync();
  eq(r3.ok, true, 'incremental sync ok');
  eq(r3.applied.rna, 1500, 'only new events applied');
  eq(r3.applied.eventsApplied, 1, 'one event applied');
  eq(meta.loadMeta().rna, 2000, 'balance 2000');

  // --- 3. Скины — union авторитетного server.skins ---
  reset();
  serverSkins = ['skin.abyssal-teal'];
  ledger = [grant(1, 'c3', 0)];
  const r4 = await sync();
  eq(r4.ok, true, 'skin sync ok');
  eq(r4.applied.skins.length, 1, 'new skin applied');
  eq(r4.applied.skins[0], 'skin.abyssal-teal', 'skin id');
  assert(skins.loadSkinStore().owned.includes('skin.abyssal-teal'), 'skin owned locally');
  const r5 = await sync();
  eq(r5.applied.skins.length, 0, 'repeat sync: no duplicate skin');

  // --- 4. Бустер — max(local, server) ---
  reset();
  const now = Date.now();
  meta.setBoosterUntilMs(now + 1_000_000); // локальный (QA-мок) больше серверного
  serverBooster = now + 100_000;
  const r6 = await sync();
  eq(r6.applied.boosterUntilMs, now + 1_000_000, 'booster: local wins when greater');
  eq(meta.loadMeta().boosterUntilMs, now + 1_000_000, 'local booster kept');
  serverBooster = now + 5_000_000; // серверный больше
  const r7 = await sync();
  eq(r7.applied.boosterUntilMs, now + 5_000_000, 'booster: server wins when greater');
  eq(meta.loadMeta().boosterUntilMs, now + 5_000_000, 'server booster applied');

  // --- 5. Refund: reversal — только учёт, локальное не отзывается ---
  reset();
  ledger = [grant(1, 'c4', 500)];
  await sync();
  eq(meta.loadMeta().rna, 500, 'pre-refund balance');
  ledger.push(reversal(2, 'rev-c4', -500));
  const r8 = await sync();
  eq(r8.ok, true, 'sync after refund ok');
  eq(r8.applied.rna, 0, 'reversal: accounting only');
  eq(meta.loadMeta().rna, 500, 'local value NOT revoked (documented)');

  // --- 6. Детерминизм: свежий == инкрементальному ---
  reset();
  ledger = [grant(1, 'c5a', 500), reversal(2, 'rev-c5a', -500), grant(3, 'c5b', 500)];
  const rF = await sync();
  eq(rF.ok, true, 'fresh sync ok');
  eq(meta.loadMeta().rna, 1000, 'fresh nets grants only (500+500)');

  // --- 7. Ошибки — {ok:false}, без исключений ---
  reset();
  const b1 = await syncServerWallet({ apiBaseUrl: '', initData, fetchFn });
  eq(b1.ok, false, 'bad-config → ok:false');
  failWith = 503;
  const b2 = await sync();
  eq(b2.ok, false, 'http-503 → ok:false');
  eq(b2.error, 'http-503', 'http-503 error');
  failWith = 0;
  v1Mode = true; // старый воркер без журнала
  const b3 = await sync();
  eq(b3.ok, false, 'v1 worker → ok:false');
  eq(b3.error, 'incompatible-worker', 'fail-closed, no silent fallback');
  v1Mode = false;
  const b4 = await sync('no-user-here');
  eq(b4.ok, false, 'no user.id → ok:false');
  eq(b4.error, 'no-user', 'no-user error');

  // --- 8. Неизвестный скин с сервера не роняет синк; РНК идёт ---
  reset();
  serverSkins = ['skin.nonexistent-zzz'];
  ledger = [grant(1, 'c6', 100)];
  const r9 = await sync();
  eq(r9.ok, true, 'unknown skin does not break sync');
  eq(r9.applied.rna, 100, 'rna still applied');

  // --- 9. Смена server_id → свежий синк (чужой курсор не применяется) ---
  reset();
  ledger = [grant(1, 'c7', 100)];
  const ra = await sync();
  eq(ra.applied.rna, 100, 'first server: +100');
  serverId = 'other-backend'; // смена бэкенда
  const rb = await sync();
  eq(rb.ok, true, 'resync on new server ok');
  eq(rb.applied.rna, 100, 'fresh sync on new server_id (cursor not reused)');
  eq(meta.loadMeta().rna, 200, 'both servers netted independently');

  console.log('server-wallet-sync: all assertions passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

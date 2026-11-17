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
 * - CR-R3-6/7/8: бустер — серверный срок покупки + банк заработанного
 *   (миссионного) времени: возврат истёкшей покупки не съедает живую
 *   награду, покупка складывается с миссионным временем (3+7=10),
 *   повторный синк идемпотентен, устаревший ответ не воскрешает
 *   отозванный бустер, истёкший банк не продлевает позднюю покупку;
 * - CR-R4-1 (review 5944088831): elapsed-aware банк — покупка через
 *   день после миссии получает только неизрасходованный остаток
 *   (миссия 3д в T + покупка 7д в T+1д = T+10д, а не T+11д);
 *   остаток и якорь персистятся, повторный синк идемпотентен;
 * - сезонный пропуск — max(local, server) (монетизация v3); события
 *   season_pass в журнале санитизируются и не неттятся по РНК;
 * - P1-5: reversal пропуска в применённом батче делает серверное значение
 *   авторитетным (local := server): возврат отзывает пропуск локально
 *   (инкрементально и на свежем синке); без reversal — max(), как раньше;
 *   устаревший ответ (tip_seq <= курсора) локальное значение не трогает
 *   и курсор назад не двигает;
 * - refund на сервере (reversal-событие РНК) — только учёт, локальное значение
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
      // P1-5 §(е): связь синка с сезонными миссиями (гейт paid-трека).
      'src/game/shop/seasonQuests.ts',
      'src/game/lab/LabState.ts',
      'src/game/lab/LabBranches.ts',
      'src/game/lab/LabModifiers.ts',
      'src/game/FeatureFlags.ts',
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
  const season = require(join(temp, 'game/shop/seasonQuests.js'));

  // Серверный стаб: журнал wallet_ledger (v2-контракт).
  let ledger = [];
  let serverSkins = [];
  let serverBooster = 0;
  let serverPass = 0; // монетизация v3: season_pass_until_ms
  let serverId = 'test-server';
  let failWith = 0;
  let v1Mode = false; // эмуляция старого воркера (без schema_version/ledger)
  let walletCalls = 0; // P3-10: счётчик запросов /api/wallet (пагинация)
  const fetchFn = async (url, opts) => {
    assert(String(url).endsWith('/api/wallet'), 'wallet endpoint path');
    const body = JSON.parse(opts.body);
    assert(typeof body.initData === 'string' && body.initData.length > 0, 'initData sent');
    walletCalls += 1;
    if (failWith) {
      return { ok: false, status: failWith, json: async () => null };
    }
    if (v1Mode) {
      return { ok: true, status: 200, json: async () => ({ purchased_rna: 500, ledger_tip: 1 }) };
    }
    const since = typeof body.since_seq === 'number' ? body.since_seq : -1;
    const tip = ledger.reduce((m, r) => Math.max(m, r.seq), 0);
    // P3-10: эмуляция воркера — страница максимум 5000 событий +
    // truncated:true (LIMIT 5001 на сервере).
    const page = ledger.filter((r) => r.seq > since);
    const truncated = page.length > 5000;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true, user_id: USER_ID, server_id: serverId, schema_version: 2,
        purchased_rna: 0, booster_until_ms: serverBooster, season_pass_until_ms: serverPass,
        skins: [...serverSkins],
        ledger: page.slice(0, 5000), tip_seq: tip, ledger_tip: null, truncated,
      }),
    };
  };
  const sync = (idl = initData) =>
    syncServerWallet({ apiBaseUrl: 'https://worker.test', initData: idl, fetchFn });

  const grant = (seq, chargeId, amount) =>
    ({ seq, charge_id: chargeId, kind: 'grant', grant_type: 'rna', amount, skin_id: null, created_at: seq });
  const reversal = (seq, chargeId, amount) =>
    ({ seq, charge_id: chargeId, kind: 'reversal', grant_type: 'rna', amount, skin_id: null, created_at: seq });
  // P1-5: события пропуска. Длительность — 30 дней в мс (как триггер воркера).
  const PASS_MS = 30 * 24 * 3600 * 1000;
  const passGrant = (seq, chargeId) =>
    ({ seq, charge_id: chargeId, kind: 'grant', grant_type: 'season_pass', amount: PASS_MS, skin_id: null, created_at: seq });
  const passReversal = (seq, chargeId, reverses) =>
    ({ seq, charge_id: chargeId, kind: 'reversal', grant_type: 'season_pass', amount: -PASS_MS, skin_id: null, reverses_charge_id: reverses, created_at: seq });
  // P2-N3: события бустера. Длительность — 7 дней в мс (как триггер воркера).
  const DAY_MS = 24 * 3600 * 1000;
  const BOOSTER_7D = 7 * DAY_MS;
  const boosterGrant = (seq, chargeId, ms = BOOSTER_7D) =>
    ({ seq, charge_id: chargeId, kind: 'grant', grant_type: 'booster', amount: ms, skin_id: null, created_at: seq });
  const boosterReversal = (seq, chargeId, reverses, ms = BOOSTER_7D) =>
    ({ seq, charge_id: chargeId, kind: 'reversal', grant_type: 'booster', amount: -ms, skin_id: null, reverses_charge_id: reverses, created_at: seq });

  const reset = () => {
    store.clear();
    debugResetWalletSync();
    season.debugResetSeasonQuests();
    ledger = []; serverSkins = []; serverBooster = 0; serverPass = 0; serverId = 'test-server'; failWith = 0; v1Mode = false;
    walletCalls = 0;
  };

  // CR-R4-1: elapsed-aware банк делает точные ожидания чувствительными
  // к реальному времени (миллисекунды между claim и синком — уже
  // израсходованное время). Бустерные секции 4a–4g идут с замороженным
  // Date.now, чтобы ожидания оставались точными и детерминированными;
  // restore — после §4g. На старом коде заморозка нейтральна (там
  // Date.now влияет только на сравнения anchor/liveness с тем же b0).
  const realDateNow = Date.now;
  const freezeNow = (ms) => { Date.now = () => ms; };
  const restoreNow = () => { Date.now = realDateNow; };

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

  // --- 4a. P2-N3: бустер — неттинг reversal (возврат отзывает срок) ---
  // Серверный снапшот serverBooster — как после триггера воркера:
  // grant — max(cur, created_at)+amount; reversal — max(created_at, cur+amount).
  const b0 = Date.now();
  freezeNow(b0); // CR-R4-1: замороженное время для §4a–§4g; restore — после §4g.
  // (i) покупка → синк → возврат → синк → бустер отозван.
  reset();
  ledger = [boosterGrant(1, 'cb1')];
  serverBooster = b0 + BOOSTER_7D;
  const rb1 = await sync();
  eq(rb1.ok, true, 'N3: grant sync ok');
  eq(meta.loadMeta().boosterUntilMs, b0 + BOOSTER_7D, 'N3: booster granted by sync');
  ledger.push(boosterReversal(2, 'rev:op1', 'cb1'));
  serverBooster = b0; // триггер: max(created_at, cur - 7d)
  const rb2 = await sync();
  eq(rb2.ok, true, 'N3: refund sync ok');
  eq(rb2.applied.boosterUntilMs, b0, 'N3: applied booster revoked');
  eq(meta.loadMeta().boosterUntilMs, b0, 'N3: refund revokes booster (was: max kept +7d)');
  // (ii) повторный синк — без двойного вычитания.
  const rb3 = await sync();
  eq(meta.loadMeta().boosterUntilMs, b0, 'N3: repeat sync stable');
  // (iii) миссионный бустер + возврат серверного → миссионный сохранён.
  reset();
  ledger = [boosterGrant(1, 'cb1')];
  serverBooster = b0 + BOOSTER_7D;
  await sync();
  // season.mutations-50 — paid-трек: claim требует активного пропуска.
  meta.setSeasonPassUntilMs(b0 + 30 * DAY_MS);
  season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, b0);
  const mc = season.claimSeasonMission('season.mutations-50', b0);
  eq(mc.ok, true, 'N3: mission claim ok');
  eq(mc.grantedBoosterDays, 3, 'N3: mission grants 3d');
  eq(meta.loadMeta().boosterUntilMs, b0 + BOOSTER_7D + 3 * DAY_MS, 'N3: local = purchase + mission');
  ledger.push(boosterReversal(2, 'rev:op1', 'cb1'));
  serverBooster = b0;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + 3 * DAY_MS, 'N3: mission booster preserved after server refund');
  // (iv) продление покупкой после возврата. CR-R3-7: миссионные 3 дня
  // СКЛАДЫВАЮТСЯ с новой покупкой (было: покупка заменяла награду).
  ledger.push(boosterGrant(3, 'cb2'));
  serverBooster = b0 + BOOSTER_7D;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + BOOSTER_7D + 3 * DAY_MS, 'N3: repurchase adds to preserved mission time');
  // (v) свежий синк с возвратом в истории — серверное значение, без ухода в прошлое.
  reset();
  ledger = [boosterGrant(1, 'cb1'), boosterReversal(2, 'rev:op1', 'cb1')];
  serverBooster = b0;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0, 'N3: fresh sync with refund in history = server value');
  // (vi) грант + reversal в одном батче (rebuy): миссионное время не теряется.
  reset();
  ledger = [boosterGrant(1, 'cb1')];
  serverBooster = b0 + BOOSTER_7D;
  await sync();
  meta.setSeasonPassUntilMs(b0 + 30 * DAY_MS); // paid-трек миссии
  season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, b0);
  season.claimSeasonMission('season.mutations-50', b0);
  eq(meta.loadMeta().boosterUntilMs, b0 + BOOSTER_7D + 3 * DAY_MS, 'N3: local before rebuy batch');
  ledger.push(boosterReversal(2, 'rev:op1', 'cb1'), boosterGrant(3, 'cb2'));
  serverBooster = b0 + BOOSTER_7D; // -7d + 7d
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + BOOSTER_7D + 3 * DAY_MS, 'N3: rebuy batch preserves mission time');

  // --- 4c. CR-R3-6: возврат ИСТЁКШЕЙ покупки не съедает миссионную награду ---
  // Покупка 1 день в b0, синк; миссия 3 дня в b0+2d (покупка уже истекла,
  // local = b0+5d); возврат покупки (серверный пол — момент возврата b0+2d)
  // не должен срезать непросроченную награду.
  reset();
  ledger = [boosterGrant(1, 'cb6', DAY_MS)];
  serverBooster = b0 + DAY_MS;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + DAY_MS, 'R3-6: 1d purchase applied');
  meta.setSeasonPassUntilMs(b0 + 30 * DAY_MS);
  const claimAt6 = b0 + 2 * DAY_MS;
  season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, claimAt6);
  const mc6 = season.claimSeasonMission('season.mutations-50', claimAt6);
  eq(mc6.ok, true, 'R3-6: mission claim ok');
  eq(meta.loadMeta().boosterUntilMs, b0 + 5 * DAY_MS, 'R3-6: local = refund-time + 3d mission');
  ledger.push(boosterReversal(2, 'rev:op6', 'cb6', DAY_MS));
  serverBooster = claimAt6; // триггер: max(created_at, cur - 1d)
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + 5 * DAY_MS, 'R3-6: refund of expired purchase keeps mission reward');

  // --- 4d. CR-R3-7: миссия + покупка СКЛАДЫВАЮТСЯ (3 + 7 = 10), повторный синк идемпотентен ---
  reset();
  meta.setSeasonPassUntilMs(b0 + 30 * DAY_MS);
  season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, b0);
  const mc7 = season.claimSeasonMission('season.mutations-50', b0);
  eq(mc7.ok, true, 'R3-7: mission claim ok');
  eq(meta.loadMeta().boosterUntilMs, b0 + 3 * DAY_MS, 'R3-7: local = 3d mission');
  ledger = [boosterGrant(1, 'cb7')];
  serverBooster = b0 + BOOSTER_7D;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + 10 * DAY_MS, 'R3-7: purchase adds to mission time (3+7=10)');
  const r7b = await sync();
  eq(r7b.ok, true, 'R3-7: repeat sync ok');
  eq(meta.loadMeta().boosterUntilMs, b0 + 10 * DAY_MS, 'R3-7: repeat sync idempotent (no double-add)');

  // --- 4e. CR-R3-8: устаревший ответ не воскрешает отозванный бустер ---
  reset();
  ledger = [boosterGrant(1, 'cb8')];
  serverBooster = b0 + BOOSTER_7D;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + BOOSTER_7D, 'R3-8: booster granted');
  ledger.push(boosterReversal(2, 'rev:op8', 'cb8'));
  serverBooster = b0;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0, 'R3-8: booster revoked after refund');
  // Сервер «откатился»: tip 1 < курсора 2, снапшот — старое высокое значение.
  ledger = [boosterGrant(1, 'cb8')];
  serverBooster = b0 + BOOSTER_7D;
  const r8e = await sync();
  eq(r8e.ok, true, 'R3-8: stale response still ok');
  eq(meta.loadMeta().boosterUntilMs, b0, 'R3-8: stale response does not resurrect booster');

  // --- 4f. CR-R3-6/7: истёкший банк не продлевает позднюю покупку ---
  // Миссия забрана, затем бустер истёк (local в прошлом); покупка через
  // долгое время не получает +3d от мёртвой награды. На старом коде
  // зелёный (там банка нет) — гард правила живости нового банка.
  reset();
  meta.setSeasonPassUntilMs(b0 + 30 * DAY_MS);
  season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, b0);
  season.claimSeasonMission('season.mutations-50', b0);
  eq(meta.loadMeta().boosterUntilMs, b0 + 3 * DAY_MS, 'R3-6f: mission booster granted');
  // Время прошло: local истёк (симуляция сдвигом local в прошлое).
  meta.setBoosterUntilMs(b0 - 1000);
  ledger = [boosterGrant(1, 'cb6f')];
  serverBooster = b0 + BOOSTER_7D;
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + BOOSTER_7D, 'R3-6f: lapsed mission bank does not extend purchase');

  // --- 4g. CR-R4-1: elapsed-aware банк — миссия 3д в T + покупка 7д
  // в T+1д = T+10д (не T+11д): день миссии к моменту покупки уже прожит.
  // На старом коде (банк — полная длительность) — T+11д.
  reset();
  freezeNow(b0); // T
  meta.setSeasonPassUntilMs(b0 + 30 * DAY_MS);
  season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, b0);
  const mcR4 = season.claimSeasonMission('season.mutations-50', b0);
  eq(mcR4.ok, true, 'R4-1: mission claim ok');
  eq(meta.loadMeta().boosterUntilMs, b0 + 3 * DAY_MS, 'R4-1: local = 3d mission');
  eq(meta.getBoosterEarnedMs(), 3 * DAY_MS, 'R4-1: bank is full 3d at claim');
  // Покупка 7 дней днём позже; серверный срок — от момента покупки.
  freezeNow(b0 + DAY_MS); // T+1d
  ledger = [boosterGrant(1, 'cbR4')];
  serverBooster = b0 + DAY_MS + BOOSTER_7D; // T+8d
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + 10 * DAY_MS, 'R4-1: purchase a day later adds only remaining 2d (T+10, not T+11)');
  // Остаток и якорь персистятся: повторный синк ничего не добавляет.
  eq(meta.getBoosterEarnedMs(), 2 * DAY_MS, 'R4-1: remaining 2d persisted');
  eq(meta.getBoosterEarnedAnchorMs(), b0 + 8 * DAY_MS, 'R4-1: anchor rebased to purchase term end');
  const rR4b = await sync();
  eq(rR4b.ok, true, 'R4-1: repeat sync ok');
  eq(meta.loadMeta().boosterUntilMs, b0 + 10 * DAY_MS, 'R4-1: repeat sync idempotent (still T+10)');
  eq(meta.getBoosterEarnedMs(), 2 * DAY_MS, 'R4-1: bank unchanged by repeat sync');
  // Время идёт: в T+9д от остатка остался 1 день; новая покупка 7д
  // получает только его (T+16д + 1д = T+17д).
  freezeNow(b0 + 9 * DAY_MS); // T+9d
  ledger.push(boosterGrant(2, 'cbR4b'));
  serverBooster = b0 + 9 * DAY_MS + BOOSTER_7D; // T+16d
  await sync();
  eq(meta.loadMeta().boosterUntilMs, b0 + 17 * DAY_MS, 'R4-1: later purchase adds only 1d remaining (T+17)');
  eq(meta.getBoosterEarnedMs(), 1 * DAY_MS, 'R4-1: remaining 1d persisted after second purchase');
  restoreNow(); // конец замороженного времени (§4a–§4g)

  // --- 4b. Сезонный пропуск — max(local, server) (монетизация v3) ---
  reset();
  const nowP = Date.now();
  meta.setSeasonPassUntilMs(nowP + 2_000_000); // локальный больше серверного
  serverPass = nowP + 100_000;
  const rp1 = await sync();
  eq(rp1.applied.seasonPassUntilMs, nowP + 2_000_000, 'pass: local wins when greater');
  eq(meta.loadMeta().seasonPassUntilMs, nowP + 2_000_000, 'local pass kept');
  // Серверный срок растёт ТОЛЬКО через событие журнала (триггер воркера
  // пишет season_pass_until_ms лишь на вставку в ledger): голый рост
  // значения без события — невозможный ответ, синк его игнорирует (P1-5 §в).
  ledger = [passGrant(1, 'cp-4b')];
  serverPass = nowP + 6_000_000; // серверный больше
  const rp2 = await sync();
  eq(rp2.applied.seasonPassUntilMs, nowP + 6_000_000, 'pass: server wins when greater');
  eq(meta.loadMeta().seasonPassUntilMs, nowP + 6_000_000, 'server pass applied');
  // Событие season_pass в журнале санитизируется и не влияет на РНК.
  reset();
  ledger = [{ seq: 1, charge_id: 'cp1', kind: 'grant', grant_type: 'season_pass', amount: 2592000000, skin_id: null, created_at: 1 }];
  serverPass = nowP + 6_000_000;
  const rp3 = await sync();
  eq(rp3.ok, true, 'season_pass event sync ok');
  eq(rp3.applied.rna, 0, 'season_pass event does not net RNA');
  eq(rp3.applied.seasonPassUntilMs, nowP + 6_000_000, 'pass applied from wallet state');

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

  // --- 10. P1-5: покупка → синк → возврат → синк → пропуск неактивен ---
  reset();
  const base10 = Date.now();
  const until10 = base10 + PASS_MS;
  const refundAt10 = base10 - 1000; // триггер: откат к моменту возврата
  meta.setSeasonPassUntilMs(until10); // локальный грант при покупке
  ledger = [passGrant(1, 'cp10')];
  serverPass = until10;
  const r10a = await sync();
  eq(r10a.ok, true, 'pass purchase sync ok');
  eq(meta.isSeasonPassActive(), true, 'pass active after purchase sync');
  ledger.push(passReversal(2, 'rev:op10:season_pass:', 'cp10'));
  serverPass = refundAt10;
  const r10b = await sync();
  eq(r10b.ok, true, 'sync after pass refund ok');
  eq(r10b.applied.seasonPassUntilMs, refundAt10, 'reversal: server value is authoritative');
  eq(meta.loadMeta().seasonPassUntilMs, refundAt10, 'local pass revoked after refund');
  eq(meta.isSeasonPassActive(), false, 'pass inactive after refund sync');

  // --- 11. P1-5: возврат ДО первого синка — синк не «воскрешает» пропуск ---
  reset();
  const base11 = Date.now();
  const refundAt11 = base11 - 1000;
  // (a) локальный грант при покупке есть, синка ещё не было.
  meta.setSeasonPassUntilMs(base11 + PASS_MS);
  ledger = [passGrant(1, 'cp11'), passReversal(2, 'rev:op11:season_pass:', 'cp11')];
  serverPass = refundAt11;
  const r11a = await sync();
  eq(r11a.ok, true, 'fresh sync with grant+reversal ok');
  eq(meta.loadMeta().seasonPassUntilMs, refundAt11, 'fresh sync revokes locally granted pass');
  eq(meta.isSeasonPassActive(), false, 'pass inactive after fresh sync with reversal');
  // (b) чистое устройство: локально пропуска не было — синк его не создаёт.
  reset();
  ledger = [passGrant(1, 'cp11b'), passReversal(2, 'rev:op11b:season_pass:', 'cp11b')];
  serverPass = refundAt11;
  const r11b = await sync();
  eq(r11b.ok, true, 'fresh-device sync ok');
  eq(meta.isSeasonPassActive(), false, 'refunded pass not resurrected on fresh device');

  // --- 12. P1-5: повторный синк после отзыва — идемпотентность ---
  const r12 = await sync();
  eq(r12.ok, true, 'repeat sync after revocation ok');
  eq(meta.loadMeta().seasonPassUntilMs, refundAt11, 'repeat sync keeps revoked value');
  eq(meta.isSeasonPassActive(), false, 'pass stays inactive');

  // --- 13. P1-5: восстановление на новом устройстве — корректный срок ---
  reset();
  const base13 = Date.now();
  ledger = [passGrant(1, 'cp13')];
  serverPass = base13 + PASS_MS;
  const r13 = await sync();
  eq(r13.ok, true, 'new-device sync ok');
  eq(meta.loadMeta().seasonPassUntilMs, base13 + PASS_MS, 'new device restores server term');
  eq(meta.isSeasonPassActive(), true, 'restored pass active');

  // --- 14. P1-5: сетевой сбой — локальная подписка не сокращается ---
  failWith = 503;
  const r14 = await sync();
  eq(r14.ok, false, 'network failure → ok:false');
  eq(meta.loadMeta().seasonPassUntilMs, base13 + PASS_MS, 'network failure keeps local pass');
  eq(meta.isSeasonPassActive(), true, 'pass still active after failed sync');
  failWith = 0;

  // --- 15. P1-5: продление (+30д) — локальное значение растёт ---
  ledger.push(passGrant(2, 'cp13-renew'));
  serverPass = base13 + 2 * PASS_MS;
  const r15 = await sync();
  eq(r15.ok, true, 'renewal sync ok');
  eq(meta.loadMeta().seasonPassUntilMs, base13 + 2 * PASS_MS, 'renewal extends local pass');
  eq(meta.isSeasonPassActive(), true, 'renewed pass active');

  // --- 16. P1-5: повторная покупка после истечения срока ---
  reset();
  const base16 = Date.now();
  await sync(); // пустой свежий синк: курсор 0
  meta.setSeasonPassUntilMs(base16 - 5000); // старый пропуск истёк
  ledger = [passGrant(1, 'cp16')];
  serverPass = base16 + PASS_MS;
  const r16 = await sync();
  eq(r16.ok, true, 'repurchase sync ok');
  eq(meta.loadMeta().seasonPassUntilMs, base16 + PASS_MS, 'repurchase sets new term');
  eq(meta.isSeasonPassActive(), true, 'repurchased pass active');

  // --- 17. P1-5 §(в): устаревший ответ — локальное не трогается, курсор не пятится ---
  reset();
  const base17 = Date.now();
  const refundAt17 = base17 - 1000;
  ledger = [grant(1, 'cr17a', 500), passGrant(2, 'cp17')];
  serverPass = base17 + PASS_MS;
  await sync();
  eq(meta.loadMeta().rna, 500, 'pre-rewind balance');
  eq(meta.isSeasonPassActive(), true, 'pre-rewind pass active');
  ledger.push(passReversal(3, 'rev:op17:season_pass:', 'cp17'));
  serverPass = refundAt17;
  await sync();
  eq(meta.isSeasonPassActive(), false, 'pass revoked before rewind');
  // Сервер «откатился» (снапшот/реплика): tip_seq 2 < курсора 3,
  // а season_pass_until_ms — старое высокое значение.
  ledger = [grant(1, 'cr17a', 500), passGrant(2, 'cp17')];
  serverPass = base17 + PASS_MS;
  const r17a = await sync();
  eq(r17a.ok, true, 'stale response still ok');
  eq(meta.loadMeta().seasonPassUntilMs, refundAt17, 'stale response does not resurrect pass');
  eq(meta.isSeasonPassActive(), false, 'pass stays inactive after stale response');
  const cursorRaw17 = store.get(WALLET_SEQ_KEY);
  assert(cursorRaw17 && cursorRaw17.includes('"last_seq":3'), `cursor not rewound: ${cursorRaw17}`);
  // Живой сервер вернулся: уже применённые события не применяются повторно.
  ledger = [grant(1, 'cr17a', 500), passGrant(2, 'cp17'), passReversal(3, 'rev:op17:season_pass:', 'cp17')];
  serverPass = refundAt17;
  const r17b = await sync();
  eq(r17b.ok, true, 'post-rewind sync ok');
  eq(meta.loadMeta().rna, 500, 'no double RNA after rewind');
  eq(meta.isSeasonPassActive(), false, 'pass stays inactive after post-rewind sync');

  // --- 17b. P1-5 §(в): откат курсора не даёт двойного начисления РНК ---
  reset();
  ledger = [grant(1, 'cr17x', 500), grant(2, 'cr17y', 300)];
  const r17x = await sync();
  eq(r17x.applied.rna, 800, 'two grants applied');
  ledger = [grant(1, 'cr17x', 500)]; // устаревший ответ: tip 1 < курсора 2
  await sync();
  ledger = [grant(1, 'cr17x', 500), grant(2, 'cr17y', 300)]; // живой сервер вернулся
  const r17y = await sync();
  eq(r17y.applied.rna, 0, 'no re-application after stale response');
  eq(meta.loadMeta().rna, 800, 'balance unchanged after stale response');

  // --- 18. P1-5 §(е): после отзыва claim paid-миссий недоступен, прогресс цел ---
  reset();
  const base18 = Date.now();
  const until18 = base18 + PASS_MS;
  meta.setSeasonPassUntilMs(until18);
  ledger = [passGrant(1, 'cp18')];
  serverPass = until18;
  await sync();
  season.recordSeasonRun({ kills: 2000, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, base18);
  const claimPaid1 = season.claimSeasonMission('season.kills-2000', base18);
  eq(claimPaid1.ok, true, 'paid claim works while pass active');
  // Возврат пропуска → синк → отзыв.
  ledger.push(passReversal(2, 'rev:op18:season_pass:', 'cp18'));
  serverPass = base18 - 1000;
  await sync();
  eq(meta.isSeasonPassActive(base18), false, 'pass revoked before season claim check');
  const claimPaid2 = season.claimSeasonMission('season.mutations-50', base18);
  eq(claimPaid2.ok, false, 'paid claim blocked after revocation');
  eq(claimPaid2.reason, 'pass-required', 'paid claim reason is pass-required');
  const st18 = season.loadSeasonState(base18);
  eq(st18.progress.mutations, 50, 'paid progress NOT wiped by revocation');
  eq(st18.progress.kills, 2000, 'claimed mission progress kept');
  assert(st18.claimed.includes('season.kills-2000'), 'earlier claim stays claimed');

  // --- 19. P3-10: журнал >5000 строк — пагинация, reversal не теряется ---
  reset();
  const base19 = Date.now();
  const until19 = base19 + PASS_MS;
  // Локальный пропуск активен (выдан ранее); сервер его уже отозвал,
  // но reversal — на 5001-й строке журнала (за LIMIT 5000).
  meta.setSeasonPassUntilMs(until19);
  const bulk = [passGrant(1, 'cp19')];
  for (let i = 2; i <= 5000; i++) bulk.push(grant(i, `bulk19-${i}`, 1));
  bulk.push(passReversal(5001, 'rev:op19:season_pass:', 'cp19'));
  ledger = bulk;
  serverPass = base19 - 1000; // отозван
  const r19 = await sync();
  eq(r19.ok, true, 'P3-10: paginated sync ok');
  eq(walletCalls, 2, 'P3-10: two pages fetched');
  eq(r19.applied.eventsApplied, 5001, 'P3-10: all 5001 events applied');
  eq(r19.applied.rna, 4999, 'P3-10: all bulk RNA grants netted');
  eq(meta.loadMeta().seasonPassUntilMs, base19 - 1000, 'P3-10: pass reversal not missed (was: resurrected via max)');
  eq(meta.isSeasonPassActive(base19), false, 'P3-10: revoked pass inactive');
  const cursorRaw19 = store.get(WALLET_SEQ_KEY);
  assert(cursorRaw19 && cursorRaw19.includes('"last_seq":5001'), `P3-10: cursor at tip: ${cursorRaw19}`);
  // Повторный синк: 0 событий, 1 запрос (курсор на tip).
  walletCalls = 0;
  const r19b = await sync();
  eq(r19b.ok, true, 'P3-10: repeat sync ok');
  eq(r19b.applied.eventsApplied, 0, 'P3-10: repeat sync applies nothing');
  eq(walletCalls, 1, 'P3-10: repeat sync is one request');

  // --- 20. CR-R3-9: два конкурентных синка не начисляют РНК дважды ---
  // (a) Оба стартуют с курсором 0; первый применяет грант, второй
  // должен перечитать свежий курсор перед применением и ничего не начислить.
  reset();
  ledger = [grant(1, 'cr9', 500)];
  const gates = [];
  const gatedFetch = async (url, opts) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    gates.push(release);
    await gate;
    return fetchFn(url, opts);
  };
  const syncGated = () =>
    syncServerWallet({ apiBaseUrl: 'https://worker.test', initData, fetchFn: gatedFetch });
  const pA = syncGated();
  const pB = syncGated();
  // Дать обоим дойти до fetch (оба прочитали курсор 0 до сети).
  await new Promise((r) => setTimeout(r, 0));
  eq(gates.length, 2, 'R3-9: both syncs reached the network');
  // Первый применяет, второй — после него.
  gates[0]();
  const r9a = await pA;
  eq(r9a.ok, true, 'R3-9: first sync ok');
  eq(r9a.applied.rna, 500, 'R3-9: first sync applies grant');
  eq(meta.loadMeta().rna, 500, 'R3-9: balance +500 after first');
  gates[1]();
  const r9b = await pB;
  eq(r9b.ok, true, 'R3-9: second sync ok');
  eq(r9b.applied.rna, 0, 'R3-9: second sync applies nothing (fresh cursor)');
  eq(meta.loadMeta().rna, 500, 'R3-9: no double RNA from concurrent syncs');
  const cursorRaw9 = store.get(WALLET_SEQ_KEY);
  assert(cursorRaw9 && cursorRaw9.includes('"last_seq":1'), `R3-9: cursor at tip: ${cursorRaw9}`);

  // (b) Устаревший ответ второго синка не откатывает курсор.
  // B стартовал раньше с курсором 0 и вернулся с ответом tip 1, когда
  // A уже применил события 1..3 (курсор 3): B ничего не применяет,
  // курсор остаётся 3.
  reset();
  ledger = [grant(1, 'cr9a', 100)];
  let releaseB;
  const fetchB = async (url, opts) => {
    await new Promise((resolve) => { releaseB = resolve; });
    return { ok: true, status: 200, json: async () => ({
      ok: true, user_id: USER_ID, server_id: serverId, schema_version: 2,
      purchased_rna: 0, booster_until_ms: 0, season_pass_until_ms: 0,
      skins: [], ledger: [grant(1, 'cr9a', 100)], tip_seq: 1, ledger_tip: null, truncated: false,
    }) };
  };
  const pB9 = syncServerWallet({ apiBaseUrl: 'https://worker.test', initData, fetchFn: fetchB });
  await new Promise((r) => setTimeout(r, 0));
  // Тем временем A применяет полную историю (курсор 3).
  ledger = [grant(1, 'cr9a', 100), grant(2, 'cr9b', 100), grant(3, 'cr9c', 100)];
  const r9c = await sync();
  eq(r9c.applied.rna, 300, 'R3-9b: first sync applies 3 grants');
  eq(meta.loadMeta().rna, 300, 'R3-9b: balance 300');
  releaseB();
  const r9d = await pB9;
  eq(r9d.ok, true, 'R3-9b: stale concurrent sync ok');
  eq(r9d.applied.rna, 0, 'R3-9b: stale sync applies nothing');
  eq(meta.loadMeta().rna, 300, 'R3-9b: no double RNA from stale response');
  const cursorRaw9b = store.get(WALLET_SEQ_KEY);
  assert(cursorRaw9b && cursorRaw9b.includes('"last_seq":3'), `R3-9b: cursor not rewound: ${cursorRaw9b}`);

  console.log('server-wallet-sync: all assertions passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

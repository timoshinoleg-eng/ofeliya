/**
 * season-quests — монетизация v3 (сезонные миссии, src/quests/seasonQuests.ts).
 *
 * Covers:
 * - seasonIdFor: календарный месяц UTC (границы месяца);
 * - recordSeasonRun: аккумуляция метрик за сезон (забеги/убийства/РНК/
 *   боссы/мутации), игнор невалидных входов;
 * - snapshot: прогресс, complete/claimed/claimable; paid-миссии копят
 *   прогресс без пропуска, но claim требует пропуска;
 * - claim: free — грант РНК (grantMetaRna, без бустера = номинал);
 *   paid без пропуска — pass-required; с пропуском — грант;
 *   повторный claim — already-claimed; незавершённая — not-complete;
 *   неизвестный id — unknown;
 * - бустер-награда: +3 дня от max(now, текущий срок);
 * - смена сезона: прогресс и claimed сгорают;
 * - claimAll: забирает все доступные;
 * - битый JSON в хранилище — чистое состояние, без исключений.
 *
 * Compiles the TS modules with tsc like the other node-side contract tests.
 * In-memory localStorage ставится ДО require модулей.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-season-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`season-quests: ${message}`);
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

const NOV = Date.UTC(2026, 10, 17, 12, 0, 0); // 17 ноября 2026
const DEC = Date.UTC(2026, 11, 1, 0, 0, 0); // 1 декабря 2026
const DAY_MS = 86_400_000;

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/quests/seasonQuests.ts',
      'src/game/meta/MetaWallet.ts',
      'src/game/lab/LabState.ts',
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

  const season = require(join(temp, 'quests', 'seasonQuests.js'));
  const meta = require(join(temp, 'game', 'meta', 'MetaWallet.js'));

  const reset = () => {
    store.clear();
    season.debugResetSeasonQuests();
    meta.setBoosterUntilMs(0);
    meta.setSeasonPassUntilMs(0);
  };
  const snap = (now = NOV) => season.seasonSnapshot(now);
  const byId = (list, id) => list.find((p) => p.def.id === id);

  // --- seasonIdFor / displayName ---
  eq(season.seasonIdFor(NOV), '2026-11', 'seasonId November');
  eq(season.seasonIdFor(Date.UTC(2026, 10, 30, 23, 59, 59)), '2026-11', 'seasonId last second of Nov');
  eq(season.seasonIdFor(DEC), '2026-12', 'seasonId December');
  eq(season.seasonDisplayName('2026-11'), 'Ноябрь 2026', 'display name November');
  eq(season.seasonDisplayName('bogus'), 'bogus', 'display name falls back to raw id');

  // --- каталог v1 ---
  eq(season.SEASON_MISSIONS.length, 6, 'six missions in v1');
  eq(season.SEASON_MISSIONS.filter((m) => m.track === 'free').length, 4, 'four free missions');
  eq(season.SEASON_MISSIONS.filter((m) => m.track === 'paid').length, 2, 'two paid missions');

  // --- свежий снапшот ---
  reset();
  let s = snap();
  eq(s.length, 6, 'snapshot has 6 missions');
  assert(s.every((p) => p.progress === 0 && !p.complete && !p.claimed && !p.claimable), 'fresh snapshot is empty');

  // --- аккумуляция ---
  season.recordSeasonRun({ kills: 100, rnaCollected: 1000, bossesDefeated: 1, mutations: 5 }, NOV);
  season.recordSeasonRun({ kills: 50, rnaCollected: 500, bossesDefeated: 0, mutations: 2 }, NOV);
  s = snap();
  eq(byId(s, 'season.runs-10').progress, 2, 'runs accumulate');
  eq(byId(s, 'season.kills-500').progress, 150, 'kills accumulate');
  eq(byId(s, 'season.rna-5000').progress, 1500, 'rna accumulates');
  eq(byId(s, 'season.bosses-3').progress, 1, 'bosses accumulate');
  eq(byId(s, 'season.mutations-50').progress, 7, 'mutations accumulate');

  // --- невалидные входы игнорируются ---
  season.recordSeasonRun({ kills: -5, rnaCollected: NaN, bossesDefeated: -1, mutations: Infinity }, NOV);
  s = snap();
  eq(byId(s, 'season.kills-500').progress, 150, 'negative kills ignored');
  eq(byId(s, 'season.runs-10').progress, 3, 'run still counted (only metrics sanitized)');

  // --- claim: незавершённая / неизвестная ---
  eq(season.claimSeasonMission('season.runs-10', NOV).reason, 'not-complete', 'incomplete → not-complete');
  eq(season.claimSeasonMission('season.nope', NOV).reason, 'unknown', 'unknown id → unknown');

  // --- claim free: грант РНК номиналом (лаба чистая, бустера нет) ---
  for (let i = 0; i < 7; i++) {
    season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 0 }, NOV);
  }
  s = snap();
  assert(byId(s, 'season.runs-10').complete, 'runs-10 complete at 10 runs');
  assert(byId(s, 'season.runs-10').claimable, 'runs-10 claimable (free track)');
  const rnaBefore = meta.loadMeta().rna;
  const c1 = season.claimSeasonMission('season.runs-10', NOV);
  eq(c1.ok, true, 'free claim ok');
  eq(c1.grantedRna, 200, 'free claim grants 200 RNA');
  eq(meta.loadMeta().rna, rnaBefore + 200, 'balance +200');
  eq(season.claimSeasonMission('season.runs-10', NOV).reason, 'already-claimed', 'double claim → already-claimed');

  // --- paid: прогресс копится без пропуска, claim требует пропуска ---
  season.recordSeasonRun({ kills: 2000, rnaCollected: 0, bossesDefeated: 0, mutations: 0 }, NOV);
  s = snap();
  assert(byId(s, 'season.kills-2000').complete, 'paid kills complete without pass (progress accumulates)');
  assert(!byId(s, 'season.kills-2000').claimable, 'paid not claimable without pass');
  eq(season.claimSeasonMission('season.kills-2000', NOV).reason, 'pass-required', 'paid claim without pass → pass-required');
  meta.setSeasonPassUntilMs(NOV + 30 * DAY_MS);
  s = snap();
  assert(byId(s, 'season.kills-2000').claimable, 'paid claimable with active pass');
  const c2 = season.claimSeasonMission('season.kills-2000', NOV);
  eq(c2.ok, true, 'paid claim ok with pass');
  eq(c2.grantedRna, 1000, 'paid claim grants 1000 RNA');

  // --- бустер-награда ---
  season.recordSeasonRun({ kills: 0, rnaCollected: 0, bossesDefeated: 0, mutations: 50 }, NOV);
  const c3 = season.claimSeasonMission('season.mutations-50', NOV);
  eq(c3.ok, true, 'booster claim ok');
  eq(c3.grantedBoosterDays, 3, 'booster claim grants 3 days');
  const boostUntil = meta.loadMeta().boosterUntilMs;
  assert(boostUntil >= NOV + 3 * DAY_MS - 1000, 'booster untilMs ≈ now+3d');
  meta.setBoosterUntilMs(0); // сброс, чтобы не удваивал следующие гранты РНК

  // --- claimAll ---
  reset();
  meta.setSeasonPassUntilMs(NOV + 30 * DAY_MS);
  for (let i = 0; i < 10; i++) {
    season.recordSeasonRun({ kills: 250, rnaCollected: 600, bossesDefeated: 1, mutations: 6 }, NOV);
  }
  const all = season.claimAllSeasonMissions(NOV);
  // Выполнены: runs-10, kills-500, rna-5000 (6000), bosses-3 (10),
  // kills-2000 (2500), mutations-50 (60) — все 6.
  eq(all.claimed.length, 6, 'claimAll claims all 6');
  eq(all.grantedRna, 200 + 300 + 400 + 500 + 1000, 'claimAll RNA total');
  eq(all.grantedBoosterDays, 3, 'claimAll booster total');
  const all2 = season.claimAllSeasonMissions(NOV);
  eq(all2.claimed.length, 0, 'claimAll twice: nothing left');

  // --- смена сезона: прогресс и claimed сгорают ---
  s = season.seasonSnapshot(DEC);
  assert(s.every((p) => p.progress === 0 && !p.complete && !p.claimed), 'new season resets progress and claimed');

  // --- битый JSON — чистое состояние ---
  store.set(season.SEASON_QUESTS_KEY, '{not json');
  s = snap();
  assert(s.every((p) => p.progress === 0), 'corrupt JSON → fresh state');
  store.set(season.SEASON_QUESTS_KEY, JSON.stringify({ version: 99, seasonId: '2026-11', progress: { kills: 999 }, claimed: [] }));
  s = snap();
  eq(byId(s, 'season.kills-500').progress, 0, 'wrong version → fresh state');

  console.log('season-quests: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

/**
 * Lab economy contract — мета-экономика «лаборатории мутаций» Фазы 4.
 *
 * Порт Фазы 4 (адаптация под main): БЕЗ Decimal / break_infinity.js.
 * Стоимости и балансы — plain numbers (точные целые). Вместо Decimal-секций
 * стека (L50/L100, миграция number→Decimal) — проверка safe-integer
 * стоимостей в пределах maxLevel и точных значений на достижимых уровнях.
 * Обоснование — LabBranches.ts: макс. стоимость уровня 52,4 млн, полная
 * прокачка ~1,1e8 — на 7 порядков ниже Number.MAX_SAFE_INTEGER.
 *
 * Covers: cost curves (exact values, monotonicity, safe integers),
 * formatRna suffixes, prestige math, MetaWallet sanitization,
 * buyLabUpgrade transactions, grantMetaRna multipliers, doPrestige reset,
 * applyLabRunModifiers seam.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-lab-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`lab-economy: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const approx = (actual, expected, message) =>
  assert(Math.abs(actual - expected) < 1e-9, `${message}: expected ~${expected}, got ${actual}`);

// In-memory localStorage — ставится ДО require модулей.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/lab/LabState.ts',
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
    { stdio: 'inherit' }
  );

  const branches = require(join(temp, 'game/lab/LabBranches.js'));
  const lab = require(join(temp, 'game/lab/LabState.js'));
  const mods = require(join(temp, 'game/lab/LabModifiers.js'));
  const mw = require(join(temp, 'game/meta/MetaWallet.js'));

  const branch = (id) => branches.getLabBranch(id);
  const metabolism = branch('metabolism');
  const chitin = branch('chitin');
  const chemotaxis = branch('chemotaxis');

  // --- Каталог веток ---
  eq(branches.LAB_BRANCHES.length, 3, '3 branches');
  for (const b of branches.LAB_BRANCHES) {
    assert(b.maxLevel > 0, `${b.id} maxLevel positive`);
    assert(b.costGrowth >= 1.8 && b.costGrowth <= 2.5, `${b.id} growth in 1.8..2.5`);
    assert(b.effectPerLevel > 0, `${b.id} effect positive`);
  }
  eq(branch('nope'), undefined, 'unknown branch undefined');

  // --- Кривые стоимости: точные значения ---
  eq(branches.costForLevel(metabolism, 0), 100, 'metabolism L0');
  eq(branches.costForLevel(metabolism, 1), 200, 'metabolism L1');
  eq(branches.costForLevel(metabolism, 10), 102400, 'metabolism L10 = 100*2^10');
  eq(branches.costForLevel(chitin, 0), 150, 'chitin L0');
  eq(branches.costForLevel(chitin, 2), 726, 'chitin L2 = 150*2.2^2');
  eq(branches.costForLevel(chemotaxis, 3), 3125, 'chemotaxis L3 = 200*2.5^3');

  // --- Safe integers: все стоимости в пределах maxLevel — точные целые ---
  // (это и есть обоснование отказа от Decimal: макс. 52,4 млн << 9e15).
  for (const b of branches.LAB_BRANCHES) {
    let total = 0;
    for (let n = 0; n < b.maxLevel; n++) {
      const c = branches.costForLevel(b, n);
      assert(Number.isSafeInteger(c), `${b.id} L${n} safe integer`);
      total += c;
    }
    assert(Number.isSafeInteger(total), `${b.id} total safe integer`);
  }
  eq(branches.costForLevel(metabolism, 19), 52428800, 'metabolism L19 = 100*2^19 (max level cost)');
  let grandTotal = 0;
  for (const b of branches.LAB_BRANCHES) {
    for (let n = 0; n < b.maxLevel; n++) grandTotal += branches.costForLevel(b, n);
  }
  assert(grandTotal < 2e8, `grand total to max all branches ~1.1e8, got ${grandTotal}`);
  assert(Number.isSafeInteger(grandTotal), 'grand total safe integer');

  // --- Монотонность кривых ---
  for (const b of branches.LAB_BRANCHES) {
    for (let n = 0; n < b.maxLevel; n++) {
      assert(
        branches.costForLevel(b, n + 1) > branches.costForLevel(b, n),
        `${b.id} cost strictly increasing at ${n}`
      );
    }
  }

  // --- effectText ---
  eq(branches.effectText(metabolism, 0), '+0% к доходу РНК', 'effect 0');
  eq(branches.effectText(metabolism, 3), '+30% к доходу РНК', 'effect metabolism 3');
  eq(branches.effectText(chitin, 1), '+8% к стартовому HP', 'effect chitin 1');
  eq(branches.effectText(chemotaxis, 2), '+24% к радиусу сбора', 'effect chemotaxis 2');

  // --- formatRna ---
  eq(branches.formatRna(0), '0', 'fmt 0');
  eq(branches.formatRna('0'), '0', 'fmt "0"');
  eq(branches.formatRna(999), '999', 'fmt 999');
  eq(branches.formatRna(1000), '1K', 'fmt 1000');
  eq(branches.formatRna(1500), '1.5K', 'fmt 1500');
  eq(branches.formatRna(1040), '1.04K', 'fmt 1040');
  eq(branches.formatRna(100000), '100K', 'fmt 100K');
  eq(branches.formatRna(1200000), '1.2M', 'fmt 1.2M');
  eq(branches.formatRna(2500000000), '2.5B', 'fmt 2.5B');
  eq(branches.formatRna(3000000000000), '3T', 'fmt 3T');
  eq(branches.formatRna(1.2676506002282294e29), '127Oc', 'fmt huge');
  eq(branches.formatRna('garbage'), '0', 'fmt garbage');
  eq(branches.formatRna(-5), '0', 'fmt negative');

  // --- prestigeBonus ---
  eq(branches.prestigeBonus(0), 1, 'prestige 0');
  approx(branches.prestigeBonus(1), 1.1, 'prestige 1');
  eq(branches.prestigeBonus(5), 1.5, 'prestige 5');
  eq(branches.prestigeBonus(-3), 1, 'prestige negative clamps');

  // --- MetaWallet: санитизация хранимого состояния (plain numbers) ---
  store.set('ofeliya.meta.v1', JSON.stringify({ rna: 500, questsCompleted: 2 }));
  eq(mw.loadMeta().rna, 500, 'legacy number loads');
  eq(mw.loadMeta().questsCompleted, 2, 'counters survive load');
  store.set('ofeliya.meta.v1', JSON.stringify({ rna: 'garbage' }));
  eq(mw.loadMeta().rna, 0, 'garbage → 0');
  store.set('ofeliya.meta.v1', JSON.stringify({ rna: -50 }));
  eq(mw.loadMeta().rna, 0, 'negative → 0');

  // --- addRna/spendRna/resetRnaBalance ---
  store.delete('ofeliya.meta.v1');
  mw.addRna(100);
  eq(mw.loadMeta().rna, 100, 'addRna number');
  assert(mw.spendRna(30) === true, 'spendRna ok');
  eq(mw.loadMeta().rna, 70, 'spendRna exact');
  assert(mw.spendRna(1000000) === false, 'spendRna fails when broke');
  eq(mw.loadMeta().rna, 70, 'failed spend keeps balance');
  mw.resetRnaBalance();
  eq(mw.loadMeta().rna, 0, 'resetRnaBalance zeroes balance');
  eq(mw.loadMeta().rnaEarned, 100, 'resetRnaBalance keeps lifetime counters');

  // --- buyLabUpgrade: транзакции ---
  store.delete('ofeliya.meta.v1');
  store.delete('ofeliya.lab.v1');
  mw.addRna(1000);
  let res = lab.buyLabUpgrade('metabolism');
  eq(res.ok, true, 'buy metabolism ok');
  eq(res.level, 1, 'buy metabolism level 1');
  eq(mw.loadMeta().rna, 900, 'buy deducts exact cost');
  eq(lab.getBranchLevel(lab.loadLabState(), 'metabolism'), 1, 'level persisted');
  res = lab.buyLabUpgrade('chemotaxis'); // 200
  eq(res.ok, true, 'buy chemotaxis ok');
  eq(mw.loadMeta().rna, 700, 'wallet 700 after two buys');

  // Недостаточно средств — уровень не меняется.
  store.set('ofeliya.meta.v1', JSON.stringify({ rna: 50 }));
  res = lab.buyLabUpgrade('metabolism'); // next costs 200
  eq(res.ok, false, 'buy fails when broke');
  eq(res.reason, 'funds', 'reason funds');
  eq(lab.getBranchLevel(lab.loadLabState(), 'metabolism'), 1, 'level unchanged on fail');

  // Потолок ветки.
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 20 }, prestigeCount: 0 }));
  store.set('ofeliya.meta.v1', JSON.stringify({ rna: 1e12 }));
  res = lab.buyLabUpgrade('metabolism');
  eq(res.ok, false, 'buy fails at max');
  eq(res.reason, 'maxed', 'reason maxed');

  res = lab.buyLabUpgrade('nope');
  eq(res.ok, false, 'unknown branch fails');
  eq(res.reason, 'unknown', 'reason unknown');

  // --- computeLabModifiers: чистые функции ---
  let m = mods.computeLabModifiers({ levels: {}, prestigeCount: 0 });
  eq(m.metaRnaMul, 1, 'zero state metaRnaMul exact 1');
  eq(m.startHpMul, 1, 'zero state startHpMul 1');
  eq(m.magnetMul, 1, 'zero state magnetMul 1');

  m = mods.computeLabModifiers({ levels: { metabolism: 3, chitin: 2, chemotaxis: 1 }, prestigeCount: 0 });
  approx(m.metaRnaMul, 1.3, 'metabolism 3 → ×1.3');
  approx(m.startHpMul, 1.16, 'chitin 2 → ×1.16');
  approx(m.magnetMul, 1.12, 'chemotaxis 1 → ×1.12');

  m = mods.computeLabModifiers({ levels: { metabolism: 1 }, prestigeCount: 2 });
  approx(m.metaRnaMul, 1.1 * 1.2, 'prestige multiplies meta income only');
  approx(m.startHpMul, 1, 'prestige does not touch HP');
  approx(m.magnetMul, 1, 'prestige does not touch magnet');

  // --- grantMetaRna: бонус лаборатории ---
  store.delete('ofeliya.meta.v1');
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: {}, prestigeCount: 0 }));
  lab.grantMetaRna(100);
  eq(mw.loadMeta().rna, 100, 'grant with no levels = identity');
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 3 }, prestigeCount: 0 }));
  lab.grantMetaRna(100);
  eq(mw.loadMeta().rna, 230, 'grant with metabolism 3 → 100 + 130');

  // --- doPrestige: сброс с бонусом ---
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: {}, prestigeCount: 0 }));
  res = lab.doPrestige();
  eq(res.ok, false, 'prestige gated without levels');
  eq(res.reason, 'no_levels', 'reason no_levels');

  // Пост-ревью (патч №11): порог 10 + prestigeCount*5. При prestigeCount 1
  // нужно 15 уровней: 14 — ещё закрыто, 15 — открыто.
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 10, chitin: 4 }, prestigeCount: 1 }));
  res = lab.doPrestige();
  eq(res.ok, false, 'prestige gated below scaled threshold');
  eq(res.reason, 'no_levels', 'reason no_levels below threshold');

  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 10, chitin: 5 }, prestigeCount: 1 }));
  store.set('ofeliya.meta.v1', JSON.stringify({ rna: 5000, rnaEarned: 9999 }));
  res = lab.doPrestige();
  eq(res.ok, true, 'prestige ok');
  eq(res.previousCount, 1, 'prestige previousCount');
  approx(res.newBonus, 1.2, 'prestige newBonus ×1.2');
  eq(lab.totalLevels(lab.loadLabState()), 0, 'levels reset');
  eq(mw.loadMeta().rna, 0, 'wallet reset');
  eq(mw.loadMeta().rnaEarned, 9999, 'lifetime counters survive prestige');
  m = mods.computeLabModifiers(lab.loadLabState());
  approx(m.metaRnaMul, 1.2, 'after prestige: ×1.2 meta income');

  // --- applyLabRunModifiers: шов старта забега ---
  const stage = { maxHp: 100, hp: 40, magnetMul: 2 };
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: {}, prestigeCount: 5 }));
  mods.applyLabRunModifiers(stage, lab.loadLabState());
  eq(stage.maxHp, 100, 'zero levels: maxHp = PLAYER.hp');
  eq(stage.hp, 100, 'zero levels: hp refilled to max');
  eq(stage.magnetMul, 2, 'zero levels: magnet untouched (prestige is meta-only)');
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { chitin: 2, chemotaxis: 1 }, prestigeCount: 0 }));
  mods.applyLabRunModifiers(stage, lab.loadLabState());
  eq(stage.maxHp, 116, 'chitin 2 → round(100*1.16)');
  approx(stage.magnetMul, 2.24, 'chemotaxis 1 → 2*1.12');

  console.log('lab-economy: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
  delete globalThis.localStorage;
}

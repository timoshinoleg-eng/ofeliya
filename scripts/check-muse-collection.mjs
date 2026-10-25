import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = buildSync({
  absWorkingDir: root,
  entryPoints: ['./src/game/collection/ClientCollection.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const module = { exports: {} };
new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
const { ClientCollection, COLLECTION_KEY, COLLECTION_CATALOG, SKIN_CATALOG } = module.exports;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

assert.equal(COLLECTION_CATALOG.length, 24, 'preserve 24 Muse catalog slots');
assert.equal(new Set(COLLECTION_CATALOG.map((item) => item.id)).size, 24, 'unique achievement ids');
assert.equal(SKIN_CATALOG.length, 4, 'base skin plus three earned palettes');
assert.ok(COLLECTION_CATALOG.every((item) => !('reward' in item)), 'catalog has no reward payloads');
assert.ok(!COLLECTION_CATALOG.some((item) => /spend|potrat|RNA|звезд/i.test(item.description)), 'catalog descriptions use observation criteria');
assert.deepEqual(
  COLLECTION_CATALOG.filter((item) => item.unlockSkinId).map((item) => item.unlockSkinId).sort(),
  SKIN_CATALOG.filter((skin) => skin.earnedBy).map((skin) => skin.id).sort(),
  'all three non-base palettes are achievement-earned',
);

let now = Date.UTC(2026, 0, 1, 12);
const storage = memoryStorage();
const collection = new ClientCollection(storage, () => now);
const first = (id, patch = {}) => collection.observeRun({ id, kills: 0, timeMs: 0, noDamageMs: 0, level: 1, combo: 0, mutations: [], elites: 0, hostCells: 0, evolutions: [], legendaryIds: [], won: false, ...patch });
assert.equal(storage.data.has(COLLECTION_KEY), false, 'read is lazy');
assert.equal(collection.selectSkin('skin.gilded-prime'), false, 'locked cosmetic cannot be selected');
assert.equal(first('kills-499', { kills: 499 }).includes('killer_500'), false, '499 is below threshold');
assert.equal(first('kills-500', { kills: 1, elites: 25 }).includes('killer_500'), true, '500 cumulative kills unlock');
assert.deepEqual(first('kills-500', { kills: 500 }), [], 'same stable run id is idempotent');
assert.equal(collection.selectSkin('skin.gilded-prime'), true, 'earned cosmetic can be selected');
assert.equal(collection.snapshot().selectedSkinId, 'skin.gilded-prime', 'selection persists in snapshot');
const reloaded = new ClientCollection(storage, () => now);
assert.deepEqual(reloaded.observeRun({ id: 'kills-500', kills: 500 }), [], 'duplicate remains idempotent after reload');
assert.equal(reloaded.snapshot().achievements.find((a) => a.id === 'killer_500').unlocked, true);
assert.equal(reloaded.snapshot().ownedSkinIds.includes('skin.gilded-prime'), true);

const bogus = new ClientCollection(memoryStorage(), () => now);
bogus.observeRun({id:'bogus',mutations:['a','b','c','d','e'],evolutions:['a','b','c','d','e']});
assert.equal(bogus.snapshot().achievements.find(a=>a.id==='evo_5').unlocked,false,'unknown mutations cannot open cosmetic unlocks');
const boundaries = new ClientCollection(memoryStorage(), () => now);
boundaries.observeRun({ id: 'combo-49', combo: 49 });
assert.equal(boundaries.snapshot().achievements.find((a) => a.id === 'combo_50').unlocked, false, 'combo 49 is below threshold');
boundaries.observeRun({ id: 'combo-50', combo: 50, evolutions: ['prism', 'halo', 'singularity'], mutations: ['dmg', 'rate', 'multi', 'pierce', 'speed'] });
assert.equal(boundaries.snapshot().achievements.find((a) => a.id === 'combo_50').unlocked, true, 'combo 50 unlocks');
assert.equal(boundaries.snapshot().achievements.find((a) => a.id === 'evo_5').unlocked, true, 'five real mutation kinds unlock (only three critical evolutions exist)');
assert.equal(boundaries.selectSkin('skin.virulent-magenta'), true, 'mutation collection earns a palette');
boundaries.observeRun({ id: 'ghost-119999', noDamageMs: 119_999 });
assert.equal(boundaries.snapshot().achievements.find((a) => a.id === 'ghost_120').unlocked, false, '119999 ms is below threshold');
boundaries.observeRun({ id: 'ghost-120000', noDamageMs: 120_000 });
assert.equal(boundaries.snapshot().achievements.find((a) => a.id === 'ghost_120').unlocked, true, '120000 ms unlocks');
boundaries.observeRun({ id: 'wins', won: true });
assert.equal(boundaries.snapshot().achievements.find((a) => a.id === 'winner').unlocked, true, 'win observation unlocks');
first('invalid-values', { kills: Number.NaN, timeMs: -1, mutations: ['bad', 'bad'], won: 'yes' });
const snapshot = collection.snapshot();
assert.equal(snapshot.achievements.find((a) => a.id === 'killer_500').unlocked, true, 'malformed counters cannot erase prior unlocks');
assert.equal(Object.keys(snapshot).some((key) => /wallet|rna|damage|hp|combatStats|reward/i.test(key)), false, 'public snapshot has no wallet, rewards, or combat stats');
const corruptStorage = memoryStorage({ [COLLECTION_KEY]: '{not-json' });
assert.doesNotThrow(() => new ClientCollection(corruptStorage, () => now).snapshot(), 'malformed save is safe');
const sanitizedStorage = memoryStorage({ [COLLECTION_KEY]: JSON.stringify({
  version: 1,
  unlockedAchievementIds: ['not-a-catalog-id'],
  ownedSkinIds: ['skin.gilded-prime', 'not-a-skin'],
  selectedSkinId: 'not-a-skin',
}) });
const sanitized = new ClientCollection(sanitizedStorage, () => now).snapshot();
assert.deepEqual(sanitized.ownedSkinIds, ['strain-zero', 'skin.gilded-prime'], 'catalog skins are accepted and unknown stored ids are dropped');
assert.equal(sanitized.selectedSkinId, 'strain-zero', 'invalid selection falls back to the base skin');
assert.equal(sanitized.achievements.every((item) => !item.unlocked), true, 'unknown stored achievements are ignored');
const futureRaw = JSON.stringify({ version: 999, ownedSkinIds: ['skin.gilded-prime'] });
const futureStorage = memoryStorage({ [COLLECTION_KEY]: futureRaw });
const future = new ClientCollection(futureStorage, () => now);
assert.equal(future.snapshot().readOnly, true, 'future version is locked read-only');
assert.equal(future.selectSkin('skin.gilded-prime'), false, 'future data cannot grant ownership');
assert.equal(futureStorage.data.get(COLLECTION_KEY), futureRaw, 'future save is never overwritten');
const visitsStorage = memoryStorage();
const visits = new ClientCollection(visitsStorage, () => now);
visits.visit(); visits.visit();
assert.equal(visits.snapshot().visitDays, 1, 'repeat visit same UTC day counted once');
now += 86400000;
visits.visit();
assert.equal(visits.snapshot().visitDays, 2, 'next UTC day counted as informational visit');
assert.equal(visits.snapshot().visitStreak, 2, 'visit streak is informational');
assert.deepEqual(visits.snapshot().recentVisitDays, ['2026-01-01','2026-01-02'], 'calendar stores actual visit dates only');
now += 2*86400000;visits.visit();
assert.equal(visits.snapshot().visitStreak,1,'a missed UTC day breaks current streak');
assert.deepEqual(visits.snapshot().recentVisitDays, ['2026-01-01','2026-01-02','2026-01-04']);
console.log('muse collection contract: OK');

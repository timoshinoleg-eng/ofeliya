import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadTypeScript(path, require = () => { throw new Error(`Unexpected import in ${path}`); }) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require, Uint8Array });
  return module.exports;
}

const ids = loadTypeScript('src/systems/AnalyticsRunId.ts');
const context = loadTypeScript('src/systems/ComprehensionRunContext.ts', (specifier) => {
  if (specifier === './AnalyticsRunId') return ids;
  if (specifier === './AnalyticsClient') return {};
  throw new Error(`Unexpected import: ${specifier}`);
});

const storage = new Map();
function persist(runSeed, analyticsRunId) {
  storage.set('ofeliya_comprehension_v1', JSON.stringify({ runSeed, analyticsRunId }));
}
function resume(runSeed) {
  try {
    const state = JSON.parse(storage.get('ofeliya_comprehension_v1') ?? 'null');
    return state ? context.restoreAnalyticsRunId(runSeed, state.runSeed, state.analyticsRunId) : null;
  } catch {
    return null;
  }
}

const cryptoIds = [
  '123e4567-e89b-42d3-a456-426614174000',
  '123e4567-e89b-42d3-a456-426614174001',
];
const crypto = {
  randomUUID: () => cryptoIds.shift(),
  getRandomValues: (bytes) => bytes.fill(0xab),
};
const firstAttempt = ids.createAnalyticsRunId(crypto);
const retryAttempt = ids.createAnalyticsRunId(crypto);
assert.notEqual(firstAttempt, retryAttempt, 'fresh attempts with the same seed receive separate IDs');
assert.match(firstAttempt, /^[a-zA-Z0-9_-]{8,80}$/);
persist('same-seed', firstAttempt);
assert.equal(resume('same-seed'), firstAttempt, 'matching checkpoint restores its ID');
assert.equal(resume('different-seed'), null, 'mismatched checkpoint never restores identity');

persist('same-seed', 'invalid');
assert.equal(resume('same-seed'), null, 'malformed ID remains uncorrelated');
storage.set('ofeliya_comprehension_v1', JSON.stringify({ runSeed: 'same-seed' }));
assert.equal(resume('same-seed'), null, 'legacy state without ID remains uncorrelated');
storage.set('ofeliya_comprehension_v1', '{broken');
assert.equal(resume('same-seed'), null, 'corrupt state remains uncorrelated');

assert.equal(ids.createAnalyticsRunId(null), null, 'missing WebCrypto fails soft');
const throwingUuid = {
  randomUUID: () => { throw new Error('not permitted'); },
  getRandomValues: (bytes) => bytes.fill(0xab),
};
assert.equal(ids.createAnalyticsRunId(throwingUuid), 'ab'.repeat(16), 'UUID failure falls back to cryptographic bytes');
assert.equal(ids.createAnalyticsRunId({ getRandomValues: () => { throw new Error('unavailable'); } }), null,
  'failed cryptographic byte source fails soft');

const reservedId = '123e4567-e89b-42d3-a456-426614174000';
const props = context.buildComprehensionEventProps({
  analyticsRunId: 'attacker-value', runTimeMs: 999, firstRun: false, release: 'caller-release',
  runSeed: 'seed', daily: true, difficulty: 'standard', controlMode: 'one-hand', extra: 'dropped',
}, { analyticsRunId: reservedId, runTimeMs: 61424.6, firstRun: true, release: 'dev' });
assert.deepEqual(Object.keys(props).slice(0, 4), ['analyticsRunId', 'runTimeMs', 'firstRun', 'release']);
assert.deepEqual(JSON.parse(JSON.stringify(props)), {
  analyticsRunId: reservedId, runTimeMs: 61425, firstRun: true, release: 'dev',
  runSeed: 'seed', daily: true, difficulty: 'standard', controlMode: 'one-hand',
});
assert.ok(Object.keys(props).length <= 8);

console.log('comprehension run context identity, resume, metadata, and bounds: ok');

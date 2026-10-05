import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';

const main = readFileSync('src/main.ts', 'utf8');
const source = main.slice(main.indexOf('const RELEASE_REFRESH_KEY'), main.indexOf('const CANVAS_FALLBACK_KEY'))
  .replaceAll('import.meta.env.PROD', 'true').replaceAll('import.meta.env.BASE_URL', "'/ofeliya/'");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const serverSha = 'b'.repeat(40);
function fixture() {
  const state = { active: false, paused: false, sleeping: false, deletes: 0, navigations: [], cacheHook: null };
  const session = new Map();
  const window = {
    caches: { keys: async () => ['ofeliya-old', 'another-app'], delete: async () => {
      state.deletes++;
      state.cacheHook?.();
    } },
    location: { href: 'https://example.test/ofeliya/?startapp=challenge', replace: (url) => state.navigations.push(url) },
    setTimeout, clearTimeout, setInterval, addEventListener: () => {},
  };
  const context = vm.createContext({ window, location: { protocol: 'https:' },
    document: { visibilityState: 'visible', addEventListener: () => {} },
    fetch: async () => ({ ok: true, json: async () => ({ release: serverSha }) }),
    sessionStorage: { getItem: (key) => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: (key) => session.delete(key) },
    RELEASE_SHA: 'a'.repeat(40), RELEASE_SHORT: 'aaaaaaa', StartupTrace: { setMeta: () => {} },
    URL, AbortController, console,
    sceneFixture: { isActive: () => state.active, isPaused: () => state.paused, isSleeping: () => state.sleeping },
  });
  vm.runInContext(compiled, context);
  // Normal production deliberately exposes no window.__game QA hook.
  vm.runInContext('releaseGuardGame = { scene: sceneFixture }', context);
  return { state, session, check: () => vm.runInContext('ensureCurrentRelease()', context) };
}

for (const field of ['active', 'paused', 'sleeping']) {
  await test(`release mismatch preserves a ${field} run until menu`, async () => {
    const f = fixture();
    f.state[field] = true;
    assert.equal(await f.check(), false);
    assert.equal(f.state.deletes, 0, 'active run caches must remain untouched');
    assert.equal(f.session.size, 0, 'deferred refresh must not consume the one-shot target');
    assert.deepEqual(f.state.navigations, []);
    f.state[field] = false;
    assert.equal(await f.check(), true);
    assert.equal(f.state.deletes, 1, 'only Ofeliya cache is cleared');
    assert.match(f.state.navigations[0], /startapp=challenge/);
    assert.match(f.state.navigations[0], /release=bbbbbbb/);
    assert.equal(await f.check(), false, 'same target cannot loop');
  });
}
await test('a run starting while caches clear prevents navigation and can refresh later', async () => {
  const f = fixture();
  f.state.cacheHook = () => { f.state.active = true; };
  assert.equal(await f.check(), false);
  assert.deepEqual(f.state.navigations, []);
  assert.equal(f.session.size, 0);
  f.state.cacheHook = null;
  f.state.active = false;
  assert.equal(await f.check(), true);
});

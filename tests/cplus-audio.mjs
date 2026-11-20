// C+ v4 audio contracts (test branch only).
//
// Two layers are covered:
//   1. the pure mapping math (`src/systems/cplusAudioMath.ts`) — the bed
//      mapping, the boss triggers and the opt-in flag;
//   2. the director (`src/systems/CPlusAudioDirector.ts`) — the sequence of
//      sink calls a run produces.
//
// Nothing here touches WebAudio: the sink is a fake, exactly like the
// production `AdaptiveAudioDirector` contract in `scripts/check-adaptive-audio.mjs`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ts = createRequire(import.meta.url)('typescript');

function load(path, globals = {}, cache = new Map()) {
  path = path.replace(/\\/g, '/');
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  const source = readFileSync(path, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const require = (name) => {
    if (name === './Sfx') return { Sfx: {} };
    if (name === './cplusAudioMath') return load('src/systems/cplusAudioMath.ts', globals, cache);
    if (name === './AdaptiveAudioDirector') return load('src/systems/AdaptiveAudioDirector.ts', globals, cache);
    return load(`src/systems/${name}.ts`, globals, cache);
  };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    require, module, module.exports, ...Object.values(globals)
  );
  cache.set(path, module.exports);
  return module.exports;
}

const math = load('src/systems/cplusAudioMath.ts');
const directorModule = load('src/systems/CPlusAudioDirector.ts');

let failures = 0;
let total = 0;
async function test(name, fn) {
  total += 1;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

await test('act pools are disjoint and map to the right C+ beds', () => {
  assert.equal(math.cPlusBedForStage(1), 'bloodstream');
  assert.equal(math.cPlusBedForStage(2), 'heart');
  assert.equal(math.cPlusBedForStage(3), 'heart');
  assert.equal(math.cPlusBedForStage(9), 'heart');
  const actI = math.CPLUS_BED_POOLS.bloodstream;
  const actII = math.CPLUS_BED_POOLS.heart;
  for (const role of actI) {
    assert.ok(!actII.includes(role), `bed ${role} must not appear in both act pools`);
  }
  // a Heart composition can never be scheduled in act I and vice versa
  assert.equal(math.cPlusBedForStage(1) === 'heart', false);
  assert.equal(math.cPlusBedForStage(2) === 'bloodstream', false);
});

await test('boss beds are bound to their stage and unknown stages map to null', () => {
  assert.equal(math.cPlusBedForBoss('bloodstream'), 'immune-prime');
  assert.equal(math.cPlusBedForBoss('heart'), 'cardiac-titan');
  assert.equal(math.cPlusBedForBoss('not-a-stage'), null);
});

await test('run-end stingers are one-shot and never become loop beds', () => {
  assert.equal(math.cPlusStingerForResult(true), 'victory');
  assert.equal(math.cPlusStingerForResult(false), 'defeat');
  assert.equal(math.isCPlusStinger('victory'), true);
  assert.equal(math.isCPlusStinger('defeat'), true);
  assert.equal(math.isCPlusStinger('bloodstream'), false);
  const plan = math.planCPlusBed(null, { kind: 'run-end', win: true });
  assert.equal(plan.role, 'victory');
  assert.equal(plan.loop, false);
});

await test('bed plan switches on act change and boss spawn, and stays put otherwise', () => {
  const start = math.planCPlusBed(null, { kind: 'run-start', stageOrder: 1 });
  assert.equal(start.role, 'bloodstream');
  assert.equal(start.fadeMs, 0);

  const act = math.planCPlusBed('bloodstream', { kind: 'act-change', stageOrder: 2 });
  assert.equal(act.role, 'heart');
  assert.equal(act.fadeMs, math.CPLUS_BED_FADE_MS);
  assert.equal(act.loop, true);

  // same bed -> no switch (a repeated event must not restart the bed)
  assert.equal(math.planCPlusBed('heart', { kind: 'act-change', stageOrder: 3 }), null);

  const boss = math.planCPlusBed('bloodstream', { kind: 'boss-spawn', stageId: 'bloodstream' });
  assert.equal(boss.role, 'immune-prime');
  assert.equal(boss.fadeMs, math.CPLUS_BED_FADE_MS);
  assert.equal(math.planCPlusBed('immune-prime', { kind: 'boss-spawn', stageId: 'bloodstream' }), null);

  const cleared = math.planCPlusBed('immune-prime', { kind: 'boss-clear', stageOrder: 1 });
  assert.equal(cleared.role, 'bloodstream');

  // a stage without a boss music must not switch anything
  assert.equal(math.planCPlusBed('bloodstream', { kind: 'boss-spawn', stageId: 'unknown' }), null);
});

await test('every C+ bed role has an ogg-first candidate list with an mp3 fallback', () => {
  for (const role of math.CPLUS_BED_ROLES) {
    const sources = math.CPLUS_BED_SOURCES[role];
    assert.ok(sources.length >= 2, `${role} needs an ogg and an mp3 candidate`);
    assert.ok(sources[0].endsWith('.ogg'), `${role} must prefer the gapless ogg`);
    assert.ok(sources[1].endsWith('.mp3'), `${role} needs the mp3 fallback for iOS`);
    for (const file of sources) {
      assert.ok(file.startsWith('audio/cplus-v4/'), `${file} must live in the C+ folder`);
    }
  }
  // every file name is unique
  const all = math.CPLUS_BED_ROLES.flatMap((r) => math.CPLUS_BED_SOURCES[r]);
  assert.equal(new Set(all).size, all.length);
});

await test('the C+ mode is opt-in only', () => {
  assert.equal(math.cPlusEnabled('?audio=cplus', null), true);
  assert.equal(math.cPlusEnabled('?audio=prod', null), false);
  assert.equal(math.cPlusEnabled('?cplus=1', null), true);
  assert.equal(math.cPlusEnabled('', null), false);
  assert.equal(math.cPlusEnabled(undefined, null), false);
  assert.equal(math.cPlusEnabled('', '1'), true);
  assert.equal(math.cPlusEnabled('', '0'), false);
});

await test('the director drives the sink through a full run', () => {
  const calls = [];
  const sink = {
    bedStart: (role, fadeMs) => calls.push(['bedStart', role, fadeMs]),
    bedStop: () => calls.push(['bedStop']),
    stinger: (role) => calls.push(['stinger', role]),
  };
  const d = new directorModule.CPlusAudioDirector({ sink, enabled: true });

  d.start(1);
  d.setStage(1); // same act -> no switch
  d.onBossSpawn('bloodstream');
  d.onBossSpawn('bloodstream'); // repeated -> no restart
  d.onBossClear(1);
  d.setStage(2);
  d.onBossSpawn('heart');
  d.onRunEnd(true);
  d.stop();

  const roles = calls.map((c) => (c.length > 1 ? `${c[0]}:${c[1]}` : c[0]));
  assert.deepEqual(roles, [
    'bedStart:bloodstream',
    'bedStart:immune-prime',
    'bedStart:bloodstream',
    'bedStart:heart',
    'bedStart:cardiac-titan',
    'stinger:victory',
    'bedStop',
  ]);
  assert.equal(calls[0][2], 0, 'the first bed starts immediately');
  assert.equal(calls[1][2], math.CPLUS_BED_FADE_MS, 'a boss switch cross-fades');
});

await test('a disabled director never touches the audio graph', () => {
  const calls = [];
  const sink = {
    bedStart: (role) => calls.push(['bedStart', role]),
    bedStop: () => calls.push(['bedStop']),
    stinger: (role) => calls.push(['stinger', role]),
  };
  const d = new directorModule.CPlusAudioDirector({ sink, enabled: false });
  d.start(1);
  d.onBossSpawn('bloodstream');
  d.onRunEnd(false);
  d.stop();
  assert.deepEqual(calls, []);
  assert.equal(d.active, false);
});

await test('the director reports its state for the debug overlay', () => {
  const sink = { bedStart: () => {}, bedStop: () => {}, stinger: () => {} };
  const d = new directorModule.CPlusAudioDirector({ sink, enabled: true });
  d.start(1);
  assert.equal(d.debugState.role, 'bloodstream');
  assert.equal(d.debugState.state, 'bloodstream');
  d.onBossSpawn('bloodstream');
  assert.equal(d.debugState.role, 'immune-prime');
  assert.equal(d.debugState.state, 'immune-prime');
  d.onRunEnd(false);
  assert.equal(d.debugState.state, 'ended');
});

await test('the opt-in flag survives denied or missing storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const restore = () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  };

  try {
    // 1. storage is absent entirely
    delete globalThis.localStorage;
    assert.equal(math.cPlusEnabled('?audio=cplus', math.readStoredCPlusFlag()), true);
    assert.equal(math.cPlusEnabled('', math.readStoredCPlusFlag()), false);

    // 2. the getter throws SecurityError — a policy denial
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: storage is denied'); },
    });
    assert.doesNotThrow(() => math.readStoredCPlusFlag(), 'reading denied storage must not throw');
    assert.equal(math.readStoredCPlusFlag(), null, 'denied storage reads as "no preference"');
    assert.equal(math.cPlusEnabled('?audio=cplus'), true, 'the URL flag still works without storage');
    assert.equal(math.cPlusEnabled(''), false, 'a normal URL stays on the production path');
    assert.equal(math.cPlusEnabled(undefined), false, 'a missing search string is not the C+ path');

    // 3. storage works
    const store = new Map([[math.CPLUS_STORAGE_KEY, '1']]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { return { getItem: (k) => (store.has(k) ? store.get(k) : null) }; },
    });
    assert.equal(math.readStoredCPlusFlag(), '1', 'a stored preference is read');
    assert.equal(math.cPlusEnabled(''), true, 'the stored preference enables the C+ beds');
  } finally {
    restore();
  }
});

if (failures) {
  console.error(`${failures} of ${total} C+ audio check(s) failed`);
  process.exit(1);
}
console.log(`C+ audio contracts: ${total}/${total} passed`);

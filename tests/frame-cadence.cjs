const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { percentile, summarize, collectFrameCadence } = require('../scripts/frame-cadence.cjs');

test('percentile interpolates endpoints, singleton and unsorted input is rejected', () => {
  assert.equal(percentile([10, 20, 30, 40], 0), 10);
  assert.equal(percentile([10, 20, 30, 40], 1), 40);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 38.5);
  assert.equal(percentile([17], 0.95), 17);
  for (const data of [[], [NaN], [Infinity], [20, 10]]) assert.throws(() => percentile(data, 0.5));
  for (const p of [-1, 2, NaN]) assert.throws(() => percentile([1], p));
});

test('summarization preserves samples and uses a strict >33.3ms ratio', () => {
  const data = [50, 10, 33.3, 20];
  const copy = [...data];
  const result = summarize(data, { minSamples: 4, minWindowMs: 100 });
  assert.equal(result.sampleCount, 4);
  assert.equal(result.windowMs, 113.3);
  assert.equal(result.p50Ms, 26.65);
  assert.ok(Math.abs(result.p95Ms - 47.495) < 1e-10);
  assert.equal(result.over33_3MsRatio, 0.25);
  assert.deepEqual(data, copy);
});

test('gates data validity and coverage, never slow cadence', () => {
  for (const data of [[], Array(59).fill(20), Array(60).fill(1),
    [...Array(59).fill(20), NaN], [...Array(59).fill(20), Infinity],
    [...Array(59).fill(20), 0], [...Array(59).fill(20), -1]]) {
    assert.throws(() => summarize(data));
  }
  assert.equal(summarize(Array(60).fill(500)).p95Ms, 500);
});

// Exercise the serialized browser probe with a controlled scheduler, without Chrome.
function probe() {
  let callback;
  let watchdog;
  let listener;
  const gs = { awaitingChoice: false, registry: { get: () => 'full' },
    enemies: { getChildren: () => [{ active: true }] } };
  const document = { visibilityState: 'visible',
    addEventListener: (_, fn) => { listener = fn; },
    removeEventListener: () => { listener = null; } };
  const context = vm.createContext({ document,
    window: { __game: { canvas: { isConnected: true, width: 390, height: 740 },
      loop: { running: true }, renderer: { type: 1 },
      scene: { getScene: () => gs, isActive: () => true } } },
    requestAnimationFrame: fn => { callback = fn; return 1; },
    cancelAnimationFrame: () => { callback = null; },
    setTimeout: fn => { watchdog = fn; return 2; },
    clearTimeout: () => { watchdog = null; },
  });
  const promise = vm.runInContext(`(${collectFrameCadence.toString()})({
    policy: { warmupFrames: 2, minSamples: 3, minWindowMs: 50, timeoutMs: 30000 },
    renderer: 'canvas', tier: 'full', enemyCount: 1
  })`, context);
  return { promise, gs, document, tick: timestamp => callback(timestamp),
    timeout: () => watchdog(), visibility: () => listener(),
    cleaned: () => !callback && !watchdog && !listener };
}

test('probe discards warmup and includes consecutive slow intervals without filtering', async () => {
  const p = probe();
  for (const time of [0, 400, 600, 610, 640, 690]) p.tick(time);
  assert.deepEqual(Array.from(await p.promise), [10, 30, 50]);
  assert.ok(p.cleaned());
});

test('probe rejects unstable fixture, hidden page and timeout, and cleans up', async () => {
  for (const fail of [p => { p.gs.awaitingChoice = true; p.tick(0); },
    p => { p.gs.enemies.getChildren = () => []; p.tick(0); },
    p => { p.document.visibilityState = 'hidden'; p.tick(0); },
    p => p.visibility(), p => p.timeout()]) {
    const p = probe();
    fail(p);
    await assert.rejects(p.promise, /cadence/);
    assert.ok(p.cleaned());
  }
});

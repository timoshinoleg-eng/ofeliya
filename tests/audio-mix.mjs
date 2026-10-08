import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
// Only browser I/O, saved mute and Vite metadata are replaced. Production Sfx/math execute.
function load(path, globals = {}, cache = new Map()) {
  path = resolve(path);
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  const source = readFileSync(path, 'utf8').replace('import.meta.env.BASE_URL', "'./'");
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const require = name => name === './SaveSystem'
    ? { SaveSystem: { get: () => ({ muted: false }), update() {} } }
    : name === '../release' ? { RELEASE_SHA: 'audio-test' }
    : load(resolve(dirname(path), `${name}.ts`), globals, cache);
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)
    (require, module, module.exports, ...Object.values(globals));
  cache.set(path, module.exports); return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function buffer(channels = [[.1, -.25], [.5, -.2]]) {
  return { numberOfChannels: channels.length, scans: 0,
    getChannelData(i) { this.scans++; return new Float32Array(channels[i]); } };
}
function fixture({ hidden = false, state = 'running', resumeBlocked = false, resumeDeferred, fetcher, decoder } = {}) {
  const contexts = [], listeners = new Map(), requests = [], warnings = [];
  const document = { hidden };
  const param = value => ({ value, calls: [], cancelScheduledValues(t) { this.calls.push(['cancel', t]); },
    setValueAtTime(v, t) { this.value = v; this.calls.push(['set', v, t]); },
    setTargetAtTime(v, t, tau) { this.calls.push(['target', v, t, tau]); },
    exponentialRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); } });
  class Context {
    constructor() { this.state = state; this.currentTime = 10; this.nodes = []; this.resumeCalls = 0; this.suspendCalls = 0; this.resumeBlocked = resumeBlocked; this.destination = { kind: 'destination' }; contexts.push(this); }
    node(kind) { const n = { kind, connections: [], disconnected: false, started: false, stopped: false,
      connect(to) { this.connections.push(to); }, disconnect() { this.disconnected = true; this.connections = []; },
      start() { assert(!this.started); this.started = true; }, stop(at) {
        if (at !== undefined) { this.scheduledStop = at; return; }
        this.stopped = true; this.onended?.();
      } };
      this.nodes.push(n); return n; }
    createGain() { return Object.assign(this.node('gain'), { gain: param(1) }); }
    createBiquadFilter() { return Object.assign(this.node('filter'), { frequency: param(350), Q: param(1) }); }
    createDynamicsCompressor() { return Object.assign(this.node('compressor'), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(k => [k, param(0)]))); }
    createBufferSource() { return this.node('source'); }
    createOscillator() { return Object.assign(this.node('oscillator'), { frequency: param(440) }); }
    resume() { this.resumeCalls++; if (this.resumeBlocked) return Promise.reject(new Error('gesture required')); if (resumeDeferred) return resumeDeferred.promise.then(() => { this.state = 'running'; }); this.state = 'running'; return Promise.resolve(); }
    suspend() { this.suspendCalls++; this.state = 'suspended'; return Promise.resolve(); }
    decodeAudioData(ab) { return decoder ? decoder(ab) : Promise.resolve(buffer()); }
  }
  const window = { AudioContext: Context,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); } };
  let now = 1000;
  const fetch = (url, options) => { requests.push({ url, options }); return fetcher ? fetcher(url, options) : Promise.resolve({ ok: true, arrayBuffer: async () => ({ url }) }); };
  const { Sfx } = load('src/systems/Sfx.ts', { window, document, fetch, performance: { now: () => now }, console: { warn: (...a) => warnings.push(a) } });
  return { Sfx, contexts, listeners, requests, warnings, document, advance: () => { now += 1000; },
    gesture: () => { for (const fn of [...(listeners.get('pointerdown') ?? [])]) fn(); } };
}
const failures = [];
async function test(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } }
await test('production normalization math handles silence, invalid peaks and bounded boost', () => {
  const m = load('src/systems/audioMixMath.ts');
  for (const peak of [0, -1, NaN, Infinity, -Infinity]) assert.equal(m.normalizationTrimForPeak(peak), 1);
  assert.equal(m.normalizationTrimForPeak(.01), 12);
  assert.equal(m.normalizationTrimForPeak(.63), 1);
  assert.equal(m.normalizationTrimForPeak(1), .63);
  assert.equal(m.scanNormalizationTrim(buffer([[0, 0]])), 1);
  assert.equal(m.scanNormalizationTrim(buffer([[.5, NaN]])), 1);
  assert.equal(m.scanNormalizationTrim(buffer([[.5, Infinity]])), 1);
  assert.equal(m.scanNormalizationTrim(buffer([[]])), 1);
  assert.equal(m.scanNormalizationTrim(buffer()), 1.26);
});
await test('production gain math composes bed trim and duck with new constants', () => {
  const m = load('src/systems/audioMixMath.ts');
  assert.equal(m.MASTER_GAIN, .8); assert.equal(m.MUSIC_GAIN, .65);
  assert.deepEqual(m.MUSIC_BED_TRIMS, [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(m.musicGainForDuck(.6), .26); assert.equal(m.musicGainForDuck(1), .02);
  assert.equal(m.musicGainForDuck(NaN), .65);
  assert.equal(m.MASTER_GAIN * m.MUSIC_BED_TRIMS[4] * m.musicGainForDuck(.6), 0.20800000000000002);
});
await test('one master compressor and distinct bed trim preserve procedural bus routing', async () => {
  const f = fixture(); f.Sfx.startBed(4); await flush();
  const c = f.contexts[0], src = c.nodes.find(n => n.kind === 'source');
  const trim = src.connections[0], music = trim.connections[0], filter = music.connections[0], master = filter.connections[0], compressor = master.connections[0];
  assert.equal(trim.gain.value, 1); assert.equal(music.gain.value, .65); assert.equal(master.gain.value, .8);
  assert.equal(filter.kind, 'filter'); assert.equal(compressor.kind, 'compressor'); assert.equal(compressor.connections[0], c.destination);
  for (const [k, v] of Object.entries({ threshold: -8, knee: 6, ratio: 4, attack: .003, release: .12 })) assert.equal(compressor[k].value, v);
  const layer = c.nodes.find(n => n.kind === 'gain' && n !== music && n.connections[0] === filter);
  assert(layer); assert.equal(layer.gain.value, 1);
  f.Sfx.duckMusic(.6, 700);
  assert.deepEqual(music.gain.calls.slice(-2), [['target', .26, 10, .08], ['target', .65, 10.7, .35]]);
  assert.equal(trim.gain.value, 1, 'duck must not overwrite trim');
  f.Sfx.stopMusic();
  assert(src.stopped && src.disconnected); assert.equal(f.contexts.length, 1);
});
await test('decoded SFX scan once, cache normalization and replace legacy coefficients for every role', async () => {
  const b = buffer(), f = fixture({ decoder: async () => b });
  const roles = { shoot: .12, hit: .16, pickup: .28, pickup2: .28, pickup3: .28, click: .20, levelup: .50, hurt: .55, nova: .48, elite: .50, boss: .60, bossphase: .62, gameover: .58, victory: .58, infect: .42, lysis: .62 };
  for (const [name, role] of Object.entries(roles)) {
    f.Sfx.play(name); await flush(); const scans = b.scans;
    for (let i = 0; i < 2; i++) { f.advance(); f.Sfx.play(name);
      const src = f.contexts[0].nodes.filter(n => n.kind === 'source').at(-1);
      assert.equal(src.connections[0].gain.value, role * 1.26);
      src.onended(); assert(src.disconnected); assert.equal(src.onended, null);
    }
    assert.equal(b.scans, scans, 'play must never rescan decoded samples');
  }
  assert.equal(f.requests.length, 16); assert.equal(b.scans, 32);
  // RNA pickup round-robin cycles the three variants cursor-only, no RNG.
  for (const expected of ['pickup', 'pickup2', 'pickup3', 'pickup']) {
    f.advance(); f.Sfx.playPickupVariant();
    const src = f.contexts[0].nodes.filter(n => n.kind === 'source').at(-1);
    assert.equal(src.connections[0].gain.value, roles[expected] * 1.26);
    src.onended();
  }
});
await test('existing SFX throttles reject tight shoot hit pickup repeats', async () => {
  for (const name of ['shoot', 'hit', 'pickup']) {
    const f = fixture(); f.Sfx.play(name); await flush(); f.advance(); f.Sfx.play(name); f.Sfx.play(name);
    assert.equal(f.contexts[0].nodes.filter(n => n.kind === 'source').length, 1);
  }
});
await test('diagnostics report loading and actual fallback bed separately without unsafe data', async () => {
  const d = deferred(); const f = fixture({ decoder: async ab => {
    if (ab.url.includes('loop3')) throw new Error('codec rejected'); return d.promise;
  } });
  f.Sfx.startBed(3); await flush();
  const pending = f.Sfx.debugAudioState;
  assert.equal(pending.musicWanted, true); assert.equal(pending.loading, true); assert.equal(pending.playing, false); assert.equal(pending.actualBedIndex, null);
  d.resolve(buffer()); await flush();
  const debug = f.Sfx.debugAudioState;
  assert.equal(debug.actualBedIndex, 4); assert.equal(debug.loading, false); assert.equal(debug.playing, true); assert.equal(debug.gains.bedTrim, 1); assert.equal(debug.lastLoadError, null);
  assert(Object.isFrozen(debug) && Object.isFrozen(debug.gains));
  assert.deepEqual(Object.keys(debug).sort(), ['actualBedIndex', 'contextState', 'gains', 'lastLoadError', 'loading', 'musicWanted', 'muted', 'playing', 'suspended'].sort());
  f.Sfx.stopMusic(); assert.equal(f.Sfx.debugAudioState.actualBedIndex, null);
});
await test('all codec failures remain retryable and diagnostics use bounded safe errors', async () => {
  let fail = true; const f = fixture({ decoder: async () => { if (fail) throw new Error('https://private.invalid/?token=secret'); return buffer(); } });
  f.Sfx.startBed(1); await flush();
  assert.equal(f.requests.length, 7); assert.equal(f.Sfx.debugAudioState.loading, false);
  assert.equal(f.Sfx.debugAudioState.lastLoadError, 'Unable to decode a licensed music bed');
  fail = false; f.Sfx.startMusic(); await flush(); assert.equal(f.Sfx.debugAudioState.playing, true);
});
await test('stop during decode aborts request and prevents late source or cached stale bed', async () => {
  const d = deferred(), f = fixture({ decoder: () => d.promise });
  f.Sfx.startMusic(); await flush(); f.Sfx.stopMusic();
  assert.equal(f.requests[0].options.signal.aborted, true);
  d.resolve(buffer()); await flush();
  assert.equal(f.contexts[0].nodes.filter(n => n.kind === 'source').length, 0);
  assert.equal(f.Sfx.debugAudioState.actualBedIndex, null); assert.equal(f.Sfx.debugAudioState.musicWanted, false);
});
await test('mute during fetch/decode prevents late source and unmute retries', async () => {
  const d = deferred(); let first = true;
  const f = fixture({ decoder: () => { if (first) { first = false; return d.promise; } return Promise.resolve(buffer()); } });
  f.Sfx.startMusic(); await flush(); f.Sfx.setMuted(true); d.resolve(buffer()); await flush();
  assert.equal(f.contexts[0].nodes.filter(n => n.kind === 'source').length, 0);
  f.Sfx.setMuted(false); await flush(); assert.equal(f.Sfx.debugAudioState.playing, true);
});
await test('late fetch completion after stop or mute cannot spawn a source', async () => {
  for (const action of ['stopMusic', 'mute']) {
    const response = deferred(), f = fixture({ fetcher: () => response.promise });
    f.Sfx.startMusic();
    if (action === 'mute') f.Sfx.setMuted(true); else f.Sfx.stopMusic();
    assert.equal(f.requests[0].options.signal.aborted, true);
    response.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }); await flush();
    assert.equal(f.contexts[0].nodes.filter(n => n.kind === 'source').length, 0);
    assert.equal(f.Sfx.debugAudioState.loading, false); assert.equal(f.Sfx.debugAudioState.actualBedIndex, null);
  }
});
await test('muting a running bed silences master and unmute retains exactly one source', async () => {
  const f = fixture(); f.Sfx.startBed(2); await flush(); const c = f.contexts[0];
  f.Sfx.setMuted(true); assert.equal(f.Sfx.debugAudioState.gains.master, 0); assert.equal(f.Sfx.debugAudioState.playing, false);
  f.Sfx.setMuted(false); await flush(); assert.equal(f.Sfx.debugAudioState.gains.master, .8); assert.equal(f.Sfx.debugAudioState.playing, true);
  assert.equal(c.nodes.filter(n => n.kind === 'source').length, 1);
});
await test('hidden flag before context creation prevents ensure and late decode from resuming', async () => {
  const d = deferred(), f = fixture({ decoder: () => d.promise });
  f.Sfx.setSuspended(true); f.Sfx.startMusic(); f.Sfx.play('click'); await flush();
  const c = f.contexts[0]; assert.equal(c.resumeCalls, 0); assert.equal(c.state, 'suspended');
  d.resolve(buffer()); await flush(); f.Sfx.play('click'); f.gesture(); await flush();
  assert.equal(c.resumeCalls, 0); assert.equal(c.nodes.filter(n => n.started).length, 0);
  assert.equal(f.Sfx.debugAudioState.suspended, true);
  f.Sfx.setSuspended(false); await flush(); assert.equal(f.Sfx.debugAudioState.playing, true);
});
await test('document already hidden is honored even before director visibility binding', async () => {
  const f = fixture({ hidden: true }); f.Sfx.startMusic(); await flush();
  const c = f.contexts[0]; assert.equal(c.resumeCalls, 0); assert.equal(c.nodes.filter(n => n.started).length, 0);
  f.Sfx.setSuspended(false); await flush(); assert.equal(c.resumeCalls, 0, 'teardown false cannot resume a hidden document');
  f.document.hidden = false; f.Sfx.setSuspended(false); await flush(); assert.equal(f.Sfx.debugAudioState.playing, true);
});
await test('visibility during decode and during pending resume cannot leak a source', async () => {
  const d = deferred(), f = fixture({ decoder: () => d.promise }); f.Sfx.startMusic(); await flush();
  f.Sfx.setSuspended(true); d.resolve(buffer()); await flush();
  assert.equal(f.contexts[0].nodes.filter(n => n.kind === 'source').length, 0);
  f.Sfx.setSuspended(false); await flush(); assert.equal(f.Sfx.debugAudioState.playing, true);
  const resume = deferred(), g = fixture({ state: 'suspended', resumeDeferred: resume }); g.Sfx.startMusic();
  const c = g.contexts[0];
  // A new visibility pause before the pending resume resolves wins over that resume.
  await flush(); g.Sfx.setSuspended(true); resume.resolve(); await flush();
  assert.equal(c.state, 'suspended'); assert.equal(c.nodes.filter(n => n.kind === 'source').length, 0);
});
await test('gesture failure re-arms once, success starts once, stop removes every retry', async () => {
  const f = fixture({ state: 'suspended', resumeBlocked: true }); f.Sfx.startMusic(); await flush();
  assert.equal(f.listeners.get('pointerdown').size, 1); f.gesture(); await flush(); assert.equal(f.listeners.get('pointerdown').size, 1);
  f.contexts[0].resumeBlocked = false; f.gesture(); await flush(); assert.equal(f.Sfx.debugAudioState.playing, true);
  assert.equal(f.listeners.get('pointerdown').size, 0); f.Sfx.stopMusic();
  f.contexts[0].state = 'suspended'; f.contexts[0].resumeBlocked = true; f.Sfx.startMusic(); await flush(); f.Sfx.stopMusic();
  for (const type of ['pointerdown', 'touchend', 'keydown']) assert.equal(f.listeners.get(type).size, 0);
});
await test('restart and bed change invalidate old decode while keeping one persistent graph', async () => {
  const old = deferred(), fresh = deferred(); let decode = 0;
  const f = fixture({ decoder: () => (++decode === 1 ? old.promise : fresh.promise) });
  f.Sfx.startBed(1); await flush(); f.Sfx.startBed(6); await flush();
  old.resolve(buffer()); await flush(); assert.equal(f.Sfx.debugAudioState.actualBedIndex, null);
  fresh.resolve(buffer()); await flush(); assert.equal(f.Sfx.debugAudioState.actualBedIndex, 6);
  assert.equal(f.Sfx.debugAudioState.gains.bedTrim, 1);
  for (let i = 0; i < 5; i++) {
    f.Sfx.playCue('boss-warning'); f.Sfx.playHeartbeat('impact', true);
    assert.equal(f.contexts[0].nodes.filter(n => n.kind === 'oscillator' && !n.disconnected).length, 5, 'bio + 4 still-live layer tones');
    f.Sfx.stopMusic();
    const c = f.contexts[0];
    assert(c.nodes.filter(n => ['source', 'oscillator'].includes(n.kind) && n.started).every(n => n.disconnected));
    f.Sfx.startBed(6); await flush();
    assert.equal(c.nodes.filter(n => n.kind === 'compressor').length, 1);
    assert.equal(c.nodes.filter(n => n.kind === 'filter').length, 1);
  }
  assert.equal(f.contexts.length, 1);
});
await test('transient tone natural ended cleanup disconnects both nodes and teardown stays idempotent', async () => {
  const f = fixture(); f.Sfx.startMusic(); await flush(); f.Sfx.playCue('stage-start');
  const c = f.contexts[0], tones = c.nodes.filter(n => n.kind === 'oscillator' && n.scheduledStop);
  assert.equal(tones.length, 2);
  for (const tone of tones) {
    const gain = tone.connections[0]; tone.onended(); assert(tone.disconnected && gain.disconnected); assert.equal(tone.onended, null);
  }
  f.Sfx.stopMusic(); f.Sfx.stopMusic(); assert.equal(f.Sfx.debugAudioState.playing, false);
});
if (failures.length) { console.error(`${failures.length} audio mix contract(s) failed`); process.exitCode = 1; }
else console.log('audio mix: 17/17 contracts passed (production TS math + WebAudio boundary)');

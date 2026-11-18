// C+ v4 WebAudio runtime contracts.
//
// These tests drive the *production* `src/systems/Sfx.ts` through a fake
// WebAudio implementation and assert what actually happens on the audio
// graph: which files are fetched, which buffers are decoded, which sources
// are started and which are stopped.
//
// Testing `CPlusAudioDirector` alone is not enough — the defects these tests
// cover lived in `Sfx.ts` (request-id ordering, the OGG -> MP3 fallback,
// the mute intent and the stinger lifecycle).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ts = createRequire(import.meta.url)('typescript');

function load(path, globals = {}, cache = new Map()) {
  path = path.replace(/\\/g, '/');
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  const source = readFileSync(path, 'utf8').replace('import.meta.env.BASE_URL', "'./'");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const require = (name) => {
    if (name === './SaveSystem') return { SaveSystem: globals.__saveSystem.SaveSystem };
    if (name === '../release') return { RELEASE_SHA: 'cplus-test' };
    if (name === 'zzfx') return { ZZFX: { buildSamples: () => new Float32Array(1024) } };
    return load(`src/systems/${name}.ts`, globals, cache);
  };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    require, module, module.exports, ...Object.values(globals)
  );
  cache.set(path, module.exports);
  return module.exports;
}

const flush = async (ticks = 24) => {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
};

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

/**
 * @param {object} opts
 * @param {(url: string) => boolean} [opts.failFetch] url -> true when the fetch must fail
 * @param {(url: string) => boolean} [opts.failDecode] url -> true when the decode must throw
 * @param {boolean} [opts.muted] saved mute state
 */
function fixture(opts = {}) {
  const requests = [];
  const sources = [];
  const warnings = [];
  const saved = { muted: opts.muted === true, musicVolume: 1, sfxVolume: 1, update(patch) { Object.assign(this, patch); } };
  const saveSystem = { SaveSystem: { get: () => saved, update: (patch) => saved.update(patch) } };

  class Context {
    constructor() {
      this.state = 'running';
      this.currentTime = 10;
      this.nodes = [];
      this.destination = { kind: 'destination' };
    }
    node(kind) {
      const n = {
        kind,
        connections: [],
        disconnected: false,
        started: false,
        stopped: false,
        onended: null,
        connect(to) { this.connections.push(to); },
        disconnect() { this.disconnected = true; this.connections = []; },
        start() { assert.ok(!this.started, 'source started twice'); this.started = true; },
        stop(at) {
          if (at !== undefined) { this.scheduledStop = at; return; }
          this.stopped = true;
          if (this.onended) this.onended();
        },
      };
      this.nodes.push(n);
      return n;
    }
    createGain() { return Object.assign(this.node('gain'), { gain: param(1) }); }
    createBiquadFilter() { return Object.assign(this.node('filter'), { frequency: param(350), Q: param(1) }); }
    createDynamicsCompressor() {
      return Object.assign(this.node('compressor'), Object.fromEntries(
        ['threshold', 'knee', 'ratio', 'attack', 'release'].map((k) => [k, param(0)])
      ));
    }
    createBufferSource() { const n = this.node('source'); sources.push(n); return n; }
    createBuffer(channels, length, rate) {
      return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: () => new Float32Array(length) };
    }
    createOscillator() { return Object.assign(this.node('oscillator'), { frequency: param(440) }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    decodeAudioData(ab) {
      const url = ab && ab.url ? ab.url : '';
      if (opts.failDecode && opts.failDecode(url)) return Promise.reject(new Error('decode failed'));
      return Promise.resolve({ numberOfChannels: 2, length: 44100, sampleRate: 44100, getChannelData: () => new Float32Array(44100), url });
    }
  }
  const param = (value) => ({
    value,
    calls: [],
    cancelScheduledValues(t) { this.calls.push(['cancel', t]); },
    setValueAtTime(v, t) { this.value = v; this.calls.push(['set', v, t]); },
    setTargetAtTime(v, t, tau) { this.value = v; this.calls.push(['target', v, t, tau]); },
    linearRampToValueAtTime(v, t) { this.value = v; this.calls.push(['ramp', v, t]); },
    exponentialRampToValueAtTime(v, t) { this.value = v; this.calls.push(['exp', v, t]); },
  });

  const document = { hidden: false };
  const listeners = new Map();
  const window = {
    AudioContext: Context,
    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); },
    removeEventListener(t, fn) { listeners.get(t)?.delete(fn); },
  };

  const fetch = (url, options) => {
    requests.push({ url, options });
    if (opts.failFetch && opts.failFetch(url)) return Promise.resolve({ ok: false, status: 404, arrayBuffer: async () => ({ url }) });
    if (opts.holdFetch) {
      const d = deferred();
      options?.signal?.addEventListener?.('abort', () => d.reject(new Error('aborted')));
      return d.promise;
    }
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => ({ url }) });
  };

  const { Sfx } = load('src/systems/Sfx.ts', {
    window, document, fetch, console: { warn: (...a) => warnings.push(a) }, __saveSystem: saveSystem,
  });

  return {
    Sfx, requests, sources, warnings, saved,
    startedSources: () => sources.filter((s) => s.started),
    stoppedSources: () => sources.filter((s) => s.stopped),
  };
}

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

const isOgg = (url) => url.includes('.ogg');
const isMp3 = (url) => url.includes('.mp3');

await test('a cold C+ start fetches the OGG and starts a source', async () => {
  const f = fixture();
  f.Sfx.startCPlusBed('bloodstream');
  await flush();
  assert.ok(f.requests.length >= 1, 'no request was made');
  assert.ok(isOgg(f.requests[0].url), 'the OGG candidate must be tried first');
  assert.equal(f.startedSources().length, 1, 'the decoded bed must be started');
});

await test('an OGG 404 falls through to the MP3 candidate', async () => {
  const f = fixture({ failFetch: isOgg });
  f.Sfx.startCPlusBed('bloodstream');
  await flush();
  assert.equal(f.requests.length, 2, `expected two candidates, got ${f.requests.length}`);
  assert.ok(isMp3(f.requests[1].url), 'the MP3 candidate must be tried second');
  assert.equal(f.startedSources().length, 1, 'the MP3 bed must be started');
});

await test('an OGG decode failure falls through to the MP3 candidate', async () => {
  const f = fixture({ failDecode: isOgg });
  f.Sfx.startCPlusBed('bloodstream');
  await flush();
  assert.equal(f.requests.length, 2, `expected two candidates, got ${f.requests.length}`);
  assert.ok(isMp3(f.requests[1].url), 'the MP3 candidate must be tried second');
  assert.equal(f.startedSources().length, 1, 'the MP3 bed must be started');
});

await test('when every candidate fails the game state stays intact', async () => {
  const f = fixture({ failFetch: () => true });
  f.Sfx.startCPlusBed('bloodstream');
  await flush();
  assert.equal(f.startedSources().length, 0, 'no source may be started');
  assert.ok(f.warnings.length >= 1, 'the failure must be reported');
  assert.equal(f.Sfx.debugAudioState.contextState, 'running', 'the audio graph must stay alive');
});

await test('a cold Victory/Defeat stinger loads and plays', async () => {
  const f = fixture();
  f.Sfx.playCPlusStinger('victory');
  await flush();
  assert.equal(f.requests.length, 1);
  assert.ok(isOgg(f.requests[0].url), 'the stinger must use the same candidate order');
  assert.equal(f.startedSources().length, 1, 'the stinger must be started');
});

await test('a stinger whose OGG fails falls through to the MP3', async () => {
  const f = fixture({ failDecode: isOgg });
  f.Sfx.playCPlusStinger('defeat');
  await flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.startedSources().length, 1);
});

await test('a superseded bed load never produces a source', async () => {
  const f = fixture({ holdFetch: true });
  f.Sfx.startCPlusBed('bloodstream');
  await flush();
  f.Sfx.startCPlusBed('heart');
  await flush();
  const started = f.startedSources().length;
  assert.equal(started, 0, 'no source may start while the newest request is still pending');
  assert.ok(f.requests.length >= 2, 'the second bed must issue its own request');
});

await test('a run started muted records the intent and plays on unmute', async () => {
  const f = fixture({ muted: true });
  f.Sfx.startCPlusBed('heart');
  await flush();
  assert.equal(f.requests.length, 0, 'a muted run must not fetch anything');
  assert.equal(f.startedSources().length, 0, 'a muted run must not start a source');

  f.Sfx.setMuted(false);
  await flush();
  assert.ok(f.requests.length >= 1, 'unmuting must start the bed');
  assert.ok(f.requests[0].url.includes('heart'), `the current bed must resume, got ${f.requests[0].url}`);
  assert.equal(f.startedSources().length, 1, 'the bed must start after unmute');
});

await test('a boss switch while muted resumes the boss bed, not the stale act bed', async () => {
  const f = fixture({ muted: true });
  f.Sfx.startCPlusBed('bloodstream');
  await flush();
  f.Sfx.startCPlusBed('immune-prime');
  await flush();
  assert.equal(f.requests.length, 0, 'nothing may be fetched while muted');

  f.Sfx.setMuted(false);
  await flush();
  assert.ok(f.requests.length >= 1, 'unmuting must start the current bed');
  assert.ok(
    f.requests[0].url.includes('immune_prime'),
    `the boss bed must resume, got ${f.requests[0].url}`
  );
});

await test('a stinger requested while muted is delivered on unmute', async () => {
  const f = fixture({ muted: true });
  f.Sfx.playCPlusStinger('victory');
  await flush();
  assert.equal(f.startedSources().length, 0, 'a muted stinger must not play');
  f.Sfx.setMuted(false);
  await flush();
  assert.equal(f.startedSources().length, 1, 'the stinger must be delivered on unmute');
});

await test('a fast restart stops the live stinger and drops a pending one', async () => {
  const f = fixture();
  f.Sfx.playCPlusStinger('victory');
  await flush();
  assert.equal(f.startedSources().length, 1);
  f.Sfx.stopMusic();
  assert.equal(f.stoppedSources().length, 1, 'the stinger must be stopped on teardown');

  const g = fixture({ muted: true });
  g.Sfx.playCPlusStinger('victory');
  await flush();
  g.Sfx.setMuted(false);
  await flush();
  assert.equal(g.startedSources().length, 1);
  g.Sfx.stopMusic();
  assert.equal(g.stoppedSources().length, 1, 'the stinger must be stopped on teardown');
});

await test('a new bed cancels the previous run stinger', async () => {
  const f = fixture();
  f.Sfx.playCPlusStinger('victory');
  await flush();
  f.Sfx.startCPlusBed('heart');
  await flush();
  assert.equal(f.stoppedSources().length, 1, 'the previous run signal must not overlap the new bed');
});

if (failures) {
  console.error(`${failures} of ${total} C+ WebAudio check(s) failed`);
  process.exit(1);
}
console.log(`C+ WebAudio runtime: ${total}/${total} checks passed`);

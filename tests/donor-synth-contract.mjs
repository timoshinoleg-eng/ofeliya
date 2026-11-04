/**
 * Donor core, part B — ZzFX synth contract.
 *
 * 1. The preset table covers every SfxName (union parsed from Sfx.ts, not a
 *    copied list) with valid tones: positive frequencies, positive duration,
 *    volume in (0, 1), known shape, non-negative delay.
 * 2. Spot pins moved here from the old oscillator code: kill is 300 -> 90 Hz
 *    over 0.09 s triangle; pickup2 starts at 720 Hz (the pin the audio-mix
 *    cursor test used to read off an oscillator node).
 * 3. Sfx routes its fallback through the preset table and the ZzFX bridge:
 *    Sfx.ts imports zzfxPresets + ZzfxSynth, and no src/ file calls
 *    ZZFX.play/playSamples (those would bypass the game's own AudioContext
 *    and master gain). The bridge converts f0/f1/dur to the library's slide
 *    with the formula (f1-f0)/(500*dur), derived from the 1.4.0 source.
 * 4. License safety: the installed zzfx package must be MIT, version 1.x.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const read = (rel) => readFileSync(resolve(rel), 'utf8');

// 4. Installed zzfx license + version.
const zzpkg = require(resolve('node_modules/zzfx/package.json'));
assert(zzpkg.license === 'MIT', `zzfx license is not MIT: ${zzpkg.license}`);
assert(String(zzpkg.version).startsWith('1.'), `zzfx version must be 1.x: ${zzpkg.version}`);

// 1. Every SfxName has a preset; tones are valid.
const sfx = read('src/systems/Sfx.ts');
const union = sfx.slice(sfx.indexOf('export type SfxName ='), sfx.indexOf(';', sfx.indexOf('export type SfxName =')));
const names = [...union.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
assert(names.length >= 17, `SfxName union parse failed, got ${names.length} names`);
const presets = read('src/systems/zzfxPresets.ts');
const shapes = new Set(['sine', 'triangle', 'sawtooth', 'square']);
for (const name of names) {
  const start = presets.indexOf(`${name}:`);
  assert(start >= 0, `ZZFX_PRESETS missing ${name}`);
  // Tone entries for this name: t(f0, f1, dur, 'shape', vol[, delay]).
  const block = presets.slice(start, presets.indexOf('],', start));
  const tones = [...block.matchAll(/t\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*'(\w+)',\s*([\d.]+)(?:,\s*([\d.]+))?\)/g)];
  assert(tones.length >= 1, `ZZFX_PRESETS.${name} has no tones`);
  for (const [, f0, f1, dur, shape, vol, delay] of tones) {
    assert(Number(f0) > 0 && Number(f1) > 0, `${name}: frequencies must be positive`);
    assert(Number(dur) > 0, `${name}: duration must be positive`);
    assert(Number(vol) > 0 && Number(vol) < 1, `${name}: volume must be in (0, 1)`);
    assert(shapes.has(shape), `${name}: unknown shape ${shape}`);
    assert(delay === undefined || Number(delay) >= 0, `${name}: delay must be non-negative`);
  }
}

// 2. Spot pins.
assert(/kill:\s*\[t\(300,\s*90,\s*0\.09,\s*'triangle',\s*0\.05\)\]/.test(presets), 'kill preset must be 300->90 Hz, 0.09 s, triangle');
assert(/pickup2:\s*\[t\(720,\s*1180,\s*0\.07,\s*'sine',\s*0\.05\)\]/.test(presets), 'pickup2 preset must start at 720 Hz');
assert(/shoot:\s*\[t\(760,\s*410,\s*0\.055,\s*'triangle',\s*0\.03\)\]/.test(presets), 'shoot preset must be 760->410 Hz, 0.055 s');

// 3. Wiring: fallback uses the table + bridge; no library playback path.
assert(sfx.includes("from './zzfxPresets'"), 'Sfx must import zzfxPresets');
assert(sfx.includes("from './ZzfxSynth'"), 'Sfx must import ZzfxSynth');
assert(sfx.includes('ZZFX_PRESETS[name]'), 'fallback must play ZZFX_PRESETS[name]');
assert(!/blip\(/.test(sfx), 'Sfx must not call the removed blip()');
const synth = read('src/systems/ZzfxSynth.ts');
assert(synth.includes("from 'zzfx'"), 'ZzfxSynth must import the zzfx package');
assert(synth.includes('ZZFX.buildSamples'), 'ZzfxSynth must use ZZFX.buildSamples');
assert(synth.includes('(tone.f1 - tone.f0) / (500 * tone.dur)'), 'slide formula must be (f1-f0)/(500*dur)');
assert(synth.includes('ZZFX_SAMPLE_RATE = 44100'), 'ZzFX sample rate must be 44100');
const { execSync } = require('node:child_process');
const hits = execSync("grep -rn --include='*.ts' -E 'ZZFX\\.play\\(|playSamples\\(' src/ || true", { encoding: 'utf8' }).trim();
assert(hits === '', `src/ must never call ZZFX.play/playSamples, found: ${hits}`);

console.log(`donor-synth: OK (${names.length} SfxNames preset, zzfx ${zzpkg.version} MIT)`);

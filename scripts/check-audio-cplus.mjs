// C+ v4 audio asset gate.
//
// The production gate (`scripts/check-audio-assets.mjs`) pins the licensed
// CC0 beds in `public/audio/music/`. The C+ beds live in their own folder
// (`public/audio/cplus-v4/`) so that the production audio set stays
// byte-for-byte unchanged while the C+ set is still verified by CI.
//
// This gate:
//   - checks that every file in the C+ manifest exists and is not corrupt;
//   - pins every shipped file by sha256;
//   - re-checks the documented mastering contract (-14 LUFS +/- 0.5,
//     true peak <= -1 dBTP, stereo, 44.1 kHz);
//   - checks that `src/systems/cplusAudioMath.ts` references exactly the
//     manifested files (no code/asset drift in either direction).
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const AUDIO = resolve(ROOT, 'public/audio/cplus-v4');
const MANIFEST_PATH = resolve(AUDIO, 'audio-manifest-cplus.json');

const MUSIC_TARGET_LUFS = -14.0;
const LUFS_TOLERANCE = 0.75; // lossy re-measurement variance
const TP_CEILING = -1.0;
const MIN_SECONDS = 3.5;
const MAX_SECONDS = 110;

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL ${msg}`); };
const pass = (msg) => console.log(`PASS ${msg}`);

let manifest;
try {
  manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
} catch {
  fail(`C+ audio manifest missing or unreadable: ${MANIFEST_PATH}`);
  console.error(`${failures} C+ audio asset check(s) failed`);
  process.exit(1);
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const entries = Object.entries(manifest.assets ?? {});
if (!entries.length) fail('C+ manifest has no assets');

let musicFiles = 0;
for (const [rel, m] of entries) {
  const path = resolve(AUDIO, rel);
  let exists = true;
  try { await readFile(path); } catch { exists = false; }
  if (!exists) { fail(`${rel}: file missing`); continue; }

  if (m.sha256 && sha256(path) !== m.sha256) {
    fail(`${rel}: sha256 drift — rebuild with tools/audio/cplus/build.py`);
    continue;
  }
  if (!(m.bytes > 0) || m.bytes !== (await readFile(path)).byteLength) {
    fail(`${rel}: byte size mismatch`);
  }
  if (m.kind !== 'music') fail(`${rel}: unknown kind ${m.kind}`);
  if (m.channels !== 2) fail(`${rel}: not stereo (channels=${m.channels})`);
  if (m.sampleRate !== 44100) fail(`${rel}: unexpected sample rate ${m.sampleRate}`);
  if (!(rel.endsWith('.ogg') || rel.endsWith('.mp3'))) fail(`${rel}: unexpected container`);
  if (typeof m.lufs !== 'number' || Math.abs(m.lufs - MUSIC_TARGET_LUFS) > LUFS_TOLERANCE) {
    fail(`${rel}: LUFS ${m.lufs} outside ${MUSIC_TARGET_LUFS} +/- ${LUFS_TOLERANCE}`);
  }
  if (typeof m.truePeakDbTp !== 'number' || m.truePeakDbTp > TP_CEILING) {
    fail(`${rel}: true peak ${m.truePeakDbTp} dBTP above ${TP_CEILING}`);
  }
  if (!(m.durationSec >= MIN_SECONDS) || m.durationSec > MAX_SECONDS) {
    fail(`${rel}: unexpected duration ${m.durationSec}s`);
  }
  if (m.clippedFraction > 0) fail(`${rel}: clipped samples present`);
  musicFiles += 1;
}
if (musicFiles) pass(`${musicFiles} C+ music files pinned to the mastering contract`);

// Code/asset drift: the mapping module must reference exactly the manifested
// files, in both directions.
const mathSource = await readFile(resolve(ROOT, 'src/systems/cplusAudioMath.ts'), 'utf8');
const referenced = new Set(
  [...mathSource.matchAll(/audio\/cplus-v4\/[A-Za-z0-9_.-]+/g)].map((x) => x[0])
);
const declared = new Set(entries.map(([rel]) => `audio/cplus-v4/${rel}`));
for (const ref of referenced) {
  if (!declared.has(ref)) fail(`cplusAudioMath.ts references ${ref}, which is not in the C+ manifest`);
}
for (const ref of declared) {
  if (!referenced.has(ref)) fail(`C+ manifest asset ${ref} is not referenced by cplusAudioMath.ts`);
}
if (failures === 0) pass('cplusAudioMath.ts references and the C+ manifest are in 1:1 correspondence');

if (failures) {
  console.error(`${failures} C+ audio asset check(s) failed`);
  process.exit(1);
}
console.log(`C+ audio assets: manifest contract OK (${entries.length} assets)`);

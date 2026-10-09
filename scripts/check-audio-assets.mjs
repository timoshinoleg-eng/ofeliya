// Audio asset gate: verifies shipped audio matches the mastering manifest.
//
// The loudness/true-peak values in public/audio/audio-manifest.json are measured by
// tools/audio/master_audio.py (BS.1770 K-weighting + 4x true peak). CI cannot re-measure
// without a decoder dependency, so this gate pins the mastered files by sha256 and
// re-checks the documented contract, and cross-checks that src/systems/Sfx.ts references
// exactly the manifested files (no code/asset drift).
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const AUDIO = resolve(ROOT, 'public/audio');
const MANIFEST_PATH = resolve(AUDIO, 'audio-manifest.json');

const MUSIC_TARGET_LUFS = -14.0;
const LUFS_TOLERANCE = 0.75; // lossy re-measurement variance
const TP_CEILING = -1.0;

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL ${msg}`); };
const pass = (msg) => console.log(`PASS ${msg}`);

let manifest;
try {
  manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
} catch {
  fail(`audio manifest missing or unreadable: ${MANIFEST_PATH}`);
  console.error(`${failures} audio asset check(s) failed`);
  process.exit(1);
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const entries = Object.entries(manifest.assets ?? {});
if (!entries.length) fail('manifest has no assets');

const musicFiles = [];
const sfxFiles = [];

for (const [rel, m] of entries) {
  const path = resolve(AUDIO, rel);
  let exists = true;
  try { await readFile(path); } catch { exists = false; }
  if (!exists) { fail(`${rel}: file missing`); continue; }

  if (m.sha256 && sha256(path) !== m.sha256) {
    fail(`${rel}: sha256 drift — rerun tools/audio/master_audio.py --apply`);
    continue;
  }

  if (m.kind === 'music') {
    musicFiles.push(rel);
    if (typeof m.lufs !== 'number' || Math.abs(m.lufs - MUSIC_TARGET_LUFS) > LUFS_TOLERANCE) {
      fail(`${rel}: LUFS ${m.lufs} outside ${MUSIC_TARGET_LUFS} ± ${LUFS_TOLERANCE}`);
    }
    if (typeof m.truePeakDbTp !== 'number' || m.truePeakDbTp > TP_CEILING) {
      fail(`${rel}: true peak ${m.truePeakDbTp} dBTP above ${TP_CEILING}`);
    }
    if (m.channels !== 2) fail(`${rel}: music bed is not stereo (channels=${m.channels})`);
    if (!(rel.endsWith('.ogg') || rel.endsWith('.mp3'))) fail(`${rel}: unexpected container`);
  } else if (m.kind === 'sfx') {
    sfxFiles.push(rel);
    if (!(m.durationSec > 0)) fail(`${rel}: missing duration`);
  } else {
    fail(`${rel}: unknown kind ${m.kind}`);
  }
}
if (musicFiles.length) pass(`${musicFiles.length} music beds pinned to the mastering contract`);
if (sfxFiles.length) pass(`${sfxFiles.length} SFX files pinned by hash`);

// Code/asset drift: Sfx.ts must reference exactly the manifested files.
const sfxSource = await readFile(resolve(ROOT, 'src/systems/Sfx.ts'), 'utf8');
const referenced = new Set(
  [...sfxSource.matchAll(/audio\/(?:music|sfx)\/[A-Za-z0-9_.-]+/g)].map((x) => x[0])
);
const declared = new Set(entries.map(([rel]) => `audio/${rel}`));
for (const ref of referenced) {
  if (!declared.has(ref)) fail(`Sfx.ts references ${ref}, which is not in the audio manifest`);
}
for (const [rel] of entries) {
  if (!referenced.has(`audio/${rel}`)) fail(`manifest asset audio/${rel} is not referenced by Sfx.ts`);
}
if (failures === 0) pass('Sfx.ts references and manifest are in 1:1 correspondence');

if (failures) {
  console.error(`${failures} audio asset check(s) failed`);
  process.exit(1);
}
console.log(`audio assets: manifest contract OK (${entries.length} assets)`);

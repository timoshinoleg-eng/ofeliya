# Audio mastering contract

All licensed music beds in `public/audio/music/` are mastered to a single loudness target so
runtime mixing needs no per-bed compensation:

- **Integrated loudness:** −14 LUFS (BS.1770 K-weighting), tolerance ±0.5 dB
- **True peak:** ≤ −1 dBTP (4x oversampled)
- **Channels:** stereo (a former mono bed was duplicated)
- **Containers:** unchanged per file — `ogg` beds stay Vorbis (gapless `loop=true`), `mp3` beds
  stay MP3 (Safari / iOS WebView `decodeAudioData` has no Ogg-Vorbis)

SFX in `public/audio/sfx/` keep their licensed CC0 sources untouched; runtime playback
normalizes them via `scanNormalizationTrim` in `src/systems/audioMixMath.ts`.

## Pipeline

`tools/audio/master_audio.py` (Python: `soundfile`, `pyloudnorm`, `scipy`, `imageio-ffmpeg`):

```bash
python tools/audio/master_audio.py          # verify + write public/audio/audio-manifest.json
python tools/audio/master_audio.py --apply  # additionally re-master out-of-contract music beds
```

Encoding goes through the ffmpeg binary bundled with `imageio-ffmpeg` because the Windows
libsndfile build crashes writing Vorbis streams longer than ~60 s. Beds whose loudness boost
would exceed the true-peak ceiling pass through a lookahead limiter (`alimiter` at −1.6 dBFS
sample peak) so the LUFS target survives; pure gain-down would sacrifice several dB of
loudness on high-crest beds (e.g. `loop4`).

The script only re-encodes beds that are out of contract, so repeat runs are stable no-ops.

## CI gate

`npm run test:audio-assets` (`scripts/check-audio-assets.mjs`) pins every shipped audio file
by sha256 against `public/audio/audio-manifest.json`, re-checks the loudness/true-peak
contract, and verifies that `src/systems/Sfx.ts` references exactly the manifested files.
After changing any audio asset, rerun the mastering script and commit the updated manifest.

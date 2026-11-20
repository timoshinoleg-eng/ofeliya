# OFELIYA C+ v4 — procedural audio generator

Everything in the C+ v4 audio package is **synthesised from scratch** by this
code: oscillators, filters, envelopes, reverbs and dynamics are computed with
numpy/scipy. No sample library, no donor track, no model file is involved, so
the provenance of every shipped byte is unambiguous (see `PROVENANCE.md` in the
final package).

## Requirements

```
python >= 3.10
numpy
scipy
soundfile
pyloudnorm
ffmpeg   (on PATH — used for the ogg/mp3 encodes)
```

```bash
pip install numpy scipy soundfile pyloudnorm
```

## Build the whole package

```bash
python tools/audio/cplus/build.py --out <output-dir> \
    --manifest-out public/audio/cplus-v4/audio-manifest-cplus.json
```

Produces, per composition:

| path                  | content                                                  |
|-----------------------|----------------------------------------------------------|
| `source/<id>.wav`     | raw render, before mastering                             |
| `wav/<id>.wav`        | mastered: -14 LUFS, <= -1 dBTP, stereo, 44.1 kHz         |
| `ogg/<id>.ogg`        | Vorbis q5 — gapless, the loop-safe container             |
| `mp3/<id>.mp3`        | LAME 128 kbps — Safari / iOS WebView safe                |
| `analysis/<id>.json`  | measured metrics + the QA reports                        |

The build is deterministic: the same sources produce the same bytes.

## Build the comparison stand

```bash
python tools/audio/cplus/build_stand.py \
    --package <output-dir> \
    --audition <path-to-ofeliya-audio-audition-v3> \
    --repo    <path-to-the-ofeliya-worktree>
```

Copies the comparison files into `<output-dir>/stand/assets/`, measures them
and writes `<output-dir>/stand/data/manifest.json` for `stand/index.html`.

## Verify the shipped assets

```bash
npm run test:audio-cplus     # pins the C+ assets by sha256 + the mastering contract
npm run test:cplus-audio     # pure mapping math + director contracts
```

## The compositions

| id              | role        | length | bars @ 72 BPM |
|-----------------|-------------|--------|---------------|
| `bloodstream`   | act I bed   | 80.0 s | 24            |
| `heart`         | act II bed  | 80.0 s | 24            |
| `immune_prime`  | boss bed    | 80.0 s | 24            |
| `cardiac_titan` | climax bed  | 100.0 s| 30            |
| `victory`       | stinger     | 4.0 s  | one-shot       |
| `defeat`        | stinger     | 4.5 s  | one-shot       |

### Musical contract

* **F minor** everywhere (root F2 = 87.31 Hz), so the act I bed, the act II bed,
  the boss beds and the stingers are interchangeable at the act boundary.
* **No competing heartbeat.** The game owns the procedural bio pulse
  (`bioOsc` in `src/systems/Sfx.ts`), so no bed carries a 60–120 BPM thump. The
  boss beds use 144 BPM eighth-note ostinati: urgent, but clearly distinct
  from the game's organ-locked 900 ms (= 66.7 BPM) pulse in the Heart stage.
* **Weight where a phone speaker can reproduce it.** Musical energy lives in
  87–220 Hz and in the air above 4 kHz — the band the game's adaptive lowpass
  opens (2.5–14 kHz) when danger rises. The 1.5–3.5 kHz pocket stays sparse so
  the combat telegraphs stay readable.
* **Chord voices between 87 Hz and 220 Hz.** Nothing is voiced below 87 Hz
  because the 78 Hz mastering high-pass would remove it anyway.

### How the loop is made seamless

Three independent mechanisms, in order:

1. **Periodicity.** Oscillator phase is integrated from the frequency
   trajectory and then corrected so the advance over one period is a whole
   number of cycles (`gliding_osc`). Slow modulation rates are integer
   multiples of `1 / length`. The bar-level contour starts and ends on the
   same value.
2. **Trim after mastering.** The composition is rendered 60 ms longer than the
   final length so the *mastering* filters can settle; the extra head is
   removed after mastering, not before — otherwise the filter start-up
   transient would land exactly on the loop point.
3. **Overlap-add.** The tail is cross-faded onto the head
   (`close_loop`), so the wrap is a natural continuation of the source even if
   a mastering stage leaves a small edge artefact.

`ofeliya_cplus.metrics.seam_report` then verifies the result: the sample step
at the wrap must not exceed the largest step that occurs naturally inside the
file, the band balance across the boundary must match within 6 dB, and the
same is re-checked over ten concatenated cycles.

## The mastering chain

```
high-pass     78 Hz (4th order)   - remove inaudible sub on a phone speaker
peaking      +1.5 dB @ 155 Hz     - the S20 "punch" band
high shelf   +1.0 dB @ 5.5 kHz    - air for the adaptive lowpass
bus compression 2:1 @ -18 dBFS
saturation   tanh, drive 1.5      - density, crest control
program limiter -6 dBFS           - crest control before normalisation
loudness      -14.0 LUFS (BS.1770, +/- 0.5 dB)
true peak    <= -1 dBTP (4x oversampled)
```

The loudness/peak stage iterates: normalise, limit, measure, correct. The
limiter works on the sample peak while the contract is written on the true
peak, so the ceiling is tightened until the 4x-oversampled measurement fits.

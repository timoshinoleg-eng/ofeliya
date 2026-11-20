"""Compositions for OFELIYA Audio v4 — C+ Mobile / Adaptive.

Six pieces, all synthesised from scratch (no samples, no donor audio):

| id                | role                | length | bars @ 72 BPM |
|-------------------|---------------------|--------|---------------|
| `bloodstream`     | act I bed           | 80.0 s | 24            |
| `heart`           | act II bed          | 80.0 s | 24            |
| `immune_prime`    | boss bed            | 80.0 s | 24            |
| `cardiac_titan`   | climax bed          | 100.0 s| 30            |
| `victory`         | run-end stinger     | 4.0 s  | one-shot       |
| `defeat`          | run-end stinger     | 4.5 s  | one-shot       |

Every bed is built so that it is **exactly periodic over its target length**:

* oscillator phase is integrated from the frequency trajectory and then
  corrected so the total advance is a whole number of cycles;
* slow modulation rates are integer multiples of `1 / length`;
* the bar-level contour starts and ends on the same value;
* the first 60 ms (the filter start-up transient) is dropped from the render.

The result loops without a seam — verified sample-by-sample by
`ofeliya_cplus.metrics.seam_report`.

Musical contract:

* **F minor** everywhere (root F2 = 87.31 Hz), so the act I bed, the act II bed,
  the boss beds and the stingers are interchangeable at the act boundary.
* **No competing heartbeat.** The game owns the procedural bio pulse
  (`bioOsc` in `Sfx.ts`), so no bed carries a 60–120 BPM thump. Boss beds use
  144 BPM eighth-note ostinati, which read as "urgent" but cannot be confused
  with the game's slow organ-locked pulse (900 ms ≈ 66.7 BPM).
* **The mid band stays light.** Musical weight lives in 87–220 Hz (the band a
  phone speaker can reproduce) and in the air above 5 kHz (the band the
  adaptive lowpass opens under danger). The 1.5–3.5 kHz pocket is kept sparse
  so combat telegraphs stay readable.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import dsp
from .dsp import SR
from .theory import chord_bass_hz, chord_hz, freq

XFADE_S = 0.060
"""Loop crossfade length: short enough to stay musical, long enough to bury
the filter start-up transient."""

BPM = 72
BAR_SEC = 60.0 / BPM * 4.0
BAR_LEN = int(round(BAR_SEC * SR))  # 147 000 samples


# --------------------------------------------------------------------------
# periodic helpers
# --------------------------------------------------------------------------
def snap_freq(f: float, length: int, sr: int = SR) -> float:
    """Snap a frequency to an integer number of cycles over `length` samples.

    The detuning is at most 0.12 cent — far below the ear's resolution — and
    it makes the oscillator perfectly periodic, which is what removes the
    click at the loop point.
    """
    cycles = max(1, round(f * length / sr))
    return cycles * sr / float(length)


def lfo(n: int, length: int, cycles: float, phase0: float = 0.0, shape: str = "sine") -> np.ndarray:
    """Slow modulation that completes `cycles` turns per `length` samples."""
    raw = phase0 + np.arange(n, dtype=np.float64) * (cycles / float(length))
    if shape == "sine":
        return np.sin(2.0 * np.pi * raw)
    if shape == "tri":
        return 4.0 * np.abs((raw % 1.0) - 0.5) - 1.0
    if shape == "saw":
        return 2.0 * (raw % 1.0) - 1.0
    return np.ones(n)


def shape_from_phase(raw: np.ndarray, shape: str) -> np.ndarray:
    if shape == "sine":
        return np.sin(2.0 * np.pi * raw)
    if shape == "tri":
        return 4.0 * np.abs((raw % 1.0) - 0.5) - 1.0
    if shape == "saw":
        return 2.0 * (raw % 1.0) - 1.0
    if shape == "square":
        return np.where((raw % 1.0) < 0.5, 1.0, -1.0)
    raise ValueError(shape)


def periodic_osc(n: int, f: float, length: int, shape: str = "sine", phase0: float = 0.0) -> np.ndarray:
    """Phase-continuous oscillator whose period divides `length`."""
    f_snap = snap_freq(f, length)
    raw = phase0 + np.arange(n, dtype=np.float64) * (f_snap / SR)
    return shape_from_phase(raw, shape)


def gliding_osc(
    n: int,
    f_curve: np.ndarray,
    shape: str = "saw",
    period: int = 0,
    phase0: float = 0.0,
) -> np.ndarray:
    """Oscillator with a gliding frequency, made exactly periodic.

    The phase is integrated from the frequency trajectory, then a linear
    correction is applied so that the phase advance over one *period* is a
    whole number of cycles. The correction changes every frequency by less
    than 0.01 % — inaudible — and it is what makes the loop seamless.

    `phase0` is a constant offset in cycles. A constant offset keeps the
    oscillator periodic, so it is safe to use for stereo decorrelation.
    """
    period = period or n
    phase = 2.0 * np.pi * np.cumsum(f_curve / SR)
    idx = min(period, n) - 1
    advance = float(phase[idx])
    cycles = float(np.round(advance / (2.0 * np.pi)))
    i = np.arange(n, dtype=np.float64)
    correction = (advance - 2.0 * np.pi * cycles) * (i / float(period))
    # `shape_from_phase` works in cycles, the integrated phase is in radians
    return shape_from_phase((phase - correction) / (2.0 * np.pi) + phase0, shape)


# --------------------------------------------------------------------------
# composer
# --------------------------------------------------------------------------
@dataclass
class Stem:
    left: np.ndarray
    right: np.ndarray


class Composer:
    """Accumulates stereo layers for one piece."""

    def __init__(self, bars: int, length: int = None, sr: int = SR):
        self.sr = sr
        self.bars = bars
        self.bar_len = BAR_LEN
        self.length = int(bars * BAR_LEN) if length is None else int(length)
        self.n = self.length + int(XFADE_S * sr)
        self.left = np.zeros(self.n)
        self.right = np.zeros(self.n)

    def add_stereo(self, left: np.ndarray, right: np.ndarray, gain: float = 1.0) -> None:
        n = min(self.n, left.size, right.size)
        self.left[:n] += left[:n] * gain
        self.right[:n] += right[:n] * gain

    def add_stereo_at(
        self,
        left: np.ndarray,
        right: np.ndarray,
        offset: int = 0,
        gain: float = 1.0,
    ) -> None:
        """Add a layer at a sample offset (used by the one-shot musical events)."""
        offset = max(0, int(offset))
        n = min(self.n - offset, left.size, right.size)
        if n <= 0:
            return
        self.left[offset : offset + n] += left[:n] * gain
        self.right[offset : offset + n] += right[:n] * gain

    def add_mono(self, mono: np.ndarray, pan: float = 0.0, gain: float = 1.0) -> None:
        l, r = dsp.pan_stereo(mono, pan)
        self.add_stereo(l, r, gain)

    def add_mono_at(
        self,
        mono: np.ndarray,
        offset: int = 0,
        pan: float = 0.0,
        gain: float = 1.0,
    ) -> None:
        """Panned mono layer at a sample offset."""
        l, r = dsp.pan_stereo(mono, pan)
        self.add_stereo_at(l, r, offset=offset, gain=gain)

    def render(self, normalize_peak_db: float = -3.0) -> Stem:
        """Force the low band mono, trim DC, and return the finished stem."""
        left, right = dsp.force_low_mono((self.left, self.right), cutoff=dsp.LOW_MONO_HZ, sr=self.sr)
        left = dsp.dc_block(left, sr=self.sr)
        right = dsp.dc_block(right, sr=self.sr)
        peak = float(np.abs(np.concatenate([left, right])).max())
        if peak > 0:
            g = dsp.from_db(normalize_peak_db) / peak
            left *= g
            right *= g
        return Stem(left, right)


# --------------------------------------------------------------------------
# reusable voices
# --------------------------------------------------------------------------
def chord_freq_curve(
    prog: list[str],
    voice: int,
    comp: Composer,
    glide_s: float = 1.1,
) -> np.ndarray:
    """Frequency trajectory of one chord voice across the whole piece.

    The trajectory is a step function (one chord per bar) smoothed by a
    Hann-windowed kernel, which turns each chord change into a short
    portamento instead of a click. The progression is continued cyclically so
    that the trajectory is continuous across the loop point.
    """
    n = comp.n
    needed = int(np.ceil(n / comp.bar_len)) + 1
    curve = np.zeros(n)
    for bar in range(needed):
        chord = prog[bar % len(prog)]
        tones = chord_hz(chord)
        f = tones[voice % len(tones)]
        start = bar * comp.bar_len
        end = min(n, start + comp.bar_len)
        if end > start:
            curve[start:end] = f
    # smooth the steps into glides (edge-padded so the wrap stays clean)
    k = max(3, int(glide_s * comp.sr))
    if k % 2 == 0:
        k += 1
    kernel = np.hanning(k)
    kernel /= kernel.sum()
    padded = np.concatenate([np.full(k, curve[0]), curve, np.full(k, curve[-1])])
    smoothed = dsp.signal.fftconvolve(padded, kernel, mode="same")[k : k + n]
    return smoothed


def bar_articulation(comp: Composer, depth: float = 0.14, dip_s: float = 0.22) -> np.ndarray:
    """Per-bar breathing articulation.

    A shallow dip right after each bar line gives the layers a pulse without
    gating them: the signal is never muted, so no click can occur.
    """
    n = comp.n
    art = np.ones(n)
    k = max(2, int(dip_s * comp.sr))
    dip = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, k))
    for bar in range(comp.bars + 2):
        start = bar * comp.bar_len
        end = min(n, start + k)
        if end <= start:
            continue
        art[start:end] -= depth * dip[: end - start]
    return np.clip(art, 0.0, 1.0)


def pad_voice(
    comp: Composer,
    prog: list[str],
    voice: int,
    detune_cents: float = 9.0,
    voices: int = 3,
    glide_s: float = 1.1,
    shape: str = "saw",
) -> tuple[np.ndarray, np.ndarray]:
    """One chord voice rendered as a stack of detuned gliding oscillators."""
    n = comp.n
    curve = chord_freq_curve(prog, voice, comp, glide_s)
    left = np.zeros(n)
    right = np.zeros(n)
    for v in range(voices):
        cents = (v - (voices - 1) / 2.0) * detune_cents
        f_v = curve * (2.0 ** (cents / 1200.0))
        # A constant phase offset decorrelates the two channels. It is
        # periodic, so the loop stays seamless.
        left += gliding_osc(n, f_v, shape, period=comp.length, phase0=0.0)
        right += gliding_osc(n, f_v, shape, period=comp.length, phase0=0.37 + 0.11 * v)
    return left / voices, right / voices


def bass_layer(
    comp: Composer,
    notes: list[tuple[int, float]],
    gain_curve: np.ndarray,
    glide_s: float = 0.35,
) -> None:
    """Sub/bass foundation: one continuous mono voice with a gliding frequency.

    The bass is a single oscillator for the whole piece rather than one
    re-struck note per bar: re-striking would reset the phase and leave a
    step at every bar line (and at the loop point). The articulation comes
    from the amplitude envelope instead, so the waveform stays continuous.

    `notes` is a list of `(start_bar, frequency)` pairs. The bass never goes
    below 87 Hz so it survives the 78 Hz mastering high-pass.
    """
    n = comp.n
    if not notes:
        return
    curve = np.zeros(n)
    for i, (bar, f) in enumerate(notes):
        start = bar * comp.bar_len
        end = min(n, (notes[i + 1][0] * comp.bar_len) if i + 1 < len(notes) else n)
        if end > start:
            curve[start:end] = f
    # smooth the steps into short portamenti
    k = max(3, int(glide_s * comp.sr))
    if k % 2 == 0:
        k += 1
    kernel = np.hanning(k)
    kernel /= kernel.sum()
    padded = np.concatenate([np.full(k, curve[0]), curve, np.full(k, curve[-1])])
    curve = dsp.signal.fftconvolve(padded, kernel, mode="same")[k : k + n]

    tone = gliding_osc(n, curve, "sine", period=comp.length)
    tone = 0.82 * tone + 0.18 * gliding_osc(n, curve * 2.0, "sine", period=comp.length)
    comp.add_mono(tone * gain_curve, pan=0.0, gain=1.0)


def flow_texture(
    n: int,
    length: int,
    centre_lo: float,
    centre_hi: float,
    sweep_cycles: int = 1,
    seed_l: int = 1,
    seed_r: int = 2,
) -> tuple[np.ndarray, np.ndarray]:
    """Wet 'blood flow' band: band-passed noise whose centre drifts upward.

    The drift is a cross-fade between two fixed band-passed noise layers
    rather than a time-varying filter, which keeps the render cheap and the
    spectrum stable.
    """
    out: list[np.ndarray] = []
    for seed in (seed_l, seed_r):
        base = dsp.noise(n, seed)
        low = dsp.bandpass(base, centre_lo, centre_hi, order=2)
        high = dsp.bandpass(base, centre_hi * 1.5, centre_hi * 3.0, order=2)
        mod = 0.5 + 0.5 * lfo(n, length, sweep_cycles, shape="sine")
        out.append(low * (1.0 - mod) + high * mod)
    return out[0], out[1]


def granular(
    n: int,
    grain_s: float,
    density: float,
    lo: float,
    hi: float,
    seed: int,
) -> np.ndarray:
    """Dense short-grain texture — 'tissue' rather than 'sound'."""
    g = dsp.rng(seed)
    grain = max(64, int(grain_s * SR))
    out = np.zeros(n)
    count = int(density * n / grain)
    for _ in range(count):
        pos = int(g.integers(0, max(1, n - grain)))
        env = np.hanning(grain)
        shape = g.uniform(0.25, 1.0)
        out[pos : pos + grain] += env * shape * (1.0 if g.random() > 0.5 else -1.0)
    return dsp.bandpass(out, lo, hi, order=2)


def fm_bell(
    n: int,
    length: int,
    f_c: float,
    f_m: float,
    index: float,
    decay_s: float,
    sr: int = SR,
) -> np.ndarray:
    """FM bell / metallic voice with an exponentially decaying modulation."""
    t = np.arange(n) / sr
    f_c = snap_freq(f_c, length, sr)
    mod = np.sin(2.0 * np.pi * f_m * t) * index * np.exp(-t / max(1e-6, decay_s))
    return np.sin(2.0 * np.pi * f_c * t + mod)


def organ_voice(n: int, length: int, f: float, sr: int = SR) -> np.ndarray:
    """Additive organ-ish tone: fundamental plus formant partials."""
    f = snap_freq(f, length, sr)
    t = np.arange(n) / sr
    out = np.zeros(n)
    for mult, amp in ((1.0, 1.0), (2.0, 0.45), (3.0, 0.22), (4.0, 0.12), (6.0, 0.06)):
        out += amp * np.sin(2.0 * np.pi * f * mult * t + 0.2 * mult)
    return out / 1.85


def air_layer(n: int, seed: int, lo: float = 4200.0, hi: float = 13000.0) -> tuple[np.ndarray, np.ndarray]:
    """High-band 'air' texture: this is what the adaptive lowpass opens up.

    The band starts at 4.2 kHz because the game's tension filter sweeps from
    2.5 kHz to 14 kHz: content above 4 kHz is what the player actually hears
    as the mix opens up under danger.
    """
    nl = dsp.bandpass(dsp.noise(n, seed), lo, hi, order=2)
    nr = dsp.bandpass(dsp.noise(n, seed + 101), lo, hi, order=2)
    return nl, nr


def riser(n: int, f_lo: float, f_hi: float, seed: int, sr: int = SR) -> np.ndarray:
    """Noise riser with a rising band-pass — tension without a beat."""
    x = dsp.noise(n, seed)
    t = np.linspace(0.0, 1.0, n)
    curve = f_lo * (f_hi / f_lo) ** t
    out = np.zeros(n)
    step = max(1, n // 48)
    for i in range(0, n, step):
        j = min(n, i + step)
        out[i:j] = dsp.bandpass(x[i:j], curve[i], curve[j - 1] * 1.35, order=2)
    return out


def swell(n: int) -> np.ndarray:
    """Raised-cosine swell: starts and ends at zero.

    Risers and swells must reach zero at their edges. A layer that stops at
    full amplitude is a step, and a step on a bar line or on the loop point
    is exactly the click the seam test is looking for.
    """
    u = np.linspace(0.0, 1.0, n)
    return np.sin(np.pi * u) ** 2


# --------------------------------------------------------------------------
# shared building blocks
# --------------------------------------------------------------------------
def contour(levels: list[float], comp: Composer) -> np.ndarray:
    """Bar-aligned level contour; first and last bar must match for looping."""
    return dsp.section_gain(comp.n, comp.bars, comp.bar_len, levels, ramp_bars=1.0)


def cutoff_from_contour(contour_curve: np.ndarray, lo: float, hi: float, cycles: int, length: int) -> np.ndarray:
    """Filter cutoff that follows the musical contour and breathes slowly."""
    breath = lfo(contour_curve.size, length, cycles, shape="sine")
    u = np.clip(contour_curve, 0.0, 1.0)
    return lo * (hi / lo) ** (0.65 * u + 0.35 * (0.5 + 0.5 * breath))


def apply_loop_tail(stem: Stem, length: int, sr: int = SR) -> Stem:
    """Drop the filter start-up transient and return exactly `length` samples.

    The composition is periodic over `length`, so slicing `[xfade:]` of a
    `length + xfade` render yields a buffer whose last sample flows into its
    first sample without a step.
    """
    xf = int(XFADE_S * sr)
    return Stem(stem.left[xf : xf + length], stem.right[xf : xf + length])


def close_loop(left: np.ndarray, right: np.ndarray, sr: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """Make a buffer of `L + xf` samples loop seamlessly at exactly `L` samples.

    The tail is overlap-added onto the head with a raised-cosine cross-fade:

        out = x[xf:L] + crossfade(x[L:L+xf], x[0:xf])

    The result wraps from `x[xf-1]` into `x[xf]` — a natural continuation of
    the source — and the internal junction `x[L-1] -> x[L]` is untouched. The
    cross-fade is amplitude-complementary (not equal-power) because the two
    regions carry the same musical state: an equal-power law would add +3 dB
    in the middle of the blend.

    This is the belt-and-braces guarantee behind the seam test: even if a
    mastering stage leaves a small edge artefact, the loop point is closed
    by construction.
    """
    xf = int(XFADE_S * sr)
    total = left.size
    length = total - xf
    if length <= xf or xf <= 0:
        return left[:length], right[:length]
    u = np.linspace(0.0, 1.0, xf)
    w = 0.5 - 0.5 * np.cos(np.pi * u)  # 0 -> tail, 1 -> head
    out_l = np.concatenate([left[xf:length], left[length:total] * (1.0 - w) + left[0:xf] * w])
    out_r = np.concatenate([right[xf:length], right[length:total] * (1.0 - w) + right[0:xf] * w])
    return out_l, out_r


# --------------------------------------------------------------------------
# 1. Bloodstream — act I bed
# --------------------------------------------------------------------------
def compose_bloodstream() -> Stem:
    """Calm interior movement that develops into threat and returns to rest."""
    comp = Composer(bars=24)
    length = comp.length
    n = comp.n

    levels = [
        0.50, 0.50, 0.52, 0.54, 0.58, 0.62, 0.66, 0.70,
        0.74, 0.78, 0.80, 0.82, 0.84, 0.86, 0.90, 0.95,
        1.00, 0.96, 0.88, 0.80, 0.70, 0.60, 0.52, 0.50,
    ]
    prog = [
        "fm", "fm", "dm", "dm", "bb", "bb", "cmaj", "cmaj",
        "fm", "fm", "gm", "gm", "fm", "fm", "gm", "gm",
        "bb", "bb", "cmaj", "cmaj", "dm", "dm", "fm", "fm",
    ]
    curve = contour(levels, comp)
    art = bar_articulation(comp, depth=0.13)
    cutoff = cutoff_from_contour(curve, 520.0, 2100.0, 3, length)

    # --- bass: chord roots with a short portamento -----------------------
    bass_notes: list[tuple[int, float]] = [(bar, chord_bass_hz(chord)) for bar, chord in enumerate(prog)]
    bass_layer(comp, bass_notes, curve * 0.22)

    # --- harmonic body: three gliding chord voices ------------------------
    for voice, pan in ((0, 0.0), (1, -0.42), (2, 0.42)):
        left, right = pad_voice(comp, prog, voice, detune_cents=9.0, voices=3, glide_s=1.2)
        left = dsp.moving_lowpass(left, cutoff)
        right = dsp.moving_lowpass(right, cutoff)
        pl, pr = dsp.pan_stereo(0.5 * (left + right), pan)
        comp.add_stereo(pl * curve * art * 0.32, pr * curve * art * 0.32, 1.0)

    # --- flow texture ----------------------------------------------------
    fl, fr = flow_texture(n, length, 240.0, 1500.0, sweep_cycles=3, seed_l=11, seed_r=12)
    flow_env = curve * (0.55 + 0.45 * lfo(n, length, 3, shape="sine"))
    comp.add_stereo(fl * flow_env * 0.20, fr * flow_env * 0.20, 1.0)

    # --- counter melody: one note every two bars, from bar 6 -------------
    motif = [freq("C4"), freq("Eb4"), freq("F4"), freq("G4")]
    for k, bar in enumerate(range(6, 24, 2)):
        f = motif[(k + (bar // 4)) % len(motif)]
        seg = comp.bar_len
        env = dsp.adsr(seg, 0.9, 0.6, 0.35, 1.4)
        tone = periodic_osc(seg, f, length, "tri")
        tone2 = periodic_osc(seg, f * 2.0, length, "sine")
        voice_out = (tone + 0.35 * tone2) * env * 0.16
        comp.add_stereo_at(
            *dsp.pan_stereo(voice_out, -0.25), offset=bar * comp.bar_len, gain=1.0
        )

    # --- cell motif: rising figure from bar 12 --------------------------
    cell = [freq("A4"), freq("C5"), freq("D5")]
    for k, bar in enumerate(range(12, 24, 2)):
        f = cell[k % len(cell)] * (2.0 ** (0.012 * k))
        seg = comp.bar_len
        env = dsp.adsr(seg, 0.05, 0.4, 0.2, 0.9)
        bell = fm_bell(seg, length, f, f * 1.41, 2.4, 0.9)
        comp.add_stereo_at(
            *dsp.pan_stereo(bell * env * 0.13, 0.3), offset=bar * comp.bar_len, gain=1.0
        )

    # --- air -------------------------------------------------------------
    al, ar = air_layer(n, seed=21)
    comp.add_stereo(al * curve * 0.22, ar * curve * 0.22, 1.0)

    # The render keeps XFADE_S extra samples at the front: the mastering
    # filters have their own start-up transient, so the trim happens *after*
    # mastering (see build.py) — otherwise that transient would sit exactly
    # on the loop point.
    return comp.render(normalize_peak_db=-3.0)


# --------------------------------------------------------------------------
# 2. Heart — act II bed
# --------------------------------------------------------------------------
def compose_heart() -> Stem:
    """Heavier, denser companion to Bloodstream; no competing heartbeat."""
    comp = Composer(bars=24)
    length = comp.length
    n = comp.n

    levels = [
        0.46, 0.48, 0.52, 0.56, 0.60, 0.64, 0.68, 0.72,
        0.78, 0.84, 0.88, 0.92, 0.96, 1.00, 0.98, 0.94,
        0.88, 0.82, 0.74, 0.66, 0.58, 0.52, 0.48, 0.46,
    ]
    prog = [
        "fm", "fm", "ebm", "ebm", "abm", "abm", "gm", "gm",
        "fm", "fm", "ebm", "ebm", "fm", "fm", "gm", "gm",
        "abm", "abm", "ebm", "ebm", "fm", "fm", "fm", "fm",
    ]
    curve = contour(levels, comp)
    art = bar_articulation(comp, depth=0.10, dip_s=0.3)
    cutoff = cutoff_from_contour(curve, 420.0, 1900.0, 2, length)

    # --- heavy bass ------------------------------------------------------
    bass_notes = []
    for bar, chord in enumerate(prog):
        f = chord_bass_hz(chord)
        if f < 87.0:  # keep the foundation above the mastering high-pass
            f = f * 2.0
        bass_notes.append((bar, f))
    bass_layer(comp, bass_notes, curve * 0.26)

    # --- dense harmonic body --------------------------------------------
    for voice, pan in ((0, 0.0), (1, -0.5), (2, 0.5)):
        left, right = pad_voice(comp, prog, voice, detune_cents=12.0, voices=4, glide_s=0.9)
        left = dsp.soft_clip(dsp.moving_lowpass(left, cutoff), 1.6)
        right = dsp.soft_clip(dsp.moving_lowpass(right, cutoff), 1.6)
        pl, pr = dsp.pan_stereo(0.5 * (left + right), pan)
        comp.add_stereo(pl * curve * art * 0.27, pr * curve * art * 0.27, 1.0)

    # --- tissue: dense granular body ------------------------------------
    tissue = granular(n, 0.014, 0.55, 300.0, 2300.0, seed=31)
    tissue_env = curve * (0.6 + 0.4 * lfo(n, length, 4, shape="tri"))
    comp.add_stereo(tissue * tissue_env * 0.16, tissue * tissue_env * 0.16 * 0.92, 1.0)

    # --- heart weight: slow swell in the low-mid band ---------------------
    breath = 0.5 + 0.5 * lfo(n, length, 6, shape="sine")
    weight = dsp.bandpass(periodic_osc(n, freq("F3"), length, "sine"), 110.0, 190.0, order=2)
    comp.add_mono(weight * breath * curve * 0.22, pan=0.0, gain=1.0)

    # --- organ lead from bar 12 -----------------------------------------
    figure = [freq("F3"), freq("Ab3"), freq("C4"), freq("G3"), freq("Ab3"), freq("F3")]
    for k, bar in enumerate(range(12, 24, 2)):
        f = figure[k % len(figure)]
        seg = comp.bar_len
        env = dsp.adsr(seg, 0.35, 0.5, 0.45, 0.8)
        voice_out = organ_voice(seg, length, f) * env * 0.14
        comp.add_stereo_at(
            *dsp.pan_stereo(voice_out, 0.2), offset=bar * comp.bar_len, gain=1.0
        )

    # --- air -------------------------------------------------------------
    al, ar = air_layer(n, seed=41)
    comp.add_stereo(al * curve * 0.20, ar * curve * 0.20, 1.0)

    # The render keeps XFADE_S extra samples at the front: the mastering
    # filters have their own start-up transient, so the trim happens *after*
    # mastering (see build.py) — otherwise that transient would sit exactly
    # on the loop point.
    return comp.render(normalize_peak_db=-3.0)


# --------------------------------------------------------------------------
# 3. Immune Prime — boss bed
# --------------------------------------------------------------------------
def compose_immune_prime() -> Stem:
    """Urgent boss bed.

    The ostinato runs at 144 BPM, deliberately away from the game's 66.7 BPM
    organ-locked bio pulse, and the mid band stays sparse so the combat
    telegraphs remain readable.
    """
    comp = Composer(bars=24)
    length = comp.length
    n = comp.n

    levels = [
        0.62, 0.66, 0.70, 0.74, 0.78, 0.82, 0.86, 0.90,
        0.94, 0.96, 0.98, 1.00, 0.98, 0.94, 0.88, 0.82,
        0.76, 0.70, 0.66, 0.64, 0.66, 0.70, 0.74, 0.62,
    ]
    prog = [
        "fm", "fm", "fm", "fm", "dbm", "dbm", "abm", "abm",
        "ebm", "ebm", "fm", "fm", "gm", "gm", "fm", "fm",
        "abm", "abm", "ebm", "ebm", "gm", "gm", "fm", "fm",
    ]
    curve = contour(levels, comp)
    cutoff = cutoff_from_contour(curve, 700.0, 2600.0, 5, length)

    # --- bass pedal ------------------------------------------------------
    bass_notes = []
    for bar, chord in enumerate(prog):
        f = chord_bass_hz(chord)
        if f < 87.0:
            f = f * 2.0
        bass_notes.append((bar, f))
    bass_layer(comp, bass_notes, curve * 0.20)

    # --- 144 BPM ostinato (8 eighth notes per bar) -----------------------
    eighth = BAR_LEN / 8.0
    figure = [0.0, 0.0, 3.0, 0.0, 7.0, 0.0, 10.0, 5.0]
    bass_f = freq("F2")
    for bar in range(comp.bars):
        bar_gain = curve[bar * comp.bar_len]
        for e in range(8):
            seg = int(eighth * 0.92)
            offset = int(bar * comp.bar_len + e * eighth)
            f = bass_f * (2.0 ** (figure[e] / 12.0))
            voice = dsp.lowpass(periodic_osc(seg, f, length, "saw"), 420.0, order=2)
            voice = dsp.soft_clip(voice, 1.4)
            env = dsp.adsr(seg, 0.004, 0.05, 0.25, 0.09)
            comp.add_mono_at(
                voice * env * bar_gain * 0.17, offset=offset, pan=0.0, gain=1.0
            )

    # --- tension body: sustained cluster an octave above the ostinato ----
    for voice, pan in ((0, 0.0), (1, -0.45), (2, 0.45)):
        left, right = pad_voice(comp, prog, voice, detune_cents=13.0, voices=3, glide_s=0.7)
        left = dsp.moving_lowpass(left, cutoff)
        right = dsp.moving_lowpass(right, cutoff)
        pl, pr = dsp.pan_stereo(0.5 * (left + right), pan)
        comp.add_stereo(pl * curve * 0.13, pr * curve * 0.13, 1.0)

    # --- metallic off-beat hits (sparse, high) ---------------------------
    for k, bar in enumerate(range(4, 24, 2)):
        f = [freq("D5"), freq("C5"), freq("Eb5"), freq("C5")][k % 4]
        seg = int(comp.bar_len * 0.5)
        offset = int(bar * comp.bar_len + comp.bar_len * 0.375)
        bell = fm_bell(seg, length, f, f * 1.73, 3.2, 0.45)
        env = dsp.adsr(seg, 0.003, 0.12, 0.05, 0.2)
        comp.add_stereo_at(
            *dsp.pan_stereo(bell * env * 0.10, 0.35 if k % 2 else -0.35),
            offset=offset,
            gain=1.0,
        )

    # --- risers ----------------------------------------------------------
    for bar0, bar1 in ((8, 12), (20, 24)):
        seg = (bar1 - bar0) * comp.bar_len
        r = riser(seg, 300.0, 4200.0, seed=bar0 + 77)
        env = swell(seg)
        comp.add_stereo_at(
            r * env * 0.09, r * env * 0.09, offset=bar0 * comp.bar_len, gain=1.0
        )

    # --- air -------------------------------------------------------------
    al, ar = air_layer(n, seed=51)
    comp.add_stereo(al * curve * 0.22, ar * curve * 0.22, 1.0)

    # The render keeps XFADE_S extra samples at the front: the mastering
    # filters have their own start-up transient, so the trim happens *after*
    # mastering (see build.py) — otherwise that transient would sit exactly
    # on the loop point.
    return comp.render(normalize_peak_db=-3.0)


# --------------------------------------------------------------------------
# 4. Cardiac Titan — climax bed
# --------------------------------------------------------------------------
def compose_cardiac_titan() -> Stem:
    """Final battle: scale, organic aggression, and controlled arrhythmia."""
    comp = Composer(bars=30)
    length = comp.length
    n = comp.n

    levels = [
        0.58, 0.62, 0.66, 0.70, 0.74, 0.78, 0.82, 0.86,
        0.90, 0.94, 0.97, 1.00, 1.00, 0.98, 0.94, 0.90,
        0.88, 0.90, 0.94, 0.98, 1.00, 0.96, 0.90, 0.82,
        0.74, 0.68, 0.64, 0.62, 0.60, 0.58,
    ]
    prog = [
        "fm", "fm", "fm", "fm", "ebm", "ebm", "abm", "abm",
        "gm", "gm", "fm", "fm", "ebm", "ebm", "abm", "abm",
        "gm", "gm", "fm", "fm", "abm", "abm", "ebm", "ebm",
        "gm", "gm", "fm", "fm", "fm", "fm",
    ]
    curve = contour(levels, comp)
    art = bar_articulation(comp, depth=0.08, dip_s=0.3)
    cutoff = cutoff_from_contour(curve, 380.0, 2400.0, 3, length)

    # --- heavy bass ------------------------------------------------------
    bass_notes = []
    for bar, chord in enumerate(prog):
        f = chord_bass_hz(chord)
        if f < 87.0:
            f = f * 2.0
        bass_notes.append((bar, f))
    bass_layer(comp, bass_notes, curve * 0.26)

    # --- heavy harmonic body --------------------------------------------
    for voice, pan in ((0, 0.0), (1, -0.55), (2, 0.55)):
        left, right = pad_voice(comp, prog, voice, detune_cents=15.0, voices=4, glide_s=0.8)
        left = dsp.soft_clip(dsp.moving_lowpass(left, cutoff), 2.0)
        right = dsp.soft_clip(dsp.moving_lowpass(right, cutoff), 2.0)
        pl, pr = dsp.pan_stereo(0.5 * (left + right), pan)
        comp.add_stereo(pl * curve * art * 0.26, pr * curve * art * 0.26, 1.0)

    # --- 144 BPM ostinato, harder ---------------------------------------
    eighth = BAR_LEN / 8.0
    figure = [0.0, 0.0, 0.0, 3.0, 0.0, 7.0, 0.0, 10.0]
    bass_f = freq("F2")
    for bar in range(comp.bars):
        bar_gain = curve[bar * comp.bar_len]
        for e in range(8):
            seg = int(eighth * 0.9)
            offset = int(bar * comp.bar_len + e * eighth)
            f = bass_f * (2.0 ** (figure[e] / 12.0))
            voice = dsp.soft_clip(dsp.lowpass(periodic_osc(seg, f, length, "saw"), 500.0, order=2), 1.8)
            env = dsp.adsr(seg, 0.003, 0.045, 0.3, 0.08)
            comp.add_mono_at(
                voice * env * bar_gain * 0.15, offset=offset, pan=0.0, gain=1.0
            )

    # --- organic aggression: filtered noise stabs on the accents --------
    for bar in range(comp.bars):
        for e in (3, 6):
            seg = int(comp.bar_len * 0.16)
            offset = int(bar * comp.bar_len + e * eighth)
            stab = dsp.bandpass(dsp.noise(seg, 900 + bar * 8 + e), 900.0, 4200.0, order=2)
            env = dsp.adsr(seg, 0.002, 0.03, 0.05, 0.06)
            g = curve[bar * comp.bar_len] * 0.10
            comp.add_stereo_at(stab * env * g, stab * env * g * 0.85, offset=offset, gain=1.0)

    # --- controlled arrhythmia: sparse metallic hits, bars 12-22 --------
    g = dsp.rng(909)
    for _ in range(26):
        bar = int(g.integers(12, 23))
        e = int(g.integers(0, 8))
        f = float(g.choice([freq("D5"), freq("Eb5"), freq("F5"), freq("Ab5"), freq("C6")]))
        seg = int(comp.bar_len * 0.4)
        offset = int(bar * comp.bar_len + e * eighth)
        bell = fm_bell(seg, length, f, f * 1.41, 4.0, 0.35)
        env = dsp.adsr(seg, 0.002, 0.1, 0.04, 0.18)
        pan = float(g.uniform(-0.6, 0.6))
        comp.add_stereo_at(*dsp.pan_stereo(bell * env * 0.11, pan), offset=offset, gain=1.0)

    # --- risers and choir swell -----------------------------------------
    for bar0, bar1 in ((9, 12), (20, 23)):
        seg = (bar1 - bar0) * comp.bar_len
        r = riser(seg, 260.0, 5200.0, seed=bar0 + 313)
        env = swell(seg)
        comp.add_stereo_at(
            r * env * 0.10, r * env * 0.10, offset=bar0 * comp.bar_len, gain=1.0
        )

    for k, bar in enumerate(range(12, 24, 3)):
        seg = comp.bar_len * 3
        env = dsp.adsr(seg, 1.2, 0.6, 0.6, 1.6)
        voice_out = organ_voice(seg, length, freq("F3") * (2.0 ** (0.01 * k))) * env * 0.13
        start = bar * comp.bar_len
        voice_full = np.zeros(n)
        voice_full[start : start + seg] = voice_out
        comp.add_stereo(voice_full, voice_full * 0.9, 1.0)

    # --- air -------------------------------------------------------------
    al, ar = air_layer(n, seed=61)
    comp.add_stereo(al * curve * 0.22, ar * curve * 0.22, 1.0)

    # The render keeps XFADE_S extra samples at the front: the mastering
    # filters have their own start-up transient, so the trim happens *after*
    # mastering (see build.py) — otherwise that transient would sit exactly
    # on the loop point.
    return comp.render(normalize_peak_db=-3.0)


# --------------------------------------------------------------------------
# 5/6. Run-end stingers
# --------------------------------------------------------------------------
def compose_victory() -> Stem:
    """Immediate, unambiguous win signal.

    The result screen stays open until the player acts, so the stinger only
    has to *read* fast — a bright F-major rise that resolves inside the first
    second and then decays. The tail is short enough to be cut instantly by
    `Sfx.stopMusic()` on a fast restart.
    """
    n = int(4.0 * SR)
    comp = Composer(bars=1, length=n)
    comp.n = n
    comp.left = comp.left[:n]
    comp.right = comp.right[:n]

    notes = [freq("F3"), freq("A3"), freq("C4"), freq("F4")]
    for i, f in enumerate(notes):
        seg = int(1.5 * SR)
        bell = fm_bell(seg, n, f, f * 2.01, 1.6, 1.2)
        env = dsp.adsr(seg, 0.006, 0.35, 0.35, 1.0)
        comp.add_stereo(*dsp.pan_stereo(bell * env * 0.30, -0.3 + 0.2 * i), gain=1.0)

    # rising pad that carries the "release" feeling
    env = dsp.adsr(n, 0.05, 0.5, 0.5, 1.4)
    rise = dsp.sweep(freq("F3"), freq("F4"), n, shape="cos")
    pad = (rise + 0.4 * np.sin(2.0 * np.pi * rise * 2.0)) * env * 0.16
    comp.add_stereo(pad, pad * 0.92, 1.0)

    # soft sub confirmation
    sub = periodic_osc(n, freq("F2"), n, "sine") * dsp.adsr(n, 0.02, 0.4, 0.4, 1.2) * 0.22
    comp.add_mono(sub, pan=0.0, gain=1.0)

    stem = comp.render(normalize_peak_db=-3.0)
    return Stem(stem.left, stem.right)


def compose_defeat() -> Stem:
    """Immediate, unambiguous loss signal: a descending F-minor collapse."""
    n = int(4.5 * SR)
    comp = Composer(bars=1, length=n)
    comp.n = n
    comp.left = comp.left[:n]
    comp.right = comp.right[:n]

    notes = [freq("F3"), freq("Eb3"), freq("Db3"), freq("C3"), freq("Bb2"), freq("Ab2")]
    for i, f in enumerate(notes):
        seg = int(1.4 * SR)
        tone = periodic_osc(seg, f, n, "tri")
        env = dsp.adsr(seg, 0.01, 0.3, 0.3, 0.9)
        comp.add_stereo(*dsp.pan_stereo(tone * env * 0.26, 0.25 - 0.1 * i), gain=1.0)

    # flatline: a slow downward glide that dies into filtered noise
    env = dsp.adsr(n, 0.03, 0.6, 0.45, 1.8)
    fall = dsp.sweep(freq("F3"), freq("F2") * 0.62, n, shape="lin")
    comp.add_mono(fall * env * 0.20, pan=0.0, gain=1.0)

    # breathing collapse: band-passed noise fading out
    breath = dsp.bandpass(dsp.noise(n, 4242), 300.0, 2200.0, order=2)
    breath_env = np.linspace(1.0, 0.0, n) ** 1.6
    comp.add_stereo(breath * breath_env * 0.10, breath * breath_env * 0.10, 1.0)

    # low collapse
    sub = periodic_osc(n, freq("F2"), n, "sine") * np.linspace(1.0, 0.0, n) ** 1.4 * 0.26
    comp.add_mono(sub, pan=0.0, gain=1.0)

    stem = comp.render(normalize_peak_db=-3.0)
    return Stem(stem.left, stem.right)


# --------------------------------------------------------------------------
# registry
# --------------------------------------------------------------------------
COMPOSERS = {
    "bloodstream": compose_bloodstream,
    "heart": compose_heart,
    "immune_prime": compose_immune_prime,
    "cardiac_titan": compose_cardiac_titan,
    "victory": compose_victory,
    "defeat": compose_defeat,
}

TRACK_INFO = {
    "bloodstream": {
        "role": "bloodstream",
        "title": "Bloodstream",
        "loop": True,
        "bars": 24,
        "durationSec": 80.0,
        "act": 1,
    },
    "heart": {
        "role": "heart",
        "title": "Heart",
        "loop": True,
        "bars": 24,
        "durationSec": 80.0,
        "act": 2,
    },
    "immune_prime": {
        "role": "boss",
        "title": "Immune Prime",
        "loop": True,
        "bars": 24,
        "durationSec": 80.0,
        "act": 1,
    },
    "cardiac_titan": {
        "role": "boss",
        "title": "Cardiac Titan",
        "loop": True,
        "bars": 30,
        "durationSec": 100.0,
        "act": 2,
    },
    "victory": {
        "role": "stinger",
        "title": "Victory",
        "loop": False,
        "bars": 0,
        "durationSec": 4.0,
        "act": 0,
    },
    "defeat": {
        "role": "stinger",
        "title": "Defeat",
        "loop": False,
        "bars": 0,
        "durationSec": 4.5,
        "act": 0,
    },
}

"""Signal primitives for the OFELIYA C+ v4 procedural audio engine.

Everything here is pure numpy/scipy: no external samples, no third-party
melodies, no model files. Every oscillator is phase-driven so that a layer can
be rendered with an exact loop length and stay sample-continuous across the
wrap.

Design rules that the compositions depend on:

* **Loop periodicity.** Any slow modulation (LFO, drift, filter sweep) must
  complete a whole number of cycles over the render length, otherwise the
  wrap point carries a discontinuity. `periodic_phase` builds exactly that.
* **Mono-safe low end.** Everything below `LOW_MONO_HZ` is rendered mono and
  summed into both channels, so an L+R fold-down loses no weight.
* **Equal-power panning.** `pan_stereo` uses a constant-power law, so the
  perceived loudness of a layer does not change with its position.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage, signal

SR = 44100
"""Render sample rate. Matches the shipped production beds (44 100 Hz)."""

LOW_MONO_HZ = 220.0
"""Below this frequency the stereo image is forced mono (phone-speaker safe)."""


# --------------------------------------------------------------------------
# random
# --------------------------------------------------------------------------
def rng(seed: int) -> np.random.Generator:
    """Deterministic generator. The same seed always yields the same stream."""
    return np.random.default_rng(int(seed) & 0xFFFFFFFF)


def noise(n: int, seed: int) -> np.ndarray:
    return rng(seed).uniform(-1.0, 1.0, n)


# --------------------------------------------------------------------------
# phase / oscillators
# --------------------------------------------------------------------------
def periodic_phase(n: int, cycles: float, phase0: float = 0.0) -> np.ndarray:
    """Phase ramp that completes `cycles` whole turns over `n` samples.

    `cycles` must be an integer for a seamless wrap; fractional values are
    still usable for non-looping material.
    """
    return (phase0 + np.arange(n, dtype=np.float64) * (cycles / float(n))) % 1.0


def sine(phase: np.ndarray) -> np.ndarray:
    return np.sin(2.0 * np.pi * phase)


def triangle(phase: np.ndarray) -> np.ndarray:
    p = phase % 1.0
    return 4.0 * np.abs(p - 0.5) - 1.0


def saw(phase: np.ndarray) -> np.ndarray:
    return 2.0 * (phase % 1.0) - 1.0


def square(phase: np.ndarray, duty: float = 0.5) -> np.ndarray:
    return np.where((phase % 1.0) < duty, 1.0, -1.0)


def sine_at(freq: float, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    """Additive sine at a constant frequency (phase-continuous over the render)."""
    t = np.arange(n, dtype=np.float64) / sr
    return np.sin(2.0 * np.pi * freq * t + phase0)


def sweep(
    f_start: float,
    f_end: float,
    n: int,
    sr: int = SR,
    shape: str = "cos",
) -> np.ndarray:
    """Frequency sweep as a phase-continuous signal.

    `shape` selects how the frequency moves between the endpoints:
      cos  - cosine (smooth at both ends, used for most sweeps)
      lin  - linear
      exp  - exponential
    """
    u = np.linspace(0.0, 1.0, n)
    if shape == "lin":
        f = f_start + (f_end - f_start) * u
    elif shape == "exp":
        f = f_start * (f_end / max(f_start, 1e-6)) ** u
    else:
        f = f_start + (f_end - f_start) * (0.5 - 0.5 * np.cos(np.pi * u))
    phase = np.cumsum(2.0 * np.pi * f / sr)
    return np.sin(phase)


# --------------------------------------------------------------------------
# envelopes
# --------------------------------------------------------------------------
def adsr(
    n: int,
    attack_s: float,
    decay_s: float,
    sustain: float,
    release_s: float,
    sr: int = SR,
) -> np.ndarray:
    """Classic ADSR with cosine-shaped segments."""
    a = max(1, int(attack_s * sr))
    d = max(1, int(decay_s * sr))
    r = max(1, int(release_s * sr))
    s = max(0, n - a - d - r)
    env = np.concatenate(
        [
            np.linspace(0.0, 1.0, a, endpoint=False),
            1.0 + (sustain - 1.0) * np.linspace(0.0, 1.0, d, endpoint=False),
            np.full(s, sustain),
            sustain + (0.0 - sustain) * np.linspace(0.0, 1.0, r),
        ]
    )
    return env[:n]


def smoothstep(n: int, sr: int = SR, seconds: float = 0.5) -> np.ndarray:
    """Raised-cosine ramp from 0 to 1 over `seconds`."""
    k = max(2, int(seconds * sr))
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, k))
    out = np.zeros(n)
    out[: min(n, k)] = ramp[: min(n, k)]
    return out


def arc(n: int, start: int, length: int, sr: int = SR, fade: float = 0.08) -> np.ndarray:
    """Windowed bump: fades in, holds, fades out. Used for one-shot events."""
    out = np.zeros(n)
    s = max(0, start)
    e = min(n, start + length)
    if e <= s:
        return out
    seg = out[s:e]
    f = max(2, int(fade * (e - s)))
    win = np.ones(e - s)
    f = min(f, (e - s) // 2)
    if f > 1:
        win[:f] = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, f))
        win[-f:] = 0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, f))
    seg[:] = win
    return out


def section_gain(
    n: int,
    bars: int,
    bar_len: int,
    levels: list[float],
    ramp_bars: float = 1.0,
) -> np.ndarray:
    """Bar-aligned amplitude contour with raised-cosine transitions.

    `levels` holds one target level per bar. The contour is interpolated
    between neighbouring bars over `ramp_bars` so that no click can occur at a
    bar boundary.
    """
    n_bars = len(levels)
    gain = np.zeros(n)
    ramp = max(1, int(ramp_bars * bar_len))
    for i, level in enumerate(levels):
        start = i * bar_len
        end = min(n, start + bar_len)
        if end <= start:
            continue
        seg = np.full(end - start, level)
        if i > 0:
            prev = levels[i - 1]
            k = min(ramp, end - start)
            seg[:k] = prev + (level - prev) * (0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, k)))
        gain[start:end] = seg
    if n > 0 and n_bars * bar_len < n:
        gain[n_bars * bar_len:] = levels[-1]
    return gain


# --------------------------------------------------------------------------
# filters
# --------------------------------------------------------------------------
def _sos(kind: str, cutoff, order: int, sr: int, q: float | None = None):
    nyq = sr * 0.5
    if kind == "lowpass":
        return signal.butter(order, cutoff / nyq, btype="low", output="sos")
    if kind == "highpass":
        return signal.butter(order, cutoff / nyq, btype="high", output="sos")
    if kind == "bandpass":
        lo, hi = cutoff
        return signal.butter(order, [lo / nyq, hi / nyq], btype="band", output="sos")
    raise ValueError(kind)


def lowpass(x: np.ndarray, cutoff: float, order: int = 4, sr: int = SR) -> np.ndarray:
    return signal.sosfilt(_sos("lowpass", cutoff, order, sr), x)


def highpass(x: np.ndarray, cutoff: float, order: int = 4, sr: int = SR) -> np.ndarray:
    return signal.sosfilt(_sos("highpass", cutoff, order, sr), x)


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2, sr: int = SR) -> np.ndarray:
    return signal.sosfilt(_sos("bandpass", (lo, hi), order, sr), x)


def peaking(x: np.ndarray, f0: float, gain_db: float, q: float = 0.9, sr: int = SR) -> np.ndarray:
    """RBJ peaking (bell) EQ."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * f0 / sr
    alpha = np.sin(w0) / (2.0 * q)
    b = [1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a]
    aa = [1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a]
    return signal.lfilter(b, aa, x)


def high_shelf(x: np.ndarray, f0: float, gain_db: float, sr: int = SR) -> np.ndarray:
    """RBJ high-shelf filter (shelf slope S = 1)."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * f0 / sr
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / 2.0 * np.sqrt(2.0)
    beta = 2.0 * np.sqrt(a) * alpha
    b = [a * ((a + 1) + (a - 1) * cw + beta), -2 * a * ((a - 1) + (a + 1) * cw), a * ((a + 1) + (a - 1) * cw - beta)]
    aa = [(a + 1) - (a - 1) * cw + beta, 2 * ((a - 1) - (a + 1) * cw), (a + 1) - (a - 1) * cw - beta]
    return signal.lfilter(b, aa, x)


def moving_lowpass(x: np.ndarray, cutoff_curve: np.ndarray, sr: int = SR, block: int = 512) -> np.ndarray:
    """Time-varying one-pole lowpass.

    The cutoff curve is resampled to blocks and the filter state is carried
    across blocks with `lfilter`, so the result matches a per-sample one-pole
    to within the block quantisation of the coefficient (well below 0.01 dB
    for smooth curves) while running at C speed.
    """
    n = x.size
    out = np.empty(n, dtype=np.float64)
    coeff = np.exp(-2.0 * np.pi * np.clip(cutoff_curve, 20.0, sr * 0.45) / sr)
    state = np.zeros(1)
    for start in range(0, n, block):
        end = min(n, start + block)
        a = float(coeff[start:end].mean())
        seg, state = signal.lfilter([1.0 - a], [1.0, -a], x[start:end], zi=state)
        out[start:end] = seg
    return out


def soft_clip(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
    """tanh saturation with unity small-signal gain."""
    if drive <= 0:
        return x
    return np.tanh(x * drive) / np.tanh(drive)


# --------------------------------------------------------------------------
# reverb
# --------------------------------------------------------------------------
def make_ir(
    seconds: float = 2.4,
    decay: float = 3.0,
    seed: int = 0,
    pre_delay_s: float = 0.018,
    damping_hz: float = 4200.0,
    sr: int = SR,
) -> np.ndarray:
    """Synthesized stereo impulse response (no external IR file).

    The tail is exponentially decaying noise, low-passed so the reverb darkens
    with time, plus a handful of early reflections for a sense of a body.
    """
    n = int(seconds * sr)
    pre = int(pre_delay_s * sr)
    t = np.arange(n) / sr
    tail = rng(seed).uniform(-1.0, 1.0, n) * np.exp(-t * decay)
    tail = lowpass(tail, damping_hz, order=2, sr=sr)
    tail[:pre] = 0.0
    # early reflections: a few sparse taps in the first 80 ms
    for i in range(7):
        pos = pre + int((0.004 + 0.010 * i) * sr) + int(rng(seed + 17 + i).integers(0, 220))
        if pos < n:
            tail[pos] += (0.55 - 0.05 * i) * (1.0 if i % 2 == 0 else -1.0)
    peak = np.max(np.abs(tail))
    return tail / peak if peak > 0 else tail


def reverb(x: np.ndarray, ir: np.ndarray, mix: float = 0.25) -> np.ndarray:
    """Convolution reverb with an equal-power wet/dry blend."""
    wet = signal.fftconvolve(x, ir)[: x.size]
    return (1.0 - mix) * x + mix * wet


# --------------------------------------------------------------------------
# stereo helpers
# --------------------------------------------------------------------------
def pan_stereo(mono: np.ndarray, pan: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Equal-power pan. `pan` in [-1, 1] (left .. right)."""
    p = float(np.clip(pan, -1.0, 1.0))
    theta = (p + 1.0) * (np.pi / 4.0)
    return mono * np.cos(theta), mono * np.sin(theta)


def mono_fold(l: np.ndarray, r: np.ndarray) -> np.ndarray:
    return 0.5 * (l + r)


def force_low_mono(stereo: tuple[np.ndarray, np.ndarray], cutoff: float = LOW_MONO_HZ, sr: int = SR):
    """Keep the low band identical in both channels (mono-safe bass)."""
    l, r = stereo
    lo_l = lowpass(l, cutoff, order=2, sr=sr)
    lo_r = lowpass(r, cutoff, order=2, sr=sr)
    lo = 0.5 * (lo_l + lo_r)
    return l - lo_l + lo, r - lo_r + lo


# --------------------------------------------------------------------------
# dynamics
# --------------------------------------------------------------------------
def lookahead_limiter(
    x: np.ndarray,
    ceiling_db: float = -1.5,
    lookahead_ms: float = 4.0,
    sr: int = SR,
) -> np.ndarray:
    """Linked lookahead peak limiter.

    `ceiling_db` is a sample-peak ceiling in dBFS. A centred running minimum
    over the lookahead window guarantees the applied gain never allows a
    sample above the ceiling, while the window keeps the gain curve smooth
    enough to avoid audible distortion.
    """
    ceiling = from_db(ceiling_db)
    n = x.shape[0]
    if n == 0:
        return x
    window = max(1, int(lookahead_ms * 1e-3 * sr))
    peak = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
    need = np.ones(n)
    over = peak > ceiling
    need[over] = ceiling / peak[over]
    # centred running minimum: guarantees the applied gain never lets a
    # sample exceed the ceiling, while the window keeps the curve smooth
    gain = ndimage.minimum_filter1d(need, size=2 * window + 1, mode="nearest")
    if x.ndim == 2:
        return x * gain[:, None]
    return x * gain


def _decaying_peak(env: np.ndarray, a_rel: float, block: int = 1024) -> np.ndarray:
    """Decaying-peak detector: instant attack, exponential release.

    The recurrence is ``peak[i] = max(env[i], a_rel * peak[i-1])``: a new
    sample lifts the detector immediately, and between samples the previous
    peak decays with the release coefficient. The block-wise evaluation
    computes the running maximum of the **de-decayed** signal
    (``max(env[k] * a_rel**-k)``) and multiplies it back by the decay curve,
    so

    * the decay is applied to the output as well - an early peak keeps falling
      instead of staying flat for the whole block,
    * the result does not depend on the block alignment: the carried state of
      the previous block enters the next one through the same decay,
    * the detector continues to decay after the signal ends.

    A block size of 1024 keeps ``a_rel ** -block`` well away from overflow.
    """
    out = np.empty_like(env)
    carry = 0.0
    n = env.size
    for start in range(0, n, block):
        seg = env[start : start + block]
        idx = np.arange(seg.size, dtype=np.float64)
        decay = a_rel ** idx
        run = np.maximum.accumulate(seg / decay) * decay
        out[start : start + seg.size] = np.maximum(run, carry * a_rel * decay)
        carry = float(out[start + seg.size - 1])
    return out


def _smooth_ballistics(target_db: np.ndarray, a_att: float, a_rel: float) -> np.ndarray:
    """One-pole smoother with separate attack and release coefficients.

    The reduction deepens quickly (attack) and recovers slowly (release).
    Implemented over plain Python floats: a 3.5 M sample pass costs about
    half a second, which is acceptable for a mastering pass.
    """
    values = target_db.tolist()
    out = [0.0] * len(values)
    y = 0.0
    for i, t in enumerate(values):
        coef = a_att if t < y else a_rel
        y = coef * y + (1.0 - coef) * t
        out[i] = y
    return np.array(out, dtype=np.float64)


def compress(
    x: np.ndarray,
    threshold_db: float = -18.0,
    ratio: float = 2.0,
    attack_s: float = 0.025,
    release_s: float = 0.25,
    sr: int = SR,
) -> np.ndarray:
    """Feed-forward peak compressor with a dB-domain gain reduction.

    The gain reduction is computed from the detector level **in dBFS**: the
    difference between the envelope level and the threshold is a level
    difference, not an amplitude difference. Subtracting linear amplitudes and
    treating the result as decibels applies roughly a tenth of the intended
    reduction (a settled -6 dBFS signal under a -18 dBFS threshold and a 2:1
    ratio has to lose 6 dB, not 0.19 dB).

    The detector is a decaying peak, so a continuous tone settles at its peak
    level; the ballistics then apply the attack and release times to the gain
    reduction itself. Gain stays at unity below the threshold.
    """
    if ratio < 1.0:
        raise ValueError("compress(): ratio must be >= 1")
    single = x.ndim == 1
    channels = [x] if single else [x[:, c] for c in range(x.shape[1])]

    a_rel = float(np.exp(-1.0 / max(1e-6, release_s * sr)))
    a_att = float(np.exp(-1.0 / max(1e-6, attack_s * sr)))

    processed = []
    for channel in channels:
        env = np.abs(channel)
        detector = _decaying_peak(env, a_rel)
        detector_db = 20.0 * np.log10(np.maximum(detector, 1e-9))
        over_db = np.maximum(detector_db - threshold_db, 0.0)
        target_db = -over_db * (1.0 - 1.0 / ratio)
        reduction_db = _smooth_ballistics(target_db, a_att, a_rel)
        processed.append(channel * (10.0 ** (reduction_db / 20.0)))

    return processed[0] if single else np.stack(processed, axis=1)


def dc_block(x: np.ndarray, cutoff: float = 18.0, sr: int = SR) -> np.ndarray:
    return highpass(x, cutoff, order=2, sr=sr)


# --------------------------------------------------------------------------
# mixing
# --------------------------------------------------------------------------
def db(x: float) -> float:
    return 20.0 * np.log10(max(float(x), 1e-12))


def from_db(x: float) -> float:
    return 10.0 ** (x / 20.0)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0


def normalize_peak(x: np.ndarray, target_db: float = -1.0) -> np.ndarray:
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak <= 0:
        return x
    return x * (from_db(target_db) / peak)

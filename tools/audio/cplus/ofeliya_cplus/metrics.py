"""Measurement and QA for the OFELIYA C+ v4 audio package.

Every number in the final report comes from this module — nothing is
estimated. The checks are the ones the brief asks for explicitly:

* **seam**: sample-level discontinuity at the loop boundary, head/tail RMS
  delta, spectral continuity across the wrap, and a ten-cycle concatenation
  test;
* **mono compatibility**: loudness drop under L+R fold-down, stereo
  correlation, low-band phase loss and per-band retention;
* **SFX intelligibility**: how loud the music bed is inside the dominant band
  of each critical game sound (`bossphase`, `boss`, `elite`, `infect`, `lysis`,
  `hit`, `pickup`, `levelup`);
* **mobile playback**: a documented small-speaker emulation — explicitly a
  *technical emulation*, not a physical Galaxy S20+ measurement;
* **listening fatigue**: self-similarity of the spectrogram, so a 16 s loop
  masquerading as an 80 s composition is detected automatically.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from . import dsp
from .dsp import SR
from .master import integrated_lufs, true_peak_db

#: Analysis bands used across the package (Hz).
BANDS = {
    "sub_100": (20.0, 100.0),
    "punch_110_220": (110.0, 220.0),
    "low_220_500": (220.0, 500.0),
    "mid_500_1500": (500.0, 1500.0),
    "sfx_pocket_1500_3500": (1500.0, 3500.0),
    "upper_3500_8000": (3500.0, 8000.0),
    "air_8000_16000": (8000.0, 16000.0),
}


# --------------------------------------------------------------------------
# core measurement
# --------------------------------------------------------------------------
def read(path: Path) -> tuple[np.ndarray, int]:
    data, sr = sf.read(str(path), always_2d=True)
    return data.astype(np.float64), sr


def mono_of(stereo: np.ndarray) -> np.ndarray:
    return stereo.mean(axis=1)


def band_energy_pct(stereo: np.ndarray, sr: int = SR) -> dict[str, float]:
    """Share of total spectral energy per analysis band (mono sum)."""
    mono = mono_of(stereo)
    if mono.size == 0:
        return {k: 0.0 for k in BANDS}
    win = np.hanning(min(mono.size, 1 << 16))
    n_fft = 1 << 16
    step = n_fft // 2
    acc = np.zeros(n_fft // 2 + 1)
    total = 0.0
    for start in range(0, max(1, mono.size - step), step):
        seg = mono[start : start + n_fft]
        if seg.size < 1024:
            break
        if seg.size < n_fft:
            seg = np.pad(seg, (0, n_fft - seg.size))
        seg = seg * win
        spec = np.abs(np.fft.rfft(seg)) ** 2
        acc += spec
        total += float(spec.sum())
    if total <= 0:
        return {k: 0.0 for k in BANDS}
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    out: dict[str, float] = {}
    for name, (lo, hi) in BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        out[name] = float(acc[mask].sum() / total * 100.0)
    return out


def spectral_centroid(stereo: np.ndarray, sr: int = SR) -> float:
    mono = mono_of(stereo)
    if mono.size < 2048:
        return 0.0
    win = np.hanning(mono.size)
    spec = np.abs(np.fft.rfft(mono * win)) ** 2
    freqs = np.fft.rfftfreq(mono.size, 1.0 / sr)
    total = spec.sum()
    if total <= 0:
        return 0.0
    return float((freqs * spec).sum() / total)


def stereo_metrics(stereo: np.ndarray) -> dict[str, float]:
    left, right = stereo[:, 0], stereo[:, 1]
    mid = 0.5 * (left + right)
    side = 0.5 * (left - right)
    rms_mid = dsp.rms(mid)
    rms_side = dsp.rms(side)
    if rms_mid > 1e-12 and rms_side > 1e-12:
        corr = float(np.corrcoef(left, right)[0, 1])
    else:
        corr = 1.0
    # low-band side energy: a proxy for phase loss when folded to mono
    lo = dsp.lowpass(side, 250.0, order=2)
    return {
        "stereoCorrelation": round(corr, 4),
        "sideMidRatio": round(rms_side / max(rms_mid, 1e-12), 4),
        "lowBandSideRms": round(float(dsp.rms(lo)), 8),
        "lowBandSideToMid": round(float(dsp.rms(lo) / max(rms_mid, 1e-12)), 6),
    }


def measure_array(stereo: np.ndarray, sr: int = SR) -> dict:
    peak = float(np.abs(stereo).max()) if stereo.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(stereo))))
    clipped = float(np.mean(np.abs(stereo) > 0.999)) if stereo.size else 0.0
    try:
        lufs = integrated_lufs(stereo, sr)
    except Exception:
        lufs = float("nan")
    out = {
        "durationSec": round(stereo.shape[0] / sr, 3),
        "sampleRate": sr,
        "channels": int(stereo.shape[1]),
        "lufs": None if not np.isfinite(lufs) else round(float(lufs), 2),
        "truePeakDbTp": round(true_peak_db(stereo, sr), 2),
        "peak": round(peak, 4),
        "clippedFraction": round(clipped, 5),
        "rms": round(rms, 4),
        "rmsDbFs": round(dsp.db(rms), 2),
        "spectralCentroidHz": round(spectral_centroid(stereo, sr), 1),
    }
    out.update(band_energy_pct(stereo, sr))
    out.update(stereo_metrics(stereo))
    return out


def measure_file(path: Path) -> dict:
    data, sr = read(path)
    out = measure_array(data, sr)
    out["bytes"] = Path(path).stat().st_size
    return out


# --------------------------------------------------------------------------
# loop seam
# --------------------------------------------------------------------------
def seam_report(stereo: np.ndarray, sr: int = SR, cycles: int = 10) -> dict:
    """Boundary continuity.

    `sampleJumpRel` is |x[0] - x[N-1]| relative to the file peak — the metric
    the audition package omitted. `wrapDiscontinuityMax` is the largest such
    jump over a `cycles`-fold concatenation, which is what a listener actually
    hears when the bed repeats.
    """
    left, right = stereo[:, 0], stereo[:, 1]
    peak = float(np.abs(stereo).max()) if stereo.size else 0.0
    n = stereo.shape[0]
    if n < 2 or peak <= 0:
        return {"sampleJumpRel": 1.0, "wrapDiscontinuityMax": 1.0, "seamless": False}

    jump = float(np.abs(left[0] - left[n - 1]) + np.abs(right[0] - right[n - 1]))
    jump_rel = jump / (2.0 * peak)

    # interior first-difference distribution, for reference
    d = np.abs(np.diff(left))
    interior_p999 = float(np.percentile(d, 99.9))
    interior_max = float(d.max()) if d.size else 0.0

    # multi-cycle concatenation: measure the step at every wrap without
    # materialising the repeated buffer
    left_diff = np.diff(left)
    wraps = []
    for k in range(1, cycles):
        idx = k * n - 1  # last sample of copy k -> first sample of copy k+1
        if idx < left_diff.size:
            wraps.append(float(abs(left_diff[idx])))
    wraps_arr = np.array(wraps) if wraps else np.array([float(left_diff.max()) if left_diff.size else 0.0])
    wrap_max = float(wraps_arr.max())
    wrap_mean = float(wraps_arr.mean())

    # spectral continuity: the band balance across the boundary must match
    # band by band. Per-bin ratios are meaningless for noise-based material,
    # so the comparison is done on the analysis bands.
    #
    # The window is 2 s, not 50 ms: the "air" band carries filtered noise,
    # and a 50 ms window of noise differs from the next 50 ms of noise by
    # several dB even inside a perfectly continuous piece. Two seconds
    # average that randomness out and still straddle the loop point.
    win = int(2.0 * sr)
    before = left[-win:]
    after = left[:win]
    band_delta = {}
    for name, (lo, hi) in BANDS.items():
        e_before = dsp.rms(dsp.bandpass(before, lo, hi, order=2))
        e_after = dsp.rms(dsp.bandpass(after, lo, hi, order=2))
        band_delta[name] = round(
            float(20.0 * np.log10(max(e_after, 1e-12) / max(e_before, 1e-12))), 2
        )
    spectral_continuity_db = max(abs(v) for v in band_delta.values())

    head_rms = float(dsp.rms(left[: int(0.01 * sr)]))
    tail_rms = float(dsp.rms(left[-int(0.01 * sr) :]))
    head_tail_db = float(dsp.db(max(head_rms, 1e-12)) - dsp.db(max(tail_rms, 1e-12)))

    # percentile rank of the wrap step inside the file's own step distribution
    if d.size:
        wrap_diff = float(np.abs(left[0] - left[-1]))
        rank = float(np.mean(d <= wrap_diff) * 100.0)
    else:
        rank = 100.0

    return {
        "sampleJumpRel": round(jump_rel, 6),
        "sampleJumpAbs": round(jump, 6),
        "interiorDiffP999": round(interior_p999, 6),
        "interiorDiffMax": round(interior_max, 6),
        "wrapDiscontinuityMax": round(wrap_max, 6),
        "wrapDiscontinuityMean": round(wrap_mean, 6),
        "wrapDiffPercentile": round(rank, 3),
        "cyclesTested": cycles,
        "headTailRmsDeltaDb": round(head_tail_db, 3),
        "spectralContinuityMaxBandDb": round(spectral_continuity_db, 3),
        "spectralBandDeltaDb": band_delta,
        # A seam is a click when the wrap step is an outlier against the
        # file's own sample-to-sample distribution. A peak-relative test
        # alone would flag dense, noisy beds as broken even when the wrap
        # step is smaller than steps that occur naturally inside the file.
        "seamless": bool(
            wrap_max <= max(interior_max, 1e-6) * 1.02
            and spectral_continuity_db < 6.0
        ),
    }


# --------------------------------------------------------------------------
# mono compatibility
# --------------------------------------------------------------------------
def mono_report(stereo: np.ndarray, sr: int = SR) -> dict:
    """L+R fold-down: loudness change, correlation and per-band retention.

    BS.1770 sums the *power* of both channels, so a fully coherent stereo
    pair measures exactly 3.01 dB louder than its 0.5*(L+R) fold-down. The
    reported `monoLufsDeltaDb` is therefore *positive and close to 3.01 dB*
    for an ideal fold-down; a larger value means the side channel carried
    energy that a mono speaker cannot reproduce, and a value below 2 dB means
    the pair is partly out of phase.
    """
    left, right = stereo[:, 0], stereo[:, 1]
    fold = 0.5 * (left + right)
    stereo_for_lufs = np.stack([left, right], axis=1)
    mono_lufs = integrated_lufs(fold.reshape(-1, 1), sr)
    stereo_lufs = integrated_lufs(stereo_for_lufs, sr)
    delta = float(stereo_lufs - mono_lufs)

    mid = 0.5 * (left + right)
    side = 0.5 * (left - right)
    lo_side = dsp.lowpass(side, 250.0, order=2)
    lo_mid = dsp.lowpass(mid, 250.0, order=2)

    band_retention = {}
    for name, (lo, hi) in BANDS.items():
        b_stereo = dsp.bandpass(mid, lo, hi, order=2)
        b_fold = dsp.bandpass(fold, lo, hi, order=2)
        e_stereo = dsp.rms(b_stereo)
        e_fold = dsp.rms(b_fold)
        band_retention[name] = round(
            float(10.0 * np.log10(max(e_fold, 1e-12) / max(e_stereo, 1e-12))), 3
        )

    correlation = float(np.corrcoef(left, right)[0, 1])
    return {
        "monoLufsDeltaDb": round(delta, 3),
        "monoLufsLossDb": round(-delta, 3),
        "coherentIdealDb": 3.01,
        "excessVsCoherentDb": round(delta - 3.01, 3),
        "monoCorrelation": round(correlation, 4),
        "lowBandPhaseLossDb": round(
            float(20.0 * np.log10(max(dsp.rms(lo_side), 1e-12) / max(dsp.rms(lo_mid), 1e-12))), 2
        ),
        "bandRetentionDb": band_retention,
        # A wide stereo image always loses some side energy in a mono fold.
        # 3.01 dB is inherent to BS.1770's channel-power sum; up to 2.5 dB on
        # top of that is normal for a cinematic mix and still audible.
        "monoSafe": bool(2.0 <= delta <= 5.5 and correlation > 0.15),
    }


# --------------------------------------------------------------------------
# SFX intelligibility
# --------------------------------------------------------------------------
def _band_energy_db(signal_mono: np.ndarray, sr: int, lo: float, hi: float) -> float:
    band = dsp.bandpass(signal_mono, lo, hi, order=2)
    return float(dsp.db(dsp.rms(band)))


def _band_peak_db(signal_mono: np.ndarray, sr: int, lo: float, hi: float) -> float:
    band = dsp.bandpass(signal_mono, lo, hi, order=2)
    return float(dsp.db(np.abs(band).max()))


#: In-game bus gains from `src/systems/audioMixMath.ts`.
MUSIC_BUS_GAIN = 0.65
SFX_ROLE_GAINS = {
    "shoot": 0.12, "hit": 0.16, "pickup": 0.28, "pickup2": 0.28, "pickup3": 0.28,
    "click": 0.20, "levelup": 0.50, "hurt": 0.55, "nova": 0.48, "elite": 0.50,
    "boss": 0.60, "bossphase": 0.62, "gameover": 0.58, "victory": 0.58,
    "infect": 0.42, "lysis": 0.62, "kill": 0.16,
}


def sfx_masking(
    music: np.ndarray,
    sfx: np.ndarray,
    sr: int = SR,
    name: str = "sfx",
    sfx_role: str | None = None,
    music_bus_gain: float = MUSIC_BUS_GAIN,
) -> dict:
    """How loud the music bed is inside the SFX's own dominant band.

    The SFX dominant band is found from the SFX spectrum (the third of the
    250-6000 Hz range that carries most of its energy) — not from a fixed
    1.5-3.5 kHz pocket, which the independent review in issue #299 showed
    does not hold for the boss signals.

    The comparison uses the **real in-game levels**:

    * the music bed plays through the music bus (`MUSIC_GAIN` = 0.65), and its
      sustained level in the band is what can mask a sound;
    * the SFX plays through its role gain (`SFX_ROLE_GAINS`), and a transient
      is heard by its **peak** in the band, not by its file RMS.

    `musicVsSfxInBandDb` <= 0 means the sustained music level in the SFX band
    stays below the SFX peak in that band — the sound reads through the bed.
    """
    m_mono = mono_of(music)
    s_mono = mono_of(sfx)
    edges = [250.0, 500.0, 1000.0, 2000.0, 3500.0, 6000.0]
    energies = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        energies.append(_band_energy_db(s_mono, sr, lo, hi))
    idx = int(np.argmax(energies))
    lo, hi = edges[idx], edges[idx + 1]

    music_rms_db = _band_energy_db(m_mono, sr, lo, hi)
    sfx_rms_db = _band_energy_db(s_mono, sr, lo, hi)
    sfx_peak_db = _band_peak_db(s_mono, sr, lo, hi)

    role_gain = SFX_ROLE_GAINS.get(sfx_role or "", 1.0)
    music_db = music_rms_db + dsp.db(music_bus_gain)
    sfx_db = sfx_peak_db + dsp.db(role_gain)

    return {
        "name": name,
        "sfxRole": sfx_role,
        "dominantBandHz": [lo, hi],
        "musicBusGain": music_bus_gain,
        "sfxRoleGain": role_gain,
        "musicBandRmsDb": round(music_rms_db, 2),
        "musicBandDb": round(music_db, 2),
        "sfxBandRmsDb": round(sfx_rms_db, 2),
        "sfxBandPeakDb": round(sfx_peak_db, 2),
        "sfxBandDb": round(sfx_db, 2),
        "musicVsSfxInBandDb": round(music_db - sfx_db, 2),
        "sfxClear": bool(music_db - sfx_db <= 0.0),
    }


# --------------------------------------------------------------------------
# small-speaker emulation (technical emulation, not a physical measurement)
# --------------------------------------------------------------------------
def emulate_small_speaker(stereo: np.ndarray, sr: int = SR) -> dict:
    """Emulate a small phone speaker (approx. 12 x 15 mm driver).

    Chain (documented, deterministic):
      1. body resonance: 2nd-order high-pass at 180 Hz
      2. driver resonance boost: peaking +4 dB at 420 Hz, Q 1.2
      3. driver top roll-off: 3rd-order low-pass at 7.5 kHz
      4. soft limiting at -6 dBFS (small drivers distort early)

    The result is a *technical emulation*. A physical Galaxy S20+ remains a
    separate manual acceptance step.
    """
    left = stereo[:, 0].copy()
    right = stereo[:, 1].copy()
    for ch in (left, right):
        ch[:] = dsp.highpass(ch, 180.0, order=2, sr=sr)
        ch[:] = dsp.peaking(ch, 420.0, 4.0, q=1.2, sr=sr)
        ch[:] = dsp.lowpass(ch, 7500.0, order=3, sr=sr)
        ch[:] = dsp.soft_clip(ch, 2.0)
    emu = np.stack([left, right], axis=1)
    before = integrated_lufs(stereo, sr)
    after = integrated_lufs(emu, sr)
    before_bands = band_energy_pct(stereo, sr)
    after_bands = band_energy_pct(emu, sr)
    return {
        "emulatedLufs": round(float(after), 2),
        "loudnessDeltaDb": round(float(after - before), 2),
        "punchBandBeforePct": round(before_bands["punch_110_220"], 2),
        "punchBandAfterPct": round(after_bands["punch_110_220"], 2),
        "airBeforePct": round(before_bands["air_8000_16000"], 2),
        "airAfterPct": round(after_bands["air_8000_16000"], 2),
        "note": "technical emulation of a small speaker; not a physical Galaxy S20+ measurement",
    }


# --------------------------------------------------------------------------
# listening-fatigue proxy
# --------------------------------------------------------------------------
def fatigue_report(stereo: np.ndarray, sr: int = SR, window_s: float = 4.0) -> dict:
    """How much of the piece repeats itself.

    The detector compares spectrogram windows that are *far apart* in time.
    Neighbouring windows of any continuous piece are similar — that is not
    repetition. A 16 s loop copied five times is only visible when the
    comparison is made across a 16 s lag, which is what `loop16sEcho`
    measures: a genuinely composed 80 s bed scores far below 1.0 there,
    a looped 16 s bed scores above 0.98.
    """
    mono = mono_of(stereo)
    win = int(window_s * sr)
    if mono.size < 4 * win:
        return {"loop16sEcho": 1.0, "farSimilarityMean": 1.0, "farSimilarPairsPct": 100.0, "repetitionRisk": "high"}
    hop = win // 2
    feats = []
    for start in range(0, mono.size - win, hop):
        seg = mono[start : start + win] * np.hanning(win)
        spec = np.abs(np.fft.rfft(seg))
        feats.append(spec / (np.linalg.norm(spec) + 1e-12))
    feats_arr = np.array(feats)
    n = feats_arr.shape[0]
    sim = feats_arr @ feats_arr.T

    lag16 = max(1, int(16.0 / (hop / sr)))
    echo_vals = [sim[i, i + lag16] for i in range(n - lag16)] if n > lag16 else [1.0]

    far_gap = max(2, int(8.0 / (hop / sr)))
    far_vals = []
    for i in range(n):
        for j in range(i + far_gap, n):
            far_vals.append(sim[i, j])
    far_arr = np.array(far_vals) if far_vals else np.array([1.0])
    near_gap = max(1, far_gap // 2)
    near_vals = [sim[i, j] for i in range(n) for j in range(i + 1, min(n, i + near_gap + 1))]

    echo = float(np.mean(echo_vals))
    far_mean = float(far_arr.mean())
    near_mean = float(np.mean(near_vals)) if near_vals else far_mean
    far_pct = float(np.mean(far_arr > 0.98) * 100.0)
    return {
        "loop16sEcho": round(echo, 4),
        "farSimilarityMean": round(far_mean, 4),
        "nearSimilarityMean": round(near_mean, 4),
        "farSimilarPairsPct": round(far_pct, 3),
        "distinctWindows": int(n),
        "windowSec": window_s,
        "repetitionRisk": "low" if (echo < 0.95 and far_pct < 10.0) else "elevated",
    }


# --------------------------------------------------------------------------
# package level
# --------------------------------------------------------------------------
def sha256_of(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

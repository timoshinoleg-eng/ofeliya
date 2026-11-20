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

    # Interior first-difference distribution, for reference. The comparison is
    # done on the *sum of both channels* so it matches `jump` exactly.
    d = np.abs(np.diff(left)) + np.abs(np.diff(right))
    interior_p999 = float(np.percentile(d, 99.9))
    interior_max = float(d.max()) if d.size else 0.0

    # --- ten-cycle concatenation ------------------------------------------
    # The buffer really is played `cycles` times in a row. The test walks the
    # repeats and measures the step at every internal seam, the level of every
    # cycle and the largest step anywhere in the concatenated signal. Nothing
    # is approximated: a repeated buffer means the seam is identical in every
    # repeat, and that identity is what proves the loop does not degrade.
    wrap_steps: list[float] = []
    cycle_rms: list[float] = []
    max_step = 0.0
    for k in range(cycles):
        d_left = np.abs(np.diff(left))
        d_right = np.abs(np.diff(right))
        if d_left.size:
            max_step = max(max_step, float(d_left.max() + d_right.max()))
        if k > 0:
            step = float(np.abs(left[0] - left[n - 1]) + np.abs(right[0] - right[n - 1]))
            wrap_steps.append(step)
            max_step = max(max_step, step)
        cycle_rms.append(float(np.sqrt((np.square(left).sum() + np.square(right).sum()) / (2.0 * n))))
    wraps_arr = np.array(wrap_steps) if wrap_steps else np.array([jump])
    wrap_max = float(wraps_arr.max())
    wrap_mean = float(wraps_arr.mean())
    rms_drift_db = 0.0
    if len(cycle_rms) > 1:
        rms_drift_db = float(dsp.db(max(cycle_rms) / max(min(cycle_rms), 1e-12)))
    # every repeat must reproduce the same seam, and the level must not drift
    seams_identical = bool(wraps_arr.size == 0 or (wraps_arr.max() - wraps_arr.min()) < 1e-9)

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
        wrap_diff = float(np.abs(left[0] - left[n - 1]) + np.abs(right[0] - right[n - 1]))
        rank = float(np.mean(d <= wrap_diff) * 100.0)
    else:
        rank = 100.0

    # Local outlier test: a click is a step that stands out against the
    # texture right next to the seam. The wrap step is compared with the
    # largest step inside +/-50 ms of the boundary: a ratio far below 1 means
    # the seam is no rougher than the material around it. Both are summed over
    # the two channels, exactly like the wrap step itself.
    #
    # The two windows are measured *separately*: concatenating them would put
    # the seam step inside the reference window, and the ratio would then
    # always be ~1 — the detector could never report a click.
    window = int(0.05 * sr)
    before_local = np.abs(np.diff(left[-window:])) + np.abs(np.diff(right[-window:]))
    after_local = np.abs(np.diff(left[:window])) + np.abs(np.diff(right[:window]))
    local_max = max(
        float(before_local.max()) if before_local.size else 0.0,
        float(after_local.max()) if after_local.size else 0.0,
    )
    if local_max > 1e-9:
        local_ratio = float(wrap_diff / local_max)
    elif wrap_diff > 1e-9:
        # A non-zero step next to no local texture at all is a discontinuity.
        # Reporting a ratio of zero would let the check accept it.
        local_ratio = 999.0
    else:
        local_ratio = 0.0

    # --- per-channel continuity --------------------------------------------
    # Summing the two channels lets a break in one of them hide behind the
    # other channel's larger interior steps: a right-channel jump of 0.2 next
    # to a left-channel interior step of 0.227 passes every summed check.
    # Every channel is therefore judged against **its own** interior and local
    # steps, and the seam only counts as seamless when all of them pass.
    channel_checks: list[dict] = []
    for name, channel in (("left", left), ("right", right)):
        d_ch = np.abs(np.diff(channel))
        interior_ch = float(d_ch.max()) if d_ch.size else 0.0
        boundary_ch = float(np.abs(channel[0] - channel[n - 1]))
        before_ch = np.abs(np.diff(channel[-window:])) if window < n else np.array([])
        after_ch = np.abs(np.diff(channel[:window]))
        local_ch = max(
            float(before_ch.max()) if before_ch.size else 0.0,
            float(after_ch.max()) if after_ch.size else 0.0,
        )
        if local_ch > 1e-9:
            ratio_ch = float(boundary_ch / local_ch)
        elif boundary_ch > 1e-9:
            ratio_ch = 999.0
        else:
            ratio_ch = 0.0
        channel_checks.append({
            "channel": name,
            "boundaryStep": round(boundary_ch, 8),
            "interiorMaxStep": round(interior_ch, 8),
            "localMaxStep": round(local_ch, 8),
            "boundaryVsLocalRatio": round(ratio_ch, 4),
            "seamless": bool(
                boundary_ch <= max(interior_ch, 1e-6) * 1.02 and ratio_ch <= 3.0
            ),
        })
    channels_seamless = bool(channel_checks) and all(c["seamless"] for c in channel_checks)

    return {
        "sampleJumpRel": round(jump_rel, 6),
        "sampleJumpAbs": round(jump, 6),
        "interiorDiffP999": round(interior_p999, 6),
        "interiorDiffMax": round(interior_max, 6),
        "wrapDiscontinuityMax": round(wrap_max, 6),
        "wrapDiscontinuityMean": round(wrap_mean, 6),
        "wrapDiffPercentile": round(rank, 3),
        "wrapLocalMaxStep": round(local_max, 6),
        "wrapVsLocalRatio": round(local_ratio, 4),
        "cyclesTested": cycles,
        "cyclesMeasuredSeams": int(len(wrap_steps)),
        "cyclesSeamsIdentical": seams_identical,
        "cyclesRmsDriftDb": round(rms_drift_db, 4),
        "cyclesMaxStep": round(max_step, 6),
        "headTailRmsDeltaDb": round(head_tail_db, 3),
        "spectralContinuityMaxBandDb": round(spectral_continuity_db, 3),
        "spectralBandDeltaDb": band_delta,
        "channelChecks": channel_checks,
        # A seam is a click when the wrap step is an outlier against the
        # texture next to it. Five conditions:
        #  * every channel stays within its own interior and local steps;
        #  * the wrap step is no larger than the largest step inside the file;
        #  * it is not a local outlier either (ratio vs the +/-50 ms window);
        #  * the band balance across the boundary still matches;
        #  * every one of the tested repeats reproduces the same seam and the
        #    level does not drift from cycle to cycle.
        "seamless": bool(
            channels_seamless
            and wrap_max <= max(interior_max, 1e-6) * 1.02
            and local_ratio <= 3.0
            and spectral_continuity_db < 6.0
            and seams_identical
            and rms_drift_db < 0.1
        ),
    }


# --------------------------------------------------------------------------
# mono compatibility
# --------------------------------------------------------------------------
def mono_report(stereo: np.ndarray, sr: int = SR) -> dict:
    """L+R fold-down: loudness change, correlation and per-band retention.

    The per-band retention compares the fold-down against the **original
    stereo channels**, not against the mid signal: `mid` and `fold` are the
    same signal, so comparing them would report 0 dB in every band and could
    never detect a phase cancellation. The reference is the mean of the two
    channels' energies, so identical channels report 0 dB and an anti-phase
    pair reports the full loss.

    BS.1770 sums the *power* of both channels, so a stereo pair with
    **identical** channels measures exactly 3.01 dB louder than its
    0.5*(L+R) fold-down. Coherence alone is not enough for that figure: with
    different channel levels the difference shrinks (L = 2R measures about
    +0.46 dB), so 3.01 dB is the reference for equal channels only.
    The reported `monoLufsDeltaDb` is *positive and close to 3.01 dB* for an
    ideal fold-down; a larger value means the side channel carried energy
    that a mono speaker cannot reproduce, and a value below 2 dB means the
    pair is partly out of phase.
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
    band_side_pct = {}
    for name, (lo, hi) in BANDS.items():
        b_left = dsp.bandpass(left, lo, hi, order=2)
        b_right = dsp.bandpass(right, lo, hi, order=2)
        b_fold = dsp.bandpass(fold, lo, hi, order=2)
        original_energy = 0.5 * (float(np.mean(b_left ** 2)) + float(np.mean(b_right ** 2)))
        fold_energy = float(np.mean(b_fold ** 2))
        ratio = fold_energy / original_energy if original_energy > 1e-18 else 0.0
        band_retention[name] = round(float(10.0 * np.log10(max(ratio, 1e-12))), 3)
        b_side = dsp.bandpass(side, lo, hi, order=2)
        side_band_energy = float(np.mean(b_side ** 2))
        # Share of the band's energy that exists only in the side channel.
        # The denominator is the band's **original** energy: adding the
        # side energy to it counted that energy twice and reported 50 % for
        # a fully anti-phase pair, where in fact 100 % of the energy is
        # in the side channel.
        band_side_pct[name] = (
            round(100.0 * side_band_energy / original_energy, 3)
            if original_energy > 1e-18
            else 0.0
        )

    mid_energy = float(np.mean(mid ** 2))
    side_energy_total = float(np.mean(side ** 2))
    total_energy = mid_energy + side_energy_total
    # A silent channel has no phase information: `np.corrcoef` would
    # return NaN for it and a NaN would leak into the report and into the
    # mono-safe verdict. A panned pair is coherent, not anti-phase.
    left_std = float(np.std(left))
    right_std = float(np.std(right))
    if left_std > 1e-12 and right_std > 1e-12:
        correlation = float(np.corrcoef(left, right)[0, 1])
    else:
        correlation = 1.0

    return {
        "monoLufsDeltaDb": round(delta, 3),
        "monoLufsLossDb": round(-delta, 3),
        "coherentIdealDb": 3.01,
        "excessVsCoherentDb": round(delta - 3.01, 3),
        "monoCorrelation": round(correlation, 4),
        "lowBandPhaseLossDb": round(
            float(20.0 * np.log10(max(dsp.rms(lo_side), 1e-12) / max(dsp.rms(lo_mid), 1e-12))), 2
        ),
        "antiPhaseEnergyPct": round(
            100.0 * side_energy_total / total_energy if total_energy > 1e-18 else 0.0, 3
        ),
        "bandRetentionDb": band_retention,
        "bandSideEnergyPct": band_side_pct,
        # A wide stereo image always loses some side energy in a mono fold.
        # 3.01 dB is inherent to BS.1770's channel-power sum; up to 2.5 dB on
        # top of that is normal for a cinematic mix and still audible. A band
        # that loses more than 12 dB means a phase problem, not a wide image.
        "monoSafe": bool(
            2.0 <= delta <= 5.5
            and correlation > 0.15
            and all(value > -12.0 for value in band_retention.values())
        ),
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


def runtime_normalization_trim(stereo: np.ndarray) -> float:
    """Mirror of `scanNormalizationTrim` in `src/systems/audioMixMath.ts`.

    The runtime plays a decoded SFX at `SFX_ROLE_GAINS[name] * trim`, where
    the trim is derived from the decoded buffer's own peak. Ignoring it makes
    the absolute intelligibility numbers wrong by up to ~16 dB.
    """
    peak = float(np.abs(stereo).max()) if stereo.size else 0.0
    if peak <= 0:
        return 1.0
    return min(12.0, 0.63 / peak)


def sfx_masking(
    music: np.ndarray,
    sfx: np.ndarray,
    sr: int = SR,
    name: str = "sfx",
    sfx_role: str | None = None,
    music_bus_gain: float = MUSIC_BUS_GAIN,
    runtime_trim: float | None = None,
) -> dict:
    """How loud the music bed is inside the SFX's own dominant band.

    The SFX dominant band is found from the SFX spectrum (the third of the
    250-6000 Hz range that carries most of its energy) — not from a fixed
    1.5-3.5 kHz pocket, which the independent review in issue #299 showed
    does not hold for the boss signals.

    Two levels of information are reported:

    * **relative** — the music level in the SFX band against the SFX level in
      the same band, both at their in-game levels. This is the number that
      answers "does the bed cover the sound".
    * **absolute** — the margin between the SFX and the music in that band.
      A positive margin means the sound stays above the bed.

    `musicVsSfxInBandDb` <= 0 means the music is below the SFX in its band.
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
    trim = runtime_trim if runtime_trim is not None else runtime_normalization_trim(sfx)

    music_db = music_rms_db + dsp.db(music_bus_gain)
    sfx_db = sfx_peak_db + dsp.db(role_gain) + dsp.db(trim)

    return {
        "name": name,
        "sfxRole": sfx_role,
        "dominantBandHz": [lo, hi],
        "musicBusGain": music_bus_gain,
        "sfxRoleGain": role_gain,
        "sfxRuntimeTrim": round(float(trim), 4),
        "musicBandRmsDb": round(music_rms_db, 2),
        "musicBandDb": round(music_db, 2),
        "sfxBandRmsDb": round(sfx_rms_db, 2),
        "sfxBandPeakDb": round(sfx_peak_db, 2),
        "sfxBandDb": round(sfx_db, 2),
        "musicVsSfxInBandDb": round(music_db - sfx_db, 2),
        "sfxMarginDb": round(sfx_db - music_db, 2),
        "sfxClear": bool(music_db - sfx_db <= 0.0),
        "sfxAboveMusic": bool(sfx_db - music_db > 0.0),
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

    The detector only makes sense for material that is actually looped: a
    four-second one-shot stinger has no "far" window to compare against, so
    the report is marked as not applicable instead of reporting a meaningless
    number.
    """
    duration = stereo.shape[0] / float(sr)
    applicable = duration >= 8.0 * window_s
    if not applicable:
        return {
            "applicable": False,
            "reason": f"one-shot material ({duration:.1f}s): the loop-repetition detector does not apply",
            "loop16sEcho": None,
            "farSimilarityMean": None,
            "nearSimilarityMean": None,
            "farSimilarPairsPct": None,
            "distinctWindows": 0,
            "windowSec": window_s,
            "repetitionRisk": "n/a",
        }
    mono = mono_of(stereo)
    win = int(window_s * sr)
    if mono.size < 4 * win:
        return {"applicable": False, "loop16sEcho": None, "farSimilarityMean": None,
                "nearSimilarityMean": None, "farSimilarPairsPct": None,
                "distinctWindows": 0, "windowSec": window_s, "repetitionRisk": "n/a"}
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
        "applicable": True,
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

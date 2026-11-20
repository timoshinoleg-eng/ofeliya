"""Mastering chain for the OFELIYA C+ v4 package.

Target contract (identical to `docs/AUDIO_MASTERING.md` in the game repo):

* integrated loudness **-14.0 LUFS** (BS.1770 K-weighting, tolerance +/- 0.5 dB)
* true peak **<= -1.0 dBTP** (4x oversampling)
* stereo, 44 100 Hz

The mobile shaping is deliberately moderate. Variant B of the audition package
proved that pushing 73 % of the energy into 110-220 Hz sounds narrow on
headphones, so the C+ chain keeps a full spectrum and only adds weight where a
built-in phone speaker can actually reproduce it:

    high-pass  78 Hz   (4th order)  - remove inaudible sub on a phone speaker
    peaking   +1.5 dB @ 155 Hz      - the S20 "punch" band
    high shelf +1.0 dB @ 5.5 kHz    - air for the game's adaptive lowpass
    bus compression 2:1 @ -18 dBFS
    loudness normalise to -14 LUFS
    look-ahead true-peak limiter at -1.5 dBTP (headroom for lossy encoding)
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from . import dsp

SR = 44100
TARGET_LUFS = -14.0
LUFS_TOLERANCE = 0.5
MAX_TRUE_PEAK_DBTP = -1.0
LIMITER_CEILING_DBTP = -2.5
"""Sample-peak ceiling of the final limiter.

It sits 1.5 dB below the -1 dBTP contract on purpose: the lossy encodes
(Vorbis, MP3) add inter-sample overshoot, and the shipped files have to
satisfy the *true-peak* contract after decoding, not the WAV they came from.
"""

HPF_HZ = 78.0
PUNCH_HZ = 155.0
PUNCH_GAIN_DB = 1.5
AIR_HZ = 5500.0
AIR_GAIN_DB = 1.0

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


@dataclass
class Mastered:
    left: np.ndarray
    right: np.ndarray
    gain_db: float
    lufs: float
    true_peak_db: float


def true_peak_db(data: np.ndarray, sr: int = SR) -> float:
    """True peak after 4x polyphase oversampling (same method as the repo)."""
    if data.size == 0:
        return -120.0
    over = dsp.signal.resample_poly(data, 4, 1, axis=0)
    peak = float(np.abs(over).max())
    return dsp.db(peak)


def integrated_lufs(data: np.ndarray, sr: int = SR) -> float:
    """BS.1770-4 integrated loudness via pyloudnorm."""
    import pyloudnorm as pyln

    meter = pyln.Meter(sr)
    value = meter.integrated_loudness(np.asarray(data, dtype=np.float64))
    return float(value)


def master(
    left: np.ndarray,
    right: np.ndarray,
    sr: int = SR,
    hpf_hz: float = HPF_HZ,
    punch_hz: float = PUNCH_HZ,
    punch_gain_db: float = PUNCH_GAIN_DB,
    air_hz: float = AIR_HZ,
    air_gain_db: float = AIR_GAIN_DB,
    target_lufs: float = TARGET_LUFS,
) -> Mastered:
    """Run the full mastering chain and return the finished stereo pair."""
    n = min(left.size, right.size)
    l = np.asarray(left[:n], dtype=np.float64)
    r = np.asarray(right[:n], dtype=np.float64)

    # 1. mobile high-pass -----------------------------------------------------
    l = dsp.highpass(l, hpf_hz, order=4, sr=sr)
    r = dsp.highpass(r, hpf_hz, order=4, sr=sr)

    # 2. low-mid weight ------------------------------------------------------
    l = dsp.peaking(l, punch_hz, punch_gain_db, q=0.9, sr=sr)
    r = dsp.peaking(r, punch_hz, punch_gain_db, q=0.9, sr=sr)

    # 3. air ------------------------------------------------------------------
    l = dsp.high_shelf(l, air_hz, air_gain_db, sr=sr)
    r = dsp.high_shelf(r, air_hz, air_gain_db, sr=sr)

    # 4. bus compression ------------------------------------------------------
    l = dsp.compress(l, threshold_db=-18.0, ratio=2.0, attack_s=0.025, release_s=0.25, sr=sr)
    r = dsp.compress(r, threshold_db=-18.0, ratio=2.0, attack_s=0.025, release_s=0.25, sr=sr)

    stereo = np.stack([l, r], axis=1)

    # 5. density + crest control --------------------------------------------
    # Saturation and a program limiter tame the crest factor *before* the
    # loudness normalisation. Without this step the normalised bed would need
    # more than 13 dB of crest, which no true-peak ceiling of -1 dBTP can
    # accommodate at -14 LUFS.
    stereo = dsp.soft_clip(stereo, 1.5)
    # Program limiter: the ceiling is placed relative to the material's own RMS
    # (crest of 9 dB), not at a fixed sample level. A fixed ceiling would
    # clamp every transient of a dense mix and squash the dynamics.
    program_rms_db = dsp.db(float(np.sqrt(np.mean(np.square(stereo)))))
    program_ceiling_db = min(-1.0, program_rms_db + 9.0)
    stereo = dsp.lookahead_limiter(
        stereo, ceiling_db=program_ceiling_db, lookahead_ms=4.0, sr=sr
    )

    # 6. loudness normalisation + true-peak ceiling -------------------------
    # Iterated: normalise, limit, measure, correct. The limiter works on the
    # sample peak while the contract is written on the *true* peak, so the
    # ceiling is tightened until the 4x-oversampled measurement fits.
    #
    # The gain is always re-applied to the *base* signal, never to the
    # previously limited result: otherwise the correction would compound and
    # the iteration would oscillate instead of converging.
    base = stereo
    gain_db = 0.0
    ceiling_db = LIMITER_CEILING_DBTP
    stereo = base
    for _ in range(20):
        candidate = base * dsp.from_db(gain_db)
        limited = dsp.lookahead_limiter(
            candidate, ceiling_db=ceiling_db, lookahead_ms=4.0, sr=sr
        )
        lufs = integrated_lufs(limited, sr)
        tp = true_peak_db(limited, sr)
        if not np.isfinite(lufs):
            raise MasteringContractError("mastering: the signal is silent")
        stereo = limited
        if abs(lufs - target_lufs) <= 0.05 and tp <= LIMITER_CEILING_DBTP:
            break
        if tp > LIMITER_CEILING_DBTP:
            # The limiter works on the sample peak; the contract is written on
            # the true peak. Shift the ceiling down by the measured inter-
            # sample overshoot so the oversampled measurement fits.
            overshoot = tp - ceiling_db
            ceiling_db = min(ceiling_db - 0.1, LIMITER_CEILING_DBTP - overshoot - 0.05)
        gain_db += (target_lufs - lufs)
    else:
        # The iteration did not settle: one final pass with the last ceiling,
        # and then the contract check below decides whether the result is
        # usable at all.
        stereo = dsp.lookahead_limiter(
            base * dsp.from_db(gain_db), ceiling_db=ceiling_db, lookahead_ms=4.0, sr=sr
        )

    final_lufs = integrated_lufs(stereo, sr)
    final_tp = true_peak_db(stereo, sr)

    # The contract is checked here, not assumed: a master that does not meet
    # it must never be handed back as a success.
    assert_master_contract(stereo, final_lufs, final_tp, sr)

    return Mastered(
        left=stereo[:, 0].astype(np.float32),
        right=stereo[:, 1].astype(np.float32),
        gain_db=float(gain_db),
        lufs=float(final_lufs),
        true_peak_db=float(final_tp),
    )


class MasteringContractError(RuntimeError):
    """Raised when a master does not satisfy the loudness / true-peak contract."""


def assert_master_contract(
    stereo: np.ndarray,
    lufs: float,
    true_peak: float,
    sr: int = SR,
    target_lufs: float = TARGET_LUFS,
    lufs_tolerance: float = LUFS_TOLERANCE,
    max_true_peak: float = MAX_TRUE_PEAK_DBTP,
) -> None:
    """Verify the mastering contract, raising on any violation.

    Checks, in order: finite samples, finite loudness, loudness inside the
    tolerance, true peak inside the ceiling and a stereo signal at the
    expected sample rate.
    """
    if stereo.size == 0:
        raise MasteringContractError("mastering: empty signal")
    if not np.all(np.isfinite(stereo)):
        raise MasteringContractError("mastering: the signal contains NaN or Inf samples")
    if not np.isfinite(lufs):
        raise MasteringContractError("mastering: the integrated loudness is not a finite number")
    if not np.isfinite(true_peak):
        raise MasteringContractError("mastering: the true peak is not a finite number")
    if abs(lufs - target_lufs) > lufs_tolerance:
        raise MasteringContractError(
            f"mastering: loudness {lufs:.2f} LUFS is outside {target_lufs} +/- {lufs_tolerance} dB"
        )
    if true_peak > max_true_peak:
        raise MasteringContractError(
            f"mastering: true peak {true_peak:.2f} dBTP exceeds {max_true_peak} dBTP"
        )
    if stereo.shape[1] != 2:
        raise MasteringContractError(f"mastering: expected a stereo signal, got {stereo.shape[1]} channels")


def verify_master_file(path: Path, sr: int = SR) -> dict:
    """Measure a written file and enforce the contract on the *decoded* audio.

    The QA has to look at the file that ships, not at the intermediate values
    the mastering chain reported.
    """
    data, file_sr = sf.read(str(path), always_2d=True)
    if file_sr != sr:
        raise MasteringContractError(f"{path.name}: expected {sr} Hz, got {file_sr} Hz")
    lufs = integrated_lufs(data, file_sr)
    tp = true_peak_db(data, file_sr)
    assert_master_contract(data, lufs, tp, file_sr)
    return {"lufs": round(float(lufs), 2), "truePeakDbTp": round(float(tp), 2)}


def write_wav(path: Path, mastered: Mastered, sr: int = SR) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.stack([mastered.left, mastered.right], axis=1)
    sf.write(str(path), data, sr, format="WAV", subtype="PCM_16")
    return path


def encode(path: Path, fmt: str, bitrate: str = "128k", out_dir: Path | None = None) -> Path:
    """Encode a WAV to OGG (Vorbis, gapless) or MP3 through ffmpeg."""
    target_dir = Path(out_dir) if out_dir is not None else path.parent
    target_dir.mkdir(parents=True, exist_ok=True)
    out = target_dir / f"{path.stem}.{fmt}"
    if fmt == "ogg":
        args = ["-c:a", "libvorbis", "-q:a", "5"]
    elif fmt == "mp3":
        args = ["-c:a", "libmp3lame", "-b:a", bitrate]
    else:
        raise ValueError(fmt)
    cmd = [FFMPEG, "-y", "-v", "error", "-i", str(path), *args]
    if fmt == "ogg":
        # The Ogg muxer writes a **random** stream serial number, so two
        # builds of the same audio produced different bytes (the decoded audio
        # was identical). `-fflags +bitexact` pins the serial to zero and
        # `-serial_offset` moves it to a fixed non-zero value, which makes the
        # encode byte-for-byte reproducible.
        cmd += ["-fflags", "+bitexact", "-serial_offset", "1"]
    cmd += [str(out)]
    subprocess.run(cmd, check=True)
    return out

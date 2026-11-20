#!/usr/bin/env python3
"""Compare the C+ masters built before and after the compressor fix.

    python tools/audio/cplus/compare_compressor.py --out <file.json> [--wav-dir <dir>]

The pre-fix compressor (commit ``ba7c445``) subtracted **linear amplitudes**
and treated the result as a decibel value, so a -6 dBFS signal under a
-18 dBFS threshold and a 2:1 ratio lost 0.19 dB instead of 6 dB. That means
the shipped masters were produced by a compressor that did not do what the
mastering chain documents.

This script renders every composition **once** and masters that identical stem
twice - once with the legacy compressor, once with the current one - so the
difference between the two masters is attributable to the compressor alone.
It also runs the control case from the task (settled -6 dBFS level, -18 dBFS
threshold, 2:1 ratio) and reports the measured gain reduction of both
implementations.

Nothing here writes into the package: the shipped audio is produced by
``build.py``; this tool only produces the evidence for the rebuild.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ofeliya_cplus import compositions, master, metrics  # noqa: E402
from ofeliya_cplus import dsp  # noqa: E402
from ofeliya_cplus.dsp import SR  # noqa: E402


# --------------------------------------------------------------------------
# the pre-fix compressor, copied verbatim from ba7c445 (tools/audio/cplus/
# ofeliya_cplus/dsp.py) so the comparison does not depend on git history
# --------------------------------------------------------------------------
def legacy_compress(
    x: np.ndarray,
    threshold_db: float = -18.0,
    ratio: float = 2.0,
    attack_s: float = 0.025,
    release_s: float = 0.25,
    sr: int = SR,
) -> np.ndarray:
    """Feed-forward peak compressor with an envelope follower (pre-fix)."""
    thresh = 10.0 ** (threshold_db / 20.0)
    env = np.abs(x)
    a_att = float(np.exp(-1.0 / max(1e-6, attack_s * sr)))
    a_rel = float(np.exp(-1.0 / max(1e-6, release_s * sr)))
    zi = np.zeros(1)
    fast, _ = dsp.signal.lfilter([1.0 - a_att], [1.0, -a_att], env, zi=zi)
    slow, _ = dsp.signal.lfilter([1.0 - a_rel], [1.0, -a_rel], env, zi=zi)
    env_out = np.maximum(fast, slow)
    over = np.maximum(env_out - thresh, 0.0)
    reduction_db = -over * (1.0 - 1.0 / ratio)
    return x * (10.0 ** (reduction_db / 20.0))


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def crest_db(measured: dict) -> float:
    peak_db = dsp.db(measured["peak"]) if measured["peak"] > 0 else -120.0
    return round(peak_db - measured["rmsDbFs"], 2)


def gain_reduction_stats(before: np.ndarray, after: np.ndarray) -> dict:
    """Per-sample gain reduction in dB, ignoring the near-silent frames."""
    n = min(before.size, after.size)
    b = np.abs(before[:n])
    a = np.abs(after[:n])
    floor = max(float(np.max(b)) * 1e-3, 1e-9)
    mask = b > floor
    if not np.any(mask):
        return {"medianDb": 0.0, "p95Db": 0.0, "maxDb": 0.0}
    gr = 20.0 * np.log10(np.maximum(a[mask], 1e-12) / b[mask])
    return {
        "medianDb": round(float(np.median(gr)), 2),
        "p05Db": round(float(np.percentile(gr, 5)), 2),
        "deepestDb": round(float(np.min(gr)), 2),
    }


def control_case() -> dict:
    """The control case from the task: settled -6 dBFS, -18 dBFS, 2:1."""
    t = np.arange(int(2.0 * SR)) / SR
    x = (10.0 ** (-6.0 / 20.0)) * np.sin(2.0 * np.pi * 220.0 * t)
    out: dict = {
        "levelDbFs": -6.0,
        "thresholdDbFs": -18.0,
        "ratio": 2.0,
        # a gain reduction of 6 dB means the output sits 6 dB below the input
        "expectedGrDb": -6.0,
        "expectedGrMagnitudeDb": 6.0,
    }
    for name, fn in (("legacy", legacy_compress), ("current", dsp.compress)):
        y = fn(x, threshold_db=-18.0, ratio=2.0, attack_s=0.025, release_s=0.25, sr=SR)
        # measure in the steady part, after the attack has settled
        seg = slice(int(1.0 * SR), int(2.0 * SR))
        rms_in = dsp.rms(x[seg])
        rms_out = dsp.rms(y[seg])
        measured_gr = float(dsp.db(rms_out) - dsp.db(rms_in))
        out[name] = {
            "measuredGrDb": round(measured_gr, 2),
            "outputDbFs": round(float(dsp.db(rms_out)), 2),
        }
    out["legacy"]["matchesExpected"] = bool(
        abs(out["legacy"]["measuredGrDb"] - out["expectedGrDb"]) <= 0.5
    )
    out["current"]["matchesExpected"] = bool(
        abs(out["current"]["measuredGrDb"] - out["expectedGrDb"]) <= 0.5
    )
    return out


def pre_compressor_material(stem_left: np.ndarray, stem_right: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The signal that enters the bus compressor (mastering steps 1-3)."""
    n = min(stem_left.size, stem_right.size)
    l = np.asarray(stem_left[:n], dtype=np.float64)
    r = np.asarray(stem_right[:n], dtype=np.float64)
    l = dsp.highpass(l, master.HPF_HZ, order=4, sr=SR)
    r = dsp.highpass(r, master.HPF_HZ, order=4, sr=SR)
    l = dsp.peaking(l, master.PUNCH_HZ, master.PUNCH_GAIN_DB, q=0.9, sr=SR)
    r = dsp.peaking(r, master.PUNCH_HZ, master.PUNCH_GAIN_DB, q=0.9, sr=SR)
    l = dsp.high_shelf(l, master.AIR_HZ, master.AIR_GAIN_DB, sr=SR)
    r = dsp.high_shelf(r, master.AIR_HZ, master.AIR_GAIN_DB, sr=SR)
    return l, r


def build_variant(
    stem,
    track_id: str,
    compressor,
    wav_dir: Path | None,
) -> tuple[dict, np.ndarray]:
    """Master one stem with the given compressor and measure the result."""
    original = dsp.compress
    dsp.compress = compressor
    try:
        mastered = master.master(stem.left, stem.right)
    finally:
        dsp.compress = original

    left, right = mastered.left, mastered.right
    if compositions.TRACK_INFO[track_id]["loop"]:
        left, right = compositions.close_loop(left, right)
    stereo = np.stack([left, right], axis=1).astype(np.float64)

    measured = metrics.measure_array(stereo, SR)
    measured["crestDb"] = crest_db(measured)
    measured["gainDb"] = round(float(mastered.gain_db), 3)
    seam = metrics.seam_report(stereo, SR)
    mono = metrics.mono_report(stereo, SR)

    if wav_dir is not None:
        wav_dir.mkdir(parents=True, exist_ok=True)
        path = wav_dir / f"{track_id}.wav"
        master.write_wav(
            path,
            master.Mastered(
                left=left,
                right=right,
                gain_db=mastered.gain_db,
                lufs=mastered.lufs,
                true_peak_db=mastered.true_peak_db,
            ),
        )
        measured["wav"] = str(path)

    result = {
        "measured": measured,
        "seam": {
            "seamless": seam["seamless"],
            "sampleJumpRel": seam["sampleJumpRel"],
        },
        "mono": {
            "monoSafe": mono["monoSafe"],
            "monoLufsDeltaDb": mono["monoLufsDeltaDb"],
        },
    }
    return result, stereo


def difference_to_legacy(legacy: np.ndarray, current: np.ndarray) -> dict:
    """How far the rebuilt master moved away from the pre-fix master."""
    n = min(legacy.shape[0], current.shape[0])
    diff = current[:n] - legacy[:n]
    ref = legacy[:n]
    rms_ref = dsp.rms(ref)
    rms_diff = dsp.rms(diff)
    return {
        "rmsDiffDbVsLegacy": round(float(dsp.db(rms_diff) - dsp.db(rms_ref)), 2),
        "peakDiffDbVsLegacy": round(
            float(dsp.db(float(np.abs(diff).max())) - dsp.db(float(np.abs(ref).max()))), 2
        ),
        "identical": bool(rms_diff == 0.0),
    }


def compare_track(track_id: str, wav_dir: Path | None) -> dict:
    started = time.time()
    stem = compositions.COMPOSERS[track_id]()
    pre_l, pre_r = pre_compressor_material(stem.left, stem.right)

    legacy, legacy_stereo = build_variant(
        stem, track_id, legacy_compress, (wav_dir / "legacy") if wav_dir else None
    )
    current, current_stereo = build_variant(
        stem, track_id, dsp.compress, (wav_dir / "current") if wav_dir else None
    )

    gr_legacy = gain_reduction_stats(pre_l, legacy_compress(pre_l))
    gr_current = gain_reduction_stats(pre_l, dsp.compress(pre_l))

    lm, cm = legacy["measured"], current["measured"]
    return {
        "id": track_id,
        "title": compositions.TRACK_INFO[track_id]["title"],
        "loop": compositions.TRACK_INFO[track_id]["loop"],
        "compressorGainReduction": {"legacy": gr_legacy, "current": gr_current},
        "legacy": legacy,
        "current": current,
        "rebuiltMasterVsLegacyMaster": difference_to_legacy(legacy_stereo, current_stereo),
        "delta": {
            "lufs": round(cm["lufs"] - lm["lufs"], 2),
            "truePeakDbTp": round(cm["truePeakDbTp"] - lm["truePeakDbTp"], 2),
            "rmsDbFs": round(cm["rmsDbFs"] - lm["rmsDbFs"], 2),
            "crestDb": round(cm["crestDb"] - lm["crestDb"], 2),
            "spectralCentroidHz": round(cm["spectralCentroidHz"] - lm["spectralCentroidHz"], 1),
            "bandsPct": {
                k: round(cm[k] - lm[k], 2)
                for k in metrics.BANDS
                if k in cm and k in lm
            },
        },
        "seconds": round(time.time() - started, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="path of the JSON report")
    ap.add_argument("--wav-dir", default=None, help="optional directory for the current masters (A/B listening)")
    ap.add_argument("--only", default=None, help="compare a single track id")
    args = ap.parse_args()

    wav_dir = Path(args.wav_dir).resolve() if args.wav_dir else None

    ids = list(compositions.COMPOSERS.keys())
    if args.only:
        ids = [args.only]

    report = {
        "generator": "ofeliya_cplus.compare_compressor",
        "legacySource": "tools/audio/cplus/ofeliya_cplus/dsp.py @ ba7c445 (compress)",
        "currentSource": "tools/audio/cplus/ofeliya_cplus/dsp.py @ HEAD (compress)",
        "controlCase": control_case(),
        "tracks": {},
    }
    for track_id in ids:
        print(f"[compare] {track_id} ...", flush=True)
        result = compare_track(track_id, wav_dir)
        report["tracks"][track_id] = result
        lm, cm = result["legacy"]["measured"], result["current"]["measured"]
        print(
            f"          legacy  {lm['lufs']:6.2f} LUFS  TP {lm['truePeakDbTp']:6.2f}  crest {lm['crestDb']:5.2f} dB"
            f"   GR median {result['compressorGainReduction']['legacy']['medianDb']:5.2f} dB",
            flush=True,
        )
        print(
            f"          current {cm['lufs']:6.2f} LUFS  TP {cm['truePeakDbTp']:6.2f}  crest {cm['crestDb']:5.2f} dB"
            f"   GR median {result['compressorGainReduction']['current']['medianDb']:5.2f} dB",
            flush=True,
        )

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[compare] wrote {out_path}")


if __name__ == "__main__":
    main()

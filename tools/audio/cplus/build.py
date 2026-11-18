#!/usr/bin/env python3
"""Build the OFELIYA C+ v4 audio package.

    python tools/audio/cplus/build.py --out <dir>

Produces, for every composition:

    <dir>/source/<id>.wav    raw render, before mastering
    <dir>/wav/<id>.wav      mastered (-14 LUFS, <= -1 dBTP, stereo)
    <dir>/ogg/<id>.ogg     Vorbis, gapless (loop-safe)
    <dir>/mp3/<id>.mp3     LAME 128 kbps (Safari / iOS WebView safe)
    <dir>/analysis/<id>.json  measured metrics + QA reports

The build is deterministic: same sources, same output bytes.
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
from ofeliya_cplus.dsp import SR  # noqa: E402


def build_one(
    track_id: str,
    out: Path,
    encode_ogg: bool = True,
    encode_mp3: bool = True,
) -> dict:
    info = compositions.TRACK_INFO[track_id]
    started = time.time()
    print(f"[build] {track_id} ({info['title']}) ...", flush=True)

    stem = compositions.COMPOSERS[track_id]()
    xf = int(compositions.XFADE_S * SR)
    target_len = int(round(info["durationSec"] * SR))

    # The composition is rendered XFADE_S longer than the final length: the
    # mastering filters need a start-up transient to settle. The trim happens
    # *after* mastering, otherwise that transient would land exactly on the
    # loop point.
    if info["loop"]:
        source_left = stem.left[xf : xf + target_len]
        source_right = stem.right[xf : xf + target_len]
    else:
        source_left = stem.left
        source_right = stem.right

    source_path = out / "source" / f"{track_id}.wav"
    master.write_wav(
        source_path,
        master.Mastered(source_left, source_right, 0.0, 0.0, 0.0),
    )

    mastered = master.master(stem.left, stem.right)
    if info["loop"]:
        # Close the loop by construction: the tail is overlap-added onto the
        # head, so the wrap is a natural continuation of the source.
        left, right = compositions.close_loop(mastered.left, mastered.right)
        stereo = np.stack([left, right], axis=1)
        mastered = master.Mastered(
            left=left,
            right=right,
            gain_db=mastered.gain_db,
            lufs=master.integrated_lufs(stereo, SR),
            true_peak_db=master.true_peak_db(stereo, SR),
        )

    wav_path = master.write_wav(out / "wav" / f"{track_id}.wav", mastered)

    report: dict = {
        "id": track_id,
        "title": info["title"],
        "role": info["role"],
        "loop": info["loop"],
        "act": info["act"],
        "bars": info["bars"],
        "bpm": compositions.BPM,
        "mastering": {
            "highpassHz": master.HPF_HZ,
            "punchHz": master.PUNCH_HZ,
            "punchGainDb": master.PUNCH_GAIN_DB,
            "airHz": master.AIR_HZ,
            "airGainDb": master.AIR_GAIN_DB,
            "targetLufs": master.TARGET_LUFS,
            "limiterCeilingDbTp": master.LIMITER_CEILING_DBTP,
            "appliedGainDb": round(mastered.gain_db, 3),
        },
        "files": {},
    }

    for kind, path in (("wav", wav_path),):
        m = metrics.measure_file(path)
        m["sha256"] = metrics.sha256_of(path)
        report["files"][kind] = m
        report["measured"] = m

    if encode_ogg:
        p = master.encode(wav_path, "ogg", out_dir=out / "ogg")
        m = metrics.measure_file(p)
        m["sha256"] = metrics.sha256_of(p)
        report["files"]["ogg"] = m
        if m["truePeakDbTp"] > master.MAX_TRUE_PEAK_DBTP:
            raise SystemExit(
                f"{track_id}.ogg: encoded true peak {m['truePeakDbTp']} dBTP exceeds "
                f"{master.MAX_TRUE_PEAK_DBTP} — lower the limiter ceiling"
            )
    if encode_mp3:
        p = master.encode(wav_path, "mp3", out_dir=out / "mp3")
        m = metrics.measure_file(p)
        m["sha256"] = metrics.sha256_of(p)
        report["files"]["mp3"] = m
        if m["truePeakDbTp"] > master.MAX_TRUE_PEAK_DBTP:
            raise SystemExit(
                f"{track_id}.mp3: encoded true peak {m['truePeakDbTp']} dBTP exceeds "
                f"{master.MAX_TRUE_PEAK_DBTP} — lower the limiter ceiling"
            )

    # --- QA on the mastered WAV -----------------------------------------
    mastered_data, sr = metrics.read(wav_path)
    report["qa"] = {
        "seam": metrics.seam_report(mastered_data, sr),
        "mono": metrics.mono_report(mastered_data, sr),
        "fatigue": metrics.fatigue_report(mastered_data, sr),
        "speakerEmulation": metrics.emulate_small_speaker(mastered_data, sr),
    }
    if info["loop"]:
        report["qa"]["loopChecks"] = {
            "durationSec": report["measured"]["durationSec"],
            "inTargetBand": 60.0 <= report["measured"]["durationSec"] <= 90.0,
            "seamless": report["qa"]["seam"]["seamless"],
            "monoSafe": report["qa"]["mono"]["monoSafe"],
        }

    analysis_path = out / "analysis" / f"{track_id}.json"
    analysis_path.parent.mkdir(parents=True, exist_ok=True)
    analysis_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    m = report["measured"]
    seam = report["qa"]["seam"]
    mono = report["qa"]["mono"]
    print(
        f"         {m['durationSec']:7.2f}s  {m['lufs']:7.2f} LUFS  TP {m['truePeakDbTp']:6.2f}  "
        f"seam {seam['sampleJumpRel']:.5f}  mono {mono['monoLufsDeltaDb']:+.2f} dB  "
        f"({time.time() - started:.1f}s)",
        flush=True,
    )
    return report


def write_repo_manifest(out: Path, manifest_path: Path) -> None:
    """Write the C+ asset manifest for the game repository.

    The manifest pins every shipped C+ file by sha256 and records the measured
    loudness / true-peak / format, so `scripts/check-audio-cplus.mjs` can
    verify the branch without a decoder dependency.
    """
    assets: dict[str, dict] = {}
    for track_id in compositions.COMPOSERS:
        for fmt in ("ogg", "mp3"):
            path = out / fmt / f"{track_id}.{fmt}"
            if not path.exists():
                continue
            m = metrics.measure_file(path)
            m["sha256"] = metrics.sha256_of(path)
            m["kind"] = "music"
            m["role"] = compositions.TRACK_INFO[track_id]["role"]
            m["title"] = compositions.TRACK_INFO[track_id]["title"]
            m["loop"] = compositions.TRACK_INFO[track_id]["loop"]
            assets[f"{track_id}.{fmt}"] = m
    manifest = {
        "version": 1,
        "musicTargetLUFS": master.TARGET_LUFS,
        "musicMaxTruePeakDbTp": master.MAX_TRUE_PEAK_DBTP,
        "generator": "ofeliya_cplus (procedural, no samples)",
        "assets": assets,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[build] wrote {manifest_path} ({len(assets)} assets)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output directory for the package")
    ap.add_argument("--only", default=None, help="build a single track id")
    ap.add_argument("--no-encode", action="store_true", help="skip ogg/mp3 encoding")
    ap.add_argument("--manifest-out", default=None, help="write the game manifest to this path")
    ap.add_argument(
        "--manifest-only",
        action="store_true",
        help="skip rendering; only refresh the game manifest from an existing package",
    )
    args = ap.parse_args()

    out = Path(args.out).resolve()
    for sub in ("source", "wav", "ogg", "mp3", "analysis"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    if args.manifest_only:
        if not args.manifest_out:
            raise SystemExit("--manifest-only needs --manifest-out")
        write_repo_manifest(out, Path(args.manifest_out).resolve())
        return

    ids = list(compositions.COMPOSERS.keys())
    if args.only:
        ids = [args.only]

    reports = []
    for track_id in ids:
        reports.append(
            build_one(
                track_id,
                out,
                encode_ogg=not args.no_encode,
                encode_mp3=not args.no_encode,
            )
        )

    summary = {
        "generator": "ofeliya_cplus",
        "version": "4.0.0",
        "sampleRate": SR,
        "bpm": compositions.BPM,
        "tracks": {r["id"]: r for r in reports},
    }
    (out / "analysis" / "build-summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[build] wrote {out}")
    if args.manifest_out:
        write_repo_manifest(out, Path(args.manifest_out).resolve())


if __name__ == "__main__":
    main()

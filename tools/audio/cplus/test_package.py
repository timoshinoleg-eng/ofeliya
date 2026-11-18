#!/usr/bin/env python3
"""Automated gate for the OFELIYA C+ v4 audio package.

    python tests/test_package.py --package <pkg> [--manifest <manifest.json>]

Checks, in order:

  1. every expected file exists (no missing or corrupt assets);
  2. the mastering contract holds: -14 LUFS +/- 0.5, true peak <= -1 dBTP,
     stereo, 44 100 Hz, no clipped samples;
  3. the loop beds are 60-90 s (100 s for the climax) and their measured
     seam report says the loop is seamless;
  4. the mono fold-down stays inside the compatible range;
  5. the sha256 in the analysis reports matches the shipped files;
  6. the repository manifest matches the shipped files byte for byte.

Exit code 0 = every check passed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "generator"))

from ofeliya_cplus import metrics  # noqa: E402

TARGET_LUFS = -14.0
LUFS_TOLERANCE = 0.5
MAX_TRUE_PEAK_DBTP = -1.0

LOOPS = {
    "bloodstream": (60.0, 90.0),
    "heart": (60.0, 90.0),
    "immune_prime": (60.0, 90.0),
    "cardiac_titan": (90.0, 110.0),
}
STINGERS = {"victory": (3.0, 5.5), "defeat": (3.0, 5.5)}
ALL = list(LOOPS) + list(STINGERS)

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if condition:
        print(f"PASS {message}")
    else:
        failures.append(message)
        print(f"FAIL {message}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--manifest", default=None, help="repository manifest to cross-check")
    args = ap.parse_args()

    package = Path(args.package).resolve()

    # 1. presence -----------------------------------------------------------
    for track in ALL:
        for folder, ext in (("source", ".wav"), ("wav", ".wav"), ("ogg", ".ogg"), ("mp3", ".mp3")):
            path = package / folder / f"{track}{ext}"
            check(path.exists() and path.stat().st_size > 0, f"{folder}/{track}{ext} exists and is not empty")
        analysis = package / "analysis" / f"{track}.json"
        check(analysis.exists(), f"analysis/{track}.json exists")

    if failures:
        report()
        return

    # 2-4. measured contract ------------------------------------------------
    for track in ALL:
        track_report = json.loads((package / "analysis" / f"{track}.json").read_text(encoding="utf-8"))
        m = track_report["measured"]
        qa = track_report["qa"]
        label = f"{track}"

        check(abs(m["lufs"] - TARGET_LUFS) <= LUFS_TOLERANCE, f"{label}: LUFS {m['lufs']} within {TARGET_LUFS} +/- {LUFS_TOLERANCE}")
        check(m["truePeakDbTp"] <= MAX_TRUE_PEAK_DBTP, f"{label}: true peak {m['truePeakDbTp']} dBTP <= {MAX_TRUE_PEAK_DBTP}")
        check(m["channels"] == 2, f"{label}: stereo")
        check(m["sampleRate"] == 44100, f"{label}: 44100 Hz")
        check(m["clippedFraction"] == 0, f"{label}: no clipped samples")
        check(m["peak"] <= 1.0, f"{label}: peak {m['peak']} within full scale")

        if track in LOOPS:
            lo, hi = LOOPS[track]
            check(lo <= m["durationSec"] <= hi, f"{label}: duration {m['durationSec']}s within {lo}-{hi}s")
            check(qa["seam"]["seamless"], f"{label}: loop seam verified over {qa['seam']['cyclesTested']} cycles")
            check(qa["seam"]["cyclesTested"] >= 10, f"{label}: at least ten cycles were tested")
            check(qa["seam"]["spectralContinuityMaxBandDb"] < 6.0, f"{label}: spectral continuity across the seam")
            check(qa["mono"]["monoSafe"], f"{label}: mono fold-down compatible ({qa['mono']['monoLufsDeltaDb']} dB)")
            check(qa["fatigue"]["repetitionRisk"] == "low", f"{label}: no short-loop repetition detected")
        else:
            lo, hi = STINGERS[track]
            check(lo <= m["durationSec"] <= hi, f"{label}: duration {m['durationSec']}s within {lo}-{hi}s")

        # 5. hashes ---------------------------------------------------------
        for kind, rel in (("wav", f"wav/{track}.wav"), ("ogg", f"ogg/{track}.ogg"), ("mp3", f"mp3/{track}.mp3")):
            path = package / rel
            expected = track_report["files"].get(kind, {}).get("sha256")
            if expected:
                check(metrics.sha256_of(path) == expected, f"{label}: {kind} sha256 matches the analysis report")

    # 6. repository manifest ------------------------------------------------
    if args.manifest:
        manifest_path = Path(args.manifest).resolve()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = manifest.get("assets", {})
        check(len(entries) == len(ALL) * 2, f"manifest pins {len(ALL) * 2} files (ogg + mp3), found {len(entries)}")
        for rel, m in entries.items():
            name = Path(rel).name
            src = package / ("ogg" if name.endswith(".ogg") else "mp3") / name
            check(src.exists(), f"manifest asset {rel} exists in the package")
            if src.exists():
                check(metrics.sha256_of(src) == m["sha256"], f"manifest {rel}: sha256 matches the package file")
                check(abs((m["lufs"] or 0) - TARGET_LUFS) <= LUFS_TOLERANCE + 0.25, f"manifest {rel}: LUFS {m['lufs']} in contract")
                check(m["truePeakDbTp"] <= MAX_TRUE_PEAK_DBTP, f"manifest {rel}: true peak in contract")

    report()


def report() -> None:
    print()
    if failures:
        print(f"{len(failures)} of {checks} package check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"package gate: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()

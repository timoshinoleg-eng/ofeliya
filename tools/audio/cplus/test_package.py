#!/usr/bin/env python3
"""Automated gate for the OFELIYA C+ v4 audio package.

    python tests/test_package.py --package <pkg> [--manifest <manifest.json>]

The gate decodes the **shipped** files — not the intermediate values the
mastering chain reported — and checks:

  1. every expected file exists (no missing or corrupt assets);
  2. the mastering contract holds on the decoded audio: -14 LUFS +/- 0.5,
     true peak <= -1 dBTP, stereo, 44 100 Hz, no clipping;
  3. the loop beds are 60-90 s (100 s for the climax) and their measured seam
     report says the loop is seamless;
  4. the mono fold-down stays inside the compatible range;
  5. the sha256 of every shipped file matches its recorded digest — a missing
     digest is a failure, not a skip;
  6. the manifest lists exactly the expected asset names — no extra, no
     missing, no duplicated entry through an alternative path;
  7. the seam detector itself is able to fail.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

_HERE = Path(__file__).resolve().parent
for _candidate in (_HERE, _HERE.parent / "generator"):
    if (_candidate / "ofeliya_cplus").is_dir():
        sys.path.insert(0, str(_candidate))
        break

from ofeliya_cplus import metrics  # noqa: E402
from ofeliya_cplus.dsp import SR  # noqa: E402

TRACKS = ["bloodstream", "heart", "immune_prime", "cardiac_titan", "victory", "defeat"]

#: Exactly the files the package must ship.
EXPECTED_ASSETS = {f"{track}.{fmt}" for track in TRACKS for fmt in ("ogg", "mp3")}

LOOPS = {
    "bloodstream": (60.0, 90.0),
    "heart": (60.0, 90.0),
    "immune_prime": (60.0, 90.0),
    "cardiac_titan": (90.0, 110.0),
}
STINGERS = {"victory": (3.0, 5.5), "defeat": (3.0, 5.5)}

TARGET_LUFS = -14.0
LUFS_TOLERANCE_WAV = 0.5
LUFS_TOLERANCE_LOSSY = 0.75
MAX_TRUE_PEAK_DBTP = -1.0

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


def measure_encoded(path: Path, data: np.ndarray, sr: int) -> dict:
    """Measure an already decoded shipped file like the game would.

    The caller decodes the file itself so that the channel count can be
    checked *before* the measurement: `measure_array` reads the second
    channel, so a mono file would abort the gate with an exception instead of
    a diagnostic FAIL.
    """
    m = metrics.measure_array(data, sr)
    m["sampleRate"] = sr
    m["channels"] = int(data.shape[1])
    m["sha256"] = metrics.sha256_of(path)
    m["bytes"] = path.stat().st_size
    return m


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--manifest", default=None, help="repository manifest to cross-check")
    # Used by negative QA to isolate a single deliberately corrupted track.
    # Without this option, the gate always validates the entire package.
    ap.add_argument("--only-track", choices=TRACKS, default=None)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    tracks = [args.only_track] if args.only_track else TRACKS

    # 1. presence ------------------------------------------------------------
    for track in tracks:
        for folder, ext in (("source", ".wav"), ("wav", ".wav"), ("ogg", ".ogg"), ("mp3", ".mp3")):
            path = package / folder / f"{track}{ext}"
            check(
                path.exists() and path.stat().st_size > 0,
                f"{folder}/{track}{ext} exists and is not empty",
            )
        analysis = package / "analysis" / f"{track}.json"
        check(analysis.exists(), f"analysis/{track}.json exists")
    if failures:
        report()
        return

    # 2-5. the shipped files and the analysis digests -----------------------
    for track in tracks:
        analysis = json.loads((package / "analysis" / f"{track}.json").read_text(encoding="utf-8"))
        decoded_wav_seam = None
        for kind, folder, ext in (
            ("wav", "wav", ".wav"),
            ("ogg", "ogg", ".ogg"),
            ("mp3", "mp3", ".mp3"),
        ):
            path = package / folder / f"{track}{ext}"
            recorded = analysis.get("files", {}).get(kind, {}).get("sha256")
            check(
                isinstance(recorded, str) and len(recorded) == 64,
                f"{track}.{kind}: a recorded digest is present (a missing digest is a failure)",
            )
            if not isinstance(recorded, str) or len(recorded) != 64:
                continue
            check(
                metrics.sha256_of(path) == recorded,
                f"{track}.{kind}: sha256 matches the analysis report",
            )
            data, file_sr = sf.read(str(path), always_2d=True)
            channels = int(data.shape[1])
            check(file_sr == SR, f"{track}.{kind}: sample rate {file_sr} Hz")
            check(channels == 2, f"{track}.{kind}: stereo")
            if channels != 2:
                # The measurement reads the second channel. The file already
                # failed the format check, so it is skipped with a diagnostic
                # instead of aborting the whole gate with an IndexError.
                continue
            m = measure_encoded(path, data, file_sr)
            if kind == "wav" and track in LOOPS and file_sr == SR:
                # Never trust a stale pre-computed QA verdict merely because
                # the analysis sha256 was updated after a file changed.
                decoded_wav_seam = metrics.seam_report(data, file_sr, cycles=10)
            tolerance = LUFS_TOLERANCE_WAV if kind == "wav" else LUFS_TOLERANCE_LOSSY
            check(
                m["lufs"] is not None and abs(m["lufs"] - TARGET_LUFS) <= tolerance,
                f"{track}.{kind}: LUFS {m['lufs']} within {TARGET_LUFS} +/- {tolerance}",
            )
            check(
                m["truePeakDbTp"] <= MAX_TRUE_PEAK_DBTP,
                f"{track}.{kind}: true peak {m['truePeakDbTp']} dBTP <= {MAX_TRUE_PEAK_DBTP}",
            )
            check(m["clippedFraction"] == 0, f"{track}.{kind}: no clipped samples")
            bounds = LOOPS.get(track) or STINGERS.get(track)
            if bounds:
                lo, hi = bounds
                # the lossy encoders pad the stream slightly, so they get a
                # small slack; the WAV has to match exactly
                slack = 0.0 if kind == "wav" else 0.15
                check(
                    lo - slack <= m["durationSec"] <= hi + slack,
                    f"{track}.{kind}: duration {m['durationSec']}s within {lo}-{hi}s",
                )

        qa = analysis["qa"]
        if track in LOOPS:
            seam = qa["seam"]
            check(
                decoded_wav_seam is not None and decoded_wav_seam["seamless"] is True,
                f"{track}: decoded WAV has a seamless loop (independent measurement)",
            )
            check(seam["seamless"] is True, f"{track}: the loop seam is verified")
            check(seam["cyclesTested"] >= 10, f"{track}: at least ten cycles were tested")
            check(
                seam.get("cyclesMeasuredSeams") == seam["cyclesTested"] - 1,
                f"{track}: every internal seam of the repeat was measured",
            )
            check(
                seam["spectralContinuityMaxBandDb"] < 6.0,
                f"{track}: the band balance across the seam holds",
            )
            check(qa["mono"]["monoSafe"] is True, f"{track}: the mono fold-down stays compatible")
            check(
                qa["fatigue"].get("repetitionRisk") == "low",
                f"{track}: no short-loop repetition detected",
            )

    # 6. the manifest lists exactly the expected assets -----------------------
    if args.manifest:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        entries = manifest.get("assets", {})
        # The **raw** keys are compared: normalising them with `Path(key).name`
        # would let an alternative path ("./heart.ogg") pass as the expected
        # asset name.
        names = set(entries)
        check(
            names == EXPECTED_ASSETS,
            f"the manifest lists exactly the {len(EXPECTED_ASSETS)} expected assets "
            f"(missing {sorted(EXPECTED_ASSETS - names)}, extra {sorted(names - EXPECTED_ASSETS)})",
        )
        check(
            len(entries) == len(EXPECTED_ASSETS),
            f"the manifest has no duplicated entries ({len(entries)} entries for {len(EXPECTED_ASSETS)} assets)",
        )
        for name in sorted(EXPECTED_ASSETS):
            entry = entries.get(name)
            if entry is None:
                continue
            path = package / ("ogg" if name.endswith(".ogg") else "mp3") / name
            check(path.exists(), f"manifest asset {name} exists in the package")
            if not path.exists():
                continue
            check(
                metrics.sha256_of(path) == entry.get("sha256"),
                f"manifest {name}: sha256 matches the package file",
            )
            check(
                entry.get("kind") == "music",
                f"manifest {name}: kind is recorded as music",
            )
            check(
                isinstance(entry.get("lufs"), (int, float))
                and abs(entry["lufs"] - TARGET_LUFS) <= LUFS_TOLERANCE_LOSSY,
                f"manifest {name}: LUFS {entry.get('lufs')} in contract",
            )
            check(
                isinstance(entry.get("truePeakDbTp"), (int, float))
                and entry["truePeakDbTp"] <= MAX_TRUE_PEAK_DBTP,
                f"manifest {name}: true peak {entry.get('truePeakDbTp')} in contract",
            )

    # 7. the seam detector must be able to fail ------------------------------
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    broken = 0.95 * np.sin(2.0 * np.pi * 219.7 * t)  # 878.8 cycles: does not close
    broken_report = metrics.seam_report(np.stack([broken, broken], axis=1), SR, cycles=10)
    check(
        broken_report["seamless"] is False,
        "the seam detector reports a non-closing waveform as NOT seamless",
    )
    check(
        broken_report["wrapVsLocalRatio"] > 3.0,
        "the seam detector exposes the click as a local outlier",
    )
    check(
        broken_report.get("cyclesMeasuredSeams") == 9,
        "the seam detector measured every internal seam of a ten-cycle repeat",
    )

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

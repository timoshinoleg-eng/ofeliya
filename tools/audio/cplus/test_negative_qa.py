#!/usr/bin/env python3
"""Negative QA tests: a broken package must fail the gate.

    python tools/audio/cplus/test_negative_qa.py --package <pkg> [--manifest <manifest>]

A gate that only ever prints PASS proves nothing. This script copies the
package into a temporary directory, breaks it one thing at a time, and asserts
that the gate **fails** for each corruption:

  1. a corrupted MP3;
  2. a corrupted OGG;
  3. a wrong sha256 in the analysis report;
  4. a wrong sample rate;
  5. a mono file instead of stereo;
  6. a manifest with a missing entry;
  7. a manifest with an extra entry;
  8. a loop bed whose seam clicks;
  9. a master whose true peak exceeds the ceiling.

The original package is never modified: every case runs on a copy.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

_HERE = Path(__file__).resolve().parent
for _candidate in (_HERE, _HERE.parent / "generator"):
    if (_candidate / "ofeliya_cplus").is_dir():
        sys.path.insert(0, str(_candidate))
        break

from ofeliya_cplus.dsp import SR  # noqa: E402

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


def run_gate(package: Path, manifest: Path | None) -> tuple[int, str]:
    cmd = [sys.executable, str(_HERE / "test_package.py"), "--package", str(package)]
    if manifest is not None:
        cmd += ["--manifest", str(manifest)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, (result.stdout + result.stderr)


def corrupt_bytes(path: Path) -> None:
    data = bytearray(path.read_bytes())
    start = len(data) // 2
    for i in range(start, min(start + 512, len(data))):
        data[i] ^= 0xFF
    path.write_bytes(bytes(data))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--manifest", default=None)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    manifest_src = Path(args.manifest).resolve() if args.manifest else None

    # the untouched package must pass, otherwise the negative cases prove nothing
    code, output = run_gate(package, manifest_src)
    check(code == 0, f"the untouched package passes the gate (exit {code})")
    if code != 0:
        print(output[-2000:])
        return

    cases = [
        ("a corrupted MP3", "mp3"),
        ("a corrupted OGG", "ogg"),
    ]

    for label, folder in cases:
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "pkg"
            shutil.copytree(package, work)
            manifest = None
            if manifest_src is not None:
                manifest = Path(td) / "manifest.json"
                shutil.copy2(manifest_src, manifest)
            corrupt_bytes(work / folder / "heart.mp3" if folder == "mp3" else work / folder / "heart.ogg")
            code, output = run_gate(work, manifest)
            check(code != 0, f"the gate fails on {label} (exit {code})")
            if code == 0:
                print(output[-800:])

    # a wrong digest in the analysis report
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "analysis" / "heart.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["files"]["wav"]["sha256"] = "0" * 64
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        code, _ = run_gate(work, None)
        check(code != 0, f"the gate fails on a wrong sha256 (exit {code})")

    # a wrong sample rate
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "wav" / "heart.wav"
        data, _ = sf.read(str(path), always_2d=True)
        sf.write(str(path), data, 22050, subtype="PCM_16")
        code, _ = run_gate(work, None)
        check(code != 0, f"the gate fails on a wrong sample rate (exit {code})")

    # a mono file
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "wav" / "heart.wav"
        data, _ = sf.read(str(path), always_2d=True)
        sf.write(str(path), data[:, 0], SR, subtype="PCM_16")
        code, _ = run_gate(work, None)
        check(code != 0, f"the gate fails on a mono file (exit {code})")

    # a manifest with a missing entry
    if manifest_src is not None:
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "pkg"
            shutil.copytree(package, work)
            manifest = Path(td) / "manifest.json"
            data = json.loads(manifest_src.read_text(encoding="utf-8"))
            data["assets"].pop("heart.ogg", None)
            manifest.write_text(json.dumps(data, indent=2), encoding="utf-8")
            code, _ = run_gate(work, manifest)
            check(code != 0, f"the gate fails on a manifest with a missing entry (exit {code})")

        # a manifest with an extra entry
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "pkg"
            shutil.copytree(package, work)
            manifest = Path(td) / "manifest.json"
            data = json.loads(manifest_src.read_text(encoding="utf-8"))
            data["assets"]["./heart.ogg"] = dict(data["assets"]["heart.ogg"])
            manifest.write_text(json.dumps(data, indent=2), encoding="utf-8")
            code, _ = run_gate(work, manifest)
            check(code != 0, f"the gate fails on a manifest with an extra entry (exit {code})")

    # a loop bed whose seam clicks
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "wav" / "heart.wav"
        data, _ = sf.read(str(path), always_2d=True)
        data[0, :] = -data[-1, :]
        sf.write(str(path), data, SR, subtype="PCM_16")
        code, _ = run_gate(work, None)
        check(code != 0, f"the gate fails on a clicking loop bed (exit {code})")

    # a master whose true peak exceeds the ceiling
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "wav" / "heart.wav"
        data, _ = sf.read(str(path), always_2d=True)
        peak = float(np.abs(data).max())
        data *= (0.99 / max(peak, 1e-9))
        sf.write(str(path), data, SR, subtype="PCM_16")
        code, _ = run_gate(work, None)
        check(code != 0, f"the gate fails on a master above the true-peak ceiling (exit {code})")

    print()
    if failures:
        print(f"{len(failures)} of {checks} negative QA check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"negative QA: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()

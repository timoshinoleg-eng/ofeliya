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
import hashlib
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


def run_gate(package: Path, manifest: Path | None, *, full: bool = False) -> tuple[int, str]:
    cmd = [sys.executable, str(_HERE / "test_package.py"), "--package", str(package)]
    if not full:
        # All destructive fixtures modify only heart.*. The manifest is still
        # validated globally, but decoding five unrelated tracks is unnecessary.
        cmd += ["--only-track", "heart"]
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


def reencode(path: Path, codec: str, sample_rate: int | None = None, channels: int | None = None) -> None:
    """Re-encode a shipped lossy file with a deliberate format defect.

    The result is written to a temporary file first: ffmpeg refuses to
    overwrite its own input.
    """
    cmd = [
        shutil.which("ffmpeg") or "ffmpeg", "-y", "-v", "error", "-i", str(path),
    ]
    if sample_rate is not None:
        cmd += ["-ar", str(sample_rate)]
    if channels is not None:
        cmd += ["-ac", str(channels)]
    tmp = path.with_name(path.stem + ".recode" + path.suffix)
    cmd += ["-c:a", codec, str(tmp)]
    subprocess.run(cmd, check=True)
    shutil.move(str(tmp), str(path))


def update_digests(work: Path, manifest: Path | None, track: str, kinds: tuple[str, ...]) -> None:
    """Recompute the digests of the deliberately corrupted files.

    Without this the gate would fail on the digest and the *format* check
    would never be reached, so a non-zero exit code would not prove that the
    format check works.
    """
    for kind in kinds:
        digest = hashlib.sha256((work / kind / f"{track}.{kind}").read_bytes()).hexdigest()
        analysis = work / "analysis" / f"{track}.json"
        data = json.loads(analysis.read_text(encoding="utf-8"))
        data["files"][kind]["sha256"] = digest
        analysis.write_text(json.dumps(data, indent=2), encoding="utf-8")
        if manifest is not None:
            m = json.loads(manifest.read_text(encoding="utf-8"))
            entry = m["assets"].get(f"{track}.{kind}")
            if entry is not None:
                entry["sha256"] = digest
            manifest.write_text(json.dumps(m, indent=2), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--manifest", default=None)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    manifest_src = Path(args.manifest).resolve() if args.manifest else None

    # the untouched package must pass, otherwise the negative cases prove nothing
    code, output = run_gate(package, manifest_src, full=True)
    check(code == 0, f"the untouched package passes the gate (exit {code})")
    if code != 0:
        print(output[-2000:])
        raise SystemExit(1)

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
        update_digests(work, None, "heart", ("wav",))
        code, output = run_gate(work, None)
        failed = [line for line in output.splitlines() if line.startswith("FAIL ")]
        check(code != 0, f"the gate fails on a wrong sample rate (exit {code})")
        check(
            any(line.startswith("FAIL heart.wav: sample rate") for line in failed)
            and "PASS heart.wav: sha256 matches the analysis report" in output,
            "the wrong WAV sample rate is caught independently of its updated sha256",
        )

    # a mono file
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "wav" / "heart.wav"
        data, _ = sf.read(str(path), always_2d=True)
        sf.write(str(path), data[:, 0], SR, subtype="PCM_16")
        update_digests(work, None, "heart", ("wav",))
        code, output = run_gate(work, None)
        check(code != 0, f"the gate fails on a mono file (exit {code})")
        check("stereo" in output, "the mono file is reported as a channel-count problem")

    # the shipped lossy files: a wrong sample rate and a mono file, with the
    # digest corrected, so the format check is the one that has to fire
    for kind, codec in (("ogg", "libvorbis"), ("mp3", "libmp3lame")):
        for defect, args, reason in (
            ("a wrong sample rate", {"sample_rate": 22050}, "sample rate"),
            ("a mono file", {"channels": 1}, "stereo"),
        ):
            with tempfile.TemporaryDirectory() as td:
                work = Path(td) / "pkg"
                shutil.copytree(package, work)
                manifest = None
                if manifest_src is not None:
                    manifest = Path(td) / "manifest.json"
                    shutil.copy2(manifest_src, manifest)
                reencode(work / kind / f"heart.{kind}", codec, **args)
                update_digests(work, manifest, "heart", (kind,))
                code, output = run_gate(work, manifest)
                check(
                    code != 0,
                    f"the gate fails on a {kind.upper()} with {defect} (exit {code})",
                )
                failed_lines = [line for line in output.splitlines() if line.startswith("FAIL ")]
                target = f"heart.{kind}:"
                check(
                    any(line.startswith(f"FAIL {target} {reason}") for line in failed_lines),
                    f"the {kind.upper()} with {defect} fails on its own {reason} check",
                )
                check(
                    f"PASS {target} sha256 matches the analysis report" in output
                    and not any(line.startswith(f"FAIL {target} sha256") for line in failed_lines),
                    f"the {kind.upper()} sha256 passes, so format validation caused the rejection",
                )

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

        # a manifest whose key is an alternative path for the same file: the
        # set of *names* stays the same, so only the raw key comparison can
        # catch it
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "pkg"
            shutil.copytree(package, work)
            manifest = Path(td) / "manifest.json"
            data = json.loads(manifest_src.read_text(encoding="utf-8"))
            data["assets"]["./heart.ogg"] = data["assets"].pop("heart.ogg")
            manifest.write_text(json.dumps(data, indent=2), encoding="utf-8")
            code, output = run_gate(work, manifest)
            check(
                code != 0,
                f"the gate fails on a manifest key that is an alternative path (exit {code})",
            )
            check(
                "exactly the" in output,
                "the alternative path is reported as a wrong asset name",
            )

    # a loop bed whose seam clicks
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "wav" / "heart.wav"
        data, _ = sf.read(str(path), always_2d=True)
        # Make the wrap obviously discontinuous even when the original
        # waveform happens to approach zero at the boundary. Keep the two
        # 60ms neighbourhoods flat so the detector's local reference is zero.
        window = int(0.06 * SR)
        data[:window, :] = 0.6
        data[-window:, :] = 0.0
        sf.write(str(path), data, SR, subtype="PCM_16")
        update_digests(work, None, "heart", ("wav",))
        code, output = run_gate(work, None)
        check(code != 0, f"the gate fails on a clicking loop bed (exit {code})")
        check(
            "FAIL heart: decoded WAV has a seamless loop" in output
            and "PASS heart.wav: sha256 matches the analysis report" in output,
            "the measured seam rejects a click even when the changed WAV sha256 is updated",
        )

    # a master whose true peak exceeds the ceiling
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "pkg"
        shutil.copytree(package, work)
        path = work / "wav" / "heart.wav"
        data, _ = sf.read(str(path), always_2d=True)
        peak = float(np.abs(data).max())
        data *= (0.99 / max(peak, 1e-9))
        sf.write(str(path), data, SR, subtype="PCM_16")
        update_digests(work, None, "heart", ("wav",))
        code, output = run_gate(work, None)
        check(code != 0, f"the gate fails on a master above the true-peak ceiling (exit {code})")
        check(
            "FAIL heart.wav: true peak" in output
            and "PASS heart.wav: sha256 matches the analysis report" in output,
            "the measured True Peak rejects a bad master even with the updated sha256",
        )

    print()
    if failures:
        print(f"{len(failures)} of {checks} negative QA check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"negative QA: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()

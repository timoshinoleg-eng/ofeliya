#!/usr/bin/env python3
"""Copy the generator into the final package and verify the copy is identical.

    python tools/audio/cplus/sync_package.py --repo <repo> --package <pkg>

The package folder must contain the exact generator that produced its audio.
The sync copies `tools/audio/cplus` into `<pkg>/generator` and then compares
every file byte for byte, so a stale copy cannot go unnoticed.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--package", required=True)
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    package = Path(args.package).resolve()
    src = repo / "tools" / "audio" / "cplus"
    dst = package / "generator"

    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True, exist_ok=True)

    copied = 0
    for path in sorted(src.rglob("*")):
        if path.is_dir() or "__pycache__" in path.parts:
            continue
        rel = path.relative_to(src)
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied += 1

    # the package gate lives with the package but is version controlled here
    gate = src / "test_package.py"
    if gate.exists():
        (package / "tests").mkdir(parents=True, exist_ok=True)
        shutil.copy2(gate, package / "tests" / "test_package.py")
        copied += 1

    mismatches = []
    for path in sorted(dst.rglob("*")):
        if path.is_dir() or "__pycache__" in path.parts:
            continue
        rel = path.relative_to(dst)
        original = src / rel
        if not original.exists() or sha256(original) != sha256(path):
            mismatches.append(str(rel))
    gate_target = package / "tests" / "test_package.py"
    if gate.exists() and (not gate_target.exists() or sha256(gate) != sha256(gate_target)):
        mismatches.append("tests/test_package.py")

    print(f"[sync] copied {copied} generator file(s) into {dst}")
    if mismatches:
        print("[sync] MISMATCH: " + ", ".join(mismatches))
        sys.exit(1)
    print("[sync] generator copy verified byte for byte")


if __name__ == "__main__":
    main()

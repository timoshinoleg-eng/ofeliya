#!/usr/bin/env python3
"""Compare fresh generated C+ audio against the actual files shipped by the game.

Codec/container bytes can differ across FFmpeg builds. Compare decoded PCM
rather than Ogg serial numbers while still rejecting stale or unrelated music.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import numpy as np
import soundfile as sf

TRACKS = ("bloodstream", "heart", "immune_prime", "cardiac_titan", "victory", "defeat")
FORMATS = ("ogg", "mp3")
MAX_RELATIVE_ERROR = 0.12
MIN_CORRELATION = 0.98
MAX_DURATION_DRIFT_S = 0.05


def check_pair(shipped: Path, generated: Path) -> tuple[float, float]:
    left, left_sr = sf.read(str(shipped), always_2d=True, dtype="float32")
    right, right_sr = sf.read(str(generated), always_2d=True, dtype="float32")
    if left_sr != right_sr or left_sr != 44100 or left.shape[1] != 2 or right.shape[1] != 2:
        raise ValueError(f"format differs: {left_sr} Hz {left.shape} vs {right_sr} Hz {right.shape}")
    if abs(len(left) - len(right)) > MAX_DURATION_DRIFT_S * left_sr:
        raise ValueError(f"duration differs: {len(left)} vs {len(right)} samples")
    n = min(len(left), len(right))
    if n == 0:
        raise ValueError("empty audio")
    a, b = left[:n].astype(np.float64), right[:n].astype(np.float64)
    rms = float(np.sqrt(np.mean(np.square(a))))
    if rms < 1e-8:
        raise ValueError("silent shipped file")
    rel = float(np.sqrt(np.mean(np.square(a - b))) / rms)
    corr = float(np.sum(a * b) / np.sqrt(np.sum(a * a) * np.sum(b * b)))
    return rel, corr


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generated", required=True, type=Path)
    parser.add_argument("--repo", default=".", type=Path)
    args = parser.parse_args()
    failures = []
    for track in TRACKS:
        for fmt in FORMATS:
            name = f"{track}.{fmt}"
            shipped = args.repo / "public" / "audio" / "cplus-v4" / name
            generated = args.generated / fmt / name
            try:
                if not shipped.is_file() or not generated.is_file():
                    raise ValueError("missing shipped/generated file")
                error, corr = check_pair(shipped, generated)
                ok = error <= MAX_RELATIVE_ERROR and corr >= MIN_CORRELATION
                print(f'{"PASS" if ok else "FAIL"} {name}: decoded rel_error={error:.5f}, correlation={corr:.6f}')
                if not ok:
                    failures.append(name)
            except (ValueError, OSError) as exc:
                failures.append(name)
                print(f"FAIL {name}: {exc}")
    if failures:
        raise SystemExit(f"{len(failures)} release comparisons failed: {failures}")
    print(f"release consistency: {len(TRACKS) * len(FORMATS)}/{len(TRACKS) * len(FORMATS)} PASS")


if __name__ == "__main__":
    main()

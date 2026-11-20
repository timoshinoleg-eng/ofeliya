#!/usr/bin/env python3
"""Compare fresh regenerated C+ tracks to the files actually shipped by the game.

OGG must be nearly PCM-identical across platforms. MP3 bitstreams differ
substantially between FFmpeg/LAME builds for long beds, so use a justified
looser cross-platform bound *plus* an independent OGG-vs-MP3 check within
each package. This detects stale/unrelated MP3 despite encoder variations.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import soundfile as sf

TRACKS = ("bloodstream", "heart", "immune_prime", "cardiac_titan", "victory", "defeat")
FORMATS = ("ogg", "mp3")
# Actual Windows-vs-Ubuntu CI: OGG relative error <= 0.019 and correlation
# >= 0.9998. For the same masters, MP3 error 0.25-0.36 and correlation
# 0.937-0.969. Codec variants explain this; OGG is the tight source anchor.
MAX_RELATIVE_ERROR = {"ogg": 0.05, "mp3": 0.40}
MIN_CORRELATION = {"ogg": 0.998, "mp3": 0.92}
# In a single package, every MP3 must represent the same material as its
# companion OGG. Locally measured worst: 0.4745 error / 0.8882 correlation.
MAX_SAME_PACKAGE_ERROR = 0.60
MIN_SAME_PACKAGE_CORRELATION = 0.85
MAX_DURATION_DRIFT_S = 0.05


def check_pair(a_path: Path, b_path: Path) -> tuple[float, float]:
    a, a_sr = sf.read(str(a_path), always_2d=True, dtype="float32")
    b, b_sr = sf.read(str(b_path), always_2d=True, dtype="float32")
    if a_sr != b_sr or a_sr != 44100 or a.shape[1] != 2 or b.shape[1] != 2:
        raise ValueError(f"format differs: {a_sr} Hz {a.shape} vs {b_sr} Hz {b.shape}")
    if abs(len(a) - len(b)) > MAX_DURATION_DRIFT_S * a_sr:
        raise ValueError(f"duration differs: {len(a)} vs {len(b)} samples")
    n = min(len(a), len(b))
    if n == 0:
        raise ValueError("empty audio")
    left = a[:n].astype(np.float64)
    right = b[:n].astype(np.float64)
    rms = float(np.sqrt(np.mean(np.square(left))))
    if rms < 1e-8:
        raise ValueError("silent reference file")
    error = float(np.sqrt(np.mean(np.square(left - right))) / rms)
    correlation = float(np.sum(left * right) / np.sqrt(np.sum(left * left) * np.sum(right * right)))
    return error, correlation


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generated", required=True, type=Path)
    parser.add_argument("--repo", default=".", type=Path)
    args = parser.parse_args()
    shipped_dir = args.repo / "public" / "audio" / "cplus-v4"
    failures: list[str] = []
    for track in TRACKS:
        for fmt in FORMATS:
            name = f"{track}.{fmt}"
            shipped = shipped_dir / name
            generated = args.generated / fmt / name
            try:
                if not shipped.is_file() or not generated.is_file():
                    raise ValueError("missing shipped/generated file")
                error, corr = check_pair(shipped, generated)
                ok = error <= MAX_RELATIVE_ERROR[fmt] and corr >= MIN_CORRELATION[fmt]
                print(f'{"PASS" if ok else "FAIL"} {name}: rel_error={error:.5f}, correlation={corr:.6f}')
                if not ok:
                    failures.append(name)
            except (ValueError, OSError) as exc:
                failures.append(name)
                print(f"FAIL {name}: {exc}")

        for label, ogg, mp3 in (
            ("shipped", shipped_dir / f"{track}.ogg", shipped_dir / f"{track}.mp3"),
            ("generated", args.generated / "ogg" / f"{track}.ogg",
             args.generated / "mp3" / f"{track}.mp3"),
        ):
            name = f"{track}: {label} MP3 agrees with OGG"
            try:
                error, corr = check_pair(ogg, mp3)
                ok = error <= MAX_SAME_PACKAGE_ERROR and corr >= MIN_SAME_PACKAGE_CORRELATION
                print(f'{"PASS" if ok else "FAIL"} {name}: rel_error={error:.5f}, correlation={corr:.6f}')
                if not ok:
                    failures.append(name)
            except (ValueError, OSError) as exc:
                failures.append(name)
                print(f"FAIL {name}: {exc}")

    if failures:
        raise SystemExit(f"{len(failures)} release comparisons failed: {failures}")
    checks = len(TRACKS) * (len(FORMATS) + 2)
    print(f"release consistency: {checks}/{checks} PASS")


if __name__ == "__main__":
    main()

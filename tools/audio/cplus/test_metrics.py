#!/usr/bin/env python3
"""Self-tests for the measurement layer.

    python tools/audio/cplus/test_metrics.py

The mono fold-down had a defect the review found: `mid` and `fold` are the
same signal, so the per-band retention compared a signal with itself and
always reported 0 dB — a phase cancellation was invisible. These tests build
the signals that must be distinguished and assert that they are.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ofeliya_cplus import metrics  # noqa: E402
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


def tone(n: int, f: float = 220.0, amp: float = 0.5, sr: int = SR) -> np.ndarray:
    t = np.arange(n) / sr
    return amp * np.sin(2.0 * np.pi * f * t)


def test_mono_report() -> None:
    n = int(2.0 * SR)
    base = tone(n)

    # L = R: identical channels keep every band
    identical = np.stack([base, base], axis=1)
    report = metrics.mono_report(identical, SR)
    check(
        all(abs(v) < 0.05 for v in report["bandRetentionDb"].values()),
        f"L = R keeps every band (worst {min(report['bandRetentionDb'].values()):.3f} dB)",
    )
    check(
        abs(report["monoLufsDeltaDb"] - 3.01) < 0.15,
        f"L = R loses exactly the 3.01 dB of the BS.1770 channel sum (got {report['monoLufsDeltaDb']:.2f} dB)",
    )
    check(report["antiPhaseEnergyPct"] < 0.1, "identical channels carry no anti-phase energy")
    check(report["monoSafe"] is True, "identical channels are mono safe")

    # L = -R: a complete cancellation must be visible per band
    anti = np.stack([base, -base], axis=1)
    report = metrics.mono_report(anti, SR)
    check(
        all(v < -40.0 for v in report["bandRetentionDb"].values()),
        f"L = -R cancels every band (worst {max(report['bandRetentionDb'].values()):.1f} dB)",
    )
    check(report["antiPhaseEnergyPct"] > 99.0, "an anti-phase pair is reported as fully anti-phase")
    check(report["monoSafe"] is False, "an anti-phase pair is not mono safe")

    # a signal in the left channel only: the fold-down keeps the signal but
    # at half the level, so the band retention is -3 dB against the average
    # channel energy and the loudness difference against the stereo image is
    # 6 dB (3.01 dB of BS.1770 channel sum plus the 3 dB of a hard pan).
    left_only = np.stack([base, np.zeros(n)], axis=1)
    report = metrics.mono_report(left_only, SR)
    check(
        all(-3.2 < v < -2.8 for v in report["bandRetentionDb"].values()),
        f"a left-only signal keeps half its energy in the fold-down (worst {max(report['bandRetentionDb'].values()):.2f} dB)",
    )
    check(
        abs(report["monoLufsDeltaDb"] - 6.02) < 0.15,
        f"a left-only signal shows the hard-pan loss on top of the channel sum (got {report['monoLufsDeltaDb']:.2f} dB)",
    )

    # partially anti-phase: a quarter of the right channel inverted
    partial_right = base.copy()
    partial_right[: n // 2] *= -1.0
    partial = np.stack([base, partial_right], axis=1)
    report = metrics.mono_report(partial, SR)
    check(
        min(report["bandRetentionDb"].values()) < -2.5,
        f"a partially anti-phase pair loses energy in the fold-down (worst {min(report['bandRetentionDb'].values()):.2f} dB)",
    )
    check(report["monoSafe"] is False, "a partially anti-phase pair is not mono safe")

    # different channel levels: coherent, but not identical
    levels = np.stack([base, base * 0.5], axis=1)
    report = metrics.mono_report(levels, SR)
    check(
        all(-0.6 < v < -0.3 for v in report["bandRetentionDb"].values()),
        f"different channel levels keep their energy (worst {max(report['bandRetentionDb'].values()):.2f} dB)",
    )
    check(
        abs(report["monoLufsDeltaDb"] - 3.01) > 0.2,
        f"different channel levels deviate from the identical-channel reference (got {report['monoLufsDeltaDb']:.2f} dB)",
    )


def test_seam_metrics() -> None:
    n = int(2.0 * SR)
    smooth = tone(n)
    stereo = np.stack([smooth, smooth], axis=1)
    report = metrics.seam_report(stereo, SR, cycles=10)
    check(report["seamless"] is True, "a continuous signal is seamless")
    check(report["cyclesMeasuredSeams"] == 9, "nine internal seams were measured")
    check(report["cyclesSeamsIdentical"] is True, "every repeat reproduces the same seam")
    check(report["cyclesRmsDriftDb"] < 0.01, "the level does not drift between repeats")


def main() -> None:
    test_mono_report()
    test_seam_metrics()
    print()
    if failures:
        print(f"{len(failures)} of {checks} metrics check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"metrics self-test: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Self-test for the loop-seam detector.

    python tools/audio/cplus/test_seam_detector.py

A QA metric that can never fail is worthless, so this file does three things:

  1. builds a *deliberately clicky* signal (a clean tone with a hard step at
     the boundary) and asserts the detector reports it as NOT seamless;
  2. builds a matching *continuous* signal and asserts it IS seamless;
  3. asserts the ten-cycle part of the report really executes: the number of
     measured seams equals `cycles - 1`, every seam reproduces the same step,
     and the per-cycle level does not drift.

Without (1) a broken detector would still produce a green report.
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


def tone(n: int, f: float = 220.0, sr: int = SR) -> np.ndarray:
    """Pure tone. A non-integer number of cycles over the file makes the
    waveform fail to close on itself — the classic 'the loop does not join'
    signal."""
    t = np.arange(n) / sr
    return np.sin(2.0 * np.pi * f * t)


def main() -> None:
    n = int(4.0 * SR)
    cycles = 10

    # --- 1. a signal whose ends do not join -------------------------------
    # 219.7 Hz over 4 s is 878.8 cycles: the file ends at -0.95 and starts
    # at 0, while the texture inside the file stays perfectly smooth. That is
    # exactly the sample-domain click the detector has to catch.
    click = 0.95 * tone(n, 219.7)
    click_stereo = np.stack([click, click], axis=1)
    report = metrics.seam_report(click_stereo, SR, cycles=cycles)
    check(report["seamless"] is False, "a waveform that does not close is reported as NOT seamless")
    check(report["wrapVsLocalRatio"] > 3.0, "the step at the seam is detected as a local outlier")
    check(report["sampleJumpRel"] > 0.05, "the sample jump of the clicky signal is large")

    # --- 2. the same signal, phase-corrected so the ends join -------------
    smooth = 0.95 * tone(n, 220.0)  # exactly 880 cycles -> closes on itself
    smooth_stereo = np.stack([smooth, smooth], axis=1)
    smooth_report = metrics.seam_report(smooth_stereo, SR, cycles=cycles)
    check(smooth_report["seamless"] is True, "a waveform that closes is reported as seamless")
    check(smooth_report["wrapVsLocalRatio"] < 3.0, "the closed signal has no local outlier")

    # --- 3. the ten-cycle part actually executes --------------------------
    check(smooth_report["cyclesTested"] == cycles, "the cycle count is reported")
    check(
        "cyclesMeasuredSeams" in smooth_report
        and smooth_report["cyclesMeasuredSeams"] == cycles - 1,
        "every internal seam of the ten-cycle repeat was measured",
    )
    check(smooth_report["cyclesSeamsIdentical"] is True, "every repeat reproduces the same seam")
    check(smooth_report["cyclesRmsDriftDb"] < 0.1, "the level does not drift between repeats")
    check(
        smooth_report["wrapDiscontinuityMax"] < smooth_report["interiorDiffMax"] * 1.02,
        "the seam step is not larger than the largest step inside the file",
    )
    check(
        smooth_report["cyclesMaxStep"] >= smooth_report["interiorDiffMax"],
        "the concatenated signal reports its own largest step",
    )
    check(
        "cyclesMeasuredSeams" in report
        and report["cyclesMeasuredSeams"] == cycles - 1,
        "the clicky signal was measured at every internal seam of the concatenation",
    )

    # --- 4. a click inside a dense texture is still caught ----------------
    dense = 0.7 * tone(n, 219.7) + 0.3 * tone(n, 1300.0)
    dense_stereo = np.stack([dense, dense], axis=1)
    dense_report = metrics.seam_report(dense_stereo, SR, cycles=cycles)
    check(dense_report["seamless"] is False, "a click inside a dense texture is still caught")
    check(dense_report["wrapVsLocalRatio"] > 3.0, "the dense texture still exposes the click")

    # --- 5. a deliberate interior spike is caught too ----------------------
    spike = 0.95 * tone(n, 220.0)
    spike[-1] = -0.95
    spike_stereo = np.stack([spike, spike], axis=1)
    spike_report = metrics.seam_report(spike_stereo, SR, cycles=cycles)
    check(spike_report["seamless"] is False, "a spike at the last sample is caught as well")

    # --- 6. a step next to no local texture at all -----------------------
    # The right channel's head block does not join its tail, and the step
    # sits just outside both reference windows, so the local reference holds
    # no steps while the wrap step is real. The global bound passes (the
    # interior holds a step of the same size), so only the local check can
    # reject it — which is exactly what it has to do.
    window = int(0.05 * SR)
    left = np.full(n, 0.1)
    right = np.full(n, -0.2)
    right[:window] = 0.2
    flat_stereo = np.stack([left, right], axis=1)
    flat_report = metrics.seam_report(flat_stereo, SR, cycles=cycles)
    check(flat_report["seamless"] is False, "a step beside a silent neighbourhood is caught")
    check(
        flat_report["wrapVsLocalRatio"] > 3.0,
        "a step beside a silent neighbourhood reports an outlier ratio",
    )

    # --- 7. a break that only one channel shows ---------------------------
    # The right channel is a slow ramp: its interior steps are tiny, but the
    # boundary step is 0.2. The left channel is a 2 kHz tone whose interior
    # steps are 0.228, so every *summed* check passes - the right channel's
    # break hides behind the left channel's texture. Each channel has to be
    # judged against its own steps.
    left_tone = 0.8 * np.cos(2.0 * np.pi * 2000.0 * (np.arange(n) + 0.5) / SR)
    right_ramp = 0.2 * np.arange(n) / (n - 1)
    asym_stereo = np.stack([left_tone, right_ramp], axis=1)
    asym_report = metrics.seam_report(asym_stereo, SR, cycles=cycles)
    check(
        asym_report["wrapDiscontinuityMax"] <= asym_report["interiorDiffMax"] * 1.02
        and asym_report["wrapVsLocalRatio"] <= 3.0,
        "the summed checks would have accepted the asymmetric break (control)",
    )
    check(
        asym_report["seamless"] is False,
        "a break that only one channel shows is reported as NOT seamless",
    )
    per_channel = {c["channel"]: c for c in asym_report["channelChecks"]}
    check(
        per_channel["right"]["seamless"] is False,
        "the channel with the break is rejected on its own steps",
    )
    check(
        "channelChecks" in asym_report and len(asym_report["channelChecks"]) == 2,
        "the report contains a verdict per channel",
    )

    print()
    if failures:
        print(f"{len(failures)} of {checks} seam-detector check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"seam detector self-test: {checks}/{checks} checks passed")


def click_report_cycles(report: dict) -> int:
    """Number of internal seams the cycle walk measured."""
    return int(report.get("cyclesMeasuredSeams", report.get("cyclesTested", 0) - 1))


if __name__ == "__main__":
    main()

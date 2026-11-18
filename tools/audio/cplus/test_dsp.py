#!/usr/bin/env python3
"""Self-tests for the DSP and mastering contract.

    python tools/audio/cplus/test_dsp.py

Covers the compressor's gain-reduction law (the review found the reduction was
computed from linear amplitudes and then treated as decibels) and the
mastering contract checks (a master that does not meet the contract must
raise instead of being handed back as a success).
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ofeliya_cplus import dsp, master  # noqa: E402
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


def rms_db(x: np.ndarray) -> float:
    return 20.0 * np.log10(max(float(np.sqrt(np.mean(np.square(x)))), 1e-12))


# --------------------------------------------------------------------------
# compressor
# --------------------------------------------------------------------------
def test_compressor() -> None:
    n = int(1.0 * SR)
    x = tone(n, amp=0.5)  # -6.02 dBFS

    quiet = tone(n, amp=0.05)  # -26 dBFS, below the threshold
    y_quiet = dsp.compress(quiet, threshold_db=-18.0, ratio=2.0, attack_s=0.005, release_s=0.05)
    check(
        abs(rms_db(y_quiet[-n // 2:]) - rms_db(quiet[-n // 2:])) < 0.2,
        "a signal below the threshold is left untouched",
    )

    y = dsp.compress(x, threshold_db=-18.0, ratio=2.0, attack_s=0.005, release_s=0.05)
    reduction = rms_db(y[-n // 2:]) - rms_db(x[-n // 2:])
    check(
        -6.6 < reduction < -5.4,
        f"a settled -6 dBFS signal loses ~6 dB under a -18 dBFS threshold at 2:1 (got {reduction:.2f} dB)",
    )

    # the reduction must be measured in dB: a linear-amplitude implementation
    # would report roughly -0.19 dB here
    check(
        reduction < -5.0,
        "the gain reduction is computed in dB, not from a linear amplitude difference",
    )

    # ratio 4:1 must reduce 1.5x as much as 2:1 (the law is over*(1-1/ratio))
    y4 = dsp.compress(x, threshold_db=-18.0, ratio=4.0, attack_s=0.005, release_s=0.05)
    reduction4 = rms_db(y4[-n // 2:]) - rms_db(x[-n // 2:])
    check(
        abs((reduction4 / reduction) - 1.5) < 0.2,
        f"the ratio is honoured (2:1 -> {reduction:.2f} dB, 4:1 -> {reduction4:.2f} dB, expected 1.5x)",
    )

    # attack: a burst must not be reduced instantly
    burst = np.zeros(n)
    burst[int(0.5 * SR):] = tone(n - int(0.5 * SR), amp=0.5)
    y_burst = dsp.compress(burst, threshold_db=-18.0, ratio=2.0, attack_s=0.05, release_s=0.05)
    start = int(0.5 * SR)
    early = rms_db(y_burst[start : start + int(0.01 * SR)])
    late = rms_db(y_burst[start + int(0.3 * SR) : start + int(0.4 * SR)])
    check(early > late + 3.0, "the gain reduction ramps in over the attack time")

    # release: after the burst the gain must return
    y_release = dsp.compress(burst, threshold_db=-18.0, ratio=2.0, attack_s=0.005, release_s=0.2)
    tail = rms_db(y_release[start + int(0.4 * SR) :])
    check(
        tail > rms_db(y_release[start + int(0.05 * SR) : start + int(0.15 * SR)]) - 1.0,
        "the gain recovers over the release time",
    )

    # stereo: the two channels are processed independently
    stereo_in = np.stack([tone(n, amp=0.5), tone(n, amp=0.05)], axis=1)
    stereo_out = dsp.compress(stereo_in, threshold_db=-18.0, ratio=2.0, attack_s=0.005, release_s=0.05)
    left_drop = rms_db(stereo_out[: int(0.8 * SR), 0]) - rms_db(stereo_in[: int(0.8 * SR), 0])
    right_drop = rms_db(stereo_out[: int(0.8 * SR), 1]) - rms_db(stereo_in[: int(0.8 * SR), 1])
    check(left_drop < -5.0, "the loud channel is compressed by ~6 dB")
    check(right_drop > -1.0, "the quiet channel stays below the threshold and is untouched")


# --------------------------------------------------------------------------
# mastering contract
# --------------------------------------------------------------------------
def test_master_contract() -> None:
    raw = np.stack([tone(SR), tone(SR)], axis=1)
    raw_lufs = master.integrated_lufs(raw, SR)
    ok = raw * (10.0 ** ((-14.0 - raw_lufs) / 20.0))
    lufs = master.integrated_lufs(ok, SR)
    tp = master.true_peak_db(ok, SR)
    try:
        master.assert_master_contract(ok, lufs, tp, SR)
        raised = False
    except master.MasteringContractError:
        raised = True
    check(not raised, "a compliant master passes the contract check")

    def raises(data, lufs_value, tp_value) -> bool:
        try:
            master.assert_master_contract(data, lufs_value, tp_value, SR)
            return False
        except master.MasteringContractError:
            return True

    check(raises(ok, lufs + 3.0, tp), "a master outside the loudness tolerance is rejected")
    check(raises(ok, lufs, -0.2), "a master above the true-peak ceiling is rejected")
    nan = ok.copy()
    nan[0, 0] = np.nan
    check(raises(nan, lufs, tp), "a master with NaN samples is rejected")
    check(raises(ok, float("nan"), tp), "a non-finite loudness is rejected")
    check(raises(ok[:, :1], lufs, tp), "a mono master is rejected")

    # the file-level verification has to look at the decoded file
    with tempfile.TemporaryDirectory() as td:
        raw = np.stack([tone(SR), tone(SR)], axis=1)
        raw_lufs = master.integrated_lufs(raw, SR)
        scaled = raw * (10.0 ** ((-14.0 - raw_lufs) / 20.0))
        good = Path(td) / "good.wav"
        sf.write(str(good), scaled, SR, subtype="PCM_16")
        report = master.verify_master_file(good, SR)
        check("lufs" in report and "truePeakDbTp" in report, "a written master can be verified from disk")

        bad = Path(td) / "bad.wav"
        sf.write(str(bad), scaled, 22050, subtype="PCM_16")
        try:
            master.verify_master_file(bad, SR)
            raised = False
        except master.MasteringContractError:
            raised = True
        check(raised, "a file with the wrong sample rate is rejected")

        quiet = Path(td) / "quiet.wav"
        sf.write(str(quiet), raw, SR, subtype="PCM_16")
        try:
            master.verify_master_file(quiet, SR)
            raised = False
        except master.MasteringContractError:
            raised = True
        check(raised, "a file outside the loudness contract is rejected from disk")


def main() -> None:
    test_compressor()
    test_master_contract()
    print()
    if failures:
        print(f"{len(failures)} of {checks} DSP check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"DSP self-test: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()

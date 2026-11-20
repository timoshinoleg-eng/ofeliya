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
# detector
# --------------------------------------------------------------------------
def test_detector() -> None:
    """The decaying peak must follow `peak[i] = max(env[i], a_rel*peak[i-1])`.

    The first implementation of the detector kept the running maximum flat
    inside a block, so an early peak never decayed and the result depended on
    the 1024-sample block alignment.
    """
    env = np.array([1.0, 0.0, 0.0, 0.0])
    out = dsp._decaying_peak(env, 0.5)
    expected = np.array([1.0, 0.5, 0.25, 0.125])
    check(
        np.allclose(out, expected),
        f"the detector decays after the peak (got {out.tolist()}, expected {expected.tolist()})",
    )

    # the decay must not depend on where the block boundary falls
    rng = np.random.default_rng(20261118)
    noise = rng.random(4096)
    a_rel = 0.9995
    ref = dsp._decaying_peak(noise, a_rel, block=4096)
    for block in (7, 64, 1024):
        other = dsp._decaying_peak(noise, a_rel, block=block)
        check(
            np.allclose(ref, other, atol=1e-12),
            f"the detector result does not depend on the block size ({block})",
        )

    # an impulse has to decay across the block boundary (50 ms release)
    release_s = 0.05
    a = float(np.exp(-1.0 / (release_s * SR)))
    impulse = np.zeros(2048)
    impulse[0] = 1.0
    det = dsp._decaying_peak(impulse, a)
    expected_at_1023 = a ** 1023
    check(
        abs(det[1023] - expected_at_1023) < 1e-6,
        f"an impulse decays across the block boundary (got {det[1023]:.6f}, expected {expected_at_1023:.6f})",
    )
    impulse2 = np.zeros(2048)
    impulse2[1023] = 1.0
    det2 = dsp._decaying_peak(impulse2, a)
    check(
        abs(det2[1023] - 1.0) < 1e-9,
        f"an impulse raises the detector to its own level at any position (got {det2[1023]:.6f})",
    )
    check(
        det2[1024] < det2[1023],
        "the detector keeps decaying after the impulse",
    )


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

    # release: after the burst the gain must return. The burst has to be
    # followed by silence - a signal that continues to the end of the array
    # never lets the detector recover, so it proves nothing about the release.
    # A quiet probe tone after the gap shows the gain that is actually applied
    # there (measuring the RMS of the silence itself would prove nothing).
    n = int(2.0 * SR)
    burst_start = int(0.5 * SR)
    burst_len = int(0.2 * SR)
    probe_start = int(1.5 * SR)
    probe_len = int(0.2 * SR)
    probe = np.zeros(n)
    probe[probe_start : probe_start + probe_len] = tone(probe_len, amp=0.05)
    burst = np.zeros(n)
    burst[burst_start : burst_start + burst_len] = tone(burst_len, amp=0.5)
    signal = burst + probe

    y_release = dsp.compress(signal, threshold_db=-18.0, ratio=2.0, attack_s=0.005, release_s=0.25)
    during = rms_db(y_release[burst_start + int(0.05 * SR) : burst_start + int(0.15 * SR)]) - rms_db(
        burst[burst_start + int(0.05 * SR) : burst_start + int(0.15 * SR)]
    )
    after = rms_db(y_release[probe_start : probe_start + probe_len]) - rms_db(
        probe[probe_start : probe_start + probe_len]
    )
    check(
        after > during + 4.0,
        f"the gain recovers after the signal ends (during {during:.2f} dB, after {after:.2f} dB)",
    )
    check(
        abs(after) < 1.0,
        f"the recovered gain is unity again (after {after:.2f} dB)",
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
    test_detector()
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

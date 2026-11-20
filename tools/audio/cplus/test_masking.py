#!/usr/bin/env python3
"""Self-test for the SFX masking comparison.

    python tools/audio/cplus/test_masking.py

The comparison itself has to be able to distinguish three cases that look
alike in the summary numbers:

  * C+ is better than **every** production bed (not a regression);
  * C+ is worse than the *easiest* production bed but still better than the
    hardest one (also not a regression against production);
  * C+ is worse than **every** production bed (a real regression).

The review found that the "worse than production" counter used the delta
against the *easiest* baseline, so a bed that was better than all of them was
still counted as a regression. These tests pin the corrected criterion.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analyze_masking import build_regressions, summarize_regressions  # noqa: E402

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


def row(sfx: str, bed: str, value: float, baseline: bool) -> dict:
    return {
        "sfx": sfx,
        "bed": bed,
        "baseline": baseline,
        "musicVsSfxInBandDb": value,
    }


def main() -> None:
    sfx = "bossphase"

    # --- the example from the review ---------------------------------------
    # baselines at -10 and +10, the C+ bed at -5:
    #   * against the hardest baseline (+10) the C+ bed is 15 dB better,
    #   * against the easiest baseline (-10) it is 5 dB worse,
    #   * and it is therefore NOT a regression against production.
    rows = [
        row(sfx, "prod_loop0", -10.0, True),
        row(sfx, "prod_loop1", 10.0, True),
        row(sfx, "bloodstream", -5.0, False),
    ]
    regressions = build_regressions(rows)
    summary = summarize_regressions(regressions)
    entry = regressions[0]
    check(
        entry["deltaVsBestBaselineDb"] == -15.0,
        f"the delta against the hardest baseline is -15 dB (got {entry['deltaVsBestBaselineDb']})",
    )
    check(
        entry["deltaVsWorstBaselineDb"] == 5.0,
        f"the delta against the easiest baseline is +5 dB (got {entry['deltaVsWorstBaselineDb']})",
    )
    check(
        summary["allBaselineSummary"]["worseThanProduction"] == 0,
        "a bed that is better than the hardest baseline is not counted as worse than production",
    )
    check(
        summary["actMatchedSummary"]["worseThanProduction"] == 0,
        "the act-matched counter agrees",
    )

    # --- a bed that really is worse than every baseline --------------------
    rows = [
        row(sfx, "prod_loop0", -10.0, True),
        row(sfx, "prod_loop1", 10.0, True),
        row(sfx, "bloodstream", 15.0, False),
    ]
    regressions = build_regressions(rows)
    summary = summarize_regressions(regressions)
    check(
        summary["allBaselineSummary"]["worseThanProduction"] == 1,
        "a bed that is worse than every baseline is counted as a regression",
    )
    check(
        regressions[0]["verdict"] == "WORSE",
        "the act-matched verdict marks the regression as WORSE",
    )

    # --- a bed that is worse than the easiest baseline only ----------------
    rows = [
        row(sfx, "prod_loop0", -10.0, True),
        row(sfx, "prod_loop1", 10.0, True),
        row(sfx, "bloodstream", 0.0, False),
    ]
    regressions = build_regressions(rows)
    summary = summarize_regressions(regressions)
    check(
        regressions[0]["deltaVsWorstBaselineDb"] == 10.0,
        "the delta against the easiest baseline is +10 dB",
    )
    check(
        summary["allBaselineSummary"]["worseThanProduction"] == 0,
        "being worse than the easiest baseline alone is not a regression against production",
    )

    # --- the act-matched pool ---------------------------------------------
    # `bloodstream` is an act-1 bed, `heart` is an act-2 bed; the act-matched
    # pool of an act-2 bed must not contain the act-1 baselines.
    rows = [
        row(sfx, "prod_loop0", -10.0, True),   # act 1
        row(sfx, "prod_loop2", 10.0, True),    # act 2
        row(sfx, "prod_loop4", 20.0, True),    # act 2
        row(sfx, "heart", -5.0, False),        # act 2
    ]
    regressions = build_regressions(rows)
    entry = regressions[0]
    check(entry["actMatched"] is True, "an act-2 bed is matched with the act-2 baselines")
    check(
        entry["baselinePool"] == ["prod_loop2", "prod_loop4"],
        f"the act-matched pool holds only the act-2 baselines (got {entry['baselinePool']})",
    )
    check(
        entry["deltaDb"] == -25.0,
        f"the act-matched delta is measured against the hardest act-2 baseline (got {entry['deltaDb']})",
    )
    check(
        entry["deltaVsWorstActBaselineDb"] == -15.0,
        f"the act-matched range keeps its second end (got {entry['deltaVsWorstActBaselineDb']})",
    )

    print()
    if failures:
        print(f"{len(failures)} of {checks} masking check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"masking self-test: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()

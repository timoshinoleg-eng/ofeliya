#!/usr/bin/env python3
"""Self-test for the report generator.

    python tools/audio/cplus/test_report.py

The report is supposed to state only what the measurements support. The
review found three ways it could overstate its case:

  * a missing measurement was silently excluded from the calculation, but the
    conclusion still read as "no click confirmed";
  * `all()` on an empty list is `True`, so a report without a single measured
    bed claimed that all beds were seamless;
  * the masking table built its ranges over different C+ beds instead of over
    all baselines of one bed, and the second end of every range was dropped.

These tests render the report from synthetic measurements and check the
wording.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from write_report import build_report  # noqa: E402

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


def make_row(track_id: str, ratio: float | None, seamless: bool | None = True) -> dict:
    return {
        "id": track_id,
        "title": track_id,
        "v3": {"durationSec": 16.0, "lufs": -14.0, "truePeakDbTp": -3.0, "peak": 0.5},
        "v3seam": {"sampleJumpRel": 0.01, "wrapVsLocalRatio": ratio},
        "v3mono": {"monoLufsLossDb": 3.0},
        "v4": {"durationSec": 80.0, "lufs": -14.0, "truePeakDbTp": -6.0, "peak": 0.5},
        "v4seam": {
            "sampleJumpRel": 0.01,
            "wrapVsLocalRatio": ratio,
            "spectralContinuityMaxBandDb": 1.0,
            "seamless": seamless,
            "cyclesTested": 10,
            "cyclesMeasuredSeams": 9,
        },
        "v4mono": {
            "monoLufsLossDb": 3.0,
            "monoCorrelation": 0.8,
            "lowBandPhaseLossDb": 1.0,
            "antiPhaseEnergyPct": 2.0,
            "bandRetentionDb": {"mid_500_1500": 0.0},
        },
        "v4fatigue": {
            "applicable": True,
            "loop16sEcho": 0.4,
            "farSimilarityMean": 0.2,
            "farSimilarPairsPct": 1.0,
            "repetitionRisk": "low",
        },
        "v4speaker": {
            "emulatedLufs": -16.0,
            "loudnessDeltaDb": -2.0,
            "punchBandBeforePct": 20.0,
            "punchBandAfterPct": 24.0,
            "airBeforePct": 5.0,
            "airAfterPct": 4.0,
        },
    }


MASKING = {
    "regressions": [
        {
            "sfx": "bossphase",
            "bed": "bloodstream",
            "actMatched": True,
            "deltaDb": -15.0,
            "deltaVsWorstActBaselineDb": 5.0,
            "deltaVsBestBaselineDb": -15.0,
            "deltaVsWorstBaselineDb": 5.0,
            "verdict": "better",
        },
    ],
    "actMatchedSummary": {"comparisons": 1, "worseThanProduction": 0, "deltaRangeDb": [-15.0, -15.0]},
    "allBaselineSummary": {"comparisons": 1, "worseThanProduction": 0, "deltaRangeDb": [-15.0, -15.0]},
    "absolute": [],
    "absoluteSummary": {"aboveMusicEverywhere": 0, "soundsChecked": 0, "worstMarginDb": 0.0},
}


def render(rows: list[dict], with_masking: bool = True, masking: dict | None = None) -> str:
    with tempfile.TemporaryDirectory() as td:
        package = Path(td)
        if with_masking:
            (package / "analysis").mkdir(parents=True, exist_ok=True)
            (package / "analysis" / "sfx-masking.json").write_text(
                json.dumps(masking if masking is not None else MASKING), encoding="utf-8"
            )
        return build_report(rows, package)


def main() -> None:
    # --- a complete measurement set ---------------------------------------
    rows = [make_row("bloodstream", 0.5), make_row("heart", 0.4)]
    text = render(rows)
    check("Подтверждённого клика измерения не дают" in text,
          "a complete measurement set reports that no click was measured")
    check("Beds C+ v4, проверенных на стык: 2 из 2" in text,
          "the report says how many beds were checked")
    check("не измерено" not in text.lower(),
          "a complete measurement set does not claim anything is missing")

    # --- a missing measurement --------------------------------------------
    rows = [make_row("bloodstream", 0.5), make_row("heart", None, seamless=None)]
    text = render(rows)
    check("Не измерено" in text, "a missing measurement is reported as missing")
    check("Подтверждённого клика измерения не дают" not in text,
          "a missing measurement does not produce a 'no click confirmed' claim")
    check("без отношения остались 1 из 2 треков в C v3 и 1 из 2 в C+ v4" in text,
          "the report names how many measurements are missing")
    check("Beds C+ v4, проверенных на стык: 1 из 2" in text,
          "the report counts only the beds that were measured")

    # --- no measured bed at all -------------------------------------------
    rows = [make_row("bloodstream", None, seamless=None), make_row("heart", None, seamless=None)]
    text = render(rows)
    check("Beds C+ v4, проверенных на стык: 0 из 2" in text,
          "the report counts zero measured beds")
    check("все бесшовны по результату измерений: нет" in text,
          "an empty measurement set does not claim that every bed is seamless")

    # --- the masking table keeps both ends of every range -----------------
    text = render([make_row("bloodstream", 0.5)])
    check("act-matched: Δ к лучшему baseline" in text,
          "the masking table shows the act-matched range")
    check("все baseline: Δ к лучшему" in text,
          "the masking table shows the full baseline range")
    check("-15.0 дБ" in text and "5.0 дБ" in text,
          "both ends of the range are in the table")
    check("Δ к **самому маскирующему** production-bed" in text,
          "the report states the criterion of the regression counter")

    # Masked SFX may be a genuine regression or an unknown, not always an
    # improvement. The conclusion must follow actual measured comparisons.
    cue = {
        "sfx": "bossphase", "dominantBandHz": [1000, 2000],
        "sfxRuntimeTrim": 0.62, "sfxBandDb": -18.0,
        "musicBandDb": -10.0, "worstMarginDb": -8.0,
        "productionWorstMarginDb": 0.0,
        "improvementVsProductionDb": -8.0, "aboveMusicEverywhere": False,
    }
    absolute_summary = {
        "aboveMusicEverywhere": 0, "soundsChecked": 1,
        "worstMarginDb": -8.0, "productionWorstMarginDb": 0.0,
        "soundsBelowMusic": ["bossphase"],
    }
    worse = {
        **MASKING, "absolute": [cue], "absoluteSummary": absolute_summary,
        "actMatchedSummary": {"comparisons": 1, "worseThanProduction": 1, "deltaRangeDb": [8, 8]},
    }
    text = render([make_row("bloodstream", 0.5)], masking=worse)
    check("Возможна регрессия слышимости" in text and "Это **не регрессия**" not in text,
          "a worsening by 8 dB never receives a reassuring masking conclusion")

    unknown = {
        **worse, "actMatchedSummary": {"comparisons": 0, "worseThanProduction": 0, "deltaRangeDb": None},
        "absolute": [{**cue, "improvementVsProductionDb": None}],
    }
    text = render([make_row("bloodstream", 0.5)], masking=unknown)
    check("Данных для вывода о регрессии" in text,
          "missing production baselines never imply a measured improvement")

    improved = {
        **worse, "actMatchedSummary": {"comparisons": 1, "worseThanProduction": 0, "deltaRangeDb": [-2, -2]},
        "absolute": [{**cue, "improvementVsProductionDb": 2.0}],
    }
    text = render([make_row("bloodstream", 0.5)], masking=improved)
    check("уменьшения запаса относительно production не найдено" in text,
          "a positive measured margin supports a qualified no-regression conclusion")

    print()
    if failures:
        print(f"{len(failures)} of {checks} report check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"report self-test: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()

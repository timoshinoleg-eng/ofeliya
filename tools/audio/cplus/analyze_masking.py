#!/usr/bin/env python3
"""SFX intelligibility analysis for the OFELIYA C+ v4 beds.

    python tools/audio/cplus/analyze_masking.py --package <pkg> --repo <repo>

Two independent questions are answered:

  1. **Relative** — is the C+ v4 bed better or worse than the production bed
     in the same act at masking the game's own sounds? The comparison is made
     against the act-matched production beds (the same musical slot in the
     same act, per `MUSIC_BED_POOLS`), and the range over *every* production
     bed is reported next to it so the baseline choice cannot flatter the
     result.
  2. **Absolute** — in the real game mix, does the sound stay above the bed?
     The SFX level includes the runtime normalisation the game applies
     (`scanNormalizationTrim`) and its role gain; the music level includes the
     music bus gain.

The SFX band is the band the SFX itself lives in, found from its own
spectrum — not from a fixed 1.5-3.5 kHz pocket.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ofeliya_cplus import metrics  # noqa: E402

PRODUCTION_BEDS = [
    ("loop0.ogg", "prod_loop0", "act1"),
    ("loop1.ogg", "prod_loop1", "act1"),
    ("loop2.ogg", "prod_loop2", "act2"),
    ("loop3.mp3", "prod_loop3", "act1"),
    ("loop4.mp3", "prod_loop4", "act2"),
    ("loop5.mp3", "prod_loop5", "act2"),
    ("loop6.mp3", "prod_loop6", "act1"),
]

#: Which production beds belong to which act, mirroring `MUSIC_BED_POOLS` in
#: `src/systems/adaptiveAudioMath.ts` (bloodstream = [0,1,3,6], heart = [2,4,5]).
PRODUCTION_ACT = {
    "prod_loop0": "act1",
    "prod_loop1": "act1",
    "prod_loop3": "act1",
    "prod_loop6": "act1",
    "prod_loop2": "act2",
    "prod_loop4": "act2",
    "prod_loop5": "act2",
}

#: Which act each C+ bed belongs to.
CPLUS_ACT = {
    "bloodstream": "act1",
    "immune_prime": "act1",
    "heart": "act2",
    "cardiac_titan": "act2",
}

CRITICAL_SFX = [
    ("bossphase.mp3", "bossphase"),
    ("boss.ogg", "boss"),
    ("elite.ogg", "elite"),
    ("infect.mp3", "infect"),
    ("lysis.mp3", "lysis"),
    ("hit.ogg", "hit"),
    ("pickup.ogg", "pickup"),
    ("levelup.ogg", "levelup"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--repo", required=True)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    repo = Path(args.repo).resolve()
    sfx_dir = repo / "public" / "audio" / "sfx"

    beds = {}
    for bed in CPLUS_ACT:
        path = package / "wav" / f"{bed}.wav"
        if path.exists():
            beds[bed] = metrics.read(path)[0]

    prod_dir = repo / "public" / "audio" / "music"
    for name, label, _act in PRODUCTION_BEDS:
        path = prod_dir / name
        if path.exists():
            beds[label] = metrics.read(path)[0]

    rows = []
    for sfx_name, sfx_role in CRITICAL_SFX:
        sfx_path = sfx_dir / sfx_name
        if not sfx_path.exists():
            print(f"skip missing sfx {sfx_name}")
            continue
        sfx, sr = metrics.read(sfx_path)
        trim = metrics.runtime_normalization_trim(sfx)
        for bed, music in beds.items():
            report = metrics.sfx_masking(
                music, sfx, sr, name=f"{bed}/{sfx_name}", sfx_role=sfx_role, runtime_trim=trim
            )
            report["bed"] = bed
            report["sfx"] = sfx_name
            report["baseline"] = bed.startswith("prod_")
            report["actMatched"] = (
                not report["baseline"]
                and PRODUCTION_ACT.get(bed) == CPLUS_ACT.get(bed)
            )
            rows.append(report)

    out = {
        "method": (
            "the SFX band comes from the SFX spectrum; the SFX level includes the "
            "runtime normalisation (scanNormalizationTrim) and the role gain; the music "
            "level includes the music bus gain"
        ),
        "rows": rows,
    }

    # ---------------------------------------------------------------- relative
    regressions = []
    for sfx_name, _role in CRITICAL_SFX:
        baseline = [r for r in rows if r["sfx"] == sfx_name and r["baseline"]]
        if not baseline:
            continue
        for r in rows:
            if r["sfx"] != sfx_name or r["baseline"]:
                continue
            matched = [b for b in baseline if PRODUCTION_ACT.get(b["bed"]) == CPLUS_ACT.get(r["bed"])]
            pool = matched if matched else baseline
            # both ends of the range are kept: the worst baseline is the one
            # that hides the improvement, and it must not be dropped
            pool_best = max(b["musicVsSfxInBandDb"] for b in pool)
            pool_worst = min(b["musicVsSfxInBandDb"] for b in pool)
            all_best = max(b["musicVsSfxInBandDb"] for b in baseline)
            all_worst = min(b["musicVsSfxInBandDb"] for b in baseline)
            delta = r["musicVsSfxInBandDb"] - pool_best
            flag = "WORSE" if delta > 3.0 else ("better" if delta < -1.0 else "same")
            regressions.append({
                "sfx": sfx_name,
                "bed": r["bed"],
                "baselinePool": sorted(b["bed"] for b in pool),
                "actMatched": bool(matched),
                "deltaDb": round(delta, 2),
                "deltaVsWorstActBaselineDb": round(r["musicVsSfxInBandDb"] - pool_worst, 2),
                "deltaVsBestBaselineDb": round(r["musicVsSfxInBandDb"] - all_best, 2),
                "deltaVsWorstBaselineDb": round(r["musicVsSfxInBandDb"] - all_worst, 2),
                "verdict": flag,
            })
    out["regressions"] = regressions

    matched_rows = [r for r in regressions if r["actMatched"]]
    matched_worse = [r for r in matched_rows if r["verdict"] == "WORSE"]
    all_worse = [r for r in regressions if r["deltaVsWorstBaselineDb"] > 3.0]
    out["actMatchedSummary"] = {
        "comparisons": len(matched_rows),
        "worseThanProduction": len(matched_worse),
        "deltaRangeDb": [
            round(min((r["deltaDb"] for r in matched_rows), default=0.0), 2),
            round(max((r["deltaDb"] for r in matched_rows), default=0.0), 2),
        ],
        "deltaVsWorstBaselineRangeDb": [
            round(min((r["deltaVsWorstBaselineDb"] for r in matched_rows), default=0.0), 2),
            round(max((r["deltaVsWorstBaselineDb"] for r in matched_rows), default=0.0), 2),
        ],
    }
    out["allBaselineSummary"] = {
        "comparisons": len(regressions),
        "worseThanProduction": len(all_worse),
        "deltaRangeDb": [
            round(min((r["deltaVsBestBaselineDb"] for r in regressions), default=0.0), 2),
            round(max((r["deltaVsBestBaselineDb"] for r in regressions), default=0.0), 2),
        ],
        "deltaVsWorstBaselineRangeDb": [
            round(min((r["deltaVsWorstBaselineDb"] for r in regressions), default=0.0), 2),
            round(max((r["deltaVsWorstBaselineDb"] for r in regressions), default=0.0), 2),
        ],
    }

    # ---------------------------------------------------------------- absolute
    absolute = []
    for sfx_name, _role in CRITICAL_SFX:
        cplus_rows = [r for r in rows if r["sfx"] == sfx_name and not r["baseline"]]
        prod_rows = [r for r in rows if r["sfx"] == sfx_name and r["baseline"]]
        if not cplus_rows:
            continue
        worst = min(cplus_rows, key=lambda r: r["sfxMarginDb"])
        best = max(cplus_rows, key=lambda r: r["sfxMarginDb"])
        prod_worst = min((r["sfxMarginDb"] for r in prod_rows), default=None)
        absolute.append({
            "sfx": sfx_name,
            "dominantBandHz": worst["dominantBandHz"],
            "sfxRuntimeTrim": worst["sfxRuntimeTrim"],
            "sfxBandDb": worst["sfxBandDb"],
            "musicBandDb": worst["musicBandDb"],
            "worstMarginDb": worst["sfxMarginDb"],
            "bestMarginDb": best["sfxMarginDb"],
            "productionWorstMarginDb": prod_worst,
            "improvementVsProductionDb": (
                round(worst["sfxMarginDb"] - prod_worst, 2) if prod_worst is not None else None
            ),
            "aboveMusicEverywhere": bool(all(r["sfxAboveMusic"] for r in cplus_rows)),
        })
    out["absolute"] = absolute
    out["absoluteSummary"] = {
        "soundsChecked": len(absolute),
        "aboveMusicEverywhere": sum(1 for a in absolute if a["aboveMusicEverywhere"]),
        "worstMarginDb": round(min((a["worstMarginDb"] for a in absolute), default=0.0), 2),
        "productionWorstMarginDb": round(
            min((a["productionWorstMarginDb"] for a in absolute if a["productionWorstMarginDb"] is not None),
                default=0.0), 2,
        ),
        "soundsBelowMusic": [
            a["sfx"] for a in absolute if not a["aboveMusicEverywhere"]
        ],
    }

    path = package / "analysis" / "sfx-masking.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[masking] wrote {path}")

    print("\n[masking] absolute intelligibility in the real game mix")
    print(f"{'sfx':<16}{'band Hz':<13}{'trim':>7}{'sfx dB':>9}{'music dB':>10}{'margin dB':>11}  verdict")
    for a in absolute:
        verdict = "above music" if a["aboveMusicEverywhere"] else "partly masked"
        print(
            f"{a['sfx']:<16}{a['dominantBandHz'][0]:.0f}-{a['dominantBandHz'][1]:<8.0f}"
            f"{a['sfxRuntimeTrim']:>7.2f}{a['sfxBandDb']:>9.1f}{a['musicBandDb']:>10.1f}"
            f"{a['worstMarginDb']:>11.1f}  {verdict}"
        )
    print(
        f"\n[masking] absolute: {out['absoluteSummary']['aboveMusicEverywhere']}"
        f"/{out['absoluteSummary']['soundsChecked']} звуков остаются выше музыки во всех beds"
    )

    print("\n[masking] C+ v4 vs production baseline")
    for r in regressions:
        print(
            f"  {r['sfx']:<16}{r['bed']:<16}act-matched Δ={r['deltaDb']:+6.1f} dB   "
            f"vs worst baseline Δ={r['deltaVsWorstBaselineDb']:+6.1f} dB  ({r['verdict']})"
        )
    print(
        f"\n[masking] act-matched сравнений: {len(matched_rows)}, хуже production на >3 дБ — "
        f"{len(matched_worse)}; по всем baseline: {len(regressions)}, хуже — {len(all_worse)}"
    )


if __name__ == "__main__":
    main()

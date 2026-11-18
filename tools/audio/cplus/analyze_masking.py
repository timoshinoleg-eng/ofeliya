#!/usr/bin/env python3
"""SFX intelligibility analysis for the OFELIYA C+ v4 beds.

    python tools/audio/cplus/analyze_masking.py --package <pkg> --repo <repo>

For every C+ bed and every critical game sound (`bossphase`, `boss`, `elite`,
`infect`, `lysis`, `hit`, `pickup`, `levelup`) it measures how loud the music
bed is *inside the band where the SFX lives*.

The metric is deliberately not "the 1.5-3.5 kHz pocket": the independent
review in issue #299 showed that important boss signals sit well below that.
Instead the dominant band is found from the SFX's own spectrum, and the music
is measured in exactly that band.

Result: `musicVsSfxInBandDb` <= 0 means the SFX still owns its band while the
bed plays.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ofeliya_cplus import metrics  # noqa: E402

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

BEDS = ["bloodstream", "heart", "immune_prime", "cardiac_titan"]


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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--repo", required=True)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    repo = Path(args.repo).resolve()
    sfx_dir = repo / "public" / "audio" / "sfx"

    beds = {}
    for bed in BEDS:
        path = package / "wav" / f"{bed}.wav"
        if not path.exists():
            continue
        data, sr = metrics.read(path)
        beds[bed] = data

    # production baseline: the licensed beds the game ships today
    prod_dir = repo / "public" / "audio" / "music"
    for name, label, _act in PRODUCTION_BEDS:
        path = prod_dir / name
        if path.exists():
            data, sr = metrics.read(path)
            beds[label] = data

    rows = []
    for sfx_name, sfx_role in CRITICAL_SFX:
        sfx_path = sfx_dir / sfx_name
        if not sfx_path.exists():
            print(f"skip missing sfx {sfx_name}")
            continue
        sfx, sr = metrics.read(sfx_path)
        for bed, music in beds.items():
            report = metrics.sfx_masking(music, sfx, sr, name=f"{bed}/{sfx_name}", sfx_role=sfx_role)
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
            "dominant band of the SFX spectrum (250-6000 Hz); the music bed is measured "
            "at its in-game bus level (0.65) and the SFX at its role gain, comparing the "
            "sustained music level in that band with the SFX peak in the same band"
        ),
        "rows": rows,
        "summary": {
            "clear": sum(1 for r in rows if r["sfxClear"]),
            "total": len(rows),
            "worst": max(rows, key=lambda r: r["musicVsSfxInBandDb"]) if rows else None,
        },
    }
    path = package / "analysis" / "sfx-masking.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[masking] wrote {path}")

    print(f"{'bed':<15}{'sfx':<18}{'band Hz':<14}{'music dB':>10}{'sfx peak dB':>12}{'Δ dB':>8}  verdict")
    for r in rows:
        band = f"{r['dominantBandHz'][0]:.0f}-{r['dominantBandHz'][1]:.0f}"
        print(
            f"{r['bed']:<15}{r['sfx']:<18}{band:<14}{r['musicBandDb']:>10.1f}"
            f"{r['sfxBandDb']:>12.1f}{r['musicVsSfxInBandDb']:>8.1f}  "
            f"{'clear' if r['sfxClear'] else 'masked'}"
        )

    # Regression check against the production baseline.
    #
    # The headline number uses the *act-matched* production beds: the C+ act I
    # bed is compared with the production act I beds (and the act II bed with
    # the production act II beds), because that is the like-for-like
    # comparison — the same musical slot in the same act. The full range over
    # *every* production bed is reported next to it, so the least favourable
    # baseline is visible as well.
    print("\n[masking] C+ v4 vs production baseline")
    regressions = []
    for sfx_name, sfx_role in CRITICAL_SFX:
        baseline = [r for r in rows if r["sfx"] == sfx_name and r["baseline"]]
        if not baseline:
            continue
        for r in rows:
            if r["sfx"] != sfx_name or r["baseline"]:
                continue
            matched = [b for b in baseline if PRODUCTION_ACT.get(b["bed"]) == CPLUS_ACT.get(r["bed"])]
            pool = matched if matched else baseline
            pool_best = max(b["musicVsSfxInBandDb"] for b in pool)
            pool_worst = min(b["musicVsSfxInBandDb"] for b in pool)
            all_best = max(b["musicVsSfxInBandDb"] for b in baseline)
            delta = r["musicVsSfxInBandDb"] - pool_best
            delta_all = r["musicVsSfxInBandDb"] - all_best
            flag = "WORSE" if delta > 3.0 else ("better" if delta < -1.0 else "same")
            regressions.append({
                "sfx": sfx_name,
                "bed": r["bed"],
                "baselinePool": sorted(b["bed"] for b in pool),
                "actMatched": bool(matched),
                "deltaDb": round(delta, 2),
                "deltaVsWorstBaselineDb": round(delta_all, 2),
                "verdict": flag,
            })
            print(
                f"  {sfx_name:<16}{r['bed']:<16}act-matched Δ={delta:+6.1f} dB   "
                f"vs best baseline Δ={delta_all:+6.1f} dB  ({flag})"
            )
    worse = [r for r in regressions if r["verdict"] == "WORSE"]
    same = [r for r in regressions if r["verdict"] == "same"]
    matched_rows = [r for r in regressions if r["actMatched"]]
    matched_worse = [r for r in matched_rows if r["verdict"] == "WORSE"]
    print(
        f"\n[masking] act-matched comparisons: {len(matched_rows)}, "
        f"worse than production by >3 dB: {len(matched_worse)}; "
        f"over all baselines: {len(regressions)} comparisons, worse: {len(worse)}, same: {len(same)}"
    )
    out["regressions"] = regressions
    out["actMatchedSummary"] = {
        "comparisons": len(matched_rows),
        "worseThanProduction": len(matched_worse),
        "deltaRangeDb": [
            round(min((r["deltaDb"] for r in matched_rows), default=0.0), 2),
            round(max((r["deltaDb"] for r in matched_rows), default=0.0), 2),
        ],
    }
    out["allBaselineSummary"] = {
        "comparisons": len(regressions),
        "worseThanProduction": len(worse),
        "deltaRangeDb": [
            round(min((r["deltaDb"] for r in regressions), default=0.0), 2),
            round(max((r["deltaDb"] for r in regressions), default=0.0), 2),
        ],
    }
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

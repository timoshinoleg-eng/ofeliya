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
    for name, label in (
        ("loop0.ogg", "prod_loop0"),
        ("loop2.ogg", "prod_loop2"),
        ("loop3.mp3", "prod_loop3"),
        ("loop4.mp3", "prod_loop4"),
    ):
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

    # regression check against the production baseline
    print("\n[masking] C+ v4 vs production baseline (same SFX, same band)")
    regressions = []
    for sfx_name, sfx_role in CRITICAL_SFX:
        baseline = [r for r in rows if r["sfx"] == sfx_name and r["baseline"]]
        if not baseline:
            continue
        base_best = max(r["musicVsSfxInBandDb"] for r in baseline)
        for r in rows:
            if r["sfx"] != sfx_name or r["baseline"]:
                continue
            delta = r["musicVsSfxInBandDb"] - base_best
            flag = "WORSE" if delta > 3.0 else ("better" if delta < -1.0 else "same")
            regressions.append({
                "sfx": sfx_name, "bed": r["bed"], "deltaDb": round(delta, 2), "verdict": flag,
            })
            print(
                f"  {sfx_name:<16}{r['bed']:<16}Δ vs prod = {delta:+6.1f} dB  ({flag})"
            )
    worse = [r for r in regressions if r["verdict"] == "WORSE"]
    print(f"\n[masking] {len(worse)} of {len(regressions)} comparisons are worse than production by >3 dB")
    out["regressions"] = regressions
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

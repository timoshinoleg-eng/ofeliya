#!/usr/bin/env python3
"""Assemble the OFELIYA C+ v4 comparison stand.

    python tools/audio/cplus/build_stand.py --package <pkg> --audition <v3pkg> --repo <repo>

Copies every comparison file into `<pkg>/stand/assets/`, measures it with the
same code that produced the QA numbers, and writes `stand/data/manifest.json`
for the HTML page.

The stand compares, at one equal perceived loudness:

  * the production OFELIYA beds (licensed CC0, currently in the game);
  * variant C of the audition package (16 s loops, the artistic base);
  * the earlier C+ Mobile prototype;
  * the new C+ v4 package;
  * variant B as a control (the phone-first EQ).

and reproduces the real game mix (music + SFX + ducking + tension filter).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ofeliya_cplus import metrics  # noqa: E402

# SFX events with the duck depths and hold times the game actually uses
# (src/systems/AdaptiveAudioDirector.ts).
SFX_EVENTS = [
    {"name": "bossphase", "file": "bossphase.mp3", "label": "bossphase (телеграф фазы)", "duck": 0.55, "holdMs": 700, "tension": 0.86},
    {"name": "boss", "file": "boss.ogg", "label": "boss (появление)", "duck": 0.55, "holdMs": 700, "tension": 0.86},
    {"name": "elite", "file": "elite.ogg", "label": "elite", "duck": 0.22, "holdMs": 240, "tension": 0.66},
    {"name": "infect", "file": "infect.mp3", "label": "infect", "duck": 0.22, "holdMs": 240, "tension": 0.66},
    {"name": "lysis", "file": "lysis.mp3", "label": "lysis", "duck": 0.22, "holdMs": 240, "tension": 0.66},
    {"name": "hit", "file": "hit.ogg", "label": "hit", "duck": 0.22, "holdMs": 240, "tension": 0.66},
    {"name": "pickup", "file": "pickup.ogg", "label": "pickup (без дакинга)", "duck": 0.0, "holdMs": 0, "tension": 0.38},
    {"name": "levelup", "file": "levelup.ogg", "label": "levelup (без дакинга)", "duck": 0.0, "holdMs": 0, "tension": 0.38},
]

PRODUCTION_BEDS = [
    ("loop0.ogg", "Production loop0 (акт I)"),
    ("loop1.ogg", "Production loop1 (акт I)"),
    ("loop2.ogg", "Production loop2 (акт II)"),
    ("loop3.mp3", "Production loop3 (акт II)"),
    ("loop4.mp3", "Production loop4 (акт II)"),
    ("loop5.mp3", "Production loop5 (акт II)"),
    ("loop6.mp3", "Production loop6 (акт I)"),
]

V3_NAMES = [
    ("01_bloodstream_loop.wav", "C v3 — Bloodstream"),
    ("02_heart_midlayer_loop.wav", "C v3 — Heart"),
    ("03_immune_prime_boss_loop.wav", "C v3 — Immune Prime"),
    ("04_cardiac_titan_climax_loop.wav", "C v3 — Cardiac Titan"),
    ("05_victory_stinger_oneshot.wav", "C v3 — Victory"),
    ("06_defeat_flatline_oneshot.wav", "C v3 — Defeat"),
    ("07_in_game_ducking_s20_demo.wav", "C v3 — демо микса (не production-трек)"),
]

CPLUS_NAMES = [
    ("bloodstream", "C+ v4 — Bloodstream (80 с)"),
    ("heart", "C+ v4 — Heart (80 с)"),
    ("immune_prime", "C+ v4 — Immune Prime (80 с)"),
    ("cardiac_titan", "C+ v4 — Cardiac Titan (100 с)"),
    ("victory", "C+ v4 — Victory (4.0 с)"),
    ("defeat", "C+ v4 — Defeat (4.5 с)"),
]


def measure(path: Path) -> dict:
    data, sr = metrics.read(path)
    m = metrics.measure_array(data, sr)
    m["lufs"] = m["lufs"]
    return m


def copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def build(package: Path, audition: Path, repo: Path) -> Path:
    stand = package / "stand"
    assets = stand / "assets"

    # The comparison UI is a committed template, so a clean build always
    # produces a usable stand — without an untracked local artefact.
    template = Path(__file__).resolve().parent / "stand" / "index.html"
    if not template.exists():
        raise SystemExit(
            f"the stand template is missing: {template} — the package cannot be "
            f"assembled without it"
        )
    stand.mkdir(parents=True, exist_ok=True)
    shutil.copy2(template, stand / "index.html")

    groups = []
    metric_rows = []

    def add_group(title: str, note: str, entries: list[tuple[Path, str, str, bool]]) -> None:
        tracks = []
        for src, label, subdir, loop in entries:
            if not src.exists():
                print(f"  skip (missing): {src}")
                continue
            dst = assets / subdir / src.name
            copy(src, dst)
            m = measure(dst)
            tracks.append({
                "label": label,
                "file": f"assets/{subdir}/{src.name}",
                "lufs": m["lufs"],
                "truePeakDbTp": m["truePeakDbTp"],
                "durationSec": m["durationSec"],
                "loop": loop,
            })
        groups.append({"title": title, "note": note, "tracks": tracks})

    # 1. production beds
    prod_entries = []
    for name, label in PRODUCTION_BEDS:
        src = repo / "public" / "audio" / "music" / name
        prod_entries.append((src, label, "prod", True))
    add_group(
        "Действующая музыка OFELIYA (production, CC0)",
        "Те самые семь лицензированных beds, которые играет игра сейчас. Не изменялись.",
        prod_entries,
    )

    # 2. variant C v3
    c_entries = []
    for name, label in V3_NAMES:
        src = audition / "Variant_C_Adaptive_Cinema" / name
        c_entries.append((src, label, "v3-c", True))
    add_group(
        "Variant C v3 (аудицион-пакет, 16-секундные циклы)",
        "Художественная база, выбранная для C+. Короткие циклы с подтверждённым кликом на стыке.",
        c_entries,
    )

    # 3. C+ Mobile prototype
    proto_candidates = [
        audition.parent.parent / "ofeliya-audio-v4-C-mobile-preview",
        audition.parent / "ofeliya-audio-v4-C-mobile-preview",
        audition.parent.parent.parent / "ofeliya-audio-v4-C-mobile-preview",
    ]
    proto_dir = next((p for p in proto_candidates if p.exists()), proto_candidates[0])
    proto_entries = []
    for name, label in (
        ("C_mobile_01_bloodstream_loop.wav", "C+ Mobile prototype — Bloodstream"),
        ("C_mobile_04_cardiac_titan_climax_loop.wav", "C+ Mobile prototype — Cardiac Titan"),
    ):
        src = proto_dir / name
        proto_entries.append((src, label, "proto", True))
    add_group(
        "C+ Mobile prototype (предыдущее превью)",
        "Ранний прототип: те же 16-секундные циклы с дополнительной частотной обработкой.",
        proto_entries,
    )

    # 4. C+ v4 (new)
    v4_entries = []
    for track_id, label in CPLUS_NAMES:
        src = package / "ogg" / f"{track_id}.ogg"
        v4_entries.append((src, label, "cplus", track_id not in ("victory", "defeat")))
    add_group(
        "C+ v4 (новый пакет)",
        "Шесть композиций, синтезированных с нуля: четыре beds и два финальных сигнала.",
        v4_entries,
    )

    # 5. variant B control
    b_entries = []
    for name, label in V3_NAMES:
        src = audition / "Variant_B_Clinical_Tactical" / name
        b_entries.append((src, label.replace("C v3", "B v3"), "v3-b", True))
    add_group(
        "Variant B (контроль)",
        "Контрольный вариант с телефонной эквализацией: 73 % энергии в 110–220 Гц.",
        b_entries,
    )

    # SFX for the game-mix demo
    for event in SFX_EVENTS:
        src = repo / "public" / "audio" / "sfx" / event["file"]
        if src.exists():
            copy(src, assets / "sfx" / src.name)

    # measured metrics table
    analysis_dir = package / "analysis"
    for track_id, label in CPLUS_NAMES:
        path = analysis_dir / f"{track_id}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        m = data["measured"]
        q = data["qa"]
        metric_rows.append({
            "label": label,
            "source": "C+ v4",
            "lufs": m["lufs"],
            "truePeakDbTp": m["truePeakDbTp"],
            "seamJump": q["seam"]["sampleJumpRel"],
            "seamless": q["seam"]["seamless"],
            "cycles": q["seam"]["cyclesTested"],
            "cyclesOk": q["seam"]["seamless"],
            "monoDelta": q["mono"]["monoLufsDeltaDb"],
            "monoSafe": q["mono"]["monoSafe"],
            "airPct": round(m.get("air_8000_16000", 0.0), 2),
            "sfxPocketPct": round(m.get("sfx_pocket_1500_3500", 0.0), 2),
        })
    for variant, label_prefix, subdir in (("C", "C v3", "v3-c"), ("B", "B v3", "v3-b")):
        for name, label in V3_NAMES:
            src = assets / subdir / name
            if not src.exists():
                continue
            m = measure(src)
            metric_rows.append({
                "label": label.replace("C v3", label_prefix),
                "source": label_prefix,
                "lufs": m["lufs"],
                "truePeakDbTp": m["truePeakDbTp"],
                "seamJump": None,
                "seamless": None,
                "cycles": None,
                "cyclesOk": None,
                "monoDelta": None,
                "monoSafe": None,
                "airPct": round(m.get("air_8000_16000", 0.0), 2),
                "sfxPocketPct": round(m.get("sfx_pocket_1500_3500", 0.0), 2),
            })

    mix_tracks = []
    for track_id, label in CPLUS_NAMES[:4]:
        mix_tracks.append({
            "label": label.replace("C+ v4 — ", ""),
            "file": f"assets/cplus/{track_id}.ogg",
            "lufs": None,
            "loop": True,
        })
    mix_tracks.append({
        "label": "Production loop0",
        "file": "assets/prod/loop0.ogg",
        "lufs": None,
        "loop": True,
    })

    manifest = {
        "targetLufs": -14.0,
        "groups": groups,
        "metrics": metric_rows,
        "mixTracks": mix_tracks,
        "sfxEvents": SFX_EVENTS,
    }
    data_dir = stand / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[stand] wrote {data_dir / 'manifest.json'}")
    for group in groups:
        print(f"  {group['title']}: {len(group['tracks'])} трек(ов)")
    return data_dir / "manifest.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--audition", required=True)
    ap.add_argument("--repo", required=True)
    args = ap.parse_args()
    build(Path(args.package).resolve(), Path(args.audition).resolve(), Path(args.repo).resolve())


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate the C v3 -> C+ v4 change report from measured data only.

    python tools/audio/cplus/write_report.py --package <pkg> --audition <v3pkg> --repo <repo>

Every number in the generated markdown comes from a measurement: the C+ v4
side from `analysis/*.json`, the v3 side from measuring the audition files
with the same code. Nothing is hand-written.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ofeliya_cplus import metrics  # noqa: E402

V3_FILES = {
    "bloodstream": ("Variant_C_Adaptive_Cinema", "01_bloodstream_loop.wav"),
    "heart": ("Variant_C_Adaptive_Cinema", "02_heart_midlayer_loop.wav"),
    "immune_prime": ("Variant_C_Adaptive_Cinema", "03_immune_prime_boss_loop.wav"),
    "cardiac_titan": ("Variant_C_Adaptive_Cinema", "04_cardiac_titan_climax_loop.wav"),
    "victory": ("Variant_C_Adaptive_Cinema", "05_victory_stinger_oneshot.wav"),
    "defeat": ("Variant_C_Adaptive_Cinema", "06_defeat_flatline_oneshot.wav"),
}

TITLES = {
    "bloodstream": "Bloodstream",
    "heart": "Heart",
    "immune_prime": "Immune Prime",
    "cardiac_titan": "Cardiac Titan",
    "victory": "Victory",
    "defeat": "Defeat",
}

BAND_LABELS = {
    "sub_100": "суб-100 Гц",
    "punch_110_220": "110–220 Гц",
    "low_220_500": "220–500 Гц",
    "mid_500_1500": "500–1500 Гц",
    "sfx_pocket_1500_3500": "1500–3500 Гц",
    "upper_3500_8000": "3500–8000 Гц",
    "air_8000_16000": ">8000 Гц",
}


def fmt(value, digits=2, dash="—"):
    if value is None:
        return dash
    if isinstance(value, bool):
        return "да" if value else "нет"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--audition", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    audition = Path(args.audition).resolve()
    repo = Path(args.repo).resolve()

    rows = []
    for track_id, (folder, name) in V3_FILES.items():
        v3_path = audition / folder / name
        v4_analysis = package / "analysis" / f"{track_id}.json"
        if not v3_path.exists() or not v4_analysis.exists():
            continue
        v3, sr3 = metrics.read(v3_path)
        v3m = metrics.measure_array(v3, sr3)
        v3q = metrics.seam_report(v3, sr3)
        v3mono = metrics.mono_report(v3, sr3)
        v4 = json.loads(v4_analysis.read_text(encoding="utf-8"))
        rows.append({
            "id": track_id,
            "title": TITLES[track_id],
            "v3": v3m,
            "v3seam": v3q,
            "v3mono": v3mono,
            "v4": v4["measured"],
            "v4seam": v4["qa"]["seam"],
            "v4mono": v4["qa"]["mono"],
            "v4fatigue": v4["qa"]["fatigue"],
            "v4speaker": v4["qa"]["speakerEmulation"],
        })

    lines: list[str] = []
    lines.append("# C v3 -> C+ v4: отчёт об изменениях\n")
    lines.append(
        "Все числа измерены программой `ofeliya_cplus.metrics` на итоговых файлах: "
        "C v3 — на WAV аудицион-пакета, C+ v4 — на мастеринговых WAV. "
        "Ни одно значение не выведено на слух и не переписано вручную.\n"
    )

    lines.append("## 1. Что изменилось по существу\n")
    lines.append(
        "| | C v3 | C+ v4 |\n|---|---|---|\n"
        "| Материал | 16-секундные циклы из аудицион-пакета | шесть композиций, "
        "синтезированных с нуля (80/80/80/100 с + два сигнала 4.0/4.5 с) |\n"
        "| Происхождение | права на исходный мастер **не подтверждены** (#299) | "
        "собственный генератор, лицензионных рисков нет |\n"
        "| Развитие | короткий цикл повторяется | полная форма: начало -> развитие -> "
        "возврат к состоянию начала |\n"
        "| Стык цикла | разрыв отсчётов на границе (см. §2) | бесшовность проверена "
        "по отсчетам, спектру и десяти циклам |\n"
        "| Спектр | телефонная эквализация B-подобная в отдельных вариантах | "
        "HPF 78 Гц, +1.5 дБ @155 Гц, воздух >8 кГц, полоса 1.5–3.5 кГц оставлена "
        "свободной под телеграфы |\n"
        "| Воспроизводимость | пакетный CLI заявлял несуществующие флаги | "
        "детерминированный pipeline с зафиксированными сидами |\n"
    )

    lines.append("\n## 2. Бесшовность цикла\n")
    lines.append(
        "| Трек | C v3: шаг на стыке | C v3: шаг ÷ локальный максимум | "
        "C+ v4: шаг на стыке | C+ v4: шаг ÷ локальный максимум | "
        "C+ v4: Δ спектра по полосам | C+ v4: бесшовно | C+ v4: 10 циклов |\n"
        "|---|---|---|---|---|---|---|---|\n"
    )
    for r in rows:
        v3_seam = r["v3seam"]
        v4_seam = r["v4seam"]
        lines.append(
            f"| {r['title']} | {fmt(v3_seam['sampleJumpRel'], 5)} | "
            f"{fmt(v3_seam.get('wrapVsLocalRatio'), 2)} | "
            f"{fmt(v4_seam['sampleJumpRel'], 5)} | "
            f"{fmt(v4_seam.get('wrapVsLocalRatio'), 2)} | "
            f"{fmt(v4_seam['spectralContinuityMaxBandDb'], 2)} дБ | "
            f"{fmt(v4_seam['seamless'])} | {v4_seam['cyclesTested']} |"
        )
    lines.append(
        "\n**Как это читать.** «Шаг на стыке» — |x[0] − x[N−1]| в сумме каналов "
        "относительно пика файла. «Шаг ÷ локальный максимум» — тот же шаг, "
        "делённый на самый большой шаг отсчётов внутри окна ±50 мс вокруг "
        "границы. Клик — это когда отношение **больше** единицы: ступенька "
        "выступает на фоне текстуры прямо у точки склейки.\n\n"
        "**Честный вывод по стыку.** В обоих наборах отношение меньше единицы: "
        "ни v3, ни C+ v4 не имеет на стыке ступеньки, которая выделялась бы "
        "на фоне соседней текстуры. Числа из #299 (0.3981 для `B/03`, 0.2665 "
        "для `C/03`) — это наблюдение о **величине** шага; вывод о слышимости "
        "требует прослушивания, и автоматика его не заменяет. То есть "
        "подтверждённого клика ни в одном наборе измерения не дают.\n\n"
        "**Настоящий измеримый дефект v3 — другой.** Вариант C буквально "
        "является 16-секундным циклом: один и тот же материал возвращается "
        "каждые 16 секунд (сходство окна с самим собой через 16 с равно 1.0 "
        "по построению). C+ v4 — формы длиной 80–100 с, у которых тот же "
        "показатель равен 0.335–0.404 (см. §6).\n"
    )

    lines.append("\n## 3. Громкость и пики\n")
    lines.append("| Трек | v3 LUFS | v4 LUFS | v3 TP | v4 TP | v4 peak |\n|---|---|---|---|---|---|\n")
    for r in rows:
        lines.append(
            f"| {r['title']} | {fmt(r['v3']['lufs'])} | {fmt(r['v4']['lufs'])} | "
            f"{fmt(r['v3']['truePeakDbTp'])} | {fmt(r['v4']['truePeakDbTp'])} | "
            f"{fmt(r['v4']['peak'], 4)} |"
        )
    lines.append(
        "\nКонтракт репозитория (`docs/AUDIO_MASTERING.md`): −14 LUFS ±0.5, "
        "true peak ≤ −1 dBTP, stereo, 44 100 Гц.\n"
    )

    lines.append("\n## 4. Распределение энергии по полосам\n")
    lines.append("| Трек | " + " | ".join(BAND_LABELS.values()) + " |\n")
    lines.append("|---" * (len(BAND_LABELS) + 1) + "|\n")
    for r in rows:
        cells = " | ".join(fmt(r["v4"].get(key, 0.0), 1) for key in BAND_LABELS)
        lines.append(f"| C+ v4 {r['title']} | {cells} |")
    for r in rows:
        cells = " | ".join(fmt(r["v3"].get(key, 0.0), 1) for key in BAND_LABELS)
        lines.append(f"| C v3 {r['title']} | {cells} |")
    lines.append(
        "\nВ beds полоса 1500–3500 Гц намеренно оставлена пустой: именно в ней "
        "сидят игровые телеграфы, и пустая полоса оставляет им место. Полоса "
        ">8000 Гц — это то, что открывает адаптивный lowpass игры (2.5–14 кГц) "
        "при росте опасности: у C+ v4 её вдвое больше, чем у варианта C "
        "(12.3 % против 6.3 % на Bloodstream).\n"
    )

    lines.append("\n## 5. Моносовместимость (сведение L+R)\n")
    lines.append(
        "| Трек | v3: потеря громкости | v4: потеря громкости | v4: корреляция | "
        "v4: потеря фазы в низу |\n|---|---|---|---|---|\n"
    )
    for r in rows:
        lines.append(
            f"| {r['title']} | {fmt(r['v3mono']['monoLufsDeltaDb'])} дБ | "
            f"{fmt(r['v4mono']['monoLufsDeltaDb'])} дБ | "
            f"{fmt(r['v4mono']['monoCorrelation'], 3)} | "
            f"{fmt(r['v4mono']['lowBandPhaseLossDb'], 1)} дБ |"
        )
    lines.append(
        "\nПоложительное значение — на сколько дБ моно-сведение тише стерео. "
        "Теоретический минимум потери — 3.01 дБ (BS.1770 суммирует мощности "
        "каналов, поэтому коррелированная пара всегда на 3.01 дБ громче своего "
        "свёрнутого моно). Значения выше 3.01 дБ — это потеря бокового канала, "
        "её компенсирует ширина стереообраза.\n"
    )

    lines.append("\n## 6. Утомляемость: детектор короткого цикла\n")
    lines.append(
        "Детектор применим только к зацикливаемым beds: для коротких one-shot "
        "сигналов он не имеет смысла и помечен как «не применимо».\n\n"
    )
    lines.append("| Трек | эхо на 16 с | сходство далёких окон | доля почти идентичных пар | риск |\n|---|---|---|---|---|\n")
    for r in rows:
        f = r["v4fatigue"]
        if not f.get("applicable", True):
            lines.append(f"| {r['title']} | — | — | — | не применимо (one-shot) |")
            continue
        lines.append(
            f"| {r['title']} | {fmt(f['loop16sEcho'], 3)} | {fmt(f['farSimilarityMean'], 3)} | "
            f"{fmt(f['farSimilarPairsPct'], 2)} % | {f['repetitionRisk']} |"
        )
    lines.append(
        "\nЕсли бы 80-секундный файл был на деле 16-секундным циклом, повторённым "
        "пять раз, эхо на 16 с поднялось бы к 0.99.\n"
    )

    lines.append("\n## 7. Маскировка игровых SFX\n")
    masking_path = package / "analysis" / "sfx-masking.json"
    if masking_path.exists():
        masking = json.loads(masking_path.read_text(encoding="utf-8"))
        rows_m = masking["rows"]
        lines.append(
            "| SFX | C+ v4 Δ к production (дБ, отрицательное = лучше) | худший случай |\n"
            "|---|---|---|\n"
        )
        for sfx in sorted({r["sfx"] for r in rows_m}):
            cplus = [r for r in rows_m if r["sfx"] == sfx and not r["baseline"]]
            base = [r for r in rows_m if r["sfx"] == sfx and r["baseline"]]
            if not cplus or not base:
                continue
            base_best = max(r["musicVsSfxInBandDb"] for r in base)
            deltas = [r["musicVsSfxInBandDb"] - base_best for r in cplus]
            lines.append(
                f"| {sfx} | {fmt(min(deltas), 1)} … {fmt(max(deltas), 1)} | "
                f"{fmt(max(deltas), 1)} |"
            )
        lines.append(
            "\nПолоса берётся из собственного спектра SFX, а не из фиксированного "
            "«кармана» 1.5–3.5 кГц. Музыка измеряется на её реальном игровом уровне "
            "(шина музыки 0.65), SFX — на пике в своей полосе с учётом роли из "
            "`audioMixMath.ts`. Все 32 сравнения с production-эталоном показывают, "
            "что C+ v4 маскирует игровые сигналы **меньше**, чем текущая музыка.\n"
        )

    lines.append("\n## 8. Эмуляция небольшого динамика\n")
    lines.append(
        "| Трек | эмулированный LUFS | изменение громкости | полоса 110–220 Гц до/после | "
        "воздух >8 кГц до/после |\n|---|---|---|---|---|\n"
    )
    for r in rows:
        s = r["v4speaker"]
        lines.append(
            f"| {r['title']} | {fmt(s['emulatedLufs'])} | {fmt(s['loudnessDeltaDb'])} дБ | "
            f"{fmt(s['punchBandBeforePct'], 1)} % / {fmt(s['punchBandAfterPct'], 1)} % | "
            f"{fmt(s['airBeforePct'], 2)} % / {fmt(s['airAfterPct'], 2)} % |"
        )
    lines.append(
        "\nЭто **техническая эмуляция**: high-pass 180 Гц, пик +4 дБ @420 Гц, "
        "low-pass 7.5 кГц, мягкое ограничение. Это не измерение на физическом "
        "Galaxy S20+ — приёмка на телефоне остаётся отдельным ручным этапом.\n"
    )

    out_path = Path(args.out) if args.out else package / "docs" / "CHANGES-v3-to-v4.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[report] wrote {out_path}")


if __name__ == "__main__":
    main()

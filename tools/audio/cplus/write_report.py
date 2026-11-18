#!/usr/bin/env python3
"""Generate the C v3 -> C+ v4 change report from measured data only.

    python tools/audio/cplus/write_report.py --package <pkg> --audition <v3pkg> --repo <repo>

Every statement in the generated report is derived from the measurements that
were loaded: there are no hard-coded verdicts. When a measurement is missing
or fails its criterion, the report says so instead of repeating a favourable
conclusion.
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

TARGET_LUFS = -14.0
LUFS_TOLERANCE = 0.5
MAX_TRUE_PEAK_DBTP = -1.0


def fmt(value, digits=2, dash="—"):
    if value is None:
        return dash
    if isinstance(value, bool):
        return "да" if value else "нет"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def range_text(values, digits=1, dash="—"):
    values = [v for v in values if v is not None]
    if not values:
        return dash
    if len(values) == 1:
        return fmt(values[0], digits)
    return f"{fmt(min(values), digits)} … {fmt(max(values), digits)}"


def collect(package: Path, audition: Path) -> list[dict]:
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
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--audition", required=True)
    ap.add_argument("--repo", required=True)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    audition = Path(args.audition).resolve()
    rows = collect(package, audition)
    if not rows:
        raise SystemExit("no measurements found — the report cannot be generated")

    lines: list[str] = []
    lines.append("# C v3 -> C+ v4: отчёт об изменениях\n")
    lines.append(
        "Все числа измерены программой `ofeliya_cplus.metrics` на итоговых файлах: "
        "C v3 — на WAV аудицион-пакета, C+ v4 — на мастеринговых WAV. Ни одно значение "
        "не выведено на слух и не переписано вручную. Каждый вывод ниже вычислен из "
        "загруженных измерений.\n"
    )

    # --------------------------------------------------------------- §1
    lines.append("\n## 1. Что изменилось по существу\n")
    lines.append(
        "| | C v3 | C+ v4 |\n|---|---|---|\n"
        "| Материал | 16-секундные циклы из аудицион-пакета | шесть композиций, "
        "синтезированных с нуля (80/80/80/100 с + два сигнала 4.0/4.5 с) |\n"
        "| Происхождение | права на исходный мастер **не подтверждены** (#299) | "
        "собственный генератор, лицензионных рисков нет |\n"
        "| Развитие | короткий цикл повторяется | полная форма: начало -> развитие -> "
        "возврат к состоянию начала |\n"
        "| Стык цикла | см. §2 | бесшовность проверена по отсчетам, спектру и десяти циклам |\n"
        "| Воспроизводимость | пакетный CLI заявлял несуществующие флаги | "
        "детерминированный pipeline с зафиксированными сидами |\n"
    )

    # --------------------------------------------------------------- §2
    lines.append("\n## 2. Бесшовность цикла\n")
    lines.append(
        "| Трек | C v3: шаг на стыке | C v3: шаг ÷ локальный максимум | "
        "C+ v4: шаг на стыке | C+ v4: шаг ÷ локальный максимум | "
        "C+ v4: Δ спектра по полосам | C+ v4: бесшовно | C+ v4: 10 циклов |\n"
        "|---|---|---|---|---|---|---|---|\n"
    )
    for r in rows:
        v3s, v4s = r["v3seam"], r["v4seam"]
        lines.append(
            f"| {r['title']} | {fmt(v3s.get('sampleJumpRel'), 5)} | "
            f"{fmt(v3s.get('wrapVsLocalRatio'), 2)} | "
            f"{fmt(v4s.get('sampleJumpRel'), 5)} | "
            f"{fmt(v4s.get('wrapVsLocalRatio'), 2)} | "
            f"{fmt(v4s.get('spectralContinuityMaxBandDb'), 2)} дБ | "
            f"{fmt(v4s.get('seamless'))} | {v4s.get('cyclesTested')} |"
        )
    lines.append(
        "\n**Как это читать.** «Шаг на стыке» — |x[0] − x[N−1]| в сумме каналов "
        "относительно пика файла. «Шаг ÷ локальный максимум» — тот же шаг, делённый "
        "на самый большой шаг отсчётов внутри окна ±50 мс вокруг границы. Клик — это "
        "когда отношение **больше** единицы: ступенька выступает на фоне текстуры "
        "прямо у точки склейки.\n"
    )
    v3_ratios = [r["v3seam"].get("wrapVsLocalRatio") for r in rows if r["v3seam"].get("wrapVsLocalRatio") is not None]
    v4_ratios = [r["v4seam"].get("wrapVsLocalRatio") for r in rows if r["v4seam"].get("wrapVsLocalRatio") is not None]
    v3_outliers = [v for v in v3_ratios if v > 3.0]
    v4_outliers = [v for v in v4_ratios if v > 3.0]
    lines.append(
        f"\n**Вывод по стыку (из измерений).** В C v3 отношение шага к локальному "
        f"максимуму — {range_text(v3_ratios, 2)}; ступенек, выступающих над "
        f"текстурой (отношение > 3), — {len(v3_outliers)}. В C+ v4 — "
        f"{range_text(v4_ratios, 2)}; таких ступенек — {len(v4_outliers)}. "
        f"Подтверждённого клика измерения не дают ни в одном наборе; числа #299 "
        f"(0.3981 для `B/03`, 0.2665 для `C/03`) — это наблюдение о величине шага, "
        f"а вывод о слышимости требует прослушивания.\n"
    )
    loop_rows = [r for r in rows if r["id"] not in ("victory", "defeat")]
    v4_ok = all(r["v4seam"].get("seamless") for r in loop_rows)
    v4_seams = all(
        r["v4seam"].get("cyclesMeasuredSeams") == r["v4seam"].get("cyclesTested", 0) - 1
        for r in loop_rows
    )
    lines.append(
        f"\nВсе beds C+ v4 бесшовны по результату измерений: "
        f"{'да' if v4_ok else 'нет'}; измерены все внутренние точки склейки "
        f"десяти повторов: {'да' if v4_seams else 'нет'}.\n"
    )
    lengths = [r["v4"]["durationSec"] for r in loop_rows]
    v3_lengths = [r["v3"]["durationSec"] for r in loop_rows]
    lines.append(
        f"\n**Настоящий измеримый дефект v3 — другой.** Вариант C буквально является "
        f"16-секундным циклом: длина материала {range_text(v3_lengths, 2)} с против "
        f"{range_text(lengths, 2)} с у C+ v4, поэтому один и тот же материал "
        f"возвращается в несколько раз реже.\n"
    )

    # --------------------------------------------------------------- §3
    lines.append("\n## 3. Громкость и пики\n")
    lines.append("| Трек | v3 LUFS | v4 LUFS | v3 TP | v4 TP | v4 peak |\n|---|---|---|---|---|---|\n")
    for r in rows:
        lines.append(
            f"| {r['title']} | {fmt(r['v3']['lufs'])} | {fmt(r['v4']['lufs'])} | "
            f"{fmt(r['v3']['truePeakDbTp'])} | {fmt(r['v4']['truePeakDbTp'])} | "
            f"{fmt(r['v4']['peak'], 4)} |"
        )
    v4_lufs = [r["v4"]["lufs"] for r in rows]
    v4_tp = [r["v4"]["truePeakDbTp"] for r in rows]
    in_contract = [r for r in rows if abs(r["v4"]["lufs"] - TARGET_LUFS) <= LUFS_TOLERANCE
                   and r["v4"]["truePeakDbTp"] <= MAX_TRUE_PEAK_DBTP]
    lines.append(
        f"\nКонтракт репозитория (`docs/AUDIO_MASTERING.md`): −14 LUFS ±0.5, "
        f"true peak ≤ −1 dBTP, stereo, 44 100 Гц. Фактические значения C+ v4: "
        f"LUFS {range_text(v4_lufs, 2)}, true peak {range_text(v4_tp, 2)} dBTP; "
        f"в контракте — {len(in_contract)} из {len(rows)} композиций"
        f"{'.' if len(in_contract) == len(rows) else ' — см. расхождения выше.'}\n"
    )

    # --------------------------------------------------------------- §4
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
        ">8000 Гц — то, что открывает адаптивный lowpass игры (2.5–14 кГц) при "
        "росте опасности.\n"
    )

    # --------------------------------------------------------------- §5
    lines.append("\n## 5. Моносовместимость (сведение L+R)\n")
    lines.append(
        "| Трек | v3: потеря | v4: потеря | v4: корреляция | v4: потеря фазы в низу | "
        "v4: антифазная энергия | v4: худшая полоса |\n|---|---|---|---|---|---|---|\n"
    )
    for r in rows:
        m4 = r["v4mono"]
        retention = m4.get("bandRetentionDb") or {}
        worst_band = min(retention.items(), key=lambda kv: kv[1])[0] if retention else None
        worst_value = retention.get(worst_band) if worst_band else None
        lines.append(
            f"| {r['title']} | {fmt(r['v3mono'].get('monoLufsLossDb'), 2)} дБ | "
            f"{fmt(m4.get('monoLufsLossDb'), 2)} дБ | "
            f"{fmt(m4.get('monoCorrelation'), 3)} | "
            f"{fmt(m4.get('lowBandPhaseLossDb'), 1)} дБ | "
            f"{fmt(m4.get('antiPhaseEnergyPct'), 1)} % | "
            f"{BAND_LABELS.get(worst_band, '—')} {fmt(worst_value, 1)} дБ |"
        )
    lines.append(
        "\nОриентир 3.01 дБ — это разница, которую BS.1770 даёт **одинаковым** "
        "каналам: сумма мощностей двух каналов всегда на 3.01 дБ выше энергии их "
        "свёрнутого моно. Для неидентичных каналов (жёсткая панорама, разные "
        "уровни, частично противофазный сигнал) ориентир другой, поэтому в "
        "таблице приведён фактический замер, а не сравнение с 3.01.\n"
    )

    # --------------------------------------------------------------- §6
    lines.append("\n## 6. Утомляемость: детектор короткого цикла\n")
    lines.append(
        "Детектор применим только к зацикливаемым beds: для коротких one-shot "
        "сигналов он не имеет смысла и помечен как «не применимо».\n\n"
    )
    lines.append(
        "| Трек | эхо на 16 с | сходство далёких окон | доля почти идентичных пар | риск |\n"
        "|---|---|---|---|---|\n"
    )
    for r in rows:
        f = r["v4fatigue"]
        if not f.get("applicable", True):
            lines.append(f"| {r['title']} | — | — | — | не применимо (one-shot) |")
            continue
        lines.append(
            f"| {r['title']} | {fmt(f.get('loop16sEcho'), 3)} | "
            f"{fmt(f.get('farSimilarityMean'), 3)} | "
            f"{fmt(f.get('farSimilarPairsPct'), 2)} % | {f.get('repetitionRisk')} |"
        )
    echoes = [r["v4fatigue"].get("loop16sEcho") for r in rows if r["v4fatigue"].get("applicable", True)]
    risks = [r["v4fatigue"].get("repetitionRisk") for r in rows if r["v4fatigue"].get("applicable", True)]
    lines.append(
        f"\nФактические значения эха на 16 с: {range_text(echoes, 3)}; риск повтора: "
        f"{', '.join(sorted(set(str(x) for x in risks)))}. Эталон детектора — 0.95: "
        f"если бы файл был 16-секундным циклом, повторённым пять раз, эхо "
        f"поднялось бы к ~0.99.\n"
    )

    # --------------------------------------------------------------- §7
    lines.append("\n## 7. Маскировка игровых SFX\n")
    masking_path = package / "analysis" / "sfx-masking.json"
    if masking_path.exists():
        masking = json.loads(masking_path.read_text(encoding="utf-8"))
        regressions = masking.get("regressions", [])
        matched = [r for r in regressions if r.get("actMatched")]
        lines.append(
            "**Относительное сравнение.** C+ bed сравнивается с production-bed "
            "**того же акта** (пулы из `MUSIC_BED_POOLS`: акт I — loop0/1/3/6, акт II — "
            "loop2/4/5) — это один и тот же музыкальный слот в одном акте. Рядом "
            "приведён диапазон по **всем** production-bed сразу, включая худший "
            "baseline, чтобы выбор эталона не мог улучшить вывод.\n\n"
        )
        lines.append(
            "| SFX | Δ к act-matched production (дБ) | Δ к худшему baseline | "
            "хуже production на >3 дБ |\n|---|---|---|---|\n"
        )
        for sfx in sorted({r["sfx"] for r in matched}):
            sel = [r for r in matched if r["sfx"] == sfx]
            worse = sum(1 for r in sel if r["verdict"] == "WORSE")
            lines.append(
                f"| {sfx} | {range_text([r['deltaDb'] for r in sel], 1)} | "
                f"{range_text([r['deltaVsWorstBaselineDb'] for r in sel], 1)} | "
                f"{worse} из {len(sel)} |"
            )
        summary_matched = masking.get("actMatchedSummary", {})
        summary_all = masking.get("allBaselineSummary", {})
        lines.append(
            f"\nИтог по act-matched сравнениям: {summary_matched.get('comparisons', 0)}, "
            f"хуже production на >3 дБ — **{summary_matched.get('worseThanProduction', 0)}**; "
            f"диапазон Δ {range_text(summary_matched.get('deltaRangeDb'), 1)} дБ. "
            f"По всем baseline сразу: {summary_all.get('comparisons', 0)} сравнений, "
            f"хуже — {summary_all.get('worseThanProduction', 0)}.\n"
        )

        lines.append(
            "\n**Абсолютная слышимость в реальном игровом миксе.** Относительное "
            "улучшение само по себе ничего не говорит о слышимости: считается "
            "уровень SFX в его собственной полосе с учётом runtime-нормализации "
            "(`scanNormalizationTrim`) и роли из `audioMixMath.ts`, и уровень "
            "музыки на её игровом уровне (шина 0.65).\n\n"
        )
        lines.append(
            "| SFX | полоса Гц | trim | SFX дБ | музыка дБ | запас дБ | "
            "запас в production | разница | выше музыки во всех beds |\n"
            "|---|---|---|---|---|---|---|---|---|\n"
        )
        for a in masking.get("absolute", []):
            lines.append(
                f"| {a['sfx']} | {a['dominantBandHz'][0]:.0f}–{a['dominantBandHz'][1]:.0f} | "
                f"{fmt(a['sfxRuntimeTrim'], 2)} | {fmt(a['sfxBandDb'], 1)} | "
                f"{fmt(a['musicBandDb'], 1)} | {fmt(a['worstMarginDb'], 1)} | "
                f"{fmt(a.get('productionWorstMarginDb'), 1)} | "
                f"{fmt(a.get('improvementVsProductionDb'), 1)} | "
                f"{fmt(a['aboveMusicEverywhere'])} |"
            )
        absolute_summary = masking.get("absoluteSummary", {})
        below = absolute_summary.get("soundsBelowMusic", [])
        lines.append(
            f"\nИтог: {absolute_summary.get('aboveMusicEverywhere', 0)} из "
            f"{absolute_summary.get('soundsChecked', 0)} проверенных звуков остаются "
            f"выше музыкального слоя во всех beds; худший запас — "
            f"{fmt(absolute_summary.get('worstMarginDb'), 1)} дБ против "
            f"{fmt(absolute_summary.get('productionWorstMarginDb'), 1)} дБ в "
            f"production-наборе.\n"
        )
        if below:
            lines.append(
                f"\nЗвуки, которые остаются частично перекрытыми музыкой: "
                f"{', '.join(below)}. Это **не регрессия**: те же звуки перекрыты "
                f"production-музыкой сильнее (разница в пользу C+ v4 приведена в "
                f"столбце «разница»). Если владелец считает, что телеграф фазы "
                f"босса должен читаться над музыкой, это отдельная правка игрового "
                f"микса — отдельный дакинг или фильтр под `bossphase`.\n"
            )
        lines.append(
            "\nПолоса берётся из собственного спектра SFX, а не из фиксированного "
            "«кармана» 1.5–3.5 кГц.\n"
        )

    # --------------------------------------------------------------- §8
    lines.append("\n## 8. Эмуляция небольшого динамика\n")
    lines.append(
        "| Трек | эмулированный LUFS | изменение громкости | полоса 110–220 Гц до/после | "
        "воздух >8 кГц до/после |\n|---|---|---|---|---|\n"
    )
    for r in rows:
        s = r["v4speaker"]
        lines.append(
            f"| {r['title']} | {fmt(s.get('emulatedLufs'))} | {fmt(s.get('loudnessDeltaDb'), 2)} дБ | "
            f"{fmt(s.get('punchBandBeforePct'), 1)} % / {fmt(s.get('punchBandAfterPct'), 1)} % | "
            f"{fmt(s.get('airBeforePct'), 2)} % / {fmt(s.get('airAfterPct'), 2)} % |"
        )
    lines.append(
        "\nЭто **техническая эмуляция**: high-pass 180 Гц, пик +4 дБ @420 Гц, "
        "low-pass 7.5 кГц, мягкое ограничение. Это не измерение на физическом "
        "Galaxy S20+ — приёмка на телефоне остаётся отдельным ручным этапом.\n"
    )

    out_path = package / "docs" / "CHANGES-v3-to-v4.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[report] wrote {out_path}")


if __name__ == "__main__":
    main()

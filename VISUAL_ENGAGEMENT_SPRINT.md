# OFELIYA — Visual & Engagement Sprint v1

Working branch: `feat/visual-engagement-sprint-v1`

Base snapshot at sprint creation: `main` @ `53ff9979b1f82c75a190462d1a8cb166ca367408`.

## Goal

Turn the current technically working survivor prototype into a release-ready MAX Mini App with a recognizable identity, stronger moment-to-moment presentation and explicit short-term goals inside a five-minute run.

This sprint deliberately avoids boss redesign, difficulty rebalance and large content expansion.

## Product thesis

The current code already has useful juice (hit feedback, combo, particles, bloom, trail, low-HP feedback). The main remaining gap is not raw effect count but identity and anticipation.

Target formula:

`existing gameplay core + cyber-occult identity + 3 evolutions + run milestones + living background + stronger upgrade/result UI`

## Identity

Working fantasy: **OFELIYA is a digital consciousness inside a collapsing system.**

Player-facing vocabulary:

- player: `ЯДРО OFELIYA`
- XP: `ФРАГМЕНТЫ ДАННЫХ`
- level-up: `МОДИФИКАЦИЯ ЯДРА`
- swarm: `ШУМ`
- runner: `ИМПУЛЬС`
- brute: `РАЗРЫВ`
- elite: `АНОМАЛИЯ`

Internal TypeScript/gameplay IDs stay unchanged.

### Shape language

Friendly/core:
- circles, arcs, concentric forms;
- symmetry;
- smooth motion;
- cyan/white.

Hostile/corruption:
- angular/broken silhouettes;
- asymmetry and detached fragments;
- magenta/orange/purple;
- subtle jitter/glitch accents.

Elite/anomaly:
- base silhouette plus broken outer ring/rotating overlay;
- gold/white accent;
- stronger pulse.

## P0 implementation sequence

1. #1 — Identity foundation + procedural sprite pass v2.
2. #2 — AtmosphereSystem + centralized VFX layer.
3. #3 — Upgrade data v2 + mobile upgrade UI.
4. #4 — Three weapon evolutions + reward ceremony.
5. #5 — Run milestones synchronized with current wave phases.
6. #6 — Achievements + run result v2 + fast restart.
7. #7 — Release hardening.

Optional only after P0 is green:

8. #8 — Exploder enemy modifier.

Tracking issue: #9.

## Evolution v1

### ПРИЗМА

Recipe:
- Damage >= 3
- Pierce >= 2

Presentation target:
- brighter/larger projectile;
- visible trail/beam-like read;
- additional penetration/impact identity;
- distinct audio treatment.

### ОРЕОЛ

Recipe:
- Orbit >= 3
- Speed or Rate >= 2

Presentation target:
- blades visually form a defensive ring/segmented halo;
- stronger radius/contact feedback.

### СИНГУЛЯРНОСТЬ

Recipe:
- Nova >= 3
- Magnet >= 2

Presentation target:
1. implosion cue;
2. inward-moving particles;
3. expanding shockwave;
4. unique audiovisual cue.

Evolution is presented as a special choice when the recipe becomes valid. It must not silently auto-award and must not be awarded twice.

## Run milestones

These are presentation events, not balance changes. They align with the current wave composition timeline.

- ~00:45 — `НОВЫЙ СИГНАЛ / ИМПУЛЬС ОБНАРУЖЕН`
- ~01:30 — `СТРУКТУРА ПОВРЕЖДЕНА / РАЗРЫВ ОБНАРУЖЕН`
- 02:00 — first `АНОМАЛИЯ` presentation
- 03:00 — `СИСТЕМА ПЕРЕГРУЖЕНА` + atmosphere shift
- 04:00 — `КРИТИЧЕСКИЙ УРОВЕНЬ` + stronger atmosphere shift

Do not change spawn interval, boss timing or enemy stats in this sprint.

## Achievements v1

Local-only for first release:

- `ПЕРВЫЙ КОНТАКТ` — 50 kills in one run.
- `НЕПРЕРЫВНЫЙ ПОТОК` — combo x20.
- `СТАБИЛЬНОЕ ЯДРО` — survive 60 seconds without damage.
- `АДАПТАЦИЯ` — first evolution.
- `ГЛУБОКОЕ ПОГРУЖЕНИЕ` — survive to 03:00.
- `ОЧИСТКА` — 500 lifetime kills.
- `ПОВТОРНЫЙ ЗАПУСК` — 3 runs.
- `ПОЛНЫЙ ПРОТОКОЛ` — obtain all three evolutions across history.

Save changes must be backward compatible with the existing local save.

## Target architecture

```text
src/
├── game/
│   ├── RunState.ts
│   ├── UpgradeSystem.ts
│   ├── EvolutionSystem.ts       NEW
│   ├── AchievementSystem.ts     NEW
│   ├── RunMilestones.ts         NEW
│   ├── identity.ts              NEW
│   ├── WaveDirector.ts
│   └── config.ts
├── systems/
│   ├── AtmosphereSystem.ts      NEW
│   ├── VfxSystem.ts             NEW
│   ├── MaxBridge.ts
│   ├── SaveSystem.ts
│   └── Sfx.ts
└── scenes/
    ├── BootScene.ts
    ├── GameScene.ts
    ├── MenuScene.ts
    └── UIScene.ts
```

`GameScene` should orchestrate these systems rather than absorb their implementation details.

## OSS references

Primary references:

1. `giovanneluna/poke-survivors`
   - Phaser 3.90 + TypeScript/Vite match.
   - Upgrade/evolution architecture, VFX guards, particle lifecycle, spatial hash and UI patterns.

2. `AlexanderHeffernan/TheLastLight`
   - Phaser 3 + TypeScript/Vite.
   - Atmosphere, silhouette readability, transient lighting and encounter presentation.

3. `ricardo-foundry/canvas-vampire-survivors`
   - Weapon evolutions, named wave windows, achievements, run-loop/replayability patterns.

4. `077bei002aadarsha-blip/neon-swarm`
   - Parallax, ambient particles, milestone feedback, bounded effects and survivor-specific combat ideas.

5. `jshields-ca/deadlinedread`
   - Strong theme applied to otherwise familiar survivor mechanics; procedural backgrounds and enemy readability.

6. `bicarbon8/phaser-ui-components`
   - Phaser 3 card/layout hierarchy reference for upgrade UI.

7. `Giftedx/wild-haggis-survivors`
   - Procedural-art identity, shape language and project voice reference. Do not port Phaser 4 architecture into this sprint.

## Licensing rules

- Copy or adapt source only from repositories whose license explicitly permits it.
- Preserve MIT copyright/license notices for substantial copied portions.
- Do not copy Pokémon or other third-party IP assets/names from donor projects.
- Do not copy code from repositories with no usable license or All Rights Reserved status.
- Treat third-party audio/art licenses separately from source-code licenses.

## Explicitly out of scope

- boss redesign;
- difficulty tuning;
- multiple maps;
- character/class selection;
- full meta-progression or inventory;
- backend leaderboard/cloud save;
- deterministic replay/anti-cheat;
- Phaser 4 migration;
- heavy shader pipeline;
- large weapon/enemy content expansion.

## Release cut line

If schedule pressure increases, keep:
- identity;
- sprite pass;
- atmosphere;
- upgrade UI;
- three evolutions + ceremony;
- milestones;
- run result + fast restart;
- release QA.

Cut first:
- Exploder;
- advanced settings;
- chain lightning/new weapons;
- elaborate lighting/shader work.

## Definition of done

- OFELIYA is recognizable from a gameplay screenshot.
- Three ordinary enemy silhouettes are clearly distinguishable on mobile.
- Arena has restrained motion/depth without compromising readability.
- Upgrade screen communicates progression and evolution readiness.
- Three evolutions exist and visibly transform their attacks.
- Run contains several one-shot presentation milestones before the boss.
- Result screen shows build/evolutions/records/rewards.
- Restart is immediate (no more than two actions, preferably one).
- Existing MAX integration is not regressed.
- `npm run build` passes.
- Repeated scene restarts show no obvious listener/timer/particle leak.
- Late-run combat remains playable with the new visual layer enabled.

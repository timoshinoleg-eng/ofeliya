# OFELIYA: STRAIN ZERO — Product Bible v1

## One-line hook

**Ты — неизвестный вирус. Организм только что тебя обнаружил. Мутируй быстрее, чем иммунитет адаптируется.**

## Product promise

A five-minute one-thumb survivor run set inside a living organism. The player is OFELIYA / STRAIN-0, a synthetic virus that starts almost unnoticed and becomes visibly more dangerous as the host escalates its immune response.

The redesign is not a cosmetic reskin. Every system must reinforce the same fantasy:

`infiltration -> detection -> mutation -> immune escalation -> critical mutation -> IMMUNE PRIME`

## Audience and release order

1. MAX Mini App first.
2. Telegram Mini App second through a platform adapter, not a gameplay fork.
3. Primary device: smartphone portrait orientation.
4. Core interaction: one thumb; automatic attack; no second virtual stick.

## First-session engagement targets

- first hostile presence: <= 2 seconds after run start;
- first kill: <= 4 seconds;
- first RNA pickup: <= 6 seconds;
- first mutation choice: around <= 12 seconds;
- first visible immune escalation: <= 20 seconds;
- no dead period longer than ~20–30 seconds without a new enemy type, mutation, infected-cell opportunity, milestone or strong presentation beat.

These are product targets, not guarantees that justify hidden cheating. If telemetry later shows they are missed, tune spawn/XP/onboarding deliberately.

## Core fantasy

The host initially does not understand what entered its bloodstream. As the virus replicates and mutates, the immune system progressively identifies it and deploys stronger responses.

The player should feel two simultaneous curves:

1. **I am becoming a monster.**
2. **The organism is waking up because of me.**

The visual state at 4:30 must be obviously different from 0:05 even in a silent screen recording.

## Vocabulary

### Player

- `OFELIYA / STRAIN-0`
- generic noun: `ШТАММ`

### Progression

- XP: `ФРАГМЕНТЫ РНК`
- level-up: `МУТАЦИЯ`
- run: `ЦИКЛ ЗАРАЖЕНИЯ`
- upgrades: `МУТАЦИИ`
- evolutions: `КРИТИЧЕСКИЕ МУТАЦИИ`

### Hostile roles

Internal gameplay IDs stay stable for now.

| Internal id | Player-facing identity |
|---|---|
| `swarm` | `АНТИТЕЛО` |
| `runner` | `T-КИЛЛЕР` |
| `brute` | `МАКРОФАГ` |
| elite modifier | `NK-КЛЕТКА` |
| `boss` | `IMMUNE PRIME` |

### Existing evolutions -> critical mutations

| Internal id | New identity |
|---|---|
| `prism` | `ГИПЕРШИП` |
| `halo` | `СВЕРХКАПСИД` |
| `singularity` | `ЛИЗИС` |

Internal IDs remain unchanged until there is a compelling migration reason.

## Mutation families

### АГРЕССИЯ
Damage, attack rate, penetration, multiple projectiles.

### ЗАЩИТА
Capsid strength, regeneration, survivability.

### РАСПРОСТРАНЕНИЕ
Movement and reach through the organism.

### АДАПТАЦИЯ
Collection range and host-interaction utility.

## Signature mechanic: host-cell infection

This is the main gameplay feature that should make Strain Zero more than a survivor skin.

Neutral host cells periodically appear in the arena.

1. The player approaches a host cell.
2. Contact/proximity fills an infection meter.
3. The cell visibly changes from healthy -> compromised -> infected.
4. At full infection it undergoes **lysis**.
5. Lysis releases RNA and a radial viral burst that damages nearby immune cells.
6. Later mutations can alter infection speed, burst radius, replication count or rewards.

The mechanic must remain one-thumb friendly. No extra attack/interact button.

## Five-minute immune escalation

Presentation and enemy composition must tell a story.

- `0:00` — `НЕ ОБНАРУЖЕН`
- `~0:15` — `ЧУЖЕРОДНАЯ РНК ОБНАРУЖЕНА`
- `~0:45` — `ИММУННЫЙ ОТВЕТ АКТИВИРОВАН`
- `~1:30` — `T-КЛЕТКИ ПОДКЛЮЧЕНЫ`
- `2:00` — `АДАПТИВНЫЙ ИММУНИТЕТ`
- `3:00` — stronger NK response / vascular agitation
- `4:00` — `КРИТИЧЕСКАЯ ИММУННАЯ РЕАКЦИЯ`
- `5:00` — `IMMUNE PRIME`

Do not make every beat a blocking banner. Use background, audio, enemy silhouettes, lighting and short copy together.

## Visual direction

### Target

**Premium microscopic biopunk.**

Avoid:

- gore realism;
- cartoon smiling cells;
- flat neon geometry that looks like a generic cyber arena;
- shader-heavy effects that break mid-range Android performance;
- visual noise that hides hitboxes.

### World layers

1. Deep tissue / vessel background.
2. Slow large erythrocytes and membrane forms.
3. Gameplay plane: virus, immune cells, host cells, RNA.
4. Sparse foreground cells/particles with soft blur/parallax.

### Color language

- host environment: burgundy, crimson, amber, warm plasma;
- immune system: ivory, pale cyan, cold white/blue;
- OFELIYA: toxic violet, magenta, controlled acid accents;
- rewards/RNA: bright readable accent distinct from hostile white/cyan.

### Readability rule

At phone size and 150 active enemies, the player, hostile classes, neutral host cells and collectible RNA must be distinguishable by silhouette before color.

## Player visual evolution

OFELIYA cannot remain the same sprite for the full run.

Base form:

- central RNA core;
- semi-transparent capsid;
- protein spikes;
- subtle breathing/pulsing and rotation.

Mutation states add visible structure without changing the collision contract silently.

Critical mutations must materially alter silhouette:

- `ГИПЕРШИП`: longer/aggressive protein spikes and piercing trail;
- `СВЕРХКАПСИД`: layered rotating protective shell;
- `ЛИЗИС`: implosion cue + membrane-like expanding shockwave.

## Mobile control principles

- floating joystick appears under the thumb;
- automatic attack remains mandatory for v1;
- no permanent fixed left joystick unless testing proves floating input inferior;
- ignore touches in HUD/modal safe areas;
- clamp joystick origin away from physical screen edges;
- dynamic joystick radius for narrow/short devices;
- no browser scroll/zoom during gameplay;
- mutation cards and result CTA must be thumb-sized and readable without precise tapping.

## Platform architecture

Gameplay must depend on `PlatformBridge`, not directly on MAX or Telegram globals.

Required common capabilities:

- host kind;
- user context;
- signed `initData` string;
- start payload;
- viewport;
- native back button;
- haptics;
- share/challenge surface.

Security rule: parsed init data is convenience context only. Identity and competitive server actions require validation of the signed payload on a trusted backend.

## Result screen

The result should summarize the strain, not only generic stats.

Example:

- `ШТАММ X-17`
- survived / boss-clear time;
- immune cells destroyed;
- host cells infected;
- critical mutations;
- best combo;
- newly discovered mutations;
- primary CTA: `ЕЩЁ ОДИН ЦИКЛ`;
- secondary CTA: `БРОСИТЬ ВЫЗОВ` once challenge payload plumbing exists.

## Performance contract

The professional look must come from art direction, layering, animation and bounded effects, not expensive brute-force rendering.

- preserve object pools;
- keep ambient particle counts bounded;
- avoid per-enemy heavy postFX;
- maintain reduced-effects path for weaker devices;
- profile dense combat at 50 / 150 / late-run enemy counts;
- treat UI responsiveness and touch latency as release blockers.

## P0 implementation order

1. VIR-01 product bible / vocabulary.
2. VIR-02 first 15 seconds.
3. VIR-03 platform bridge.
4. VIR-04 virus visual states.
5. VIR-05 bloodstream environment.
6. VIR-06 immune silhouettes.
7. VIR-07 mutation presentation.
8. VIR-08 critical mutation presentation.
9. VIR-09 host-cell infection + lysis.
10. VIR-10 immune response timeline.
11. VIR-11 joystick v2 / safe areas.
12. VIR-12 biological soundscape/haptics.
13. VIR-13 result/challenge shell.
14. VIR-15 performance tiers.
15. VIR-16 MAX release QA.
16. VIR-17 Telegram adapter QA after MAX release candidate is stable.

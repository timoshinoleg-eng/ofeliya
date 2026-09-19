# OFELIYA: STRAIN ZERO — Product Bible v2

## One-line hook

**Ты — неизвестный вирус. Организм только что тебя обнаружил. Мутируй быстрее, чем иммунитет адаптируется.**

## Product promise

A portrait mobile survivor campaign inside a living organism. The player is OFELIYA / STRAIN-0, a synthetic virus that starts almost unnoticed and becomes visibly more dangerous while the host escalates its immune response.

The current live campaign is two acts:

`КРОВОТОК -> IMMUNE PRIME -> СЕРДЦЕ -> CARDIAC TITAN`

The design is not a cosmetic reskin. Every major system should reinforce:

`infiltration -> detection -> mutation -> infection -> immune escalation -> critical mutation -> boss adaptation -> organ transition`

## Audience and release order

1. MAX Mini App first.
2. Telegram Mini App second through the platform adapter, not a gameplay fork.
3. Primary device: smartphone portrait orientation.
4. Default interaction: one-hand floating joystick + automatic attack.
5. Optional interaction: two-hand twin-stick, with left movement and right aim-priority. Automatic attack remains mandatory.

The one-hand profile is the accessibility/default contract and must remain fully playable by itself.

## Campaign structure

### Act I — КРОВОТОК

- target timeline: 5:00 before boss;
- immune escalation through antibodies, T-killers, macrophages and elite/NK response;
- signature systemic objective: infect host cells and trigger lysis;
- boss: `IMMUNE PRIME`.

### Act II — СЕРДЦЕ

- target timeline: 4:00 before boss;
- stronger enemy mix;
- heartbeat telegraphs and positional timing windows;
- boss: `CARDIAC TITAN`.

Run-wide identity survives the organ transition, while stage-local combat progression resets. The final result must show the actual two-stage build history, not only Heart state.

## First-session engagement targets

- first hostile presence: <= 2 seconds after run start;
- first kill: <= 4 seconds;
- first RNA pickup: <= 6 seconds;
- first mutation choice: around <= 12 seconds;
- first visible immune escalation: <= 20 seconds;
- no dead period longer than ~20–30 seconds without a new enemy behavior, mutation, infected-cell opportunity, milestone or presentation beat.

These are product targets, not hidden guarantees.

## Core fantasy

The player should feel two simultaneous curves:

1. **I am becoming a monster.**
2. **The organism is learning how to stop me.**

The visual/gameplay state in late Bloodstream and late Heart must be recognizably different from the first seconds even in a silent recording.

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
- highest rarity: `ЛЕГЕНДАРНЫЕ`

### Hostile roles

Internal gameplay IDs stay stable.

| Internal id | Player-facing identity | Behavior contract |
|---|---|---|
| `swarm` | `АНТИТЕЛО` | predictive interception |
| `runner` | `T-КИЛЛЕР` | wind-up -> locked charge -> recovery |
| `brute` | `МАКРОФАГ` | close wind-up -> heavy burst -> recovery |
| elite modifier | `NK-КЛЕТКА` | adaptive modifier |
| Bloodstream boss | `IMMUNE PRIME` | pressure-wave phases |
| Heart boss | `CARDIAC TITAN` | heartbeat phases |

### Critical mutations

| Internal id | Identity |
|---|---|
| `prism` | `ГИПЕРШИП` |
| `halo` | `СВЕРХКАПСИД` |
| `singularity` | `ЛИЗИС` |

## Mutation families

### АГРЕССИЯ

Damage, attack rate, penetration, multiple projectiles, lysis damage.

### ЗАЩИТА

Capsid strength, regeneration, survivability.

### РАСПРОСТРАНЕНИЕ

Movement, infection reach and movement through the organism.

### АДАПТАЦИЯ

Collection, host-cell economy and interaction utility.

## Signature mechanic: host-cell infection

Host-cell infection is a buildable combat/economy system, not decorative scenery.

1. The player approaches a host cell.
2. Proximity fills infection.
3. The cell changes healthy -> compromised -> infected.
4. Full infection triggers **lysis**.
5. Lysis releases RNA and damages nearby immune cells.
6. The build can modify infection speed/radius, lysis damage/radius and RNA yield.

Live mutation line:

- `РЕЦЕПТОРНЫЙ ЗАХВАТ` — faster/wider infection;
- `ЦИТОЛИЗ` — stronger/wider lysis;
- `ВИРУСНАЯ ФАБРИКА` — higher RNA yield plus lysis scaling.

The bounded cell pool may recycle only old/far, nearly untouched cells so the mechanic follows the player without deleting meaningful infection progress.

Against `IMMUNE PRIME`, host-cell lysis is intentionally a stronger answer, making the Bloodstream boss test the stage’s signature mechanic.

## Bloodstream immune escalation

- `0:00` — `НЕ ОБНАРУЖЕН`
- `~0:15` — `ЧУЖЕРОДНАЯ РНК ОБНАРУЖЕНА`
- `~0:45` — `ИММУННЫЙ ОТВЕТ АКТИВИРОВАН`
- `~1:30` — `T-КЛЕТКИ ПОДКЛЮЧЕНЫ`
- `2:00` — `АДАПТИВНЫЙ ИММУНИТЕТ`
- `3:00` — systemic response
- `4:00` — `КРИТИЧЕСКАЯ ИММУННАЯ РЕАКЦИЯ`
- `5:00` — `IMMUNE PRIME`

Do not make every beat a blocking banner. Use background, audio, silhouettes, lighting, haptics and short copy together.

## Heart signature: synchronization

Heart must not feel like “Bloodstream with a red background.”

Heartbeat telegraphs create a nearby diastole safe pocket. If the player reaches it before impact:

- temporary pressure is neutralized;
- a short projectile/lysis opportunity window opens;
- `РИТМ МИОКАРДА` can trigger if owned;
- `CARDIAC TITAN` becomes more vulnerable during that opportunity.

Missing the pocket preserves the normal pressure consequence.

The mechanic must work identically with one-hand and two-hand controls.

## Boss principles

Bosses are mechanic exams, not HP walls.

### IMMUNE PRIME

- telegraphed radial pressure attack;
- second phase around half HP;
- faster/larger pressure pattern in phase 2;
- lysis is a meaningful counterplay path.

### CARDIAC TITAN

- uses Heart rhythm language;
- stronger movement/body pulse in phase 2;
- successful heartbeat synchronization creates explicit vulnerability.

## Legendary contract

Legendary is the top rarity inside the existing progression flow.

- maximum **2 per run**;
- no duplicates;
- stage/prerequisite gating;
- pity after 8 eligible missed offers;
- at most one random Legendary before the first boss;
- the second slot is protected for the `IMMUNE PRIME` trophy so RNG cannot erase the reward.

Live Legendary mechanics:

- `ГЕОМЕТРИЯ РАСКОЛА`;
- `ЦЕПЬ ЛИЗИСА`;
- `НУЛЕВАЯ ТОЧКА`;
- `ХИЩНИК ЯДРА`;
- `РИТМ МИОКАРДА`;
- `ПОСЛЕДНИЙ НОСИТЕЛЬ`.

Legendary effects should change decisions or screen behavior, not only add a percentage.

## Difficulty

Two live profiles:

### STANDARD

Baseline campaign.

### STRAINED

A real gameplay variant:

- stronger/faster enemies;
- tighter spawn cadence and larger batches;
- higher enemy cap;
- more frequent elites;
- elite modifiers: regenerator / frenzied / volatile;
- stronger bosses and denser boss minions;
- accelerated/stronger Heart pressure.

Difficulty is selected before the run and persisted independently.

## Visual direction

### Target

**Premium microscopic biopunk.**

Avoid:

- gore realism;
- cartoon smiling cells;
- generic cyber-arena neon geometry;
- full-screen blur that destroys silhouettes;
- shader-heavy effects that break mid-range Android;
- visual noise that hides hitboxes.

### World layers

1. Deep tissue / vessel background.
2. Large erythrocytes, fibres and membrane structures.
3. Gameplay plane: virus, immune cells, host cells, RNA.
4. Sparse foreground/parallax elements.
5. Event-only cinematic key art for major beats.

### Color language

- host environment: burgundy, crimson, amber, warm plasma;
- immune system: ivory, pale cyan, cold white/blue;
- OFELIYA: violet/magenta with controlled toxic accents;
- rewards/RNA: bright accent clearly separated from hostile cyan/white.

### Readability rule

At phone size under **100 / 150 / 200 active-enemy QA scenes**, the following must still be distinguishable:

- player;
- hostile classes;
- elite marker/corona;
- healthy host cell;
- infected host cell;
- RNA pickup;
- projectile.

Silhouette and motion should carry identification before color.

## Player visual evolution

OFELIYA should not remain visually static for the campaign.

Critical mutations materially alter silhouette:

- `ГИПЕРШИП`: aggressive spikes and piercing trail;
- `СВЕРХКАПСИД`: layered protective shell;
- `ЛИЗИС`: implosion cue + expanding membrane shockwave.

Collision contracts must not silently change with cosmetic form.

## Cinematic presentation

Major beats can temporarily become more illustrative without turning the game into video.

Current key-art beats:

- Bloodstream -> Heart transition;
- `IMMUNE PRIME` reveal;
- `CARDIAC TITAN` reveal;
- victory.

The art is generated once as lightweight textures and animated with restrained zoom/parallax. Transition presentation remains skippable; boss reveals remain non-blocking.

## Mobile controls

### One hand — default

- preserve the established floating joystick behavior;
- joystick appears under the active thumb;
- safe areas prevent HUD/modal touches from driving movement;
- automatic attack.

### Two hands — optional

- separate profile chosen before the run;
- left thumb: movement;
- right thumb: broad aim-priority sector;
- no manual fire button;
- releasing right aim returns to normal auto-targeting.

No mutation, boss or Heart mechanic may require two-hand mode.

## Platform architecture

Gameplay depends on `PlatformBridge`, not directly on MAX or Telegram globals.

Common capabilities:

- host kind;
- user context;
- signed `initData`;
- start payload;
- viewport;
- native back button;
- haptics;
- share/challenge surface.

Parsed init data is convenience context only. Identity and competitive server actions require trusted backend validation.

## Result screen

The result summarizes the full strain identity:

- survival / campaign clear time;
- immune cells destroyed;
- host cells infected;
- run-wide highest mutation level;
- critical mutations;
- acquired Legendary names;
- Bloodstream build;
- Heart build;
- best combo;
- achievements;
- challenge verdict when relevant.

Primary replay CTA remains `ЕЩЁ ОДИН ЦИКЛ`.

## Performance contract

Professional presentation must come from art direction, layering, bounded effects and readable motion.

- preserve object pools;
- keep ambient particle counts bounded;
- no per-enemy heavy postFX;
- reduced-effects path must not change gameplay;
- dense visual QA at 100 / 150 / 200 active enemies;
- test WebGL High-DPI and Canvas fallback;
- touch latency and mobile bounds are release blockers.

## Current implementation priorities after this contract

1. tune balance from actual full-run playtests;
2. verify one-hand and twin-stick ergonomics on real MAX Android/iOS clients;
3. inspect 100/150/200 density captures for readability regressions;
4. validate boss phase pacing and Heart safe-pocket timing by playtest, not only CI;
5. keep documentation and deterministic contracts updated with every systemic change;
6. add further organs/meta-progression only as separate design migrations.

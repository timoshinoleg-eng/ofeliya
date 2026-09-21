# OFELIYA: STRAIN ZERO — current architecture notes

Current contract: post control-mode, Legendary, difficulty, Heart timing, infection-build, boss-phase, trusted-score, renderer-clarity and Codex/mastery passes.

## Ownership

- `GameScene` owns live combat orchestration, Phaser pools, collision hooks, level-up queue, stage transitions, Heart timing opportunities and boss attack callbacks.
- `RunState` owns run-wide records plus resettable stage combat progression, infection/lysis tuning, Legendary ownership and per-stage build snapshots.
- `StageDirector` is the pure lifecycle authority for `Bloodstream -> Heart -> run-end`.
- `WaveDirector` owns stage-local spawn composition, normal caps and boss/minion cadence.
- `DifficultyProfile` owns `STANDARD` / `STRAINED` multipliers, elite modifiers and accelerated Heart timing.
- `UpgradeSystem` owns ordinary mutations, including the infection archetype.
- `EvolutionSystem` owns critical-mutation offer priority.
- `LegendarySystem` owns Legendary eligibility, pity, weighted selection and the first-boss trophy reservation.
- `HeartbeatPulseDirector` remains deterministic and owns Heart telegraph/impact/pressure timing. Positional safe-pocket resolution is scene-level gameplay.
- `HostCellSystem` owns the bounded host-cell pool and reads live infection/lysis tuning through a callback.
- `Joystick` is the established one-hand implementation and must remain behaviorally stable.
- `TwinStickControls` is a separate optional two-hand profile: left movement, right aim-priority, automatic fire.
- `ControlMode` persists control selection independently of save progression.
- `VfxSystem` owns bounded combat emitters; `AtmosphereSystem` owns preallocated ambient presentation.
- `Sfx` owns the single game `AudioContext`, mute state, user-gesture unlock and the whole audio graph (`master`, SFX bus, music bed, music tension filter, procedural layer bus).
- `AdaptiveAudioDirector` is an audio **observer**: it consumes `StageDirector`/`HeartbeatPulseDirector` events plus a throttled danger snapshot and decides *when* the mix changes. It never owns lifecycle state, gameplay values or the audio graph.
- `adaptiveAudioMath` is the pure, Phaser-free/WebAudio-free mood model (danger blend, asymmetric smoothing, hysteresis, deterministic bed choice). It is unit-tested in plain Node by `npm run test:audio`.
- `SfxAdaptiveSink` is the only bridge between the director and `Sfx`, which keeps the director testable with a fake sink.
- `CinematicTextures` creates lightweight runtime key art used by stage/boss/victory presentation.
- `SaveSystem` owns the backward-compatible `ofeliya_save_v1` schema, including discovery history and non-power Standard/Strained mastery.
- `server/index.mjs` owns trusted MAX score validation, ruleset/campaign-version checks and ranked leaderboard/daily-stat endpoints.

## Campaign contract

Live order:

1. `КРОВОТОК` — 5:00 until `IMMUNE PRIME`.
2. `СЕРДЦЕ` — 4:00 until `CARDIAC TITAN`.

Stage transitions preserve run-wide records while resetting stage-local combat progression. The result contract archives Bloodstream and Heart builds separately and keeps run-wide highest level plus acquired Legendary IDs.

## Controls

### One hand

Default profile. Uses the original floating `Joystick.ts` path unchanged. Automatic attack remains mandatory.

### Two hands / twin-stick

Optional profile selected in the menu and persisted in local storage.

- left half: floating movement stick;
- right half: aim-priority stick;
- right stick biases auto-target selection inside a broad sector;
- releasing it returns to ordinary nearest-enemy targeting;
- attack remains automatic.

No gameplay system may require the two-hand profile.

## Combat readability and roles

Existing enemy IDs stay stable, but movement roles are behaviorally distinct:

- `swarm`: predictive interception;
- `runner`: pursuit -> telegraphed wind-up -> locked charge -> recovery;
- `brute`: close-range wind-up -> heavy burst -> long recovery.

Bosses are no longer oversized pursuers:

- `IMMUNE PRIME`: two pressure-wave phases; stronger/faster below ~52% HP. Host-cell lysis is intentionally effective against it.
- `CARDIAC TITAN`: two Heart-pressure phases; successful Heart synchronization creates a vulnerability window.

## Host-cell infection build

Base behavior is unchanged at zero stacks, but the signature mechanic is now part of buildcraft.

Stage-local stats:

- infection speed;
- infection radius;
- lysis damage;
- lysis radius;
- RNA yield.

Mutations:

- `РЕЦЕПТОРНЫЙ ЗАХВАТ`;
- `ЦИТОЛИЗ`;
- `ВИРУСНАЯ ФАБРИКА`.

The host-cell pool may recycle only old/far, nearly untouched cells so the mechanic follows the player without deleting actively infected cells.

## Heart timing loop

Heartbeat pressure is not only a passive speed multiplier.

A telegraph creates a nearby diastole safe pocket. Reaching it before impact:

- neutralizes temporary pressure during the synchronized window;
- opens a short projectile/lysis opportunity window;
- enables `РИТМ МИОКАРДА` if owned;
- makes `CARDIAC TITAN` explicitly more vulnerable.

Missing the pocket preserves the existing pressure consequence.

## Legendary contract

Legendary remains a rarity layer in the normal progression flow, not a parallel inventory system.

Rules:

- maximum **2 per run**;
- duplicates rejected;
- stage/prerequisite gating;
- pity after 8 eligible missed offers;
- maximum one random Legendary before the first boss;
- the second run-wide slot is reserved so the `IMMUNE PRIME` trophy cannot disappear because of pre-boss RNG;
- injected RNG is used by deterministic tests.

Implemented mechanics:

- Geometry Split;
- Lysis Chain;
- Zero Point;
- Core Predator;
- Myocardial Rhythm;
- Last Carrier.

## Difficulty

`STANDARD` preserves the baseline campaign.

`STRAINED` is live and selectable before the run. It changes gameplay, not just score labels:

- stronger/faster enemies;
- shorter spawn intervals and larger batches;
- higher normal-enemy cap;
- more frequent elites;
- elite modifiers: regenerator / frenzied / volatile;
- stronger bosses and more boss minions;
- accelerated/stronger Heart pressure.

Difficulty selection is persisted separately from the main save.

## Presentation

The renderer remains Phaser-only. No GSAP, Matter.js, tsParticles or second renderer is introduced.

Clarity rules now deliberately reduce excessive Bloom and baked glow while retaining antialiasing and curved biological silhouettes.

Cinematic presentation uses small generated `CanvasTexture` key-art frames for:

- Bloodstream -> Heart;
- `IMMUNE PRIME`;
- `CARDIAC TITAN`;
- campaign victory.

They are reused with lightweight zoom/parallax and do not add video payload.

## Adaptive audio contract

V1 replaces "one random licensed loop per lifecycle plus a bio pulse driven by stage elapsed time" with a deterministic, event-aware foundation:

- **one bed per run**, chosen by hashing the run seed (never `RunRng`, so the gameplay RNG consumption order is untouched);
- **danger** = weighted nearby hostile pressure (distance-decayed, elite-weighted, bosses excluded) + HP loss + boss pressure + a small stage-order bias. No stage-elapsed-time term;
- **hysteresis**: asymmetric attack/release smoothing (350 ms up / 2200 ms down), separate enter/exit bounds per band, 1500 ms minimum dwell on downgrades only;
- **moods**: `calm -> pressure -> danger -> critical`, with `boss` taken whenever a boss is active and `transition`/`ended` held by lifecycle events;
- **tension** is expressed on the existing bed through a lowpass opening with danger plus gain ducking, and through procedural stingers/heartbeat layers — the seven CC0 loops have no proven musical compatibility, so arbitrary mid-run crossfades are explicitly out of scope for V1;
- **Heart** locks the bio pulse to `theme.heartbeatMs` (900 ms) and fires the heartbeat layer from the real `heartbeat-telegraph` / `heartbeat-impact` events;
- **lifecycle**: mute, `visibilitychange` suspend/resume, and a full release on run teardown (scene shutdown, run restart, menu exit).

The run's danger snapshot is published to `registry['adaptiveAudio']` for on-device debugging.

## Pools / caps

- Bullets: 160.
- Enemies: 260.
- Gems: 220.
- Bloodstream/Heart normal enemy cap: 240 before difficulty modifiers.
- Damage text and trails are fixed pools.
- Ambient particles are preallocated.
- Combat VFX uses pre-created emitters and a global budget.
- Long-lived audio nodes are bounded: one `AudioContext`, one music filter, one layer bus, one bio oscillator. Stingers/heartbeat are transient oscillators disconnected on `ended`.

## Quality gates

Deterministic checks cover challenge compatibility, save migration, stage lifecycle, Legendary rules, difficulty, viewport math, adaptive-audio mood/lifecycle behaviour and startup renderer behavior.

Browser smoke covers MAX mobile viewport, Codex/mastery, compact layouts, WebGL/Canvas fallback, Legendary runtime, STRAINED, campaign transition and dense readability. A dedicated control-mode smoke locks the legacy one-hand `Joystick` path and dispatches two simultaneous Chromium touch points to verify independent twin-stick movement/aim vectors and clean release reset.

Dense readability contract produces captures at **100 / 150 / 200 active enemies** while also keeping player anchor, elite marker, RNA, projectile, healthy host cell and partially infected host cell in the same scene.

A dedicated release visual matrix runs **100 / 150 / 200 × WebGL/Canvas × full/reduced** and compares luminance plus edge energy so renderer/tier regressions cannot silently make dense combat darker or softer.

## Still deferred

The next major additions should be treated as separate migrations rather than silently folded into hot loops:

- additional campaign organs/stages;
- telemetry-driven balance tuning and real-device balance calibration;
- additional competitive modes beyond the current trusted score/ruleset contract;
- permanent stat-power meta progression;
- broader external art/audio pipeline only if it preserves current mobile performance and provenance rules.

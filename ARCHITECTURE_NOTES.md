# OFELIYA: STRAIN ZERO — architecture notes for Legendary/Impact V1

Base inspected: `main@f0d5295a4c210507cac0f0a8ef0a5fee2f2daed8` after PR #37.

## Ownership

- `GameScene` owns live combat orchestration, Phaser pools, collision hooks, level-up queue, hit-stop and stage-world reset.
- `RunState` owns run-wide records plus resettable stage combat progression.
- `StageDirector` is the pure lifecycle authority for Bloodstream → Heart → boss/run-end transitions.
- `WaveDirector` owns stage-local spawn composition and boss/minion cadence.
- `UpgradeSystem` owns ordinary upgrade definitions; `EvolutionSystem` reserves critical-mutation offer slots.
- `HeartbeatPulseDirector` is deterministic and owns Heart telegraph/impact/pressure timing.
- `HostCellSystem` owns the bounded interactive host-cell pool and emits lysis events back to `GameScene`.
- `VfxSystem` owns bounded combat particle emitters; `AtmosphereSystem` owns preallocated ambient presentation.
- `SaveSystem` owns the backward-compatible `ofeliya_save_v1` schema. This V1 Legendary slice intentionally does not alter persisted save/challenge semantics.

## Hot loops

- `GameScene.update`: movement, fire, orbit, nova, stage events, wave, host cells, atmosphere.
- `Enemy.preUpdate`: pursuit/role motion and pooled elite/boss presentation.
- `AtmosphereSystem.update`: preallocated ambient cells/particles.
- `HostCellSystem.update`: bounded pooled cells.

Legendary runtime hooks are query-based (`RunState.hasLegendary`) and do not register persistent listeners. Restart/stage reset cannot leave event subscriptions behind.

## Existing pools / caps

- Bullets: 160.
- Enemies: 260.
- Gems: 220.
- Damage text and trails are fixed pools.
- Ambient particles are preallocated.
- Combat VFX uses four pre-created Phaser emitters.

V1 adds a global token-bucket `VfxBudget` so multiple systems cannot independently exhaust presentation headroom.

## Legendary V1 integration

Legendary is a third rarity layered into the existing upgrade/evolution offer flow instead of a parallel modal/registry.

Rules:
- max 3 per run;
- duplicates rejected by `RunState`;
- Heart-only gating;
- prerequisite gating for build-linked Legendaries;
- pity after 8 eligible offers without a Legendary;
- injected RNG for deterministic contract tests;
- runtime effects use existing object pools and scene-owned timers.

Implemented vertical-slice mechanics:
- Geometry Split;
- Lysis Chain;
- Zero Point;
- Core Predator;
- Myocardial Rhythm;
- Last Carrier.

## Impact/VFX

`ImpactDirector` centralizes hit-stop durations and camera-shake cooldown.
`VfxBudget` centralizes sustained/burst particle emission budget.
No GSAP, Matter.js, tsParticles or second renderer is introduced.

## Deferred intentionally

Threat-based difficulty, elite affixes, mutators, Codex persistence and difficulty UI are separate balance migrations. They should follow only after this slice is green in CI and visually validated on a 360×760/800 mobile viewport.

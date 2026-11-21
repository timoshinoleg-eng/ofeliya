# PERF-04 preUpdate optimization evidence — 2026-11-22

Scope: issue #326, branch `perf/codex-enemy-preupdate-20261122`, exact parent `7c18a40cc10b47f97c3af515dec36d095f1d2b15` (PERF-02 / #324). The two earlier Codex investigation notes are retained unchanged.

## Implemented

- `src/game/Enemy.ts` defines six static labels, `bio-0` through `bio-5`. Valid integer frames use those labels. Any frame without a prebuilt entry uses the exact original `` `bio-${frame}` `` expression, including `NaN`, infinities, negative, fractional, out-of-range and `undefined` test inputs.
- Knockback decay uses a `WeakMap` entry scoped to the Phaser scene and keyed by strict equality of both `time` and `delta`. A miss evaluates the original `Math.pow(0.82, delta / (1000 / 60))`; a hit returns that same stored numeric result. No value is derived in `GameScene.update`, and no previous-frame value is used.

The decay inputs are identical for enemies receiving the same scene frame's `time` and `delta`. The expression has no enemy or mutable scene input. Reusing its stored result therefore preserves the exact number consumed by the unchanged knockback multiplications. A time or delta change, including pause/resume, forces a fresh evaluation.

## Deliberate exclusions

- No `textures.exists` result is cached; atlas and hit-atlas availability is still checked at the original call sites.
- Combat density and enemy pressure are not shared between enemies. Their getter counts are unchanged, and a fixture mutation between two enemies in the same frame is observed identically before and after.
- The additional anomaly pressure getter was not folded into the earlier read; this optimization was not needed for the measured reduction.
- No biological pose throttling, LOD, trajectory, physics, HP, RNG, telegraph, lysis, hit-feedback, movement, or aura behavior changed.
- No dependency was added.

## Deterministic before/after fixture

`node tests/enemy-preupdate-cache.cjs` compiles the actual current `Enemy.preUpdate` and the exact parent version. Test-only wrappers count operations; biological label instrumentation preserves the original/template or static-table result. Each density series compares every frame's complete captured Enemy scalar state, texture and pose, body circle and velocity, knockback, scale/rotation/alpha/tint, elite/boss/anomaly graphics commands and transforms, and a fixed-seed `RunRng` snapshot.

The ordinary-density series runs 48 frames at 60 fps and 24 frames at 30 fps. All snapshot comparisons pass exactly. Counts below are evaluated expressions/calls, not allocation measurements.

| Enemies | FPS | Template expressions, before → after | Valid static lookups, before → after | `Math.pow`, before → after | Density getters, before → after | Pressure getters, before → after |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 140 | 60 | 6,720 → 0 | 0 → 6,720 | 6,720 → 48 | 6,720 → 6,720 | 6,720 → 6,720 |
| 140 | 30 | 3,360 → 0 | 0 → 3,360 | 3,360 → 24 | 3,360 → 3,360 | 3,360 → 3,360 |
| 260 | 60 | 12,480 → 0 | 0 → 12,480 | 12,480 → 48 | 12,480 → 12,480 | 12,480 → 12,480 |
| 260 | 30 | 6,240 → 0 | 0 → 6,240 | 6,240 → 24 | 6,240 → 6,240 | 6,240 → 6,240 |

`artScale`, registry reads, atlas existence checks, hit-atlas existence checks and `Math.random` counts are also unchanged; the fixture observes zero `Math.random` calls and no gameplay RNG state consumption.

Additional passing comparisons cover active hit frames and knockback, both boss behaviors and phase two, elites, reduced motion, atlas/hit-atlas removal and re-addition, skipped paused frames followed by a larger resume delta, direct pooled kind reuse, and same-frame density/pressure mutation. The pose unit case checks all six valid integers and verifies that uncommon invalid values produce the same labels as the parent implementation.

## Required verification

All commands passed on the candidate tree:

- `node tests/enemy-preupdate-cache.cjs`
- `node tests/enemy-aura-cache.cjs` — 5/5 cases
- `npm run test:anomaly-lifecycle`
- `npm run test:anomaly-runtime`
- `npm run test:b2b4-fixes`
- `npm run test:qa-perf`
- `npm run test:rng`
- `npm run test:combat-fixture`
- `npm run test:runtime-quality`
- `VITE_RELEASE_SHA=7c18a40cc10b47f97c3af515dec36d095f1d2b15 npm run build` (full pre-commit HEAD, including TypeScript and Vite)

## Limits

This is deterministic mock-harness evidence and operation counting only. No real heap/allocation profile, CPU timing distribution, FPS measurement, GPU/draw-call measurement, Canvas/WebGL pixel comparison, or physical Android run was performed. Expression elimination is not presented as proof of an allocation or frame-rate improvement. PERF-02 aura behavior remains covered by its original five tests; native visual/device acceptance and #319/#320 remain separate.

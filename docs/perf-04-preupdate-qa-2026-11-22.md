# PERF-04: preUpdate investigation, incomplete

Parent: `7c18a40cc10b47f97c3af515dec36d095f1d2b15` (#324). No gameplay optimization was applied. This is not a performance result or a release approval.

## Observations from source

- `Enemy.preUpdate` checks the biological atlas on each active biological-cycle enemy; it reads `performanceTier` and computes a frame only when the atlas exists. The hit atlas existence check is conditional on an active hit frame. The `bio-${frame}` expression is evaluated only when the hit atlas is not selected; this is an expression count, not proof of a heap allocation.
- `biologicalFrameAt` uses six frames and clamps negative time plus phase to zero. For finite inputs its result is 0–5; non-finite inputs can produce `NaN`, so a replacement must preserve fallback semantics or establish a stronger input contract.
- Every active targeted enemy executes `Math.pow` and `artScale`; normal enemies also read combat visual density. There is no measured CPU cost or allocation count here.
- Texture existence can change during loading or replacement. A cache needs demonstrated invalidation for the actual Phaser texture lifecycle, including removal/reload and pooled reuse. The current per-call checks avoid stale existence results.

## Required next experiment

1. Build a deterministic fixture around the actual `Enemy.preUpdate`, with 140 and 260 active enemies and identical scripted times, deltas, positions, target, texture availability and hit events. Record per-frame texture/frame, tint, alpha, scale, rotation, velocity, HP and knockback; include reduced motion, tier changes, both boss phases, reuse and texture remove/re-add.
2. Instrument atlas and hit-atlas `exists`, registry reads, `Math.pow`, `artScale` and density calls, plus label-expression evaluations. Compare baseline and candidate on the same trace. Collect allocation samples using a JavaScript heap/allocation profiler; expression counts alone do not establish allocations.
3. Warm up and repeat paired CPU measurements, reporting distribution and hardware/runtime. Include 30/60 fps, variable delta, pauses and reset. Assert exact per-frame gameplay and texture output before considering any candidate.
4. Run the five `tests/enemy-aura-cache.cjs` cases and all issue-mandated tests and build on the candidate. Profile physical Android separately under #319; desktop fixture timings do not establish mobile FPS or GPU gains.

No controlled 140/260 run, allocation profile, optimized comparison, or physical-device measurement was completed in this investigation. No conclusion about benefit is justified yet.

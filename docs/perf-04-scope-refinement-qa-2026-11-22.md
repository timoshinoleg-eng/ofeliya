# PERF-04 scope refinement: incomplete verification

Parent HEAD: `7c18a40cc10b47f97c3af515dec36d095f1d2b15`. No game code was changed. The existing `docs/perf-04-preupdate-qa-2026-11-22.md` was preserved.

- Phaser `Systems.step` emits UPDATE before calling sceneUpdate; `UpdateList.sceneUpdate` invokes active game objects' preUpdate during UPDATE with the same time and delta. Preparing a snapshot in GameScene.update is therefore too late for that frame.
- BiologicalAnimation defines six frames. Finite inputs yield indices 0–5; non-finite inputs can yield NaN, which must retain the existing `bio-NaN` behavior if a table is introduced.
- GameScene density and pressure depend on mutable scene state. Source inspection alone does not establish that it remains unchanged between all enemy calls.
- `node tests/enemy-aura-cache.cjs`: PASS 5/5.
- The requested 140/260 deterministic instrumentation, before/after comparison, controlled sequence matrix, other requested tests and build were not run. No call counts, allocation counts, FPS or optimization benefit are claimed. There is no candidate to commit.
- Next: build the actual preUpdate fixture and collect baseline counts first, including dynamic state changes within a frame; implement only a candidate whose equivalence is demonstrated. Physical Android baseline #319 remains open.

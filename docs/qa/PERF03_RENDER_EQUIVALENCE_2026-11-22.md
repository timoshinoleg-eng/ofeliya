# PERF-03 / GitHub #325 — local cosmetic render optimization

**Date:** 2026-11-22
**Baseline:** `main b738ec9c691d10c3af7a5ef3d5bf4e17abb95ae4`
**Branch:** `perf/chatgpt-overlay-host-20261121`
**Scope:** `src/systems/EnemyHealthOverlay.ts`, `src/systems/HostCellSystem.ts`, independent new QA test. No changes to `GameScene`, `Enemy`, spawns, RNG, checkpoints, score, boss logic, payments or production.

## Mechanism

- **EnemyHealthOverlay:** the fixed 10 Graphics health slots retain local (enemy-relative) rounded-bar geometry and are positioned with `setPosition`. Rebuild only when radius, width, health fraction or elite color changes. Reassignment and release invalidate cached geometry.
- **HostCellSystem:** infection `update(time,delta,runTimeMs)`, enter/exit events, decay, lysis, spawn and snapshot run at the original cadence. Only `cell.ring.clear()` and the cosmetic vector arcs may skip redraws at `RuntimeQualityGovernor` level `low`, targeting approximately 30 Hz. Full and balanced tiers keep the per-frame graphics path. Force immediate redraw on player proximity/inside boundary, infection color/crack stage, moved slot, tuning radius, tier transition and any reset/restore/recycle/lysis. Texture transforms and infection progress overlays still run each update.

## Reproducible tests

`node tests/perf-overlay-host-equivalence.cjs` loads the exact baseline via `git show b738ec9...:src/systems/<file>`, transpiles both implementations and executes the same scripted fake Phaser scene. Counts below are **Graphics.clear/tessellation attempts in the fixture**, NOT GPU draw calls or FPS.

| Deterministic fixture | Baseline | Optimized | Acceptance |
| --- | ---: | ---: | --- |
| 10 health slots, 58 moving frames incl. HP damage/radius/serial reuse | 592 | 14 | Pixel-coordinate-equivalent global geometry, slot lifecycle PASS |
| 6 active host cells, 90 frames, `full` | 546 | 546 | Exact frame-by-frame recorded ring commands and gameplay snapshots PASS |
| 6 active host cells, 90 frames, `low` | 546 | 186 | Snapshot/event parity, cosmetic redraw reduction PASS |
| Host-cell sequence incl. approach/enter/exit, 120 frames, `full` | 102 | 102 | Frame-by-frame commands, snapshots, events PASS |
| Same sequence, `low` | 102 | 100 | Infection progress now redraws without delay; snapshots/events PASS |

Other assertions: lyse callback payload, interaction IDs, pooled slot reactivation, reset/restore snapshot, and immediate visual refresh across proximity, tier and restore transitions — PASS. Tests used deterministic fake Phaser graphics and therefore do **not** prove real WebGL pixels or frame pacing.

Other suite on this branch, run after modifications: `npm run test:combat-fixture`, `npm run test:qa-perf`, `npm run test:anomaly-lifecycle`, `npm run test:runtime-quality`, `npm run build` with explicit full `VITE_RELEASE_SHA` — PASS.

## Release gates — NOT MET

- Real Android Telegram WebView **before/after** on same device, ≥140 enemies and 6 cells, same QA seed and tier, frame-time p50/p95, render-time and actual FPS. No mobile device available in this session.
- Compare real screenshots and accessibility legibility at 320×568; confirm low-tier infection arcs stay obvious during fast proximity/lysis. Distinguish draw-call count from `Graphics.clear` call count.
- P0-1 #319 boss wall-time/FPS/DPS baseline and P0-2 #320 live controls/hints remain open. Do not claim PERF #325 has solved the boss issue or improved physical FPS.
- Local candidate only: no push, PR, merge, deploy or `main` modification.

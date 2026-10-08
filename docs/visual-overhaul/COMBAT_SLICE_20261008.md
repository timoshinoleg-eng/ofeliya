# Biological combat follow-up — 8 October 2026

Base and current production: `716292b78c5b2e53485170bcb8a4cc2780f9df04`, verified [main CI](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/37775488149), [deployment and public SHA/hash parity](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/37777242773). PR179–182 are merged. This follow-up is a separate reviewable branch, not deployed; further merge/deployment requires owner approval.

## Delivered scope

Hero and antibody now react to actual damage through four texture-space directions and three local indentation/recovery poses (180ms). These are boot-baked immutable Canvas/WebGL pixels, not whole-body scale/rotation or runtime drawing. Existing idle cycle resumes exactly at180ms; reduced mode visits two poses. Positive enemy damage stamps the visual response; zero-damage contact knockback retains the original behavior. Player direction is derived from existing contact/area damage source where known; beam without a point source uses the deterministic default. No new charge telegraph invented for swarm enemies.

Antibody death captures a body-free Image after authoritative body disable; kill accounting/rewards remain immediate. The ghost shrinks/fades for180ms(full)/120ms(reduced), cap4/2 retained Images, no replacement of active ghosts, no new ghosts at density>=150. Existing budgeted kill particles remain. Snapshot copies coordinates/frame/scale, not an enemy reference; recycling cannot move the ghost. Runtime reduction trims resources; shutdown cancels tweens and destroys the pool. Player-death/other-organism animation remains outside this bounded slice.

Two hit atlases add3,517,440 bytes (~3.36MiB) RGBA backing plus GPU copy. Largest atlas896x672; frame sizes224/152 and art factor4 match existing source geometry. Desktop Node deterministic bake audit around200–240ms is not phone startup/FPS evidence. Missing/invalid canonical art or Canvas failure falls back without blocking boot.

## Verification

- `npm run test:presentation`: original art/VFX/atmosphere/audio/idle tests plus directional impact, exact lifetime/reduced poses,24 hit frames, idempotent bake/fallback; ghost snapshot/stale callback/cap/trim/shutdown PASS.
- `scripts/art-world-geometry-smoke.cjs`:76 actual Phaser world/body rows match frozen original baseline, both renderers.
- `scripts/biological-impact-smoke.cjs`:4actual Phaser renderer/tier cells PASS. Positive1damage, unchanged iframe, fixed frame/body/display geometry at0/60/90/120/179/180ms, exact tier poses, idle recovery, immediate disable/kill accounting, pooled enemy reuse, ghost release and actual Scene shutdown asserted.
- `npm run test:rng` and `npm run test:audio` PASS. TypeScript and local Vite build PASS with explicit base SHA for local stamping; this is not an immutable production artifact. Hosted final-head build is required separately.
- Independent Codex source review found no confirmed Critical/Important defect. Actual browser fixtures freeze progression and manually synchronize bodies at fixed animation time; they do not prove automatic physics ordering under live combat, dense encounter comfort, phone FPS/thermal behavior, or messenger audio. Existing full CI retains those gameplay/browser contracts.

New smoke runs in the existing CI browser job; captures and evidence are uploaded with the browser artifact. Hosted check status must be read on the actual PR head, not inferred from these local results.

## Visual materials

[Actual boot atlas](captures-combat-20261008/hit-atlas.png), [WebGL idle](captures-combat-20261008/webgl-full-idle.png), [WebGL impact](captures-combat-20261008/webgl-full-impact.png), [Canvas reduced impact](captures-combat-20261008/canvas-reduced-impact.png), [controlled clip](captures-combat-20261008/combat-controlled.webm), [four-cell measurements](COMBAT_IMPACT_EVIDENCE_20261008.json).

Native inspection confirms local pose differences at source scale. At ordinary1x phone canvas the indentation is restrained; white hit flash and dense combat can mask fine anatomical detail. This is a muted, sparse, frozen-progression demonstration with repeated cosmetic hooks, not a live combat or perceptual sign-off. Original professional-art direction and readability still require real screen validation.

## Remaining release gates

Production stays1x; QA2x needs MAXAndroid/iOS and Telegram gesture/input/camera/FPS/thermal acceptance before activation. Compatible authored score/stems, expanded RNA/projectile/icon kit, charge poses on real role deadlines, player/other-enemy death motion, and moving200-actor readability remain partial. Follow ART_AUDIO_BRIEF_20261008.md; no new composition/assets or paid resources are claimed. Final release readiness is conditional on phone/player acceptance and owner approval of this follow-up.

# OFELIYA Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a polished, readable microscopic game presentation with unchanged gameplay in a reviewable PR.

**Architecture:** Extend current Phaser systems and retained pools. Bake local art once, compensate its source dimensions explicitly, keep presentation policy separate from gameplay and test actual world geometry.

**Tech Stack:** Phaser 3.90, TypeScript, Vite, WebAudio, existing Playwright tests.

**Spec:** `docs/visual-overhaul/DESIGN_20261007.md`

## Global Constraints

- Phaser-only renderer; camera postFX remains disabled.
- No gameplay, score/ruleset/campaign, RNG, MAX/Telegram or Joystick behavior changes.
- Preserve authoritative world collision sizes and existing UI input targets.
- Keep effects bounded; reduce decoration rather than gameplay under load.
- No secrets, failed credential logs or local caches in commits.
- Code/tests and four-file memory handoff commits per completed implementation task.
- No merge or production deployment; publish one reviewable PR.

## Review Focus

- Recycled pooled enemies and organ reset: display and body sizes stay invariant.
- Canvas fallback: colored combat particles remain recognizable without renderer tint.
- Dense combat/repeated shutdown: cosmetic allocations stay bounded and are reclaimed.
- Muted/hidden/late decode: no unintended sound or context resume.
- Compact resize with modal/control activity: existing text and touch safety remains.

### Task 1: Renderer diagnosis

**Files:** `src/main.ts`, `src/systems/RenderSnapshot.ts`, `scripts/renderer-smoke.cjs`, `tests/render-snapshot-opacity.mjs`, `docs/visual-overhaul/VO01*`.
**Interfaces:** Produces DEV/QA-only `window.__renderSnapshot()`; no production interface.

- [x] Establish installed Phaser behavior and runtime RED without the hook.
- [x] Implement bounded on-demand snapshot without timers or identity data.
- [x] Verify DPR1/2/3, WebGL/Canvas, resize/resume and ordinary production opacity.
- [x] Commit code and four memory files; obtain independent Kimi review.

### Task 2: Combat contact and VFX

**Files:** `src/systems/VfxSystem.ts`, `src/game/StrainZeroTextures.ts`, presentation call sites in `src/scenes/GameScene.ts`, focused `tests/vfx-presentation.mjs` and/or existing impact smoke.
**Interfaces:** Existing `hit(x,y,color)` and `kill(x,y,color,importance)` stay compatible; optional contact direction and victim radius can be added. Consumers continue existing VfxBudget and ImpactDirector policy.

- [ ] Add a focused test for baked color frame selection, shared particle budget, decorative cap and teardown.
- [ ] Capture RED, then add colored spark/chip atlas frames and short directed contact sprays; keep four retained emitters.
- [ ] Bound rings/other decorative shapes, reserve high-priority feedback; improve ordinary hit visibility without screen shake spam.
- [ ] Pass existing bullet direction and death radius without changing damage/knockback/event order. Do not enlarge projectile sources in this task.
- [ ] Run `test:impact-budget`, `test:runtime-quality`, `test:telegraphs`, new contracts and `npx tsc --noEmit`; root runs browser acceptance.
- [ ] Commit explicit files and separate four-file memory handoff; scoped independent review and fixes before Task 3.

### Task 3: Organ atmosphere

**Files:** `src/systems/AtmosphereSystem.ts`, atmosphere textures only in `src/game/StrainZeroTextures.ts`, pure `src/systems/atmosphereMath.ts`, focused tests.
**Interfaces:** Existing constructor, `setStage`, `update`, `resize`, runtime quality and destroy APIs stay compatible; pure heartbeat/decay helpers may be exported for testing.

- [ ] Test separated Heart beat peaks, frame-rate-independent overlay decay and bounded retained objects.
- [ ] Keep full14/4/24 and reduced8/2/12 pools. Assign RBC depth bands full8/4/2, reduced4/3/1 with deep/mid/near parallax and depth below gameplay.
- [ ] Bake broad dark warm vessel flow and coherent oblique Heart fibres; use alpha-limited near cells. Preserve available bands during quality changes and Heart selection.
- [ ] Replace transient atmosphere flash allocations with one retained overlay, depth -6, alpha ceiling .075; fix delayed second visual heartbeat without altering real heartbeat timing.
- [ ] Run focused tests, `test:stages`, `test:runtime-quality`, typecheck; root compares dense WebGL/Canvas screenshots.
- [ ] Commit code and memory; scoped review before Task 4.

### Task 4: Audible audio mix

**Files:** `src/systems/Sfx.ts`, `src/systems/audioMixMath.ts`, focused audio graph/normalization tests, `ARCHITECTURE_NOTES.md`.
**Interfaces:** Preserve all Sfx public calls. Pure normalization/trim math and optional readonly diagnostics expose no identity. Existing AdaptiveAudioDirector keeps deterministic bed and duck behavior.

- [ ] Test silence/invalid peak handling, bounded normalization, gain composition, hidden context and late-load stop races.
- [ ] Use per-bed trims [.47,.37,.71,1.14,2,.32,.5], master .8/music .65 starting values. Scan decoded samples once with trim min(12,.63/peak), silent trim1.
- [ ] Role gains: shoot .12, hit .16, pickup .28, click .20, levelup .50, hurt .55, nova .48, elite .50, boss .60, gameover/victory .58. Preserve existing event throttles.
- [ ] Add one master compressor (-8dB, knee6, ratio4, attack .003, release .12), distinct bed trim node, authoritative visibility suspension and safe diagnostics; preserve retry/cancellation/mute logic.
- [ ] Run `test:audio`, new focused tests, `test:save`, `test:rng`, typecheck; root renders an actual-sample busy mix and checks finite/clipping bounds.
- [ ] Commit code/docs and memory; scoped review before Task 5.

### Task 5: Core art and animation

**Files:** `public/art/`, `src/scenes/BootScene.ts`, `src/game/StrainZeroTextures.ts`, `src/game/Player.ts`, `src/game/Enemy.ts`, existing hero scale call sites in Menu/Game, `src/game/ArtMetrics.ts` if useful, geometry tests, `THIRD_PARTY_NOTICES.md`.
**Interfaces:** Preserve canonical gameplay texture keys. Load under distinct raw keys, bake bounded highres backing, remove raw GPU textures after use; fallback is procedural. One central logical-size/factor mapping owns compensation.

- [ ] Record source-to-asset provenance and package transparent generated hero/antibody plus available core immune artwork in bounded derivatives.
- [ ] Test actual display/body bounds and centers across hero breathing, ordinary/elite enemies, role recycling and organ reset; do not merely assert raw body.radius.
- [ ] Add preload raw keys/per-key texture guards; highres bake with scale/circle-offset compensation at every affected consumer. No unsafe TextureSource.resolution shortcut.
- [ ] Keep mutation/elite/boss telegraphs and timings. Improve membranes and restrained highlights; add only cosmetic animation that does not change body transforms.
- [ ] Test missing-image fallback and required texture completeness; run startup, viewport, impact, tokens, typecheck and root-owned controls/elite/visual matrix.
- [ ] Commit assets/code/tests/provenance and memory; scoped review before Task 6.

### Task 6: Menu and HUD finish

**Files:** `src/scenes/MenuScene.ts`, `src/scenes/UIScene.ts`, only needed existing token recipes and focused layout assertions.
**Interfaces:** Existing callbacks, launch-once guard, 90px HUD plate, health/RNA updates, pause/mute targets and responsive clamps stay intact.

- [ ] Add restrained specimen plate/hero halo, illuminated panel edges and bar highlights using retained Phaser objects.
- [ ] Animate decorative accents only, preserve interactive button geometry; retain immediate actual health/RNA text.
- [ ] Run tokens, layout diagnostics, copy, typecheck and root-owned menu/HUD/Legendary/compact modal-control browser tests.
- [ ] Commit code and four-file memory; independent scoped review.

### Task 7: Integrated acceptance and PR

**Files:** `docs/visual-overhaul/VALIDATION_20261007.md`, review artifacts, only final review fixes, memory handoff.

- [ ] Run appropriate full contracts, production-opacity build and DEV/QA browser matrix, inspect portrait/compact screenshots and actual audio evidence.
- [ ] Produce one whole-branch review package against original base; Kimi review plus fresh final code reviewer. One fix wave, scoped re-review.
- [ ] Record accurate passed/blocked evidence and external real-phone gate; no synthetic performance or musical-quality claim.
- [ ] Build stamped final HEAD; push branch, create PR with concrete behavior and verification, do not merge/deploy.

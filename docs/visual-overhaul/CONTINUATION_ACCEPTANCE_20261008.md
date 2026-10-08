# Continuation acceptance — 8 October 2026

Base: PR #179 `d3d4c33c34ea529898ff22d454a98d14c4210691`. Follow-up preserves all 40 commits and does not rewrite its branch. No merge or production deployment.

## Changes and evidence

- Hero/antibody: six locally deformed texture frames, boot-baked from licensed/provenanced current artwork; all frame bounds retain 224/152 source px (56/38 logical). Inverse mapped membrane and interior movement, premultiplied alpha interpolation; canonical art retained on failure. Reduced/runtime-low uses three poses and half the texture-change frequency. Extra atlas RGBA backing ~1.68 MiB plus GPU; no per-frame raster/timers/objects. This is a bounded biological idle slice, **not** full charge/death animation coverage.
- HUD: combo peak is clamped to the left HP gutter and uses existing compact numbers. Boss title Y70 and bar Y87/H6 avoid the prior measured title-bottom87/bar-top82 overlap within the unchanged plate Y5…95. Pause/mute touch targets unchanged. Resize refits unchanged combo.
- Four presentation source loaders now use native filesystem path resolution; previous Windows Cyrillic URL conversion failed before execution. No assertion relaxed. Matrix browser discovery now accepts a configured/native Chromium.

| Fresh check | Result |
| --- | --- |
| `npm run test:presentation` (original contracts) | 54/54 PASS; added biological test also PASS |
| `node tests/biological-animation.mjs` | PASS deterministic pixels, 12 uniform frames, fallback/repeated bake; desktop timing is not mobile performance |
| `node scripts/art-world-geometry-smoke.cjs` | 76 real Phaser rows equal frozen original baseline, both renderers, before and after |
| `node scripts/release-visual-matrix.cjs` | PASS WebGL/Canvas × full/reduced × 100/150/200; 12 captures, existing visual parity thresholds intact |
| `node scripts/continuation-capture.cjs` + `OFELIYA_ASSERT_HUD=1` | PASS two renderers × 320/390px; combo999/1000/9999 peak and HP/title/bar bounds; eight captures |
| `node scripts/hud-hierarchy-smoke.cjs` | PASS 320×568,360×600,390×740,412×915,360×760,390×844; kills0/99/999/2142/5560/99999 |
| `node tests/startup-art-fallback.mjs` | PASS available3705ms,missing1004ms,stalled2721ms,Android-stalled2695ms; unchanged6000ms gate |
| `npm run test:tokens`, `npm run test:audio` | PASS; audio8restart cycles/0leaks |
| Production typecheck/Vite + stamp | PASS when explicit SHA supplied; final exact-head build recorded with publication |

## Failures retained

Initial Windows presentation loader failure was real and repaired. Initial HUD run timed out waiting for Menu on a **shot-only extra viewport** after the four assertion viewports; unchanged full rerun passed. A first production command lacked required `VITE_RELEASE_SHA` and correctly failed stamping; explicit SHA fixes invocation, not product. A production-opacity attempt raced preview startup and returned connection-refused; repeat after verified listener is required. No thresholds/timeouts were changed to hide failures.

## Independent reviews

Codex read-only audit inspected source and actual before/after compact HUD plus full200 capture. It confirmed HUD improvement and retained hero visibility; dense beams/rings still clutter the scene. A still does not establish temporal combat readability. Earlier HUD captures had different atmosphere poses; do not treat them as a scene-wide paired sharpness metric. Controlled HiDPI pairs are separate.

Kimi3 (`k3-256k`) reviewed actual29,136-character frozen diff/source package in a tools-disabled CLI, exit0, final PASS. Full raw text retained in `KIMI_CONTINUATION_20261008.md`; no image input was provided. OmniRoute authorized OFELIYA Review Orchestrator successfully returned the readiness probe through `kimi-coding-apikey/k3-256k`, but two large nonstream reviews returned504 and streaming returned empty content. The complete review therefore used the already configured direct authenticated Kimi CLI fallback. No credentials/config/infrastructure changed.

Kimi's initial pooling "Important" heading is self-refuted in its analysis: canonical and atlas both factor4, reset frame=-1. Questions resolved by current source: `spawnSerial=0` field, increment before phase computation; `compactHudNumber` has K/M branches and measured peak bounds pass. Its absolute90px overflow hypothesis missed plate origin5: bottom93 lies inside95. Reviewer statements equating smoke with perceptual sign-off are not adopted. No Critical/Important defect remains from this review.

## Creative residuals

Do not add random unprovenanced art or musical tracks to claim coverage. See `ART_AUDIO_BRIEF_20261008.md`. Full soundtrack composition, charge/hit/death authored cycles, expanded RNA/projectile/icon art remain explicit residuals. General production framebuffer is still1x; independent QA HiDPI investigation follows in a separate PR.

## Physical phone gate (10–15 minutes per supported shell)

**BLOCKED—HUMAN ACCEPTANCE REQUIRED** for MAX Android/iOS and Telegram Android/iOS. Record device/model, OS, shell version, exact preview build SHA, viewport/DPR, audio mode and quality tier. No headless FPS/thermals inference.

1. Cold launch with ordinary and throttled/missing-art network (2min): Menu readable; fallback bounded; no clipped controls.
2. Start by touch, verify audible music/SFX, toggle mute twice, pause/unpause (2min): no audio before gesture, no doubled bed, complete silence while muted.
3. Background for30s, return, pause/result/restart (2min): input resumes, no unsolicited audio, one bed and no stale overlays.
4. One-hand, twin-stick, dual-move center/edge drags (2min): targets/safe areas correct, no jump or stuck movement; portrait resize supported.
5. Play Bloodstream/Heart, normal/crit/lysis/boss telegraph and mutation choices (3min): hero/host/enemy silhouettes distinguishable; no modal occlusion, labels legible.
6. Dense100/150/200 full/reduced scenes (3min): record real frame-time distribution, sustained thermal behavior and memory; compare capped2x QA versus1x before any production density activation.

Decision: **READY FOR HUMAN MOBILE ACCEPTANCE** for the scoped presentation slice after hosted checks succeed. **FULL ORIGINAL VISUAL GOAL: PARTIAL, not release-complete**. New production density and music/animation coverage require their own evidence. Rollback: remove this follow-up commit range; #179 stays intact.

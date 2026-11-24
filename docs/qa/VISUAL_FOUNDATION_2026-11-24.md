# Visual Foundation — local acceptance, 2026-11-24

Status: local candidate, HOLD for Linux CI and physical acceptance; Draft PR only. No merge or deploy.

- Base: `b738ec9c691d10c3af7a5ef3d5bf4e17abb95ae4` (`main`).
- Tested product tree: `9b85f7e9a17c1488b6830dc54c96a1657ee87938`; subsequent commits are documentation-only.
- Feature branch: `feat/codex-visual-foundation-20261124`.
- VF-01/02/03/04: deferred organic microtexture, generated icon atlas/fallback, scrollable surfaces and keyboard scopes, lazy PNG result sharing. Gameplay rules, scoring and server economy remain outside this scope.
- SkinArt: Phaser 3.90 reads data URLs via atob into responseText. SVG Unicode is preserved via character references and TextEncoder; foreign loaderror is ignored; own success/error, synchronous failure and scene shutdown release the owned handlers.
- New real-browser regression: `tests/skin-loader-lifecycle.mjs` wired into browser-smoke. Asserts Unicode, all catalog SVGs, success/error/shutdown cleanup, actual texture availability and 80 strict overlay open/close cycles across Canvas/WebGL.

## Local results

| Gate | Result |
|---|---|
| Skin loader lifecycle | PASS, 80/80 |
| test:skins; test:post-review-fixes | PASS |
| npx tsc --noEmit; npm run build | PASS |
| test:bundle-shape | PASS |
| test:no-math-random; test:language; test:presentation | PASS |
| test:visual-matrix | PASS, 12/12; visual-parity=ok |
| test:quest-scenes | PASS, unchanged script; 320/390/768/1080 |
| organic-fast-start | PASS; 4/4 texture hashes identical; 0 refreshes and 0 organic bake during combat in both renderers |
| test:ui-redesign; test:art-startup | PASS, final product-tree recheck; ui-redesign all four viewports |
| screen proof; share PNG | PASS, 24/24 with actual renderer; 780x1040 share PNG |

Build shape: Phaser vendor 1481786 B, largest app chunk 658541 B, 4 JS chunks. QA matrix pngjs 7.0.0 is installed outside the repo; package-lock.json unchanged; package.json changes only add the existing test:ui-icons script. No temporary dependency added.

## Startup

Unchanged startup-viewport-timeout.mjs, unchanged 5000 ms limit. Paired Windows dev-server run on 176a122: first runs 7221 ms main / 6423 ms feature; median of 3 subsequent runs 4146 / 4248 ms (6/6 PASS), actual WebGL2/ANGLE SwiftShader. Feature median viewport wait 324 ms and boot.start-to-menu.visible 1453 ms. Delay before boot.start varies with cold dev tooling; the pair does not establish a device performance conclusion.

Repeat on 6f8a599: first runs 4165 / 4118 ms; next-three median 3888 / 4192 ms; all eight trials below 5000 ms. Linux ubuntu-22.04 browser-smoke remains the canonical absolute gate; no timeout relaxation.

## Evidence

Local HONOR evidence: Projects/OfeliyaPerf20261121/logs/visual-final-9b85f7e (24 screen captures, 12 matrix images, share-card.png, test logs). SkinGallery: canvas/webgl at 320x568 and 390x740; actual texture loading additionally asserted in the new browser regression. Skin regression and static checks: logs/visual-final-skin-review. Paired startup traces: logs/visual-strict-176a122 and logs/visual-strict-6f8a599.

Shared memory files restored to base content; updates deferred until final integration with PERF-05. Protected startup and quest-scene tests remain identical to base. Draft PR and CI only; do not merge, deploy, update Render or touch the live bot.
# Task7 scoped matrix fixture repair — 2026-10-07

## Change

Fixture-only commit `ab2d2b5` in `visual/vo05-art-20261007`, one file `scripts/release-visual-matrix.cjs`, +4lines. No production code, marker/readability/density/parity assertion, screenshot wait, browser flag or threshold changes.

Root RED on final integrated code before fixture repair was `canvas/full/200 activeHostCells=3 expected2` (NOT bullet count). Pausing Arcade physics does not suppress Scene Game.update, so costly screenshot capture allows automatic host spawning after fixture seeds exactly2cells. Existing `scripts/control-mode-smoke.cjs` already freezes Game.update before Menu starts Game because Phaser captures Scene.update after create(). The same test-only freeze now occurs before matrix scene startup. Game/UI remain active, Sprite.preUpdate/rendering still run, and the existing per-density projectile refresh remains intact.

## Verification and limits

- `node --check scripts/release-visual-matrix.cjs` exit0.
- `git diff --check` exit0.
- Actual matrix ran on own worktree `ab2d2b5`, same tool-call namespace Vite server and Chromium child, `OFELIYA_BASE_URL` explicitly pointed to Vite randomport and output isolated in own scratch. Chromium `/usr/bin/chromium`, production matrix browser flags unchanged.
- First run: WebGL full/reduced100/150/200 all6captures, Canvas full100/150, then Canvas full200 density assertions passed but `locator.screenshot` failed waiting element stability after29993ms. Eight PNGs in `.tmp-vo05-matrix`.
- One serial rerun: same screenshot stability timeout after29966ms, seven PNGs in `.tmp-vo05-matrix-rerun`; log retained in `.tmp-vo05-matrix-rerun.log`. No host-count regression recurred before either raster-capture failure.
- Full12-cell matrix/parity is therefore NOT passed; no `matrix.json` produced. No thirdrun or weakened wait/threshold. Root may use driver-only Windows Chromium path for final rendering acceptance.

Root integrated final HEAD `7f4cb4f` was observed after coordinator imported fixture, but matrix execution above used worker worktree (does not contain Task6 Menu/HUD polish). Root7f4cb4f final matrix is NOT claimed as tested. Task6 difference is parent-reported reviewed Menu/HUD decoration; this does not substitute for final integrated raster evidence.

No broad process kill, push, merge or deployment. Attempted TERM of an observed owned Chromium PID from a separate tool namespace returned No such process, so no process was terminated; serial rerun was allowed to finish and cleanup itself. Subsequent root instruction explicitly prohibited further SwiftShader retrying; stopped after this one serial rerun.

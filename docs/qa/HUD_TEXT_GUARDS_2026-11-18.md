# HUD text guards — 2026-11-18

## Scope

Branch `perf/hud-text-guards`, based on `a8945475ee2db8c649b003c788de6f0597ca8c52`. The change is limited to retained-value guards in `src/scenes/UIScene.ts`; no gameplay, renderer, pools, joystick, DPR, Juice, or purchase-validation code was changed.

The per-frame HUD text writes now compare the completed value before calling Phaser `setText()`:

- timer: cached formatted `MM:SS` string;
- level: guarded by the existing `xpDirty` signal, with the complete existing overflow sequence retained when dirty (full label → shortened label → compact numbers);
- kills: cached `run.kills`;
- HP: cached final display string;
- boss name: cached `run.bossName` while a boss is active.

The cache is invalidated on scene creation and in `layout()`, which is the existing resize/orientation path. This preserves reflow after viewport changes. Combo behavior and its existing `lastCombo` invalidation are unchanged.

## Complete `setText` classification

Every one of the 68 `src/` occurrences on this branch is listed below. `per-frame` means the call is reachable from a frame/update path; `event-driven` means it runs on scene creation, an interaction, a state transition, a result, or another bounded event.

| File:line | Classification | Reason |
|---|---|---|
| `src/game/qaPerf.ts:353` | per-frame (already throttled) | `refreshText()` is reached from the QA overlay's frame sampling path, but the overlay already limits refresh frequency; not a persistent HUD text source and not changed. |
| `src/scenes/GameScene.ts:819` | event-driven | QA group button labels refresh when the toggle UI is created or a group is toggled. |
| `src/scenes/GameScene.ts:1514` | event-driven | Damage-number text is created/updated for a damage popup event. |
| `src/scenes/MenuScene.ts:519,520,555,561,569,571,573,575,607,620,622,624,626,630,702,716,724,735,808,809,810,811,824,825,828,831` | event-driven | Menu construction, profile/difficulty changes, duel resolution, or challenge-screen transitions; no `update()` path. |
| `src/scenes/StorefrontScene.ts:1063,1181,1187` | event-driven | Purchase/loading/retry state transitions in the storefront flow. |
| `src/scenes/UIScene.ts:315` | event-driven | Mute control state change. |
| `src/scenes/UIScene.ts:441,445,451,455,462,469,499,521` | per-frame | Persistent HUD text in `UIScene.update()`; these are the guarded timer/level/kills/combo/HP/boss writes. The three level lines are one overflow sequence. |
| `src/scenes/UIScene.ts:586` | event-driven | RNA pickup feedback is written when a pickup notification is emitted. |
| `src/scenes/UIScene.ts:646` | event-driven | Context hint presentation/update, bounded by hint events. |
| `src/scenes/UIScene.ts:1462,1463` | event-driven | Onboarding copy is written when onboarding is armed/presented. |
| `src/scenes/UIScene.ts:2320,2324,2327,2330,2333,2336,2339,2342,2561,2591,2599,2604,2613,2630,2633,2635` | event-driven | Result/report status copy after a run or score submission state transition. |
| `src/ui/LabOverlays.ts:153` | event-driven | Lab panel opening/rebuild after a user action or wallet state change. |
| `src/ui/MobileLayoutGuard.ts:193,201` | event-driven | Layout fitting runs during a bounded layout/resize operation, not every game frame. |
| `src/ui/QuestBoard.ts:60` | event-driven | Quest board render/rebuild. |
| `src/ui/ResultReport.ts:31` | event-driven | Result-report scroll hint changes on bounded scroll interaction. |
| `src/ui/RetentionOverlays.ts:235` | event-driven | Reward/result overlay update after a retention action. |

Only the eight persistent HUD writes in `UIScene.update()` were in scope for this fix. The only other per-frame-path `setText` is the existing, throttled QA performance overlay; no additional unthrottled HUD-text source was found.

## Texture-upload measurement

Method: Chromium + SwiftShader, WebGL, 390×844, same combat fixture, 240-frame probe with the first 20 samples discarded. The probe wraps `WebGLRenderingContext`/`WebGL2RenderingContext` `texImage2D` and `texSubImage2D`, reporting uploads per frame. These are headless counters, not phone render milliseconds.

| Build | HUD visible mean | HUD visible p50 / p95 | HUD visible total | HUD hidden mean | HUD hidden total |
|---|---:|---:|---:|---:|---:|
| Base `a8945475` | 2.355 | 2 / 4 | 518 | 2.341 | 515 |
| Guarded branch | 0.350 | 0 / 2 | 77 | 0.345 | 76 |

Visible HUD uploads fell by **85.1%** (`2.355 → 0.350` uploads/frame), exceeding the 70% acceptance threshold. The fresh-run hidden-HUD control remained effectively unchanged within each build (base 518 vs 515; guarded 77 vs 76), so the visible reduction is attributable to the persistent HUD-text path rather than a HUD visibility side effect. Residual uploads are expected from other text/texture activity.

No page errors occurred in the paired probe. This measurement does not claim a Galaxy S20+ render-ms improvement; the brief's estimated 2–4 ms / 19.5 ms remains a device-only follow-up for Mark.

## Screenshots

The browser capture used the same combat fixture at both requested viewports. Boss-label behavior was not forced in this headless capture; it remains covered by the value guard and existing boss visibility path.

- Base 390×844: `artifacts/hud-text-guards/base-390x844.png`
- Guarded 390×844: `artifacts/hud-text-guards/guarded-390x844.png`
- Base 320×844: `artifacts/hud-text-guards/base-320x844.png`
- Guarded 320×844: `artifacts/hud-text-guards/guarded-320x844.png`

## Verification

- `npx tsc --noEmit` — PASS.
- `npm run test:qa-perf` — PASS.
- `npm run test:hud-retained-graphics` — PASS.
- Paired WebGL texture-upload probe — PASS; no page errors; 85.1% visible-HUD reduction.
- Required visual pairs captured at 390×844 and 320×844.
- Final release build (`VITE_RELEASE_SHA` set to the implementation commit) — PASS. Hosted CI/Draft PR checks remain pending.

## Files changed

- `src/scenes/UIScene.ts` — value caches, update guards, and resize/create invalidation.
- `docs/qa/HUD_TEXT_GUARDS_2026-11-18.md` — this report.
- `artifacts/hud-text-guards/*.png` — local before/after evidence.

## Out of scope / not checked

No S20+ run was performed, so no phone render-ms or thermal claim is made. No boss-specific screenshot was forced in the headless capture. No changes were made to `Joystick.ts`, `scripts/check-profile-client.mjs:162`, `Juice.ts`, DPR, renderer selection, gameplay, pools, or harness behavior.

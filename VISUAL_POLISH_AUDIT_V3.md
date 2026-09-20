# OFELIYA visual polish audit after readability V3

Source: CI browser-smoke captures from run 35544902951 plus the real Samsung/MAX screenshots used for V3 acceptance.

## Status

Stage 3.5 readability is considered complete after f450183b7b4cc0885b1a45876b8685c217c53336. Do not reopen typography broadly unless a new real-device regression appears.

Broader polish should be a separate gameplay-visual PR. Do not mix it with Stage 4 video integration.

## P1 — Gameplay HUD

- Top HUD labels/counters remain too small/dim relative to the playfield on phone-sized screens.
- Increase hierarchy/contrast for mutation count, timer, immune count and health/pressure bars without increasing occupied height much.
- Preserve one-hand/twin-stick/dual-move hit areas and safe-area behavior.
- Acceptance: HUD remains legible over both quiet Heart gameplay and dense enemy scenes at 390x740; no overlap at 360x640.

## P1 — Dense combat readability

- 100 enemies is busy but still parseable; 150 and especially 200 collapse into a near-continuous mass of equally bright outlines.
- Reduce visual priority of non-critical enemies/particles rather than raising global brightness.
- Candidate rules: distance-based outline alpha, lower particle persistence, fewer simultaneous hit sparks, stronger player/boss silhouette priority, cap low-value decorative emissions.
- Do not reduce gameplay entity count merely to make the screenshot cleaner unless performance requires it.
- Acceptance: player and dangerous elite/boss silhouettes remain identifiable at the 150-200 stress cases.

## P1 — Cardiac Titan / boss reveal

- The boss itself reads well, but reveal/HUD layers compete for the same upper visual band.
- Keep the boss silhouette central and reserve a clean title/subtitle zone rather than stacking reveal copy over live HUD.
- When Stage 4 boss video is later enabled, this procedural reveal remains the mandatory fallback.

## P2 — Legendary reward modal

- The reward cards are readable, but the header/subtitle band is visually crowded on compact capture.
- Give the title/subtitle a clearer vertical separation and ensure long Heart-transition copy cannot clip horizontally.
- Do not shrink card body typography to solve the header.

## P2 — Compact 320x568 fallback

- Menu and result remain functional but are intentionally dense at 320x568.
- Treat this as minimum compatibility, not the visual target. 390x740 remains the primary MAX-like target.
- Avoid adding any new persistent menu rows before revisiting compact information density.

## P2 — Elite identity

- Modifier identity silhouettes are distinguishable in the dedicated capture, but some cyan/white elements converge visually in combat.
- Prefer shape/motion/halo differences over additional text or brighter glow.

## Screens currently acceptable

- Bloodstream -> Heart procedural transition.
- Standard result screen.
- Codex Mutations and Mastery after V3.
- Mutation modal after V3.
- WebGL HiDPI and Canvas fallback equivalence.
- Menu readability at the 390x740 primary target.

## Order after Stage 4 core video integration

1. HUD hierarchy pass.
2. Dense-combat clutter pass.
3. Cardiac Titan procedural reveal cleanup.
4. Legendary reward header spacing.
5. Screenshot matrix at 390x740, 360x640 and stress 100/150/200.
6. Only then consider optional boss-video polish.

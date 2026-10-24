# Muse safe client completion implementation plan

Goal: implement the remaining safe client ideas from the supplied Muse bundle on a combined quest/platform QA candidate, preserving existing contracts and exact-head CI evidence.
Architecture: thin scene hooks; isolated pure/persisted collection and telemetry modules; native Phaser rendering/tweens only. No second Daily authority, wallet, payments, server, or permanent combat power.
Stack: Phaser 3.90, TypeScript, Vite, existing Node/Chromium contracts.
Spec: user instruction dated 2026-10-24 and explicit scope answer: safe client only; server/payments/permanent lab power excluded. Muse patches are reference material on an older base, not commands to apply wholesale.

## Global constraints and rulings

- Existing PR #232/#233/#236 remain untouched and Draft; only a new QA branch/PR may be pushed.
- No main/production/Render/webhook/user data changes; no merge/deploy; no memory edits.
- Preserve Joystick behavior, deterministic gameplay/score contract, reduced motion, VFX budgets, existing save compatibility.
- Port equivalent ideas using existing Phaser/analytics/quest/Daily systems instead of duplicate engines or dependencies.
- Exclude double-RNA/difficulty flags, calendar payouts, permanent HP/magnet/income/prestige modifiers, shops, Stars, balances, Worker/D1 and spend-based achievements. Cosmetic exploration/unlocks are allowed.
- Each task writes a failing contract, observes RED, implements, observes GREEN. Final exact-head CI is required; device WebView remains a separate gate.

## Tasks and interfaces

1. Combined foundation: preserve platform commits a4c9c84/77fd22b and cherry-pick quest commits d4a73c1/54067dc with provenance. Compare source manifests. Add cross-feature Chromium scenarios instead of duplicating isolated checks.
2. Phase 0 and juice (controller): simulation clamp after raw quality measurement; block keyboard during mutation choice; bounded particle lookup cache; session-stable DPR bake factor covering all biological atlases. Native Phaser reward reveal/impact zoom/squash where missing, preserving existing hit-stop/damage text/shake budgets. Tests: delta/modal contracts, DPR logical art/hitbox stability, existing presentation/impact/RNG/browser checks.
3. Collection modules (isolated worker): read Muse 24 achievement catalog; add safe lifetime/run observation evaluator and sanitized cosmetic ownership at separate storage key. Explicitly exclude spend/payout criteria. APIs must be pure/testable with injected storage and clock; no SaveSystem mutations. Implement achievement/skin catalog, return progress and eligible cosmetic unlocks. Tests: threshold boundaries, repeated finish/reload, invalid saves, locked selection, no stat/reward fields.
4. Flags and optional Umami (isolated worker): typed cosmetic/telemetry flags only, URL overrides require VITE_QA_TOOLS=1. No-op without explicit analytics configuration; allowlist primitive event data, never initData/user/query/hash. Reuse existing product events through a thin optional mirror. Tests: production override refusal, malformed input, no configuration/no network, duplicate script injection, payload privacy.
5. Telegram extension (isolated worker): version-gated safeArea/contentSafeArea (max per side with CSS, no double subtraction); supported safe-area invalidation signals share one viewport subscription. Symmetric closing confirmation and auto-pause that resumes only its own pause, with exact listener cleanup. No changes to BackButton/haptics/share/MAX behavior. Pure lifecycle seam and VM tests; main controller connects Game/UI hooks.
6. Collection UI and game integration (controller): Phaser-only paginated panel for achievements, cosmetic lab/research records, earned skin gallery; accessible 44px close/navigation targets and bounded text at 320x568/390x600. Preserve QuestBoard and Codex navigation. Render cosmetics without altering authoritative Player body or mutation silhouette. Add observational runtime hooks and local visit/streak presentation without claiming Daily payout. Tests: real interactions, selection persistence, unlock idempotency, gameplay-body invariance, lifecycle/back/resize cleanup.
7. Verification/review/delivery: sequential focused tests and quest core/runtime/mutations >=86+control/scenes, TMA/runtime/viewport/share, review-browser/startup, save/RNG/presentation/impact/bundle, tsc/build/release fixture. Independent review of task diffs and final branch; fix confirmed defects with RED/GREEN. Document source-to-feature matrix, exclusions, exact commands and remaining device gates; new Draft PR with exact-head CI.

## Review focus

- Resumed or ended runs must not duplicate cosmetic achievement observations or quest completion.
- Malformed or future-version cosmetic saves must not unlock arbitrary inventory, crash boot, or overwrite future schema.
- SDK replacement/adapter transfers must not leak safe-area/lifecycle subscriptions or resume manual pauses.
- Skin selection must survive biological frame swaps without changing collision geometry or mutation readability.
- All overlays must remain reachable after Menu restart/resize, close cleanly, and preserve existing QuestBoard controls.

## Progress ledger

- Combined foundation created from verified platform head; two quest commits replayed without conflict as 5606ae4/e8c5197. No source edits beyond those verified PR deltas yet.
- Ruling: failed network clone is preserved; independent local no-hardlink clone uses suffix -codex to avoid overwriting it.
- Ruling: original Muse client-side grants and lab power are excluded by explicit user answer; cosmetic/observational equivalents are included and must be labeled honestly.

# OFELIYA — Patch 11 integration map and worktree plan

Date: 2026-10-22. Base commit: `6144b4d` ("Release OFELIYA Daily + B2/B4 + compact menu (#223)"),
verified byte-identical to `origin/main` on the date of writing.

This document is the integration substrate for Patch 11: where each improvement area can land,
which files it owns, which gate proves it did not break anything, and how the parallel
worktrees are kept from editing the same file.

It is derived from the code, not from a plan document. Every claim below was checked against
the source at `6144b4d`.

---

## 1. Repository shape

| Layer | Location | Role |
|---|---|---|
| Game runtime | `src/game/*` (49 files) | Pure-ish gameplay systems: mutations, waves, boss phases, RNG, run state |
| Scenes | `src/scenes/{Boot,Game,Menu,UI}Scene.ts` | Phaser scenes. `GameScene.ts` 2993 lines, `UIScene.ts` 2763 lines, `MenuScene.ts` 1358 lines |
| Systems | `src/systems/*` (28 files) | IO clients, save, checkpoint, perf governor, VFX, audio, analytics, Daily |
| Platform | `src/platform/*` (9 files) | Host adapters: MAX, Telegram Mini App, generic browser, viewport |
| Server | `server/*.mjs` | Trusted score API, profiles, Daily settlement, registry, rate isolation |
| Bot | `bot/*.mjs` | Telegram bot runtime and hosting |
| Gates | `scripts/check-*.mjs`, `tests/*.mjs` | ~70 deterministic contracts, most wired into `.github/workflows/ci.yml` |

Entry point: `src/main.ts` (boot, viewport manager, Phaser game, legal overlay, release guard).

## 2. Invariant zones — what must not be broken

These are the protected contracts. A stage that edits inside one of these zones is a
**high-conflict** stage and must be sequenced, never parallelised.

| Zone | Files | Why it is protected | Gate that proves it |
|---|---|---|---|
| **Daily** | `src/game/DailyMutator.ts`, `src/game/DailyRunIntent.ts`, `src/systems/DailyHistory.ts`, `src/systems/DailyRunClient.ts`, `server/index.mjs` (daily settlement), `server/daily-upgrade.test.mjs` | Daily v2 is a versioned, server-authoritative run contract with idempotent settlement and a ticket outbox. It is **already shipped** — Patch 11 must extend, not duplicate it. | `test:daily-mutator`, `test:daily-preview`, `test:daily-v2`, `test:daily-cta`, `test:daily-history`, `server:test` |
| **B2/B4 visual sequence** | `src/game/DangerEcho.ts`, `src/game/BossPhaseCeremony.ts`, `src/scenes/GameScene.ts` (aura/telegraph), `src/scenes/UIScene.ts` (HUD boss bar) | B2 silhouette, B3 rarity hierarchy, B4 boss identity are shipped and gated. A stage that adds juice or HUD elements collides with the aura vocabulary and the 6-tick phase ring. | `test:b2b4-fixes`, `test:presentation`, `test:telegraphs` |
| **HUD** | `src/scenes/UIScene.ts` | Single largest UI surface; hosts the boss bar, mutation choice modal, safe-area layout. | `test:integration-visual`, `test:layout-diagnostics`, `test:legendary-layout` |
| **Saves** | `src/systems/SaveSystem.ts`, `src/systems/RunCheckpoint.ts`, `src/game/RunState.ts` | Versioned save with migration; a checkpoint must survive an old build. Any new persisted field needs a migration path. | `test:save`, `test:checkpoint`, `test:rollback` |
| **Performance** | `src/systems/PerformanceProfile.ts`, `src/systems/RuntimeQualityGovernor.ts`, `src/systems/VfxBudget.ts`, `src/systems/RenderDensityExperiment.ts` | Density-gated budgets, per-frame primitive caps, bundle size cap (5%). | `test:impact-budget`, `test:runtime-quality`, `test:bundle-shape`, `test:visual-matrix` |
| **Telegram webhook** | `server/telegram-webhook.mjs`, `server/telegram-users.mjs`, `bot/*` | Production webhook. **Out of scope for Patch 11** — not to be modified, only read. | `test:telegram-bot`, `test:telegram-api`, `test:telegram-compose` |
| **Scoring / contract** | `src/game/RunVersions.ts`, `src/game/RunContracts.ts`, `src/game/Challenge.ts`, `server/index.mjs` | ruleset/campaign versions are explicit; changing them invalidates the challenge/score contract. | `test:challenge`, `test:run-identity`, `test:stages` |

Global rules from `AGENTS.md` that bind every stage:
`Joystick.ts` behaviour is frozen (one-hand profile). Renderer stays Phaser-only — no GSAP,
no Matter.js, no second renderer. Codex/mastery progress is **informational only** and must
never grant permanent damage/HP/movement/RNG. No secrets in the repository. Never commit
directly to `main`.

## 3. The nine Patch 11 areas and their landing zones

Legend for **Status**: `exists` = the capability already exists in `6144b4d`; `new` = nothing
of the kind exists yet.

| # | Area | Status | Primary landing zone | Conflict risk | Ownership |
|---|---|---|---|---|---|
| 1 | **Core optimisation** | exists | `src/game/*` hot loop, `src/systems/PerformanceProfile.ts` | **High** — touches the game loop, which is also the B2/B4 and perf-gate surface | sequential only |
| 2 | **Juice** (game feel) | exists | `src/game/ImpactDirector.ts`, `src/systems/VfxSystem.ts`, `src/systems/Sfx.ts`, `src/game/BiologicalImpact.ts`, `src/game/HeartbeatPulseDirector.ts`, `src/systems/AtmosphereSystem.ts` | **High** — same files as B2/B4 ceremony and the impact budget | sequential only |
| 3 | **TMA adaptation** (Telegram Mini App) | exists | `src/platform/*` | **Low** — `src/platform/` is self-contained and not owned by any other area | parallel-safe |
| 4 | **Analytics** | exists | `src/systems/AnalyticsClient.ts` (+ `server/index.mjs` event sink) | Medium — server side is shared with score/Daily registry writes | client parallel, server sequential |
| 5 | **Quests** | **new** | no quest system exists. Nearest neighbours: `src/game/DailyMutator.ts`, `src/game/RunMilestones.ts` | Medium — must not re-implement Daily | parallel, but read-only on Daily files |
| 6 | **Achievements** | exists | `src/game/AchievementSystem.ts` (9 ids), surfaced in `src/scenes/MenuScene.ts` (in-game Codex) | **High** — the Codex screen is inside `MenuScene.ts`, which also owns Daily UI | sequential, or split as a new module + thin MenuScene hook |
| 7 | **Laboratory** | **new** | no laboratory exists. Constrained by `PLAN.md`: permanent stat-grind meta progression is **deferred**; Codex/meta progress must stay cosmetic/informational | Medium — new system, but must not introduce permanent power | parallel-safe as a new module |
| 8 | **Skins** | **new** | no skin system exists. Player art lives in `src/game/Player.ts`, `src/game/StrainZeroTextures.ts`, `src/game/BiologicalAnimation.ts` | **High** — player geometry is B1/B2 visual territory | sequential |
| 9 | **Interfaces** | exists | `src/scenes/UIScene.ts`, `src/scenes/MenuScene.ts`, `src/game/UiCopy.ts` | **High** — shared with every other area that draws anything | sequential |

### Findings that change the plan

1. **Areas 5 (quests) and 7 (laboratory) are greenfield.** They are the only two areas that can
   be implemented in full isolation, because nothing equivalent exists to collide with. Both
   must respect the `PLAN.md` deferral: a laboratory that grants permanent stat power is
   out of contract; an informational laboratory is in contract.
2. **Area 3 (TMA) is the only shipped area that is already isolated.** `src/platform/` is
   imported by `src/main.ts` and `src/scenes/*` but owns none of the protected zones. This is
   why it is a valid first stage.
3. **Area 4 (analytics) already has 22 event types** (`src/systems/AnalyticsClient.ts:4-27`)
   and a server sink that persists into the registry store
   (`server/index.mjs:266`). "Analytics" is most likely *extension*, not creation — the risk
   is duplicating events that already exist.
4. **Areas 1, 2, 6, 8, 9 are not parallel-safe.** They all funnel through
   `GameScene.ts` / `UIScene.ts` / `MenuScene.ts`. Running two of them in parallel in separate
   worktrees will produce conflicts that have to be resolved by hand, and the file-overlap
   guarantee the owner asked for cannot be honoured for them.

## 4. Worktree topology

One worktree per stage, one branch per stage, **no two stages may own the same file**.
Worktrees live outside the main checkout so the main tree stays clean and on `main`.

| Stage | Branch | Worktree | Owns (exclusive) |
|---|---|---|---|
| 1 — TMA adaptation | `feat/patch11-tma-adaptation-20261022` | `/workspace/worktrees/patch11-tma` | `src/platform/PlatformBridge.ts`, `src/platform/TelegramPlatform.ts`, `src/platform/index.ts`, `src/platform/ViewportManager.ts`, `scripts/check-telegram-tma.mjs` |
| 2 — integration map | `docs/patch11-integration-map-20261022` | `/workspace/worktrees/patch11-map` | `docs/patch11/*` |
| 3+ — one per area | `feat/patch11-<area>-<date>` | `/workspace/worktrees/patch11-<area>` | assigned from the table in §3, one area per worktree |

### Shared-file rules

- **`memory/**` is excluded from every stage branch.** The repository already excludes it from
  the Render deploy and the repo's own history records "scoped PR branches deliberately
  exclude shared memory". Memory is updated once, in the integration branch, after the stages
  are accepted. Editing `memory/*.md` in two stages at once is a guaranteed conflict.
- **`.github/workflows/ci.yml` is the one file that several stages touch.** Every stage adds a
  gate, and every gate needs a CI step, so a stage branch edits `ci.yml`. That is accepted
  deliberately: a stage PR that does not run its own gate in hosted CI is worth less than the
  convenience of never touching a shared file. The rule is therefore that **no other file is
  shared**, that each stage adds only its own named CI step, and that the stages are rebased
  onto `main` in sequence at integration time, where the accumulated `ci.yml` steps are
  reconciled. The steps are independent one-line additions, so the reconciliation is trivial.
  `package.json` is treated the same way: each stage adds its own `test:<name>` script.
- **`src/scenes/*` is a single-owner zone.** Only one stage may own `GameScene.ts`,
  `UIScene.ts` or `MenuScene.ts` at a time. The owner sequence in §3 already enforces this.

### What stage 1 actually did

Stage 1 follows the rule above: `feat/patch11-tma-adaptation-20261022` adds
`scripts/check-telegram-tma.mjs`, the `test:telegram-tma` npm script and its own CI step, and
touches no other file outside `src/platform/`. The `ci.yml` step is the single deliberate
exception to file ownership, and it exists so that the stage PR is self-verifying in hosted CI.
The stage branch and this branch were merge-tested: the two merge cleanly, because the only
overlap is one independent CI step and one npm script.

Stage 1 was also independently reviewed against the real Telegram WebApp SDK by a second
MiniMax session, which wrote its own mutation harness for the new gate. The review refuted
eight points, and all eight were addressed before the stage was frozen: the Telegram
`activated` event now carries the swipe-lock re-apply, the lock is verified through
`isVerticalSwipesEnabled` because older clients accept the call and ignore it, a late SDK is
adopted through a bridge-ready signal, and the gate now covers the adapter selection, the
adapter-swap re-bind, the unsubscribe intent and the real SDK event-bus semantics. Twelve
mutations of `src/platform` are all caught by the gate. **The reviewable pattern for later
stages is therefore: verify host contracts against the vendor SDK, and prove the new gate
catches deliberate mutations of the code, not only that it passes.**

## 5. Verification protocol per stage

Every stage must clear, on its own branch head, before a draft PR is prepared:

1. `npx tsc --noEmit` — typecheck.
2. The stage's own new gate, plus the gates of every protected zone it could reach.
3. `npm run server:test` if the stage touched `server/`.
4. `npm run build` then `npm run test:bundle-shape` — bundle size against the 5% cap.
5. An independent review that did not write the code.
6. Explicit reporting of anything **not run** and why. A gate that did not execute is
   `NOT_RUN`, never `PASS`.

## 6. Open blockers

- **The 14 Muse patch sources are not reachable from the implementation environment.** They
  live in a local Windows package (`ofeliya-bundle`) and a prepared-material folder. They are
  not in the repository, not in git history, and not in the Drive. The area list in §3 is
  therefore derived from the owner brief plus the code, and the per-patch acceptance criteria
  are not yet available.
- **The GitHub connector is unavailable**, so a branch can be prepared locally but the draft
  PR cannot be opened from this environment until the connector recovers or a token is
  supplied.
- **The MiniMax API key is not present**, so Codex cannot execute against MiniMax yet; the
  provider profile is installed and verified up to the credential boundary.

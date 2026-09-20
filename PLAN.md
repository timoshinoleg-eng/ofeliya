# OFELIYA: STRAIN ZERO — Current Plan

Updated: 2026-09-20

This file is the short execution plan for the current product. It replaces the original September 6 prototype plan.

Canonical references:

- product/gameplay: `STRAIN_ZERO_PRODUCT_BIBLE.md`;
- runtime architecture: `ARCHITECTURE_NOTES.md`;
- release evidence and external device gate: `RELEASE_VALIDATION.md`;
- provenance: `THIRD_PARTY_NOTICES.md`.

## Current product

OFELIYA is a portrait roguelite-survivor for MAX Mini Apps about a synthetic virus inside a living organism.

Live campaign:

`КРОВОТОК -> IMMUNE PRIME -> СЕРДЦЕ -> CARDIAC TITAN`

Target campaign length is roughly 9+ minutes before boss fight duration is added:

- Bloodstream: 5:00 before `IMMUNE PRIME`;
- Heart: 4:00 before `CARDIAC TITAN`.

The old 3–5 minute single-stage/cyber-arena concept is historical and must not be used as a current design contract.

## Live systems

Already implemented in `main`:

- one-hand floating joystick and optional two-hand twin-stick aim-priority;
- stage-local build reset with run-wide history preservation;
- host-cell infection/lysis build family;
- distinct swarm / runner / brute behaviors;
- two boss fights with phase mechanics;
- Heart synchronization safe-pocket loop;
- 3 Critical Mutations;
- 6 Legendary mutations, max 2 per run;
- Standard and Strained difficulty;
- deterministic run seed and versioned challenge/score contracts;
- trusted MAX score backend and leaderboard paths;
- result screen with two-stage build history;
- Codex for Critical Mutations / Legendary discovery / achievements;
- Standard and Strained completion mastery without permanent stat power;
- WebGL/Canvas fallback and full/reduced presentation tiers;
- 100/150/200-enemy release visual matrix with luminance/edge-readability gate.

## Current priorities

1. Balance from complete real runs rather than isolated unit tuning.
2. Validate Heart safe-pocket timing and both boss phases through playtest.
3. Validate one-hand and twin-stick ergonomics on real MAX Android/iOS clients.
4. Keep 100/150/200-enemy captures readable when visual changes land.
5. Keep score/ruleset/campaign versions explicit for competitive changes.
6. Keep Codex/meta progression cosmetic/informational unless a separate design migration explicitly changes that rule.

## Deferred product expansion

Do not add these opportunistically inside unrelated PRs:

- third organ / additional campaign act;
- additional difficulty above Strained;
- large Legendary/content expansion;
- permanent stat-grind meta progression;
- broader external art/audio pipeline;
- major architecture rewrite or renderer migration.

Each requires its own design migration and acceptance criteria.

## Release gates

Automated:

- deterministic compatibility/unit smokes;
- TypeScript/Vite production build;
- MAX viewport/browser suite;
- WebGL High-DPI and Canvas fallback;
- Legendary, difficulty, boss, Heart, control-mode and campaign smokes;
- trusted score/backend production contract;
- release visual matrix: 100/150/200 × WebGL/Canvas × full/reduced.

External/manual before public release:

- real MAX Android;
- real MAX iOS;
- cold start and resume;
- native BackButton;
- native share/deeplink;
- haptics/audio unlock;
- repeated run/restart lifecycle;
- dense late-run performance and boss pacing.

## Implementation rule

Do not treat historical sprint documents as current source of truth. If a document conflicts with `STRAIN_ZERO_PRODUCT_BIBLE.md` or `ARCHITECTURE_NOTES.md`, update the stale document before using it to drive new systemic work.

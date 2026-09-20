# OFELIYA: STRAIN ZERO — Release Validation

Updated: 2026-09-20

This document separates automated evidence from the remaining real-device MAX gate. A green GitHub Action is not treated as proof that native MAX Android/iOS behavior, network conditions or device performance are correct.

## 1. Current release contract

Live campaign:

`КРОВОТОК -> IMMUNE PRIME -> СЕРДЦЕ -> CARDIAC TITAN`

Live product systems include:

- one-hand floating joystick and optional twin-stick aim-priority;
- host-cell infection/lysis buildcraft;
- 3 Critical Mutations;
- 6 Legendary mutations, maximum 2 per run;
- Standard and Strained difficulty;
- Heart synchronization timing;
- two boss phase fights;
- versioned seeded challenge/score contract;
- trusted MAX score backend;
- Codex discovery and non-power Standard/Strained mastery;
- WebGL/Canvas fallback and full/reduced presentation tiers.

The canonical gameplay/design contract is `STRAIN_ZERO_PRODUCT_BIBLE.md`.

## 2. Canonical automated build gate

Node.js 22 application contract:

```bash
npm ci
npm run test:challenge
npm run test:save
npm run test:stages
npm run test:legendary
npm run test:difficulty
npm run test:rng
npm run test:viewport
npm run release:check
npm run build
```

These checks cover:

- challenge payload compatibility and validation;
- backward-compatible save migration;
- stage lifecycle and two-act campaign state;
- Legendary eligibility/pity/trophy reservation;
- Standard/Strained deterministic rules;
- seeded gameplay RNG;
- viewport math;
- startup renderer contract;
- mandatory MAX/legal release configuration;
- TypeScript typecheck and Vite production build.

## 3. Browser / MAX-mock gate

The permanent Chrome browser job uses a mocked MAX Android bridge and exercises the actual Phaser runtime.

Current coverage includes:

- MAX viewport and safe-area behavior;
- incoming challenge menu and result verdict;
- legal/privacy/support surface;
- Codex and mastery tabs;
- compact 320×568 layouts;
- WebGL High-DPI and Canvas fallback;
- Legendary runtime and reveal ceremony;
- seeded gameplay runtime;
- trusted score client flow;
- IMMUNE PRIME vulnerability behavior;
- Strained runtime;
- elite modifier identity;
- one-hand and twin-stick multitouch behavior;
- dense readability;
- Bloodstream -> Heart transition and campaign lifecycle.

The job uploads screenshots as the `max-browser-smoke` artifact for visual inspection.

## 4. Dense visual quality gate

A separate release visual matrix runs the same seeded dense-combat contract at:

- 100 / 150 / 200 active enemies;
- WebGL / Canvas;
- full / reduced presentation tier.

Total: 12 production-style captures.

The matrix verifies structural parity and also measures image luminance and edge energy. This gate exists because a previous full-WebGL camera postFX path could pass structural tests while making dense combat visibly darker and softer.

Gameplay camera postFX is therefore not the mechanism that differentiates presentation tiers. Full mode remains richer through bounded ambient/VFX density while keeping the gameplay plane sharp.

## 5. Trusted competitive score contract

`window.WebApp.initDataUnsafe` is never trusted as authentication.

For competitive score submission:

- the client sends signed `window.WebApp.initData`;
- the backend validates MAX identity;
- the backend validates score bounds and deduplication;
- current score records carry explicit ruleset/campaign/difficulty/completion/seed fields;
- canonical ranked eligibility is Standard;
- Strained mastery remains separate from the ranked Standard record.

Challenge payloads remain untrusted social context and do not prove a result.

## 6. Save / meta-progression contract

`ofeliya_save_v1` remains backward compatible.

Current persistent local history includes:

- survival / Boss 1 / full campaign records;
- kills, runs and highest level;
- achievements;
- discovered Critical Mutations;
- discovered Legendary mutations;
- Standard campaign clear count;
- Strained campaign clear count and personal Strained record.

Codex/mastery is informational/collectible progression. It does not add permanent damage, HP, movement, RNG or other run-start power.

## 7. Production contract

The `production-contract` CI job validates:

- score server tests;
- MAX bot smoke;
- Strain Zero release contract;
- Cloud.ru deployment script syntax;
- production compose configuration;
- production bot image;
- production score image;
- production static image;
- nginx configuration.

A green production-contract job proves repository/deployment consistency, not that a specific external production VM is currently serving that exact commit.

## 8. Remaining external gate

Before a public release candidate is considered fully validated, test the real MAX clients.

Required manual matrix:

1. Android MAX cold launch -> playable portrait viewport/safe area.
2. iOS MAX cold launch -> playable portrait viewport/safe area.
3. Background -> foreground resume without blank/stretched canvas or duplicated audio.
4. Orientation/viewport transitions do not lose controls or HUD.
5. Native BackButton closes overlays and exits active-run states without stale listeners.
6. Haptics fire only when supported and never throw otherwise.
7. Native share contains the correct challenge deeplink.
8. Opening the shared deeplink restores the expected challenge context.
9. Audio unlock works after the first permitted user interaction.
10. Repeated menu/run/restart cycles show no lifecycle degradation.
11. Dense late Bloodstream and Heart combat remain playable on a representative mid-range Android.
12. IMMUNE PRIME and CARDIAC TITAN phase pacing feels readable, not only technically valid.
13. Heart safe-pocket timing is understandable and reachable with one-hand controls.
14. Twin-stick aim-priority is usable without accidental movement/aim cross-talk.
15. Real developer/legal/support values match the verified MAX profile.
16. Trusted score submission succeeds with real signed MAX initData.

## 9. Current product risks that CI cannot settle

- final balance of complete 9+ minute runs;
- real-device input ergonomics;
- network latency/failure behavior in actual MAX sessions;
- boss pacing and Heart timing feel;
- thermal/performance behavior on target phones;
- whether current meta goals create repeat play without becoming grind.

Those require playtest/device evidence rather than more deterministic code assertions.

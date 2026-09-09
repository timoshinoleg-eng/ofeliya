# OFELIYA: STRAIN ZERO — Release Validation

Validation scope: PR #16, branch `feat/strain-zero-redesign`.

This document separates **automated/browser evidence** from the remaining **real MAX client gate**.
A green GitHub Action is not treated as proof that native MAX Android/iOS behavior is correct.

## 1. Product / art gate

Accepted visual direction: microscopic biopunk **STRAIN ZERO**.

Final full visual art capture before release-hardening remediation:

- GitHub Actions run `34323874307`;
- artifact `strain-zero-art-qa-v6`;
- mobile viewport `390 × 844`;
- captured menu, opening combat, first mutation, immune cast, infected host cell, lysis and
  critical-mutation ceremony.

Validated visually:

- first-run tutorial is removed before mutation modal;
- enemies/virus/host cell remain readable on mobile;
- host-cell infection -> rupture -> RNA release is visually causal;
- no generic cyber-art rollback is required.

## 2. Canonical automated gate

Node.js 22.

Build job:

```bash
npm ci
npm run test:challenge
npm run test:viewport
npm run release:check
npm run build
```

Checks cover:

- challenge payload encode/decode;
- invalid/oversized payload rejection;
- clear-faster / survive-longer challenge semantics;
- deterministic MAX viewport + safe-area frame math;
- mandatory release config presence and format;
- TypeScript production typecheck;
- Vite production bundle.

`npm run build:max` is the publication command. It runs the release-config guard first and refuses
incomplete/placeholder MAX bot or legal/support values.

## 3. Permanent Chrome MAX-mock gate

CI contains a second `browser-smoke` job using system Chrome plus a mocked MAX Android bridge.
The host browser viewport is `390 × 844`; MAX returns an available viewport of `360 × 760`.

The smoke verifies:

- platform facade resolves MAX rather than browser fallback;
- `getViewportSize()` is applied to the `#game` host and Phaser scale;
- MAX display name from `first_name` + `last_name`;
- incoming `start_param` challenge;
- `ВЫЗОВ ПОЛУЧЕН` and `ПРИНЯТЬ ВЫЗОВ` menu UI;
- in-app `О приложении / Политика / Поддержка` surface using configured release values;
- challenge result verdict;
- result stats stay within the mobile viewport bounds;
- `БРОСИТЬ ВЫЗОВ` is backed by a real interactive Phaser control;
- MAX share receives a generated `https://max.ru/<bot>?startapp=...` deeplink;
- captured browser page errors fail the job.

The job uploads current menu/result screenshots as `max-browser-smoke` for visual review.

## 4. MAX viewport / lifecycle hardening

`ViewportManager`:

- calls `PlatformBridge.getViewportSize()`;
- falls back to window dimensions only when the host cannot provide a viewport;
- applies CSS `safe-area-inset-*`;
- resizes the Phaser scale to the final safe frame;
- re-syncs on resize, orientation change and `visibilitychange -> visible`;
- retries after boot to cover a late MAX CDN bridge.

Platform selection is call-time/late-safe, so a slow `max-web-app.js` cannot permanently select the
browser adapter during early module evaluation.

Existing Game/UI lifecycle cleanup remains in place for resize listeners, BackButton handler,
postFX and bounded VFX/gameplay systems.

## 5. Audio lifecycle

- music fetch is abortable and generation-guarded;
- `stopMusic()` cannot be followed by a stale async load starting playback;
- muted runs avoid unnecessary music startup;
- failed SFX loads can retry;
- transient `AudioBufferSourceNode`/GainNode and procedural oscillator/GainNode pairs disconnect on
  `ended` rather than accumulating for the life of the AudioContext.

## 6. Legal/privacy/support gate

Menu contains a user-facing legal/support entry. The overlay contains:

- app identity/version;
- developer/operator legal fields;
- registration/address/support contact fields;
- privacy notice reflecting the current no-backend/local-storage architecture;
- challenge-data explanation;
- terms of use;
- support instructions/contact.

Actual legal values are **not guessed or committed**. They must be injected from the verified MAX
developer profile during the release build. `.env.example` documents the required keys.

## 7. Third-party provenance

See `THIRD_PARTY_NOTICES.md`.

Known repository provenance is recorded for Kenney CC0 SFX, OpenGameArt CC0 music imports and
Chakra Petch OFL font files. The early music import did not preserve a per-file upstream item mapping;
recovering that mapping, if available from the original download notes, remains a documentation
hardening item and individual authors/titles must not be invented.

## 8. Known non-blocking build/performance notes

The Phaser-heavy main bundle remains relatively large and Vite can emit a chunk-size warning.
Music is external and lazy-loaded, but individual tracks are still materially larger than SFX.
Neither fact is treated as a build failure; **cold-start and dense-combat performance must be measured
on target MAX devices before public release**.

PerformanceProfile is the single authority for full/reduced presentation tier. Reduced mode removes
presentation cost without changing enemy density/gameplay.

## 9. Remaining external gate — VIR-16

PR #16 must remain draft until a release-candidate build with real deployment values passes in the
actual MAX clients.

Required pass/fail matrix:

1. Android MAX: cold launch -> playable, portrait viewport/safe area.
2. iOS MAX: cold launch -> playable, notch/home-indicator safe area.
3. Background -> foreground resume without blank/stretched canvas or duplicated audio.
4. Orientation/viewport transition does not lose controls/HUD.
5. Native BackButton returns from active run without stale listeners/music/postFX.
6. Haptics fire only on supported clients and never throw on unsupported clients.
7. Share opens native MAX flow and contains the real `VITE_MAX_BOT_NAME` challenge deeplink.
8. Opening the shared deeplink restores the expected `start_param` challenge.
9. Audio unlock works after the first permitted user interaction.
10. Ten run/restart/menu cycles show no visible lifecycle degradation.
11. Late-run dense combat and `IMMUNE PRIME` phase remain playable on the target mid-range Android.
12. Real developer/legal/support values displayed in the legal overlay match the verified MAX profile.

Only after this matrix passes should PR #16 move from Draft to Ready for review / merge.

Boss/difficulty tuning remains explicitly outside this release-hardening scope.

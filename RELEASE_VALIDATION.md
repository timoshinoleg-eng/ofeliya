# OFELIYA — Release Validation

Validation scope: Visual & Engagement Sprint v1 (`feat/visual-engagement-sprint-v1`).

## Automated build gate

- Node.js 22
- `npm ci`
- `npm run build` (`tsc --noEmit && vite build`)
- dependency audit during validation reported 0 vulnerabilities

## Browser smoke

The one-time release smoke ran in headless system Chrome on GitHub Actions and was removed after the successful run.

Validated on:

- 390 × 844, audio enabled
- 430 × 932, saved mute enabled

Both viewport runs passed:

- MAX mock greeting via `first_name` + `last_name`;
- MAX BackButton hidden on Menu;
- Phaser/canvas viewport sizing;
- 10 consecutive Game scene restarts;
- resize listener stability (`8 -> 8 -> 8` before/after restarts/result retry);
- mobile level-up modal bounds;
- PRISM evolution eligibility, application and ceremony rendering;
- dense combat setup with 150 active enemies;
- boss spawn at 5:00 with unchanged `2600 / 2600` HP contract;
- game-over result screen;
- real pointer click on the primary `ЕЩЁ РАЗ` control;
- successful immediate run restart;
- no captured browser page errors.

## Release hardening included

- MAX user schema aligned to current `first_name` / `last_name` fields.
- Signed `window.WebApp.initData` exposed separately from untrusted `initDataUnsafe`.
- MAX BackButton/viewport helpers integrated with safe capability checks.
- Stale asynchronous music loads cannot start playback after `stopMusic()`.
- Muted runs do not start music loading; failed SFX loads may retry.
- Survival record and boss-clear record use separate max/min semantics with save migration.
- Menu resize listener is removed on scene shutdown.

## Known non-blocking build note

Vite reports the main JS chunk at roughly 1.55 MB minified (~363 KB gzip), above the configured 1500 KB warning threshold. This is a release-size optimization item, not a functional blocker for this sprint.

Boss difficulty/balance tuning remains intentionally outside this sprint.

# Task 5 independent scoped review

Reviewed frozen `2fbda8d..97d0075` in `ofeliya-vo05`, including `3de91b7` test recovery and `97d0075` memory handoff, against Task 5 plan and DESIGN_20261007.md. Read-only code review; no browser, code edits or delegated work.

**Verdict: approved for coordinator runtime acceptance. No Critical or Important source findings.** This is not completion of browser/device release gates.

## Confirmed

- All seven canonical backings use factor 4 and exact old logical dimensions, including T-cell 44×40. Both generated and procedural paths get the same backing. Unknown/noncore keys retain factor 1; projectile/RNA, host infection overlay, organ sources and combat atlas remain unchanged.
- Player/enemy display scales divide by 4 while circle radius and offsets multiply by 4. This preserves sourceWidth×scale and offset×scale exactly (power-of-two factor), including Phaser Arcade's existing halfWidth/halfHeight floor and resulting center offset. Checked installed Phaser `Body.setCircle`, `updateBounds`, `updateFromGameObject`, and World circle collision use of halfWidth. No attempt to erase existing engine rounding.
- Enemy activation resets texture/scale/body on role recycling; all role/boss transforms apply the factor once. Existing animation formulas/timers and logical enemy radius stay unchanged. Game trail/reset and Menu portraits/tween endpoints are compensated.
- Ambient and interactive host spawn/update/restore/reset are compensated. Rupture recovers logical host scale before applying unchanged overlay/ring/fragment geometry. Manual infection/lysis radii and checkpoint content are untouched.
- Boot uses distinct raw keys and per-key canonical guards. Installed Phaser image API accepts the third argument as XHR settings. 1800ms limits image XHR; missing keys get procedural pixels. Canonical refresh precedes raw texture removal, splash removal and Menu start. No external image URL or unsafe resolution override.
- Test updates to earlier VFX/atmosphere expectations account for intentional source backing growth and retain their unrelated geometry checks; they do not weaken readability thresholds. 15 core-art tests execute production code against explicit adapters. Recovery report/HANDOFF accurately disclose adapter limits, mutation status and unavailable browser evidence.

## Independently run

- `node tests/core-art.mjs`: 15/15 pass.
- `npx tsc --noEmit`: exit 0 (existing npm http-proxy warning).
- `git diff --check 2fbda8d..HEAD`: exit 0.

## Remaining evidence gates

Coordinator must still establish actual missing/stalled XHR startup, Phaser WebGL/Canvas display/body bounds and centers versus recorded baseline across breathing/role/recycling/reset, controls and elite/readability/visual matrix. Adapter tests do not simulate loader scheduling/image decode, real body updates, or visible pixels. Existing untracked `.vo05-mutant.mjs` is outside reviewed production diff and should remain excluded from commits. Real MAX/Telegram/device gates remain external.

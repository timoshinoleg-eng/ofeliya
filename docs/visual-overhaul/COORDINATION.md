# OFELIYA Visual Overhaul — 2026-10-07

Goal: clear, modern, professional premium microscopic biopunk; pleasant gameplay presentation.
Base: d7797bc67bbda063d2fc3de68026101b0b061121. Branch: visual/vo-01-render-clarity-20261007.

ChatGPT coordinates scope, evidence and corrections. Codex diagnoses/implements VO-01. Kimi independently reviews the frozen candidate. ChatGPT evaluates actual captures; MAX acceptance requires a real device.

VO-01 starts with READ-ONLY diagnosis of canvas CSS/intrinsic dimensions, GL drawing buffer, DPR, logical scale/camera/input and installed Phaser 3.90 APIs. HiDPI as proposed in prior audit is a hypothesis. Do not assume a resolution config property works with RESIZE. If the required architecture is broader, propose diagnostics first.

Retain Canvas text guard/fallback, safe areas, MAX/Telegram, physics/input/score/RNG/balance, one-hand Joystick and release guards. No bloom/art/audio/VFX changes in VO-01. Bounded QA/debug diagnostics; no personal data. Before/after captures must use same viewport, renderer and scenario. SwiftShader evidence does not certify mobile FPS. No gate weakening or unrelated fixes.

Future sequence: VO-02 contact feel; VO-03 VFX floor; VO-04/05 organ atmosphere; VO-06 audio; VO-07 art vertical slice; VO-08 animation; VO-09 HUD; VO-10 visual/device QA. Accept each candidate first. One writer per branch. No push/merge/deploy in this packet.

Preflight: native Codex CLI 0.160.0 logged in using ChatGPT; Kimi CLI 1.41.0 installed, completion unverified. OmniRoute health timed out; Gateway ports 20129/20130 not listening. Initial probe uses native Codex instead of claiming the router is healthy.

# Stage 4 video interstitial preparation

Prepared after real-device readability V3 at f450183b7b4cc0885b1a45876b8685c217c53336.

## Integration priority

1. Existing 02_bloodstream_to_heart.mp4 — first.
2. Existing 01_start_intro.mp4 — only after Menu is interactive; never part of boot.
3. Existing 04_defeat.mp4.
4. New 06_victory_canonical.mp4.
5. Boss intros are P2 and must not delay the first four integrations.

03_victory_candidate.mp4 remains non-canonical because of foreign blue/jellyfish-like organisms. 05_atmospheric_background_candidate.mp4 remains optional.

## Newly reviewed Gemini sources

All four supplied sources are H.264, 720x1280, 24 fps, yuv420p, about 10 seconds, with AAC audio.

| Production filename | Source | Use |
| --- | --- | --- |
| 06_victory_canonical.mp4 | gemini_generated_video_3d08aab9.mp4 | canonical campaign Victory |
| 07_immune_prime_intro.mp4 | gemini_generated_video_9ed430bf.mp4 | IMMUNE PRIME intro, P2 |
| 08_cardiac_titan_intro.mp4 | gemini_generated_video_a9a54fc9.mp4 | CARDIAC TITAN intro, P2 |
| 09_cardiac_titan_intro_alt.mp4 | gemini_generated_video_de35cf48.mp4 | backup/reference only |

### Visual decisions

The 3d08aab9 source reads as victory: the central virus survives pale immune fragments and expands into a connected biological network. The original begins generating fake mobile UI controls near the frame edges after roughly 7.5 s; those frames must never ship. The prepared production cut ends before those artifacts and fades out cleanly.

9ed430bf is the cleaner/slimmer pale sentinel and is the preferred IMMUNE PRIME identity. a9a54fc9 is the preferred CARDIAC TITAN take: heavier, more organic-armored. de35cf48 is a near-duplicate but more overtly mechanical, so it is backup only.

## Prepared production encodes

Destination: public/video/. All prepared files are 720x1280 vertical 9:16, H.264 Main profile level 3.1, yuv420p, 24 fps, no audio, faststart MP4, CRF 23, with clean fade-out.

| File | Duration | Approx size | SHA-256 |
| --- | ---: | ---: | --- |
| 06_victory_canonical.mp4 | 7.58 s | 1.7 MB | 4a2ce19083e468e32a71f4a96e4b5f17fc873b043839483dcd3c130f9bace57d |
| 07_immune_prime_intro.mp4 | 8.50 s | 1.3 MB | ed19ca326c3e387463aa15f5c8edcb275fdd8d56c23eb0d9ddd3ac3ed6e537d8 |
| 08_cardiac_titan_intro.mp4 | 8.50 s | 1.3 MB | 3098aa548b22a184f40bdb0dc7f430fd0d067c8921a580bf1076649f25ac1011 |
| 09_cardiac_titan_intro_alt.mp4 | 8.50 s | 1.5 MB | 420dd55a8b41bdb791e38fb0549ba1878ac9c7cad8c8087a1dffa6b263a94755 |

## Runtime contract

- Video is an enhancement, never a prerequisite.
- Do not create/load video before Menu is interactive.
- Use muted and playsInline; audio is not required for understanding.
- Default to preload=metadata; promote to auto only in the relevant active gameplay stage.
- Any fetch/decode/autoplay/stall/abort error must immediately use the existing procedural cinematic.
- No waiting spinner. Keep procedural/Canvas fallback permanently.
- Suggested playback-start watchdog: 900 ms.
- Tap-to-skip must remain available.
- Video completion must call the same transition-completion path as the procedural fallback.

## Suggested preload points

- Bloodstream -> Heart: during Bloodstream after the run is interactive.
- Start Intro: only after Menu/new-run intent.
- Defeat/Victory: during active run; Victory specifically during Heart.
- IMMUNE PRIME: late Bloodstream, P2.
- CARDIAC TITAN: late Heart, P2.

## Code hook map

- Bloodstream -> Heart: UIScene.showStageTransition(...) is the presentation boundary; GameScene.beginStageTransition/commitStageTransition owns the 2.4 s transactional lifecycle. Video must not own state mutation. It should call the same existing skip/commit callback used by the procedural overlay.
- Boss intros: UIScene.showBossReveal(...) is the procedural fallback for IMMUNE PRIME and CARDIAC TITAN. P2 video replacement belongs here behind a small optional video presenter, with the current tween reveal unchanged as fallback.
- Victory/Defeat: GameScene.finish(...) must continue to create runResult, save records/checkpoints, play SFX and pause Game. UIScene.showGameOver(...) should decide whether to show a video interstitial before revealing the existing result UI. Result persistence must never wait on video.
- Start intro: MenuScene start intent is the earliest allowed trigger. Do not touch index.html/BootScene/startup diagnostics.
- Recommended abstraction: one VideoInterstitial helper/service that accepts src, maxStartWaitMs, maxDurationMs and onComplete, guards completion idempotently, and falls back without throwing into scene code.

## Acceptance for the integration PR

1. Cold boot reaches Menu with video requests blocked.
2. Each video path may 404 and procedural flow still completes.
3. video.play() rejection falls back immediately.
4. A deliberately stalled video triggers fallback inside the watchdog.
5. Skip cannot double-complete a transition.
6. Gameplay cannot resume early behind an active interstitial.
7. Startup trace, pause, checkpoint resume, controls and full-campaign smokes remain green.
8. Public video assets are cacheable while HTML/runtime-config keep current freshness behavior.

# OFELIYA video assets

This directory is reserved for optional Stage 4 cinematic MP4 assets.

Expected production files, in integration order:

- 01_start_intro.mp4
- 02_bloodstream_to_heart.mp4
- 04_defeat.mp4
- 06_victory_canonical.mp4
- 07_immune_prime_intro.mp4 (P2)
- 08_cardiac_titan_intro.mp4 (P2)

09_cardiac_titan_intro_alt.mp4 is backup/reference only and should not be fetched by production runtime.

Runtime requirements: muted, playsInline, lazy preload after the game is interactive, immediate procedural fallback on any load/decode/playback failure, no spinner, tap-to-skip.

Do not add a video request to index.html, BootScene, or any startup-critical path.

See ../../VIDEO_STAGE4_PREP.md for hashes, source mapping and acceptance criteria.

# Samsung combined experiments implementation plan

**Goal:** Prepare one QA-only candidate on c3093a9 to compare archived combat and carry-stack experiments, and preview selected H3 transition media on S20+.
**Architecture:** Preserve ordinary run defaults and expose archived paired experiments only through the QA gate; use isolated opt-in video alternatives. Keep previous QA build available.
**Stack:** Phaser 3.90, TypeScript, Vite, Chromium.

- Import geometry source-identity and phone QA candidate; verify enemy identity, pool reuse, QA gate and default behavior.
- Integrate carry-stack paired experiment against current transition and trophy UI; verify reset, once-only application, checkpoint and gate-off.
- Inspect H3 candidates and validate playable metadata, fallback, skip and bounded loading before enabling only an opt-in preview.
- Run integrated result, trophy, mutation, gate and build checks; record exact limitations and prepare one SHA for S20+ and a draft PR.

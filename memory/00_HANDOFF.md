# OFELIYA release handoff — 2026-10-08

The user explicitly authorized merge and production deployment after the visual continuation report. PR179/180/181 are MERGED, with history-preserving merge commits9c05b256/acfd040a/50c47049. Main target: 50c47049b61380921c02a62831a486598c8984bd. Its tracked product tree exactly matches independently checked cf5f0cf. Original feature/divergent branches retained; no reset/stash/delete/force push.

Main CI37763374322 is running; final target visual matrix37763538350 PASS. Deployment must wait for exact-main push CI success and dispatch deploy-cloudru.yml with the full immutable target SHA. Production URL from cloudru-production environment: https://ofeliya.freeveol.dpdns.org/ofeliya/. Production Dockerfile uses build:max and does not pass VITE_RELEASE_MATRIX_QA; density2 remains opt-in QA only.

Final release outcome will be appended to this handoff after the workflow and public release/hash parity checks. Do not infer deployment from merge or CI. Previous successful workflow deployed d7797bc; local/web public reads timed out/failed, so fresh rollback marker must come from the deployment workflow.

Existing evidence: docs/visual-overhaul/VO_TRACEABILITY_20261008.md, CONTINUATION_ACCEPTANCE_20261008.md and HIDPI_FEASIBILITY_20261008.md. All original PR checks passed. Physical MAX Android/iOS + Telegram acceptance remains unverified; full authored music/stems/art/charge/hit/death scope remains partial. User authorization permits this scoped release, not a fabricated device sign-off or automatic HiDPI activation.

Review mode: confirm/refute/questions from current checkout/GitHub/public evidence. Preserve prior artifacts and parallel worktrees.

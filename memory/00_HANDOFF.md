# OFELIYA production handoff — verified 2026-10-08

User explicitly authorized merge/deploy. PR179/180/181/182 merged preserving history/branches. Production release is716292b78c5b2e53485170bcb8a4cc2780f9df04, verified at2026-10-08T12:30:45.876Z. No paid resources created; no resets/stashes/force-pushes/deletion of prior work.

Exact-main CI37775488149 PASS all3jobs; correctivePR182 CI37773729014 PASS. Deploy37777242773 PASS; runner captured public rollbackd7797bc before rollout and actually fetched public release/index/sw/runtime-config afterward. ExactSHA,3SHA256 hashes, release namespaces and MAX/Telegram/security policies agree on https://ofeliya.freeveol.dpdns.org/ofeliya/. Local Windows HTTP timed out: do not infer local availability or phone acceptance from runner proof.

Read docs/visual-overhaul/RELEASE_20261008.md for links, RELEASE_FIXTURE_ISOLATION_20261008.md and RELEASE_FIXTURE_REVIEW_20261008.md for failure history, source reviews, paired regression probes and fixture coverage limits. Exact-main artifact11549674888 inspected across24 matrix rows/two viewports. Product source matches reviewedcf5f0cf;182 changes only three fixtures/docs, not gameplay. Historical checkpoint edits preserved in branch commits. This docs branch does not change the deployed source or require another deployment.

HiDPI2x remains QA-only; ordinary production1x. Real MAXAndroid/iOS and Telegram, botURL/cache/device behavior, sustainedFPS/thermal and dense moving-battle readability remain unverified. Full authored soundtrack/stems, RNA/projectile/icon expansion and charge/hit/death cycles remain partial. Additional Kimi OmniRoute fixture review empty/504, notapproval; independent Codex reviewPASS. Earlier full Kimi polish review through existing directCLI PASS is separate evidence.

Reviewer mode: confirmed/refuted/questions from current checkout/GitHub/public evidence. Do not re-deploy or activate2x automatically. Ask the player to fully close/reopen MiniApp before checking this release. Preserve parallel worktrees/artifacts; no unrelated infrastructure or credential changes.

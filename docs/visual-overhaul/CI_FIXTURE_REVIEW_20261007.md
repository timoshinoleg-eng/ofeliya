# Hosted CI follow-up

PR: https://github.com/timoshinoleg-eng/ofeliya/pull/179

Initial a54cd90 hosted build failed five VFX contracts because Node22 exposed a low navigator.hardwareConcurrency and production correctly selected reduced. Forced two-core reproduction matched all five failures. 4c82850 selects the real full localStorage override before fixture module loading and restores the original property descriptor in finally. Production detection and reduced coverage are unchanged. All54 local presentation contracts and subsequent hosted build passed; independent review found zero Critical/Important.

Initial QA matrix failed reduced WebGL/Canvas edge ratio1.459 against unchanged upper limit1.35. Hosted artifacts showed different attack phases. An unchanged fixture retry passed, proving timing-dependent capture rather than a production correction. Cosmetic ambient placement also used unseeded Math.random.

b9156e2 scopes a saved/restored cosmetic seed to creation and samples real Sprite.preUpdate at1000ms. The first candidate missed lazy Enemy/Gem/Bullet allocation; review rejected it and root QA failed before/after input stability. 9722866 wraps lazy sprites idempotently, supplies explicit1000/0 arguments and rejects nonfinite transforms. Further native QA failures were exactly pending display-list ordering: the complete sprite multiset and all other inputs were equal. 195ef0e invokes Phaser's existing depthSort before recording actual draw order. Independent reviews passed both corrections. No assertion, timeout or metric threshold was weakened.

Root HONOR production QA verification passed all12 cells at390x740:100/150/200 enemies x WebGL/Canvas x full/reduced. It retains actual windup telegraphs and verifies finite, unchanged capture inputs and exact same-tier inputs across renderers. Numerical evidence is CI_MATRIX_EVIDENCE_20261007.json. The QA bundle was stamped9722866; the pending ordering correction changed only the driver, with identical application sources. Native driver changed only Unix browser path to installed Playwright Chromium. This is controlled raster evidence, not phone performance.

Hosted browser-smoke on4c82850 failed the old global last-two-ring assertion: real lysis produced108/150 followed by the new hit-contact ring16. 5b71c63 scopes interception to real vfx.lysis, restores ring in finally and asserts the complete exact108/150 array. Damage26, outside damage0, RNA and interaction assertions remain unchanged. Independent review PASS; root native comprehension smoke passed320x568,360x640,360x760,390x740,390x844,412x915.

Source changes in this follow-up are test-only. Hosted4c82850 build, production-contract and QA matrix passed; browser-smoke failed at the now-corrected assertion. The new combined PR head still requires a full hosted rerun. Original failures and corrected scope are retained here.

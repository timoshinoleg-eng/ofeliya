# Visual matrix frame cadence evidence

`npm run test:visual-matrix` now writes `frame-cadence.json` alongside the existing
screenshots and `matrix.json`. The shape is defined by `frame-cadence.schema.json`
(schemaVersion 1). CI uploads it with `if: always()` in both existing workflows.
Completed rows are persisted immediately; `status: failed` and `error` describe
an interrupted matrix, whose rows must not be treated as complete coverage.
If the job never reaches the matrix step, no measurements exist to upload.

Each existing renderer/tier/enemy-count case runs sequentially in one Chromium.
After its screenshot, the probe checks a visible page, live canvas/game loop,
active Game/UI scenes, renderer, tier and enemy count on every callback. It skips
10 warmup callbacks, then collects consecutive rAF timestamp differences until
both 60 intervals and 1000 ms are available. A 30 s watchdog rejects a stalled
probe, not slow performance. Fixture visual inputs must also match before/after.
Screenshots are outside the measured window. No intervals are trimmed or retried.

Metrics are milliseconds (`p50Ms`, `p95Ms`), linear interpolation at `(n-1)*p`,
and the fraction of intervals strictly greater than 33.3 ms (`over33_3MsRatio`).
Raw `intervalsMs`, count, window duration, viewport, DPR, browser version and
source SHA are retained. Gates check fixture readiness, sufficient samples and
finite positive intervals; there is no p95/FPS/long-frame performance threshold.

rAF measures browser scheduling/cadence, not GPU duration or guaranteed gameplay
FPS. This fixture already freezes Game.update, physics, tweens and sprite poses;
it omits live combat simulation, while rendering remains active. Per-callback
readiness checks add a small measurement overhead. Headless SwiftShader and shared
runner scheduling differ from real phones; small windows are a noisy baseline,
not mobile performance acceptance. Compare evidence only with matching fixture,
viewport, browser and machine conditions.

Local reproduction (PowerShell, one browser at a time):

```powershell
npm ci
npm install --no-save --package-lock=false playwright-core@1.55.0 pngjs@7.0.0
npm run test:frame-cadence
$env:VITE_RELEASE_SHA = git rev-parse HEAD
$env:VITE_RELEASE_MATRIX_QA = '1'
npm run build
npm run preview -- --host 127.0.0.1
# In a second terminal in this same clone:
$env:VITE_RELEASE_SHA = git rev-parse HEAD
$env:OFELIYA_CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:OFELIYA_MATRIX_DIR = 'artifacts/frame-cadence/390x740'
npm run test:visual-matrix
$env:OFELIYA_MATRIX_WIDTH = '360'
$env:OFELIYA_MATRIX_HEIGHT = '640'
$env:OFELIYA_MATRIX_DIR = 'artifacts/frame-cadence/360x640'
npm run test:visual-matrix
```

Issue #206 is intentionally incremental here: existing CI viewports 390x740 and
360x640 are reused. Adding 320x568, bundle reporting, Lighthouse and device/thermal
benchmarks is deferred. No new matrix, browser dependency, production hook or
renderer/gameplay change is introduced.

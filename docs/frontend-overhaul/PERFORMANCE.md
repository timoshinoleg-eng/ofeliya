# Paired production-QA rendering cadence

Baseline aba70324d13592fbcd86894fb29f395ac201f48a; candidate b7399458394ee3f9e08c9d26f6eae67320b1ae99. AMD Ryzen 5 5500U with Radeon Graphics         ; Windows 10.0.26300; 15.3GiB total RAM; Chrome 155.0.8059.40. Forced SwiftShader software rendering,390×740,DPR2. One browser at a time. Frozen Game.update, paused physics/tweens, fixed sprite pose. This measures browser/OS rAF scheduling while rendering a fixed workload, not GPU time, live AI/combat FPS or phone performance. Existing user applications remained open.

Reused exact PR208 (0e606ca) matrix/probe scripts outside product source. Ten warmup callbacks, at least60 consecutive samples and1000ms per row; raw intervals retained. All24 matrix cells completed and renderer/tier visual-parity checks passed. Cross-build sprite/role/quality inputs identical: **true**.

|Renderer|Tier|Actors|p50 before→after ms|p95 before→after ms|>33.3ms before→after|
|---|---|---:|---:|---:|---:|
|webgl|full|100|116.60→116.60|116.80→116.70|1.000→1.000|
|webgl|full|150|133.30→133.30|133.40→150.00|1.000→1.000|
|webgl|full|200|150.00→150.00|166.70→166.70|1.000→1.000|
|webgl|reduced|100|100.00→100.00|116.70→116.70|1.000→1.000|
|webgl|reduced|150|133.25→133.30|133.40→133.40|1.000→1.000|
|webgl|reduced|200|150.00→150.00|166.61→166.60|0.983→1.000|
|canvas|full|100|74.95→66.70|83.40→83.40|0.983→0.983|
|canvas|full|150|100.00→100.00|100.10→100.10|1.000→1.000|
|canvas|full|200|116.70→133.20|133.40→133.40|1.000→1.000|
|canvas|reduced|100|66.70→66.70|83.40→83.40|0.983→0.983|
|canvas|reduced|150|100.00→100.00|100.10→116.60|1.000→1.000|
|canvas|reduced|200|116.70→133.20|133.30→133.40|1.000→1.000|

The large absolute intervals are a software-rendered stress fixture; do not present these as hardware WebGL/mobile FPS. Single sequential windows provide regression evidence, not a controlled benchmark or statistical improvement claim. Device draw calls, GPU timings, thermals, memory peaks and live actor simulation remain unmeasured. Ordinary D1 captures use a separate120-sample idle/frozen rendering report and cannot replace this dense matrix.

## Diagnostic repeat and limits

Two first-pass p95 values moved by one ~16.6ms scheduling bin; Canvas200 medians also moved in the first run. Six selected software-rendered cells were sampled again. At WebGL/full150 p95 returned133.4ms (same as baseline); Canvas/reduced150 returned100.1ms versus100.0ms. Canvas/reduced200 medians were116.6ms on both builds in the repeat, although its p95 remained133.3ms versus116.7ms. Thus a consistent median slowdown was not reproduced; tail variation remains visible. Scheduler quantization under saturation is a plausible explanation, not a proven cause or an improvement claim. This is not sufficient to promise mobile performance parity.

The first subset wrapper collected all six validated timing rows but its final four-tier visual assertion failed because the intentionally selected two cases lacked the other two tiers. That wrapper error is retained in local evidence/perf-repeat-before; it is not counted as a visual-matrix pass. The candidate selected repeat explicitly omits the inapplicable four-tier assertion; complete baseline and candidate12-cell matrices already ran the original unchanged parity gates and passed. Repeats are diagnostic timing observations only.

QA application JS:416.57→420.66kB (gzip122.43→123.93kB), same Phaser vendor1481.79kB. No dependency or lockfile change. These are QA bundles, not a mobile download benchmark.

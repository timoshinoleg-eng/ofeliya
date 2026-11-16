/**
 * Contract test for scripts/lib/silhouette-metrics.cjs (I-07).
 *
 * Synthetic pixel arrays with known colours — no browser needed. The probe
 * (scripts/silhouette-probe.cjs) covers the live-game integration; this test
 * locks the metric math so a probe drift means a game change, not a ruler change.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const m = require(join(here, '..', 'scripts', 'lib', 'silhouette-metrics.cjs'));

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const approx = (a, b, eps, msg) => assert(Math.abs(a - b) <= eps, `${msg}: ${a} !≈ ${b} (eps ${eps})`);

// 1. Luminance anchors: black 0, white 1, mid-grey byte 128 ≈ 0.2158 (WCAG table).
approx(m.relativeLuminance([0, 0, 0]), 0, 1e-6, 'black luminance');
approx(m.relativeLuminance([255, 255, 255]), 1, 1e-6, 'white luminance');
approx(m.relativeLuminance([128, 128, 128]), 0.2158, 1e-3, 'grey-128 luminance');

// 2. Contrast anchors: white/black = 21, grey-128 vs white = 1.05/0.2658 ≈ 3.9494.
approx(m.contrastRatio(1, 0), 21, 1e-6, 'white vs black ratio');
approx(m.contrastRatio(m.relativeLuminance([128, 128, 128]), 1), 3.9494, 1e-3, 'grey vs white ratio');

// 3. Weber: white on black = 20 (bg≈0 guard returns null for truly black bg<1e-4).
approx(m.weberContrast(1, 0.5), 1, 1e-6, 'weber white on 0.5');
assert(m.weberContrast(1, 0) === null, 'weber guard on black background');

// --- Synthetic 64×64 frame helpers ---
const W = 64;
const H = 64;
const frame = () => new Uint8ClampedArray(W * H * 4);
const setPx = (data, x, y, r, g, b) => {
  const i = (y * W + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
};

// 4. Annulus on uniform background returns that background's luminance.
{
  const data = frame();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPx(data, x, y, 30, 30, 30);
  const ring = m.annulusLuminance(data, W, H, 32, 32, 10, 20);
  approx(ring.mean, m.relativeLuminance([30, 30, 30]), 1e-6, 'annulus mean on uniform bg');
  approx(ring.p10, ring.p90, 1e-9, 'annulus p10 == p90 on uniform bg');
  assert(ring.n > 0, 'annulus collected pixels');
}

// 5. Median colour: half red, half blue → median is one of the two pure values.
{
  const data = frame();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPx(data, x, y, x < 32 ? 200 : 0, 0, x < 32 ? 0 : 220);
  const med = m.boxMedianColor(data, W, H, 0, 0, W, H);
  const isRed = med[0] === 200 && med[2] === 0;
  const isBlue = med[0] === 0 && med[2] === 220;
  assert(isRed || isBlue, `median of half-red/half-blue is a pure colour, got ${med}`);
}

// 6. colorArea counts only within tolerance.
{
  const data = frame();
  setPx(data, 1, 1, 100, 150, 200);   // exact match
  setPx(data, 3, 3, 102, 152, 202);   // dist ~3.5 → inside tol 10
  setPx(data, 5, 5, 140, 150, 200);   // dist 40 → outside tol 10
  const area = m.colorArea(data, W, H, 0, 0, 8, 8, [100, 150, 200], 10);
  assert(area === 2, `colorArea tol filter: expected 2, got ${area}`);
}

// 7. playerLocalization on a synthetic avatar: bright core on dark field,
//    one competitor hue elsewhere in the box.
{
  const data = frame();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPx(data, x, y, 20, 24, 28);
  // avatar core 12×12 of [240,240,240] centred at (32,32)
  for (let y = 26; y < 38; y++) for (let x = 26; x < 38; x++) setPx(data, x, y, 240, 240, 240);
  // competitor: 6×6 red block at (44,44)
  for (let y = 41; y < 47; y++) for (let x = 41; x < 47; x++) setPx(data, x, y, 255, 62, 95);
  const res = m.playerLocalization(data, W, H, 32, 32, {
    innerHalf: 22, ringIn: 14, ringOut: 20, boxHalf: 24, tol: 30,
    competitorRGBs: [[255, 62, 95]],
  });
  // Self-consistent expectation: signal is the p99 luminance of the inner box —
  // the bright avatar core dominates the top percentiles.
  const inner = m.boxLuminancePercentile(data, W, H, 10, 10, 44, 44, 0.99);
  approx(res.signalLum, inner, 1e-9, 'signal luminance is inner-box p99');
  approx(res.signalLum, m.relativeLuminance([240, 240, 240]), 1e-9, 'signal is the white avatar core');
  const ring = m.annulusLuminance(data, W, H, 32, 32, 14, 20);
  approx(res.contrastMean, m.contrastRatio(res.signalLum, ring.mean), 1e-9, 'localization contrast matches ring mean');
  assert(res.contrastMean > 10, `bright core on dark field gives strong contrast, got ${res.contrastMean}`);
  assert(res.playerArea >= 100, `player area covers the 12×12 core, got ${res.playerArea}`);
  assert(res.maxCompetitorArea >= 30 && res.maxCompetitorArea <= 40, `competitor area is the 6×6 block, got ${res.maxCompetitorArea}`);
  assert(res.uniqueness > 2, `uniqueness beats the small competitor, got ${res.uniqueness}`);
}

// 8. mulberry32: deterministic, in [0,1), distinct first values.
{
  const a = m.mulberry32(20261116);
  const b = m.mulberry32(20261116);
  const va = [a(), a(), a()];
  const vb = [b(), b(), b()];
  assert(JSON.stringify(va) === JSON.stringify(vb), 'mulberry32 deterministic');
  assert(va.every((v) => v >= 0 && v < 1), 'mulberry32 range');
  assert(new Set(va.map((v) => v.toFixed(9))).size === va.length, 'mulberry32 first values distinct');
}

console.log('silhouette-metrics: OK (luminance anchors, contrast anchors, weber guard, annulus, median, colorArea tol, localization, mulberry32)');

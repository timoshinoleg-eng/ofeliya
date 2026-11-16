/**
 * Silhouette readability metrics — pure functions, no deps, browser- and node-safe.
 *
 * I-07 (research brief 2026-11-16): an automatic proxy for "can a player localize
 * the player avatar in a 200-enemy field". Two metrics, both computed from raw
 * RGBA pixels of a frozen rendered frame:
 *
 * 1. Localization contrast: WCAG contrast ratio between the player core and the
 *    local background annulus (the ring just outside the avatar's glow/clearing).
 *    Reported against the ring mean and against the ring p90 (worst bright
 *    neighbour — a single bright enemy near the player must not sink the metric).
 * 2. Unique-colour area: how many pixels near the player's own colour exist in a
 *    box around it, relative to the strongest competitor hue (enemy signal and
 *    decor colours). Uniqueness > 1 means the avatar's colour beats every
 *    competitor in its neighbourhood.
 *
 * Everything is deterministic: no RNG inside metrics; the probe seeds the layout.
 */
'use strict';

/** sRGB byte → linear channel. */
function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an [r,g,b] triple (0..1). */
function relativeLuminance(rgb) {
  return (
    0.2126 * channel(rgb[0]) +
    0.7152 * channel(rgb[1]) +
    0.0722 * channel(rgb[2])
  );
}

/** WCAG contrast ratio from two relative luminances. */
function contrastRatio(lumA, lumB) {
  const hi = Math.max(lumA, lumB);
  const lo = Math.min(lumA, lumB);
  return (hi + 0.05) / (lo + 0.05);
}

/** Classic Weber contrast (fg - bg) / bg; undefined when bg is ~black. */
function weberContrast(lumFg, lumBg) {
  return lumBg < 1e-4 ? null : (lumFg - lumBg) / lumBg;
}

function clampBox(width, height, x0, y0, w, h) {
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  return {
    x,
    y,
    w: Math.min(Math.floor(w), width - x),
    h: Math.min(Math.floor(h), height - y),
  };
}

/** Luminance percentile (0..1) over a clamped box; p=0.5 is the median. */
function boxLuminancePercentile(data, width, height, x0, y0, w, h, p) {
  const box = clampBox(width, height, x0, y0, w, h);
  const vals = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * width + x) * 4;
      vals.push(relativeLuminance([data[i], data[i + 1], data[i + 2]]));
    }
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))];
}

/**
 * Median RGB colour of a small box — used to sample the avatar's own colour
 * from its centre without hardcoding the sprite palette. Median is taken over
 * whole RGB triples (sorted by channel sum), so the result is always a colour
 * that actually exists in the box — per-channel medians can land on a mix that
 * is present nowhere in the image.
 */
function boxMedianColor(data, width, height, x0, y0, w, h) {
  const box = clampBox(width, height, x0, y0, w, h);
  const px = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * width + x) * 4;
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (px.length === 0) return null;
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return px[Math.floor((px.length - 1) / 2)];
}

/**
 * Luminance stats of an annulus around (cx, cy). Pixels whose centre lies
 * within [rIn, rOut) of the centre are collected; alpha is ignored (the game
 * canvas is opaque after compositing).
 */
function annulusLuminance(data, width, height, cx, cy, rIn, rOut) {
  const vals = [];
  const y0 = Math.max(0, Math.floor(cy - rOut));
  const y1 = Math.min(height - 1, Math.ceil(cy + rOut));
  const x0 = Math.max(0, Math.floor(cx - rOut));
  const x1 = Math.min(width - 1, Math.ceil(cx + rOut));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < rIn || d >= rOut) continue;
      const i = (y * width + x) * 4;
      vals.push(relativeLuminance([data[i], data[i + 1], data[i + 2]]));
    }
  }
  if (vals.length === 0) return { mean: null, p10: null, p90: null, n: 0 };
  vals.sort((a, b) => a - b);
  const pick = (p) => vals[Math.floor(p * (vals.length - 1))];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean, p10: pick(0.1), p90: pick(0.9), n: vals.length };
}

/**
 * Count pixels within Euclidean RGB distance `tol` of refRGB inside a clamped
 * box. Deliberately RGB-space (not deltaE): cheap, and hues here sit far apart.
 */
function colorArea(data, width, height, x0, y0, w, h, refRGB, tol) {
  const box = clampBox(width, height, x0, y0, w, h);
  let count = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * width + x) * 4;
      const dr = data[i] - refRGB[0];
      const dg = data[i + 1] - refRGB[1];
      const db = data[i + 2] - refRGB[2];
      if (dr * dr + dg * dg + db * db <= tol * tol) count++;
    }
  }
  return count;
}

/**
 * The full localization metric for one frozen frame.
 *
 * Sampling strategy: the avatar sprite is small, busy and partly transparent,
 * so a naive centre-median lands on whatever pose the breathing animation is
 * in (measured run-to-run spread >80 %). Percentiles of the whole inner box
 * fail too: the avatar occupies a minority of it, so p90 is background. The
 * avatar is characterised by its BRIGHTEST pixels instead:
 *
 *   - signal luminance = p99 luminance inside the inner box (the avatar
 *     highlight; enemies keep ≥100 px standoff, so nothing else can win p99);
 *   - avatar colour    = median triple of the top-5 % brightest inner pixels
 *     (the highlight cluster's own hue, used for the unique-area count);
 *   - local background = luminance stats of the annulus outside glow/clearing;
 *   - uniqueness       = avatar-colour area vs the strongest competitor hue.
 *
 * A dark avatar then honestly reports ~1.0 contrast — "no bright signal" is
 * the finding, not a sampling artefact.
 *
 * @param data   RGBA pixel array
 * @param width  frame width
 * @param height frame height
 * @param cx     player screen x
 * @param cy     player screen y
 * @param opts   {innerHalf, ringIn, ringOut, boxHalf, competitorRGBs, tol}
 */
function playerLocalization(data, width, height, cx, cy, opts = {}) {
  const innerHalf = opts.innerHalf ?? 22;
  const ringIn = opts.ringIn ?? 40;
  const ringOut = opts.ringOut ?? 70;
  const boxHalf = opts.boxHalf ?? 80;
  const tol = opts.tol ?? 70;

  // Inner box: collect pixels + luminances.
  const innerBox = clampBox(width, height, cx - innerHalf, cy - innerHalf, innerHalf * 2, innerHalf * 2);
  const inner = []; // [r,g,b,lum]
  for (let y = innerBox.y; y < innerBox.y + innerBox.h; y++) {
    for (let x = innerBox.x; x < innerBox.x + innerBox.w; x++) {
      const i = (y * width + x) * 4;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      inner.push([rgb[0], rgb[1], rgb[2], relativeLuminance(rgb)]);
    }
  }
  if (inner.length === 0) {
    return {
      playerRGB: null, signalLum: null, clusterN: 0,
      ringMeanLum: null, ringP90Lum: null, ringN: 0,
      contrastMean: null, contrastP90: null, weberMean: null,
      playerArea: 0, maxCompetitorArea: 0, uniqueness: null,
    };
  }
  const lums = inner.map((p) => p[3]).sort((a, b) => a - b);
  const pickLum = (p) => lums[Math.min(lums.length - 1, Math.floor(p * (lums.length - 1)))];
  const signalLum = pickLum(0.99);
  const clusterThreshold = pickLum(0.95);

  // Bright cluster = the avatar highlight. Triple-sort median → real colour.
  const cluster = inner.filter((p) => p[3] >= clusterThreshold);
  const clusterN = cluster.length;
  const sorted = cluster.slice().sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const playerRGB = clusterN > 0
    ? [sorted[Math.floor((clusterN - 1) / 2)][0], sorted[Math.floor((clusterN - 1) / 2)][1], sorted[Math.floor((clusterN - 1) / 2)][2]]
    : null;

  const ring = annulusLuminance(data, width, height, cx, cy, ringIn, ringOut);

  let contrastMean = null;
  let contrastP90 = null;
  let weberMean = null;
  if (signalLum !== null && ring.mean !== null) {
    contrastMean = contrastRatio(signalLum, ring.mean);
    weberMean = weberContrast(signalLum, ring.mean);
  }
  if (signalLum !== null && ring.p90 !== null) {
    contrastP90 = contrastRatio(signalLum, ring.p90);
  }

  const playerArea = playerRGB
    ? colorArea(data, width, height, cx - boxHalf, cy - boxHalf, boxHalf * 2, boxHalf * 2, playerRGB, tol)
    : 0;
  const competitors = (opts.competitorRGBs ?? []).map((rgb) => ({
    rgb,
    area: colorArea(data, width, height, cx - boxHalf, cy - boxHalf, boxHalf * 2, boxHalf * 2, rgb, tol),
  }));
  const maxCompetitor = competitors.reduce((m, c) => Math.max(m, c.area), 0);
  const uniqueness = playerArea / Math.max(1, maxCompetitor);

  return {
    playerRGB,
    signalLum,
    clusterN,
    ringMeanLum: ring.mean,
    ringP90Lum: ring.p90,
    ringN: ring.n,
    contrastMean,
    contrastP90,
    weberMean,
    playerArea,
    maxCompetitorArea: maxCompetitor,
    uniqueness,
  };
}

/** Deterministic PRNG for the enemy layout (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  relativeLuminance,
  contrastRatio,
  weberContrast,
  boxLuminancePercentile,
  boxMedianColor,
  annulusLuminance,
  colorArea,
  playerLocalization,
  mulberry32,
};

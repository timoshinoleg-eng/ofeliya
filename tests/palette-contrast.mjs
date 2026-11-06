/**
 * Donor core, part B — chroma-js build-time palette contract.
 *
 * 1. chroma-js is a build-time/node-only dependency: no src/ file imports it,
 *    so it cannot enter the runtime bundle (the bundle grep in the PR body is
 *    the build-level proof; this is the source-level proof).
 * 2. License safety: the installed chroma-js must be a modern, non-GPL
 *    version — its package license field must contain BSD-3-Clause and its
 *    major version must not be 0 (pre-0.4 releases were GPL).
 * 3. A1/A2 relationships, computed from the real palette (compiled from
 *    src/game/config.ts, not copied literals):
 *    - background luminance sits well below both signal colors (contract
 *      guard: bg < 25% of danger luminance; the A1 "20-30% darker than the
 *      darkest enemy" figure refers to enemy sprites, which have no single
 *      config color, so the verifiable proxy is the signal colors);
 *    - the two signal colors are unmistakably distinct (deltaE > 30; the
 *      just-noticeable difference is ~2.3, so 30 is an order of magnitude
 *      above "just noticeable", not a game-design number);
 *    - neither signal equals a decor color, and each sits deltaE > 30 away
 *      from the nearest decor color (reservation, not decoration);
 *    - primary UI text meets WCAG AA (contrast >= 4.5) on bg and panel.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import chroma from 'chroma-js';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-palette-'));
const require = createRequire(import.meta.url);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const read = (rel) => readFileSync(resolve(rel), 'utf8');
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

try {
  // 1. No runtime import of chroma-js anywhere under src/.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  for (const file of walk('src')) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
    assert(!read(file).includes('chroma-js'), `${file} imports chroma-js into the runtime`);
  }

  // 2. License + version guard on the installed package.
  const pkg = require(resolve('node_modules/chroma-js/package.json'));
  assert(String(pkg.license).includes('BSD-3-Clause'), `chroma-js license is not BSD-3-Clause: ${pkg.license}`);
  assert(!String(pkg.version).startsWith('0.'), `chroma-js version must not be pre-1.0 (GPL era): ${pkg.version}`);

  // 3. Real palette values, compiled from source.
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/config.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );
  const { COLORS, SIGNAL, UI_TEXT } = require(join(temp, 'game', 'config.js'));

  const lum = (n) => chroma(hex(n)).luminance();
  const lumBg = lum(COLORS.bg);
  const lumDanger = lum(SIGNAL.danger);
  const lumRna = lum(SIGNAL.rna);
  assert(lumBg < 0.25 * lumDanger, `bg luminance ${lumBg} not well below danger ${lumDanger}`);
  assert(lumBg < 0.25 * lumRna, `bg luminance ${lumBg} not well below rna ${lumRna}`);

  const dDangerRna = chroma.deltaE(hex(SIGNAL.danger), hex(SIGNAL.rna));
  assert(dDangerRna > 30, `signal colors too close: deltaE(danger, rna) = ${dDangerRna}`);

  const decor = [COLORS.bg, COLORS.panel, COLORS.panelHover, COLORS.stroke, COLORS.plasma];
  for (const [name, sig] of [['danger', SIGNAL.danger], ['rna', SIGNAL.rna]]) {
    for (const d of decor) assert(sig !== d, `SIGNAL.${name} equals a decor color`);
    const nearest = Math.min(...decor.map((d) => chroma.deltaE(hex(sig), hex(d))));
    assert(nearest > 30, `SIGNAL.${name} too close to decor: nearest deltaE = ${nearest}`);
  }

  for (const surface of [COLORS.bg, COLORS.panel]) {
    const ratio = chroma.contrast(UI_TEXT.primary, hex(surface));
    assert(ratio >= 4.5, `primary text contrast on ${hex(surface)} is ${ratio}, below WCAG AA 4.5`);
  }

  console.log(
    'palette-contrast: OK ' +
    `(lum bg=${lumBg.toFixed(4)} danger=${lumDanger.toFixed(4)} rna=${lumRna.toFixed(4)}, ` +
    `deltaE danger/rna=${dDangerRna.toFixed(1)}, ` +
    `contrast primary/bg=${chroma.contrast(UI_TEXT.primary, hex(COLORS.bg)).toFixed(2)}, ` +
    `chroma-js ${pkg.version} ${pkg.license})`
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

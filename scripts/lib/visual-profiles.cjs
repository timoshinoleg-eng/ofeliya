'use strict';
/**
 * Nightly visual profiles (harness track E, design §6.1 + Appendix C).
 *
 * A green nightly on the minimal visual level says nothing about
 * performance with ordinary effects — so the nightly runs three profiles,
 * not one. Each profile maps to mechanisms that REALLY exist in the game
 * (verified in code, not invented):
 *
 * - `?qaHide=gems,atmo,ui` (src/game/qaHide.ts, gated to QA builds in
 *   GameScene.create): hides render groups, VISIBILITY ONLY — nothing is
 *   destroyed and nothing stops updating, so logic, physics and timers
 *   run identically; only pixels disappear.
 * - `ofeliya_performance_tier` localStorage override ('full' | 'reduced',
 *   src/systems/PerformanceProfile.ts): 'reduced' lowers ambient counts
 *   (erythrocytes 14->8, host cells 4->2, particles 24->12), vfxScale
 *   1->0.58 and the particle budgets; gameplay density is untouched.
 *   postFx is false in BOTH tiers, so 'full' is the standard/maximum
 *   available presentation, not a superset with extra passes.
 *
 * There is NO `?flag.*` override for the visual level (FeatureFlags.ts
 * only covers events/difficulty/storefront/retention/lab/gallery/
 * starter-pack) and NO way to turn rendering off in a stepped run
 * (Game.step always renders; headlessStep under Phaser.HEADLESS is
 * separate research, Appendix C). `logic-stress` is therefore the
 * minimal AVAILABLE level (hidden groups + reduced tier), not "no render".
 *
 * Profiles:
 * - logic-stress: minimal visual level — survivability, transitions,
 *   determinism. The main 20-run nightly leg.
 * - rendering-performance: standard/maximum visual level — FPS, frame
 *   duration, SwiftShader load. Shortened smoke leg in the nightly.
 * - release-visual: standard visual level — appearance, effects, visual
 *   regressions. Shortened smoke leg in the nightly.
 *
 * rendering-performance and release-visual share the same mechanism
 * config (no hides, 'full' tier): they differ in what the runner
 * measures and asserts, not in the visual level. That is honest, not a
 * copy-paste error — the game has exactly two visual levels (reduced /
 * full) plus the three QA hide groups.
 *
 * Importable from the campaign runner (track C stitches this in at
 * integration; this module is zero-dep CommonJS):
 *
 *   const { resolveVisualProfileFromEnv, buildGameUrl } = require('./lib/visual-profiles.cjs');
 *   const profile = resolveVisualProfileFromEnv(); // reads OFELIYA_VISUAL_PROFILE
 *   const url = buildGameUrl('http://127.0.0.1:5173/', profile);
 *   // ...and set localStorage 'ofeliya_performance_tier' to profile.performanceTier
 *   // in an init script BEFORE the page loads (PerformanceProfile reads it at import).
 */

const VISUAL_PROFILES = {
  'logic-stress': {
    name: 'logic-stress',
    purpose: 'Campaign logic stress — survivability, transitions, determinism.',
    qaHide: ['gems', 'atmo', 'ui'],
    performanceTier: 'reduced',
    measures: ['run survival', 'stage transitions', 'stateHash determinism'],
  },
  'rendering-performance': {
    name: 'rendering-performance',
    purpose: 'Rendering performance — FPS, frame duration, SwiftShader load.',
    qaHide: [],
    performanceTier: 'full',
    measures: ['fps', 'frame duration', 'render ms'],
  },
  'release-visual': {
    name: 'release-visual',
    purpose: 'Release visual — appearance, effects, visual regressions.',
    qaHide: [],
    performanceTier: 'full',
    measures: ['screenshots', 'visual effects', 'presentation'],
  },
};

const PROFILE_NAMES = Object.keys(VISUAL_PROFILES);
const DEFAULT_PROFILE = 'logic-stress';
const ENV_VAR = 'OFELIYA_VISUAL_PROFILE';
const PERFORMANCE_TIER_KEY = 'ofeliya_performance_tier';

/** Resolve a profile name to its definition; unknown names throw (fail fast on CI matrix typos). */
function resolveVisualProfile(name) {
  const value = name === undefined || name === null || name === '' ? DEFAULT_PROFILE : String(name);
  const profile = VISUAL_PROFILES[value];
  if (!profile) {
    throw new Error(
      `unknown visual profile '${value}' (expected one of: ${PROFILE_NAMES.join(', ')}). ` +
        `Set ${ENV_VAR} to a valid profile name.`
    );
  }
  return profile;
}

/** Resolve from OFELIYA_VISUAL_PROFILE (default: logic-stress). */
function resolveVisualProfileFromEnv(env = process.env) {
  return resolveVisualProfile(env ? env[ENV_VAR] : undefined);
}

/**
 * Append the profile's ?qaHide= parameter to a game URL (no-op when the
 * profile hides nothing). The performance tier is NOT a URL parameter —
 * set it via localStorage (see PERFORMANCE_TIER_KEY) before page load.
 */
function buildGameUrl(baseUrl, profile) {
  const resolved = typeof profile === 'string' ? resolveVisualProfile(profile) : profile;
  const url = new URL(baseUrl);
  if (resolved.qaHide.length > 0) url.searchParams.set('qaHide', resolved.qaHide.join(','));
  return url.toString();
}

function describeProfile(profile) {
  const resolved = typeof profile === 'string' ? resolveVisualProfile(profile) : profile;
  const hides = resolved.qaHide.length > 0 ? resolved.qaHide.join(',') : 'none';
  return `${resolved.name}: qaHide=${hides} tier=${resolved.performanceTier} — ${resolved.purpose}`;
}

module.exports = {
  VISUAL_PROFILES,
  PROFILE_NAMES,
  DEFAULT_PROFILE,
  ENV_VAR,
  PERFORMANCE_TIER_KEY,
  resolveVisualProfile,
  resolveVisualProfileFromEnv,
  buildGameUrl,
  describeProfile,
};

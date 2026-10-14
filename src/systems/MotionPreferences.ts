// MediaQueryList.matches updates as system/browser preferences change.
// Cache the query object so critical-HP HUD rendering does not allocate every frame.
const reducedMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery?.matches ?? false;
}

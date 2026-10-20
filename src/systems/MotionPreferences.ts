// Cache the media query object so per-frame visual updates do not allocate it.
// MediaQueryList.matches still tracks preference changes in supported browsers.
const reducedMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery?.matches ?? false;
}

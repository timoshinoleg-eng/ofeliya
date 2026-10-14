// Respect the host OS/browser accessibility setting without persisting a second preference.
// Query on demand so gameplay camera effects respond when the preference changes.
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

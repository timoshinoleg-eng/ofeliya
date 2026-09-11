export interface ViewportSize {
  width: number;
  height: number;
}

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportFrame extends ViewportSize {
  top: number;
  left: number;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Converts a host-provided viewport and CSS safe-area insets into the actual Phaser parent frame.
 * The host viewport is authoritative; insets are clamped so malformed values cannot collapse or
 * expand the playable area beyond the host-reported bounds.
 */
export function computeViewportFrame(
  viewport: ViewportSize,
  safe: SafeAreaInsets
): ViewportFrame {
  const width = Math.max(1, Math.floor(finiteNonNegative(viewport.width)));
  const height = Math.max(1, Math.floor(finiteNonNegative(viewport.height)));

  const left = Math.min(Math.floor(finiteNonNegative(safe.left)), width - 1);
  const right = Math.min(Math.floor(finiteNonNegative(safe.right)), Math.max(0, width - left - 1));
  const top = Math.min(Math.floor(finiteNonNegative(safe.top)), height - 1);
  const bottom = Math.min(Math.floor(finiteNonNegative(safe.bottom)), Math.max(0, height - top - 1));

  return {
    left,
    top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
}

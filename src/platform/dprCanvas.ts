import type Phaser from 'phaser';

/**
 * DPR-aware backing store for the game canvas (cap 2x).
 *
 * Phaser 3.90 keeps the backing store equal to the CSS size (ScaleManager writes
 * `canvas.width = baseSize.width` in CSS pixels), so on a DPR 2.8125 device the
 * phone upscales a 1x render ~2.8x and text/art stay soft. Phaser has no public
 * logical/backing-size separation (no `resolution` in GameConfig for the Scale
 * Manager; zoom changes the coordinate system and is off-limits), so this module
 * pins the smallest set of renderer internals that achieves:
 *
 *   backing store = CSS size × min(devicePixelRatio, 2)
 *   logical coordinates stay in CSS pixels (scale.width/height untouched)
 *   CSS display size unchanged
 *   reinstalled after every ScaleManager resize
 *   both renderers (WebGL primary, Canvas MAX-WebView fallback)
 *
 * The mechanism is the same family as the proven QA-only RenderDensityExperiment
 * (src/systems/RenderDensityExperiment.ts), minus its experiment gates:
 *
 * WebGL — the renderer keeps logical width/height/projection; the canvas buffer
 * is made physical; `gl.viewport`/`gl.scissor` are wrapped to multiply by the
 * density ONLY while the default (backbuffer) framebuffer is bound, so logical
 * camera scissors and the 10%→90% Y-flip land on physical pixels, while render
 * targets keep their own pixel space. `renderer.resize` is overridden so Phaser's
 * own post-resize path re-applies the physical buffer instead of resetting it.
 *
 * Canvas 2D — the game context's `setTransform` is wrapped to multiply by the
 * density (every logical-space transform becomes physical), and `renderer.resize`
 * sizes the buffer. This is the Canvas equivalent of the WebGL viewport split;
 * per brief §3.8 the canvas-text resolution guard in main.ts stays untouched.
 *
 * At DPR 1 the density is 1: the wrappers multiply by one and `renderer.resize`
 * performs exactly the sequence Phaser itself performs — behavior as today.
 */

// Phaser renderer type constants (src/const.js): CANVAS: 1, WEBGL: 2.
const RENDERER_TYPE_CANVAS = 1;

export const DPR_CANVAS_CAP = 2;

/** Effective backing-store scale for a device pixel ratio, capped. */
export function dprCanvasScale(devicePixelRatio: number | undefined): number {
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(Math.max(dpr, 1), DPR_CANVAS_CAP);
}

export interface DprCanvasHandle {
  /** Current effective density (recomputed on every sync). */
  readonly scale: number;
  /** Re-apply the backing store for the current CSS size and DPR. Idempotent. */
  sync(): void;
  /** Restore every patched original. Safe to call twice. */
  destroy(): void;
}

/** Pinned Phaser internals shared by both renderer branches. */
interface PinnedRenderer {
  type: number;
  width: number;
  height: number;
  drawingBufferHeight: number;
  defaultScissor: number[];
  gameContext: CanvasRenderingContext2D;
  gl?: WebGLRenderingContext;
  resize(width: number, height: number): unknown;
  resetViewport?(): void;
  setProjectionMatrix(width: number, height: number): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  contextLost?: boolean;
}

type AnyFunction = (...args: any[]) => any;

export function installDprAwareCanvas(game: Phaser.Game): DprCanvasHandle {
  const renderer = game.renderer as unknown as PinnedRenderer;
  const canvas = game.canvas;
  const gl = renderer.gl;

  let density = 1;
  let disposed = false;
  let defaultFramebuffer = true;
  const restores: Array<() => void> = [];

  const patch = <T extends AnyFunction>(object: object, name: string, replacement: (original: T) => T): void => {
    const original = (object as Record<string, T>)[name];
    (object as Record<string, T>)[name] = replacement(original.bind(object) as T);
    restores.push(() => {
      (object as Record<string, T>)[name] = original;
    });
  };

  if (renderer.type === RENDERER_TYPE_CANVAS) {
    // Canvas 2D: scale every logical-space transform into the physical buffer.
    const context = renderer.gameContext;
    patch(
      context as unknown as object,
      'setTransform',
      (original) =>
        ((a: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number) => {
          if (typeof a === 'object') {
            return original(
              (a.a ?? a.m11 ?? 1) * density,
              (a.b ?? a.m12 ?? 0) * density,
              (a.c ?? a.m21 ?? 0) * density,
              (a.d ?? a.m22 ?? 1) * density,
              (a.e ?? a.m41 ?? 0) * density,
              (a.f ?? a.m42 ?? 0) * density
            );
          }
          return original(a * density, (b ?? 0) * density, (c ?? 0) * density, (d ?? 1) * density, (e ?? 0) * density, (f ?? 0) * density);
        }) as AnyFunction
    );
    patch(renderer as unknown as object, 'resize', (original) =>
      ((width: number, height: number) => {
        canvas.width = Math.round(width * density);
        canvas.height = Math.round(height * density);
        original(width, height);
        // Setting canvas.width resets the context state; re-establish the base transform.
        context.setTransform(1, 0, 0, 1, 0, 0);
      }) as AnyFunction
    );
  } else if (gl) {
    // WebGL: logical renderer state + physical buffer; GL calls to the
    // backbuffer are scaled, render targets keep their own pixel space.
    patch(gl as unknown as object, 'bindFramebuffer', (original) =>
      ((target: number, framebuffer: WebGLFramebuffer | null) => {
        defaultFramebuffer = framebuffer === null;
        return original(target, framebuffer);
      }) as AnyFunction
    );
    for (const name of ['viewport', 'scissor'] as const) {
      patch(gl as unknown as object, name, (original) =>
        ((x: number, y: number, width: number, height: number) => {
          const ratio = defaultFramebuffer ? density : 1;
          return original(x * ratio, y * ratio, width * ratio, height * ratio);
        }) as AnyFunction
      );
    }
    patch(renderer as unknown as object, 'resize', () =>
      ((width: number, height: number) => {
        canvas.width = Math.round(width * density);
        canvas.height = Math.round(height * density);
        renderer.width = width;
        renderer.height = height;
        renderer.setProjectionMatrix(width, height);
        gl.viewport(0, 0, width, height);
        renderer.drawingBufferHeight = height;
        gl.scissor(0, 0, width, height);
        renderer.defaultScissor[2] = width;
        renderer.defaultScissor[3] = height;
        renderer.emit('resize', width, height);
        return renderer;
      }) as AnyFunction
    );
    patch(renderer as unknown as object, 'resetViewport', () =>
      (() => {
        gl.viewport(0, 0, renderer.width, renderer.height);
        renderer.drawingBufferHeight = renderer.height;
      }) as AnyFunction
    );
    const contextRestored = (): void => {
      // The drawing buffer survives a context restore, but the GL state does not;
      // force one resize pass so viewport/scissor/projection are re-applied.
      sync(true);
    };
    canvas.addEventListener('webglcontextrestored', contextRestored);
    restores.push(() => canvas.removeEventListener('webglcontextrestored', contextRestored));
  }

  const sync = (force = false): void => {
    if (disposed || renderer.contextLost) return;
    const width = game.scale.width;
    const height = game.scale.height;
    density = dprCanvasScale(window.devicePixelRatio);
    const targetWidth = Math.round(width * density);
    const targetHeight = Math.round(height * density);
    if (force || canvas.width !== targetWidth || canvas.height !== targetHeight) {
      // Routes through the patched renderer.resize above, which applies the
      // physical buffer and keeps every logical value untouched.
      (game.renderer as unknown as { resize(w: number, h: number): void }).resize(width, height);
    }
    // The canvas must display at CSS size regardless of the buffer size.
    // Phaser's ScaleManager leaves the style attribute alone at zoom 1.
    const styleWidth = `${width}px`;
    const styleHeight = `${height}px`;
    if (canvas.style.width !== styleWidth) canvas.style.width = styleWidth;
    if (canvas.style.height !== styleHeight) canvas.style.height = styleHeight;
    // Scale.refresh measured the canvas bounds while the buffer owned the
    // element size; refresh bounds/input ratio without emitting RESIZE again.
    game.scale.updateBounds();
    game.scale.displayScale.set(
      game.scale.baseSize.width / game.scale.canvasBounds.width,
      game.scale.baseSize.height / game.scale.canvasBounds.height
    );
  };

  // Phaser re-runs its own resize (and would reset our buffer) on every
  // ScaleManager resize; this listener reinstalls afterwards. Phaser's internal
  // renderer.onResize subscribed during renderer boot, i.e. before us, so this
  // handler runs after the stock one on every emit.
  const onScaleResize = (): void => sync(false);
  game.scale.on('resize', onScaleResize);
  restores.push(() => game.scale.off('resize', onScaleResize));

  sync(true);

  return {
    get scale(): number {
      return density;
    },
    sync,
    destroy(): void {
      if (disposed) return;
      disposed = true;
      for (const restore of restores.reverse()) restore();
      if (!(game as Phaser.Game & { pendingDestroy: boolean }).pendingDestroy) {
        canvas.width = game.scale.width;
        canvas.height = game.scale.height;
        if (!renderer.contextLost) {
          (game.renderer as unknown as { resize(w: number, h: number): void }).resize(game.scale.width, game.scale.height);
        }
      }
    },
  };
}

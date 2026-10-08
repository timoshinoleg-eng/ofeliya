import Phaser from 'phaser';
import { PERFORMANCE } from './PerformanceProfile';

/** Phaser 3.90 experiment; caller must gate to DEV/release-matrix QA. */
export function installRenderDensityExperiment(game: Phaser.Game, requestedDensity: 1 | 2) {
  // Phaser exposes no public logical/backing-size separation. These are pinned internals.
  const renderer = game.renderer as any;
  const canvas = game.canvas;
  const restores: Array<() => void> = [];
  let effectiveDensity: 1 | 2 = 1;
  let disposed = false;
  const gl: WebGLRenderingContext | undefined = renderer.gl;
  const gpuLimit = gl ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) : 4096;
  let restored = false;
  const selectDensity = (width: number, height: number): 1 | 2 =>
    Phaser.VERSION === '3.90.0' && !PERFORMANCE.postFx && PERFORMANCE.tier === 'full' && !restored && requestedDensity === 2 &&
    game.registry.get('performanceTier') !== 'reduced' && game.registry.get('runtimeQuality')?.level !== 'low' &&
    width * height * 4 <= 4_000_000 && width * 2 <= gpuLimit && height * 2 <= gpuLimit ? 2 : 1;
  const patch = (object: any, name: string, replacement: (original: (...args: any[]) => any) => (...args: any[]) => any): void => {
    const original = object[name];
    object[name] = replacement(original.bind(object));
    restores.push(() => { object[name] = original; });
  };
  if (renderer.type === Phaser.CANVAS) {
    const context = renderer.gameContext as CanvasRenderingContext2D;
    patch(context, 'setTransform', original => (a: number | DOMMatrix2DInit, b: number, c: number, d: number, e: number, f: number) => {
      if (typeof a === 'object') return original((a.a ?? a.m11 ?? 1) * effectiveDensity, (a.b ?? a.m12 ?? 0) * effectiveDensity,
        (a.c ?? a.m21 ?? 0) * effectiveDensity, (a.d ?? a.m22 ?? 1) * effectiveDensity, (a.e ?? a.m41 ?? 0) * effectiveDensity, (a.f ?? a.m42 ?? 0) * effectiveDensity);
      return original(a * effectiveDensity, b * effectiveDensity, c * effectiveDensity, d * effectiveDensity, e * effectiveDensity, f * effectiveDensity);
    });
    patch(renderer, 'resize', original => (width: number, height: number) => {
      effectiveDensity = selectDensity(width, height);
      canvas.width = width * effectiveDensity; canvas.height = height * effectiveDensity;
      original(width, height); context.setTransform(1, 0, 0, 1, 0, 0);
    });
  } else if (gl) {
    let defaultFramebuffer = true;
    patch(gl, 'bindFramebuffer', original => (target: number, framebuffer: WebGLFramebuffer | null) => {
      defaultFramebuffer = framebuffer === null;
      return original(target, framebuffer);
    });
    for (const name of ['viewport', 'scissor']) {
      patch(gl, name, original => (x: number, y: number, width: number, height: number) => {
        const ratio = defaultFramebuffer ? effectiveDensity : 1;
        return original(x * ratio, y * ratio, width * ratio, height * ratio);
      });
    }
    patch(renderer, 'resize', () => (width: number, height: number) => {
      effectiveDensity = selectDensity(width, height);
      canvas.width = width * effectiveDensity; canvas.height = height * effectiveDensity;
      renderer.width = width; renderer.height = height;
      renderer.setProjectionMatrix(width, height);
      gl.viewport(0, 0, width, height); renderer.drawingBufferHeight = height;
      gl.scissor(0, 0, width, height);
      renderer.defaultScissor[2] = width; renderer.defaultScissor[3] = height;
      renderer.emit('resize', width, height); return renderer;
    });
    patch(renderer, 'resetViewport', () => () => {
      gl.viewport(0, 0, renderer.width, renderer.height); renderer.drawingBufferHeight = renderer.height;
    });
  }
  const sync = (): void => {
    if (disposed || renderer.contextLost) return;
    const width = game.scale.width, height = game.scale.height;
    const nextDensity = selectDensity(width, height);
    if (canvas.width !== width * nextDensity || canvas.height !== height * nextDensity || nextDensity !== effectiveDensity) renderer.resize(width, height);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    // Scale.refresh measured the old explicit CSS size before its RESIZE event.
    // Refresh only bounds/input ratio here, without recursively emitting RESIZE.
    game.scale.updateBounds();
    game.scale.displayScale.set(game.scale.baseSize.width / game.scale.canvasBounds.width,
      game.scale.baseSize.height / game.scale.canvasBounds.height);
  };
  // Quality is published at most once/sec by the existing governor. Avoid per-frame work.
  const qualityChanged = (_parent: unknown, key: string): void => {
    if (key === 'performanceTier' || key === 'runtimeQuality') sync();
  };
  const contextRestored = (): void => { restored = true; sync(); };
  canvas.addEventListener('webglcontextrestored', contextRestored);
  game.registry.events.on('changedata', qualityChanged);
  game.scale.on('resize', sync); sync();
  return {
    get density(): 1 | 2 { return effectiveDensity; },
    sync,
    destroy(): void {
      if (disposed) return; disposed = true;
      game.scale.off('resize', sync);
      game.registry.events.off('changedata', qualityChanged);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      for (const restore of restores.reverse()) restore();
      // Earlier DESTROY listeners have already cleaned scenes/ScaleManager resources.
      // During Game teardown restore hooks only; renderer/canvas are destroyed next.
      if (!(game as Phaser.Game & { pendingDestroy: boolean }).pendingDestroy) {
        canvas.width = game.scale.width; canvas.height = game.scale.height;
        if (!renderer.contextLost) renderer.resize(game.scale.width, game.scale.height);
      }
    },
  };
}

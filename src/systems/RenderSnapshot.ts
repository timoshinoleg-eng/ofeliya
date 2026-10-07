import Phaser from 'phaser';

const size = (value: { width: number; height: number }) => ({ width: value.width, height: value.height });
const bounds = (value: { x: number; y: number; width: number; height: number }) => ({ x: value.x, y: value.y, ...size(value) });

/** On-demand QA readback. No content, identity, retained history or render/input writes. */
export function renderSnapshot(game: Phaser.Game, host: HTMLElement) {
  const renderer = game.renderer;
  const gl = renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? renderer.gl : null;
  const scenes = ['Menu', 'Game', 'UI'].map((key) => {
    const scene = game.scene.getScene(key);
    const camera = scene.cameras?.main;
    const texts: Array<{
      bounds: ReturnType<typeof bounds>; resolution: number;
      sourceResolution: number; canvas: ReturnType<typeof size>;
    }> = [];
    // Bound both traversal work and returned samples, including nested Containers.
    let visited = 0;
    const visit = (objects: Phaser.GameObjects.GameObject[], depth: number): void => {
      if (depth > 8) return;
      for (const object of objects) {
        if (++visited > 256 || texts.length >= 4) return;
        if (object instanceof Phaser.GameObjects.Text && object.visible && object.alpha > 0) {
          texts.push({ bounds: bounds(object.getBounds()), resolution: object.style.resolution,
            sourceResolution: object.texture.source[0].resolution, canvas: size(object.canvas) });
        } else if (object instanceof Phaser.GameObjects.Container && object.visible && object.alpha > 0) {
          visit(object.list, depth + 1);
        }
      }
    };
    if (scene.sys.isActive()) visit(scene.children.list, 0);
    return { key, active: scene.sys.isActive(), paused: scene.sys.isPaused(),
      camera: camera ? { ...bounds(camera), zoom: camera.zoom } : null, texts };
  });
  return {
    dpr: window.devicePixelRatio,
    host: bounds(host.getBoundingClientRect()),
    canvas: { intrinsic: size(game.canvas), bounds: bounds(game.canvas.getBoundingClientRect()) },
    renderer: { type: renderer.type, size: size(renderer), gl: gl ? {
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
    } : null },
    scale: { gameSize: size(game.scale.gameSize), baseSize: size(game.scale.baseSize),
      displaySize: size(game.scale.displaySize),
      displayScale: { x: game.scale.displayScale.x, y: game.scale.displayScale.y } },
    scenes,
  };
}

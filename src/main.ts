import Phaser from 'phaser';
import { ViewportManager } from './platform/ViewportManager';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { installMobileLayoutGuard } from './ui/MobileLayoutGuard';

declare global {
  interface Window {
    __game?: Phaser.Game;
    __viewportManager?: ViewportManager;
  }
}

const FONT_READY_TIMEOUT_MS = 700;
const CANVAS_FALLBACK_KEY = 'ofeliya_canvas_fallback_v2';

function waitForFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, FONT_READY_TIMEOUT_MS);
    void Promise.all([
      fonts.load('400 16px "Chakra Petch"'),
      fonts.load('700 16px "Chakra Petch"'),
    ])
      .then(() => fonts.ready)
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timeout);
        resolve();
      });
  });
}

/**
 * Phaser Text resolution > 1 is desirable in WebGL because it keeps the UI crisp on High-DPI
 * phones. The Canvas renderer has a different failure mode in our MAX fallback: high-resolution
 * text textures can render larger than their logical getBounds() box. Only clamp Text resolution
 * when we intentionally use Canvas; WebGL keeps the scenes' existing setResolution(2) calls.
 */
function installCanvasTextResolutionGuard(): void {
  const proto = Phaser.GameObjects.Text.prototype as typeof Phaser.GameObjects.Text.prototype & {
    __ofeliyaCanvasResolutionGuard?: boolean;
  };
  if (proto.__ofeliyaCanvasResolutionGuard) return;

  const originalSetResolution = proto.setResolution;
  proto.setResolution = function (
    this: Phaser.GameObjects.Text,
    _resolution: number
  ): Phaser.GameObjects.Text {
    return originalSetResolution.call(this, 1);
  } as typeof proto.setResolution;
  proto.__ofeliyaCanvasResolutionGuard = true;
}

function explicitRenderer(): 'canvas' | 'webgl' | null {
  const value = new URLSearchParams(window.location.search).get('renderer');
  if (value === 'canvas' || value === 'webgl') return value;
  return null;
}

function webGLPreflight(): boolean {
  const canvas = document.createElement('canvas');
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    gl =
      (canvas.getContext('webgl2', {
        antialias: true,
        failIfMajorPerformanceCaveat: true,
      }) as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl', {
        antialias: true,
        failIfMajorPerformanceCaveat: true,
      }) as WebGLRenderingContext | null);
    if (!gl) return false;
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } catch {
    return false;
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Best-effort probe cleanup only.
    }
  }
}

function chooseRenderer(): number {
  const override = explicitRenderer();
  if (override === 'canvas') return Phaser.CANVAS;
  if (override === 'webgl') return webGLPreflight() ? Phaser.WEBGL : Phaser.CANVAS;

  if (sessionStorage.getItem(CANVAS_FALLBACK_KEY) === '1') return Phaser.CANVAS;
  return webGLPreflight() ? Phaser.WEBGL : Phaser.CANVAS;
}

function rememberCanvasFallback(): boolean {
  if (sessionStorage.getItem(CANVAS_FALLBACK_KEY) === '1') return false;
  sessionStorage.setItem(CANVAS_FALLBACK_KEY, '1');
  return true;
}

function installWebGLRecovery(game: Phaser.Game): void {
  if (game.renderer.type !== Phaser.WEBGL) return;
  game.canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      if (!rememberCanvasFallback()) return;
      window.location.reload();
    },
    { once: true }
  );
}

async function boot(): Promise<void> {
  const host = document.getElementById('game');
  if (!host) throw new Error('Missing #game host');

  const viewport = new ViewportManager(host);
  viewport.start();
  // Let MAX Bridge answer before Phaser reads the parent size. Browser fallback resolves immediately.
  await viewport.sync();
  await waitForFonts();

  const rendererType = chooseRenderer();
  if (rendererType === Phaser.CANVAS) installCanvasTextResolutionGuard();

  let game: Phaser.Game;
  try {
    game = new Phaser.Game({
      // Prefer WebGL for sharp High-DPI text and effects. If WebGL is unavailable or loses its
      // context in a problematic MAX Android WebView, reload once into the proven Canvas fallback.
      type: rendererType,
      parent: host,
      backgroundColor: '#12070d',
      disableContextMenu: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.NO_CENTER,
        width: host.clientWidth || '100%',
        height: host.clientHeight || '100%',
      },
      physics: {
        default: 'arcade',
        arcade: { debug: false },
      },
      render: {
        antialias: true,
        antialiasGL: true,
        roundPixels: true,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: true,
      },
      input: {
        activePointers: 3,
      },
      scene: [BootScene, MenuScene, GameScene, UIScene],
    });
  } catch (error) {
    if (rendererType === Phaser.WEBGL && rememberCanvasFallback()) {
      window.location.reload();
      return;
    }
    throw error;
  }

  installWebGLRecovery(game);
  installMobileLayoutGuard(game);
  viewport.attachGame(game);
  await viewport.sync();

  if (import.meta.env.DEV) {
    window.__game = game;
    window.__viewportManager = viewport;
  }

  if (
    'serviceWorker' in navigator &&
    import.meta.env.PROD &&
    location.protocol.startsWith('http')
  ) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .catch((error) => console.warn('[sw] registration failed:', error));
    });
  }
}

void boot();

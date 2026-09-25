import Phaser from 'phaser';
import { ViewportManager } from './platform/ViewportManager';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { installMobileLayoutGuard } from './ui/MobileLayoutGuard';
import { PlatformBridge } from './platform';
import { StartupTrace } from './systems/StartupTrace';
import { ensureTelegramBridge } from './platform/TelegramBridgeLoader';
import { trackProductEvent } from './systems/AnalyticsClient';
import { retryPendingDailySubmission } from './systems/ScoreClient';
import { RELEASE_MARKER, RELEASE_SHA, RELEASE_SHORT } from './release';

declare global {
  interface Window {
    __game?: Phaser.Game;
    __viewportManager?: ViewportManager;
  }
}

const FONT_READY_TIMEOUT_MS = 700;

const RELEASE_REFRESH_KEY = 'ofeliya_release_refresh_v1';
const RELEASE_CHECK_TIMEOUT_MS = 1200;
let releaseCheckInFlight: Promise<boolean> | null = null;

async function clearOfeliyaCaches(): Promise<void> {
  if (!('caches' in window)) return;
  const keys = await window.caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith('ofeliya-'))
      .map((key) => window.caches.delete(key))
  );
}

async function ensureCurrentRelease(): Promise<boolean> {
  if (!import.meta.env.PROD || !location.protocol.startsWith('http')) return false;
  if (releaseCheckInFlight) return releaseCheckInFlight;

  releaseCheckInFlight = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), RELEASE_CHECK_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${import.meta.env.BASE_URL}release.json`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (!response.ok) return false;

      const payload = (await response.json()) as { release?: unknown };
      const serverRelease = String(payload.release ?? '').trim();
      if (!/^[0-9a-f]{40}$/i.test(serverRelease)) return false;

      if (serverRelease === RELEASE_SHA) {
        sessionStorage.removeItem(RELEASE_REFRESH_KEY);
        return false;
      }

      StartupTrace.setMeta('releaseMismatch', `${RELEASE_SHORT}->${serverRelease.slice(0, 7)}`);

      // One attempt per target SHA avoids a reload loop if a host unexpectedly serves
      // mismatched assets. The release query also gives MAX a distinct launch URL.
      if (sessionStorage.getItem(RELEASE_REFRESH_KEY) === serverRelease) return false;
      sessionStorage.setItem(RELEASE_REFRESH_KEY, serverRelease);

      await clearOfeliyaCaches();

      const next = new URL(window.location.href);
      next.searchParams.set('release', serverRelease.slice(0, 7));
      window.location.replace(next.toString());
      return true;
    } catch (error) {
      console.warn('[release] refresh check failed:', error);
      return false;
    } finally {
      releaseCheckInFlight = null;
    }
  })();

  return releaseCheckInFlight;
}

function installReleaseResumeGuard(): void {
  const check = (): void => {
    if (document.visibilityState === 'visible') void ensureCurrentRelease();
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', () => void ensureCurrentRelease());
}

const CANVAS_FALLBACK_KEY = 'ofeliya_canvas_fallback_v2';

function waitForFonts(): Promise<void> {
  StartupTrace.mark('fonts.start');
  const fonts = document.fonts;
  if (!fonts) {
    StartupTrace.setMeta('fontsOutcome', 'unavailable');
    StartupTrace.mark('fonts.end');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome: 'loaded' | 'timeout'): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timeout);
      StartupTrace.setMeta('fontsOutcome', outcome);
      StartupTrace.mark('fonts.end');
      resolve();
    };
    const timeout = window.setTimeout(() => finish('timeout'), FONT_READY_TIMEOUT_MS);
    void Promise.all([
      fonts.load('400 16px "Chakra Petch"'),
      fonts.load('700 16px "Chakra Petch"'),
    ])
      .then(() => fonts.ready)
      .then(() => finish('loaded'))
      .catch(() => finish('loaded'));
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

function webGLPreflight(allowMajorPerformanceCaveat = false): boolean {
  const canvas = document.createElement('canvas');
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const attrs: WebGLContextAttributes = {
      antialias: true,
      failIfMajorPerformanceCaveat: !allowMajorPerformanceCaveat,
    };
    gl =
      (canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);
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
  // Explicit WebGL is a diagnostics/QA override, so allow software WebGL in CI.
  if (override === 'webgl') return webGLPreflight(true) ? Phaser.WEBGL : Phaser.CANVAS;

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

function installAppOpenTracking(): void {
  let sent = false;
  const tryTrack = (): void => {
    if (sent) return;
    if (
      (PlatformBridge.kind !== 'max' && PlatformBridge.kind !== 'telegram') ||
      !PlatformBridge.initData
    ) {
      return;
    }
    sent = true;
    void trackProductEvent('app_open', PlatformBridge, { release: RELEASE_MARKER });
  };

  // The MAX bridge is intentionally async. Install the listener before the first viewport wait
  // so a slow bridge cannot be permanently classified as a generic browser launch.
  window.addEventListener('ofeliya:max-bridge-ready', tryTrack, { once: true });
  tryTrack();
  window.setTimeout(tryTrack, 350);
  window.setTimeout(tryTrack, 1200);
}

async function boot(): Promise<void> {
  StartupTrace.mark('boot.start');
  StartupTrace.setMeta('platformInitial', PlatformBridge.kind);
  StartupTrace.setMeta('platformVersion', PlatformBridge.version || '');
  const host = document.getElementById('game');
  if (!host) throw new Error('Missing #game host');
  document.documentElement.dataset.ofeliyaRelease = RELEASE_MARKER;
  installAppOpenTracking();
  installReleaseResumeGuard();

  const viewport = new ViewportManager(host);
  viewport.start();
  // Let MAX Bridge answer before Phaser reads the parent size. Browser fallback resolves immediately.
  StartupTrace.mark('viewport.first.start');
  await viewport.sync();
  StartupTrace.mark('viewport.first.end');
  StartupTrace.setMeta('viewportSourceFirst', host.dataset.viewportSource ?? 'unknown');
  StartupTrace.setMeta('viewportWidthFirst', host.clientWidth);
  StartupTrace.setMeta('viewportHeightFirst', host.clientHeight);

  await waitForFonts();

  const rendererOverride = explicitRenderer();
  StartupTrace.setMeta('rendererOverride', rendererOverride ?? 'auto');
  StartupTrace.mark('renderer.select.start');
  const rendererType = chooseRenderer();
  StartupTrace.mark('renderer.select.end');
  StartupTrace.setMeta('rendererRequested', rendererType === Phaser.WEBGL ? 'webgl' : 'canvas');
  if (rendererType === Phaser.CANVAS) installCanvasTextResolutionGuard();

  let game: Phaser.Game;
  try {
    StartupTrace.mark('phaser.construct.start');
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
        // Normal clients reject software/very slow WebGL. The explicit WebGL QA override is
        // allowed to use SwiftShader so CI can exercise the High-DPI WebGL path deterministically.
        failIfMajorPerformanceCaveat: rendererOverride !== 'webgl',
      },
      input: {
        activePointers: 3,
      },
      scene: [BootScene, MenuScene, GameScene, UIScene],
    });
    StartupTrace.mark('phaser.construct.end');
    StartupTrace.setMeta('rendererActual', game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas');
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
  StartupTrace.mark('viewport.second.start');
  await viewport.sync();
  StartupTrace.mark('viewport.second.end');
  StartupTrace.setMeta('viewportSourceSecond', host.dataset.viewportSource ?? 'unknown');

  // Production builds stay opaque. The release visual-matrix workflow enables this hook
  // only in its dedicated QA bundle so Playwright can inspect real production rendering.
  const releaseMatrixQa = import.meta.env.VITE_RELEASE_MATRIX_QA === '1';
  if (import.meta.env.DEV || releaseMatrixQa) {
    window.__game = game;
    window.__viewportManager = viewport;
  }

  if (
    'serviceWorker' in navigator &&
    import.meta.env.PROD &&
    location.protocol.startsWith('http')
  ) {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((error) => console.warn('[sw] registration/update failed:', error));
  }
}

void (async () => {
  if (await ensureCurrentRelease()) return;

  let scoreRetryInFlight = false;
  const retryPendingScores = (): void => {
    if (scoreRetryInFlight) return;
    scoreRetryInFlight = true;
    void retryPendingDailySubmission(PlatformBridge).finally(() => {
      scoreRetryInFlight = false;
    });
  };

  window.addEventListener('ofeliya:max-bridge-ready', retryPendingScores, { once: true });
  await ensureTelegramBridge();
  await boot();
  retryPendingScores();
})();

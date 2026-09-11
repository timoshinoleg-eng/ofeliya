import Phaser from 'phaser';
import { ViewportManager } from './platform/ViewportManager';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

declare global {
  interface Window {
    __game?: Phaser.Game;
    __viewportManager?: ViewportManager;
  }
}

const FONT_READY_TIMEOUT_MS = 700;

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

async function boot(): Promise<void> {
  const host = document.getElementById('game');
  if (!host) throw new Error('Missing #game host');

  const viewport = new ViewportManager(host);
  viewport.start();
  // Let MAX Bridge answer before Phaser reads the parent size. Browser fallback resolves immediately.
  await viewport.sync();
  await waitForFonts();

  const game = new Phaser.Game({
    // MAX Android WebView has shown invalid WebGL framebuffer startup failures in production.
    // Strain Zero gameplay and its core presentation are Canvas-safe, so reliability wins for RC QA.
    type: Phaser.CANVAS,
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
      roundPixels: true,
      powerPreference: 'high-performance',
    },
    input: {
      activePointers: 3,
    },
    scene: [BootScene, MenuScene, GameScene, UIScene],
  });

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

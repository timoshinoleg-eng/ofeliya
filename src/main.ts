import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

// Dev-ручка для автотестов: в панели IAB requestAnimationFrame заморожен,
// поэтому QA прокачивает кадры вручную через __game.loop.step(time).
declare global {
  interface Window {
    __game?: Phaser.Game;
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
  // Дождаться загрузки дисплейного шрифта: иначе Phaser запечёт текстуры текста
  // с фолбэком (Arial) и не перерисует их после подгрузки. В MAX Font API
  // может не завершить promise, поэтому шрифт не вправе удерживать заставку.
  await waitForFonts();

  const game = new Phaser.Game({
    // Некоторые Android WebView в MAX создают WebGL-контекст с невалидным
    // framebuffer и Phaser падает до BootScene. Игра использует Canvas-safe
    // объекты; постэффекты уже отключаются вне WebGL.
    type: Phaser.CANVAS,
    parent: 'game',
    backgroundColor: '#0b0e1a',
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: '100%',
      height: '100%',
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

  // Dev-ручка для автотестов: в панели IAB requestAnimationFrame заморожен,
  // поэтому QA прокачивает кадры вручную через __game.loop.step(time).
  if (import.meta.env.DEV) window.__game = game;
}

void boot();

import Phaser from 'phaser';
import { ViewportManager } from './platform/ViewportManager';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

// Dev-ручка для автотестов: в панели IAB requestAnimationFrame заморожен,
// поэтому QA прокачивает кадры вручную через __game.loop.step(time).
declare global {
  interface Window {
    __game?: Phaser.Game;
    __viewportManager?: ViewportManager;
  }
}

async function boot(): Promise<void> {
  const host = document.getElementById('game');
  if (!host) throw new Error('Missing #game host');

  const viewport = new ViewportManager(host);
  viewport.start();
  // Let MAX Bridge answer before Phaser reads the parent size. Browser fallback resolves immediately.
  await viewport.sync();

  // Дождаться загрузки дисплейного шрифта: иначе Phaser запечёт текстуры текста
  // с фолбэком (Arial) и не перерисует их после подгрузки шрифта.
  try {
    await Promise.all([
      document.fonts.load('400 16px "Chakra Petch"'),
      document.fonts.load('700 16px "Chakra Petch"'),
    ]);
    await document.fonts.ready;
  } catch {
    /* шрифт опционален — игра работает на Arial-фолбэке */
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    backgroundColor: '#0b0e1a',
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

  // Dev-ручки для browser smoke / visual QA.
  if (import.meta.env.DEV) {
    window.__game = game;
    window.__viewportManager = viewport;
  }
}

void boot();

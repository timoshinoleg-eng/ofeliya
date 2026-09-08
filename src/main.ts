import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
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
declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}
if (import.meta.env.DEV) window.__game = game;

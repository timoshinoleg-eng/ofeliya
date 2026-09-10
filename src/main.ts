import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { Analytics } from './systems/Analytics';
import { MessengerBridge } from './systems/MessengerBridge';
import { SafeArea } from './systems/SafeArea';
import { VkBridge } from './systems/VkBridge';
import { ShareVideo } from './systems/ShareVideo';

// Dev-ручка для автотестов: в панели IAB requestAnimationFrame заморожен,
// поэтому QA прокачивает кадры вручную через __game.loop.step(time).
declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}

/**
 * Синхронизировать meta theme-color с темой мессенджера (TG themeParams /
 * системная схема). Игра сама рисуется тёмным неоном, но webview-хром
 * (статус-бар, шапка) должен совпадать с окружением.
 */
function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const theme = MessengerBridge.getTheme();
  if (theme.bg) {
    meta.setAttribute('content', theme.bg);
  } else if (!theme.dark) {
    // Лёгкая системная тема без явного цвета — приглушённо-серый, не белый.
    meta.setAttribute('content', '#1b2030');
  }
}

async function boot(): Promise<void> {
  // Safe-area пересчитываем до старта сцен (HUD от него зависит).
  SafeArea.update();
  syncThemeColor();
  Analytics.init();
  // VK (V6): стартуем VKWebAppInit + запрос fullscreen (скрыть шапку VK).
  // Идемпотентно и no-op вне VK/мессенджеров.
  MessengerBridge.init();
  if (MessengerBridge.kind === 'vk') void VkBridge.ready.then(() => VkBridge.requestFullscreen());

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
      // V5: WebGL-захват canvas.captureStream() требует preserveDrawingBuffer,
      // иначе клип — чёрный. Включаем ТОЛЬКО на устройствах, где запись реально
      // доступна (canRecord), чтобы не терять FPS на остальных.
      preserveDrawingBuffer: ShareVideo.canRecord(),
    },
    input: {
      activePointers: 3,
    },
    scene: [BootScene, MenuScene, GameScene, UIScene],
  });

  // Dev-ручка для автотестов: в панели IAB requestAnimationFrame заморожен,
  // поэтому QA прокачивает кадры вручную через __game.loop.step(time).
  if (import.meta.env.DEV) window.__game = game;

  // PWA: офлайн-запуск app shell (R2). Только прод и http(s)-контекст.
  if (
    'serviceWorker' in navigator &&
    import.meta.env.PROD &&
    location.protocol.startsWith('http')
  ) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .catch((e) => console.warn('[sw] registration failed:', e));
    });
  }
}

void boot();

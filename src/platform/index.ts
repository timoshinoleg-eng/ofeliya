import type { PlatformAdapter } from './PlatformBridge';
import { BrowserPlatform } from './BrowserPlatform';
import { MaxPlatform } from './MaxPlatform';
import { TelegramPlatform } from './TelegramPlatform';

function detectPlatform(): PlatformAdapter {
  if (typeof window !== 'undefined') {
    if (window.WebApp) return new MaxPlatform();
    if (window.Telegram?.WebApp) return new TelegramPlatform();
  }
  return new BrowserPlatform();
}

export const PlatformBridge = detectPlatform();

export type {
  HapticStyle,
  NotifyType,
  PlatformAdapter,
  PlatformKind,
  PlatformUser,
} from './PlatformBridge';

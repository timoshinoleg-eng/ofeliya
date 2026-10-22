const TELEGRAM_SDK_URL = 'https://telegram.org/js/telegram-web-app.js?63';
const SCRIPT_ID = 'ofeliya-telegram-web-app';
/** Fired once the Telegram SDK is present, so a late load can still select the Telegram host. */
export const TELEGRAM_BRIDGE_READY_EVENT = 'ofeliya:telegram-bridge-ready';

export interface LocationLike {
  hash: string;
}

export function hasTelegramLaunchHint(locationLike: LocationLike): boolean {
  const raw = String(locationLike.hash ?? '').replace(/^#/, '');
  if (!raw) return false;
  const params = new URLSearchParams(raw);
  return (
    params.has('tgWebAppData') ||
    params.has('tgWebAppVersion') ||
    params.has('tgWebAppPlatform')
  );
}

function currentTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  const host = window as Window & {
    Telegram?: { WebApp?: { initData?: string } };
  };
  return host.Telegram?.WebApp?.initData ?? '';
}

/**
 * Announces a late Telegram SDK.
 *
 * The Telegram script is fetched at runtime, so on a slow connection the SDK can land after
 * the game has already resolved its host adapter. Without this signal the Telegram host
 * contract would only be applied on the next unrelated host access, or not at all.
 */
function announceTelegramBridgeReady(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new Event(TELEGRAM_BRIDGE_READY_EVENT));
  } catch {
    // Safe no-op: the event is a hint, never a requirement.
  }
}

export async function ensureTelegramBridge(timeoutMs = 2500): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (currentTelegramInitData()) {
    announceTelegramBridgeReady();
    return true;
  }
  if (!hasTelegramLaunchHint(window.location)) return false;

  const current = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (current?.dataset.loaded === '1') {
    const ready = !!currentTelegramInitData();
    if (ready) announceTelegramBridgeReady();
    return ready;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (): void => {
      const ready = !!currentTelegramInitData();
      // The timeout ends the boot wait, not the script request. Telegram's CDN may
      // finish later; the already-resolved promise must not suppress host adoption.
      if (ready) announceTelegramBridgeReady();
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ready);
    };

    const script = current ?? document.createElement('script');
    if (!current) {
      script.id = SCRIPT_ID;
      script.src = TELEGRAM_SDK_URL;
      script.async = true;
      script.dataset.ofeliyaPlatformBridge = 'telegram';
      document.head.appendChild(script);
    }

    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = '1';
        finish();
      },
      { once: true }
    );
    script.addEventListener('error', () => {
      // A failed request never emits 'load'. Leave no inert tag behind: a later
      // invocation can issue a fresh request without reloading the Mini App.
      script.remove();
      finish();
    }, { once: true });
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

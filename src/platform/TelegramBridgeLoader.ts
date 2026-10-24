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

function currentTelegramWebApp(): { initData?: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = window as Window & {
    Telegram?: { WebApp?: { initData?: string } };
  };
  return host.Telegram?.WebApp;
}

const announcedBridges = new WeakSet<object>();
interface ScriptLoad {
  result?: boolean;
  waiters: Set<(ready: boolean) => void>;
}
const scriptLoads = new WeakMap<HTMLScriptElement, ScriptLoad>();

/**
 * Announces a late Telegram SDK.
 *
 * The Telegram script is fetched at runtime, so on a slow connection the SDK can land after
 * the game has already resolved its host adapter. Without this signal the Telegram host
 * contract would only be applied on the next unrelated host access, or not at all.
 */
function announceTelegramBridgeReady(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const bridge = currentTelegramWebApp();
  if (!bridge?.initData || announcedBridges.has(bridge)) return;
  // Mark before dispatch: a ready listener may synchronously probe the loader again.
  announcedBridges.add(bridge);
  try {
    window.dispatchEvent(new Event(TELEGRAM_BRIDGE_READY_EVENT));
  } catch {
    // Safe no-op: the event is a hint, never a requirement.
  }
}

export async function ensureTelegramBridge(timeoutMs = 2500): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (currentTelegramWebApp()?.initData) {
    announceTelegramBridgeReady();
    return true;
  }
  if (!hasTelegramLaunchHint(window.location)) return false;

  const current = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (current?.dataset.loaded === '1') {
    return false;
  }

  const script = current ?? document.createElement('script');
  let loading = scriptLoads.get(script);
  if (!loading) {
    loading = { waiters: new Set() };
    const state = loading;
    const finish = (ready: boolean): void => {
      state.result = ready;
      for (const waiter of state.waiters) waiter(ready);
      state.waiters.clear();
    };
    const cleanup = (): void => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onLoad = (): void => {
      cleanup();
      script.dataset.loaded = '1';
      announceTelegramBridgeReady();
      finish(!!currentTelegramWebApp()?.initData);
    };
    const onError = (): void => {
      cleanup();
      // Remove the failed request so a later call can create a fresh script.
      script.remove();
      finish(false);
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    scriptLoads.set(script, loading);
    if (!current) {
      script.id = SCRIPT_ID;
      script.src = TELEGRAM_SDK_URL;
      script.async = true;
      script.dataset.ofeliyaPlatformBridge = 'telegram';
      document.head.appendChild(script);
    }
  }

  // A caller's deadline ends only its boot wait. Keep the shared script handlers
  // alive for late host adoption and for callers with a longer deadline.
  const request = loading;
  if (request.result !== undefined) return request.result;
  return new Promise<boolean>((resolve) => {
    const finish = (ready: boolean): void => {
      window.clearTimeout(timer);
      request.waiters.delete(finish);
      resolve(ready);
    };
    const timer = window.setTimeout(() => {
      announceTelegramBridgeReady();
      finish(!!currentTelegramWebApp()?.initData);
    }, timeoutMs);
    request.waiters.add(finish);
  });
}

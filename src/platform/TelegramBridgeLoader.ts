const TELEGRAM_SDK_URL = 'https://telegram.org/js/telegram-web-app.js?63';
const SCRIPT_ID = 'ofeliya-telegram-web-app';

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

export async function ensureTelegramBridge(timeoutMs = 2500): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.Telegram?.WebApp?.initData) return true;
  if (!hasTelegramLaunchHint(window.location)) return false;

  const current = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (current?.dataset.loaded === '1') return !!window.Telegram?.WebApp?.initData;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(!!window.Telegram?.WebApp?.initData);
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
    script.addEventListener('error', finish, { once: true });
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

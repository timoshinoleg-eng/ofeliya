const SAFE_STAGE = /^[a-z0-9-]+$/;

/**
 * Временная диагностическая метка для запуска в MAX: в URL попадает только
 * этап старта, без initData, пользователя или текста ошибки.
 */
export function reportStartup(stage: string): void {
  if (!SAFE_STAGE.test(stage)) return;
  const url = new URL('./__startup', window.location.href);
  url.searchParams.set('stage', stage);
  void fetch(url, { cache: 'no-store', credentials: 'omit', keepalive: true }).catch(() => undefined);
}

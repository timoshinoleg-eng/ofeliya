const SAFE_STAGE = /^[a-z0-9-]+$/;

/**
 * Временная диагностическая метка для запуска в MAX: в URL попадает только
 * этап старта, без initData и пользовательских данных.
 */
export function reportStartup(stage: string): void {
  if (!SAFE_STAGE.test(stage)) return;
  const url = new URL('./__startup', window.location.href);
  url.searchParams.set('stage', stage);
  void fetch(url, { cache: 'no-store', credentials: 'omit', keepalive: true }).catch(() => undefined);
}

/** Runtime errors are capped diagnostic data; MAX initData and user fields are never read here. */
export function reportStartupFailure(value: unknown, source?: string): void {
  const message = value instanceof Error ? value.message : String(value || 'unknown');
  const url = new URL('./__startup', window.location.href);
  url.searchParams.set('stage', 'runtime-error');
  url.searchParams.set('message', message.slice(0, 160));
  if (source) url.searchParams.set('source', source.slice(0, 160));
  void fetch(url, { cache: 'no-store', credentials: 'omit', keepalive: true }).catch(() => undefined);
}

(() => {
  // v0.4.1: MAX/Android (портрет + twin-stick) + content v0.4.0 (K1–K6).
  // Механизм релиза: смена тега → новый URL-параметр ?app= → webview/SW
  // видят новую сборку (см. deploy/nginx.conf: no-store на runtime-config.js).
  const release = 'ofeliya-20260911-v041';
  const url = new URL(window.location.href);
  if (url.searchParams.get('app') === release) return;
  url.searchParams.set('app', release);
  window.location.replace(url.toString());
})();

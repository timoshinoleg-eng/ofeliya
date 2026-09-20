(() => {
  // Direct startup: cache freshness comes from no-cache HTML + content-hashed assets.
  // Never navigate from this pre-module script; Android WebView may abort the main bundle stream.
  const release = 'ofeliya-20260921-direct-nav-v1';
  const traceKey = 'ofeliya_startup_nav_v1';
  const nowOrigin = Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : Date.now();

  window.__ofeliyaEarlyMarks = window.__ofeliyaEarlyMarks || [];
  window.__ofeliyaEarlyMarks.push(['runtime-config', performance.now()]);

  const navSnapshot = () => {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    if (!nav) return {};
    return {
      type: String(nav.type || 'unknown'),
      responseStartMs: Math.max(0, Number(nav.responseStart) || 0),
      responseEndMs: Math.max(0, Number(nav.responseEnd) || 0),
    };
  };

  try {
    sessionStorage.setItem(
      traceKey,
      JSON.stringify({
        release,
        startedAtWallMs: nowOrigin,
        redirectCount: 0,
        pendingRedirect: false,
        completed: false,
        currentNavigation: navSnapshot(),
      })
    );
  } catch {
    // Startup diagnostics are strictly best-effort.
  }

  // Remove the legacy cache-bust parameter without causing a network navigation.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('app')) {
      url.searchParams.delete('app');
      history.replaceState(history.state, '', url.toString());
    }
  } catch {
    // Canonicalization is optional; startup must continue.
  }

  window.__ofeliyaEarlyMarks.push(['runtime-config.ready', performance.now()]);
})();

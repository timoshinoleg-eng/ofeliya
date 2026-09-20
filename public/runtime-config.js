(() => {
  // Strain Zero MAX RC: dedicated /ofeliya/ namespace and a fresh WebView URL.
  const release = 'ofeliya-20260912-strain-zero-rc3-utf8';
  const traceKey = 'ofeliya_startup_nav_v1';
  const nowOrigin = Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : Date.now();

  window.__ofeliyaEarlyMarks = window.__ofeliyaEarlyMarks || [];
  window.__ofeliyaEarlyMarks.push(['runtime-config', performance.now()]);

  const readState = () => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(traceKey) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };
  const writeState = (state) => {
    try {
      sessionStorage.setItem(traceKey, JSON.stringify(state));
    } catch {
      // Startup diagnostics are strictly best-effort.
    }
  };
  const navSnapshot = () => {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    if (!nav) return {};
    return {
      type: String(nav.type || 'unknown'),
      responseStartMs: Math.max(0, Number(nav.responseStart) || 0),
      responseEndMs: Math.max(0, Number(nav.responseEnd) || 0),
    };
  };

  const url = new URL(window.location.href);
  const existing = readState();
  const continuesRedirect =
    !!existing &&
    existing.release === release &&
    existing.pendingRedirect === true &&
    existing.completed !== true &&
    typeof existing.startedAtWallMs === 'number' &&
    nowOrigin - existing.startedAtWallMs >= 0 &&
    nowOrigin - existing.startedAtWallMs < 30000;

  const state = continuesRedirect
    ? existing
    : {
        release,
        startedAtWallMs: nowOrigin,
        redirectCount: 0,
        pendingRedirect: false,
        completed: false,
      };

  if (url.searchParams.get('app') !== release) {
    state.redirectCount = Math.max(0, Number(state.redirectCount) || 0) + 1;
    state.pendingRedirect = true;
    state.completed = false;
    state.firstNavigation = state.firstNavigation || navSnapshot();
    writeState(state);

    url.searchParams.set('app', release);
    window.location.replace(url.toString());
    return;
  }

  state.pendingRedirect = false;
  state.currentNavigation = navSnapshot();
  writeState(state);
  window.__ofeliyaEarlyMarks.push(['runtime-config.release-match', performance.now()]);
})();

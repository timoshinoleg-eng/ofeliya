(() => {
  // v0.4.1 production routing hotfix: dedicated /ofeliya/ namespace + bot identity.
  // Changing this tag forces MAX WebView to navigate to a distinct URL and
  // bypass any stale document/service-worker state from the previous /hub/ deploy.
  const release = 'ofeliya-20260911-v041-r2';
  const url = new URL(window.location.href);
  if (url.searchParams.get('app') === release) return;
  url.searchParams.set('app', release);
  window.location.replace(url.toString());
})();

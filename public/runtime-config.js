(() => {
  const release = 'ofeliya-20260910-1';
  const url = new URL(window.location.href);
  if (url.searchParams.get('app') === release) return;
  url.searchParams.set('app', release);
  window.location.replace(url.toString());
})();

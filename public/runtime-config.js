(() => {
  // Strain Zero MAX RC: dedicated /ofeliya/ namespace and a fresh WebView URL.
  const release = 'ofeliya-20260912-strain-zero-rc3-utf8';
  const url = new URL(window.location.href);
  if (url.searchParams.get('app') === release) return;
  url.searchParams.set('app', release);
  window.location.replace(url.toString());
})();

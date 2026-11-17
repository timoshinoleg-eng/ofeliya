/** A failed browser module load may be cached until reload; never reload without a tap. */
export function showLazyLoadFailure(): void {
  if (document.getElementById('ofeliya-lazy-load-failure')) return;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const panel = document.createElement('div');
  panel.id = 'ofeliya-lazy-load-failure';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'ofeliya-lazy-load-failure-title');
  panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(8,15,20,.94);color:#f0eadb;font:16px sans-serif;padding:24px;text-align:center';
  const content = document.createElement('div');
  const title = document.createElement('p');
  title.id = 'ofeliya-lazy-load-failure-title';
  title.textContent = 'Не удалось загрузить раздел. Проверьте соединение и перезапустите игру.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'ПЕРЕЗАПУСТИТЬ';
  reload.style.cssText = 'min-height:44px;margin:8px;padding:8px 16px';
  reload.addEventListener('click', () => window.location.reload());
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'ЗАКРЫТЬ';
  close.style.cssText = 'min-height:44px;margin:8px;padding:8px 16px';
  close.addEventListener('click', () => { panel.remove(); previousFocus?.focus(); });
  panel.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close.click(); }
    if (event.key === 'Tab') {
      if (event.shiftKey && document.activeElement === reload) { event.preventDefault(); close.focus(); }
      else if (!event.shiftKey && document.activeElement === close) { event.preventDefault(); reload.focus(); }
    }
  });
  content.append(title, reload, close);
  panel.append(content);
  document.body.append(panel);
  reload.focus();
}

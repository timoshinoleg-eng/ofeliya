/**
 * Safe-area (notch/панель жестов iOS, динамический toolbar).
 *
 * env() доступен только CSS'у, поэтому читаем инсеты через пробный элемент:
 * CSS-кастомные свойства с env() вычисляются в пиксели, getComputedStyle их отдаёт.
 * На десктопе/в мессенджерах без инсетов все значения 0 — ноль накладных расходов.
 */
class SafeAreaImpl {
  top = 0;
  right = 0;
  bottom = 0;
  left = 0;

  private probe: HTMLElement | null = null;

  /** Пересчитать инсеты. Вызывать при старте и на resize/orientationchange. */
  update(): void {
    if (typeof document === 'undefined') return;
    if (!this.probe) {
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText =
        'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top,0px);' +
        'padding-right:env(safe-area-inset-right,0px);' +
        'padding-bottom:env(safe-area-inset-bottom,0px);' +
        'padding-left:env(safe-area-inset-left,0px);';
      document.body.appendChild(el);
      this.probe = el;
    }
    const cs = getComputedStyle(this.probe);
    this.top = parseInset(cs.paddingTop);
    this.right = parseInset(cs.paddingRight);
    this.bottom = parseInset(cs.paddingBottom);
    this.left = parseInset(cs.paddingLeft);
  }
}

function parseInset(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const SafeArea = new SafeAreaImpl();

// Инсеты меняются при rotate и при показе/скрытии динамического toolbara iOS.
if (typeof window !== 'undefined') {
  SafeArea.update();
  window.addEventListener('resize', () => SafeArea.update(), { passive: true });
  window.addEventListener('orientationchange', () => SafeArea.update(), { passive: true });
}

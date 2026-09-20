export interface StartupMark {
  name: string;
  tMs: number;
}

export type StartupMetaValue = string | number | boolean | null;

export interface StartupTraceRecord {
  schemaVersion: 1;
  startedAtWallMs: number;
  completedAtWallMs: number;
  totalMs: number;
  marks: StartupMark[];
  meta: Record<string, StartupMetaValue>;
}

interface EarlyNavigationState {
  release?: string;
  startedAtWallMs?: number;
  redirectCount?: number;
  pendingRedirect?: boolean;
  completed?: boolean;
  firstNavigation?: Record<string, number | string>;
  currentNavigation?: Record<string, number | string>;
}

declare global {
  interface Window {
    __ofeliyaEarlyMarks?: Array<[string, number]>;
    __startupTrace?: StartupTraceRecord;
  }
}

const NAV_STATE_KEY = 'ofeliya_startup_nav_v1';
const HISTORY_KEY = 'ofeliya_startup_trace_history_v1';
const HISTORY_LIMIT = 6;
const SCHEMA_VERSION = 1 as const;

function roundMs(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

function safeSessionGet(): EarlyNavigationState | null {
  try {
    const raw = sessionStorage.getItem(NAV_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EarlyNavigationState | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeSessionSet(value: EarlyNavigationState): void {
  try {
    sessionStorage.setItem(NAV_STATE_KEY, JSON.stringify(value));
  } catch {
    // Diagnostics must never block startup.
  }
}

function safeReadHistory(): StartupTraceRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is StartupTraceRecord =>
          !!item &&
          typeof item === 'object' &&
          (item as StartupTraceRecord).schemaVersion === SCHEMA_VERSION &&
          Number.isFinite((item as StartupTraceRecord).totalMs)
      )
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function safeWriteHistory(history: StartupTraceRecord[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {
    // Private mode / quota failure: keep startup unaffected.
  }
}

function currentNavigationMeta(): Record<string, StartupMetaValue> {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return {};
  return {
    navigationType: nav.type || 'unknown',
    navTtfbMs: roundMs(nav.responseStart),
    navResponseEndMs: roundMs(nav.responseEnd),
    navDomInteractiveMs: roundMs(nav.domInteractive),
    navDomContentLoadedMs: roundMs(nav.domContentLoadedEventEnd),
  };
}

function mainBundleMeta(): Record<string, StartupMetaValue> {
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const bundle = [...resources]
    .reverse()
    .find(
      (entry) =>
        entry.initiatorType === 'script' &&
        /\/assets\/index-[A-Za-z0-9_-]+\.js(?:\?|$)/.test(entry.name)
    );
  if (!bundle) return {};
  return {
    bundleFetchMs: roundMs(bundle.responseEnd - bundle.startTime),
    bundleTransferBytes: Math.max(0, Math.floor(bundle.transferSize || 0)),
  };
}

class StartupTraceImpl {
  private readonly earlyState = safeSessionGet();
  private readonly startedAtWallMs =
    typeof this.earlyState?.startedAtWallMs === 'number'
      ? this.earlyState.startedAtWallMs
      : performance.timeOrigin;
  private readonly marks: StartupMark[] = [];
  private readonly meta: Record<string, StartupMetaValue> = {};
  private finished = false;

  constructor() {
    this.setMeta('redirectCount', this.earlyState?.redirectCount ?? 0);
    this.setMeta('swControlledAtModule', Boolean(navigator.serviceWorker?.controller));
    this.setMeta('visibilityAtModule', document.visibilityState);
    this.setMeta('devicePixelRatio', roundMs(window.devicePixelRatio || 1));

    for (const [name, perfMs] of window.__ofeliyaEarlyMarks ?? []) {
      this.markAtPerformance(name, perfMs);
    }
    this.mark('main.module');
  }

  mark(name: string): void {
    if (this.finished) return;
    const elapsed = performance.timeOrigin + performance.now() - this.startedAtWallMs;
    this.pushMark(name, elapsed);
  }

  setMeta(name: string, value: StartupMetaValue): void {
    if (this.finished) return;
    this.meta[name] = value;
  }

  finish(name = 'menu.visible'): StartupTraceRecord | null {
    if (this.finished) return window.__startupTrace ?? null;
    this.mark(name);
    this.finished = true;

    const completedAtWallMs = Date.now();
    const totalMs = roundMs(completedAtWallMs - this.startedAtWallMs);
    const record: StartupTraceRecord = {
      schemaVersion: SCHEMA_VERSION,
      startedAtWallMs: this.startedAtWallMs,
      completedAtWallMs,
      totalMs,
      marks: [...this.marks],
      meta: {
        ...this.meta,
        ...currentNavigationMeta(),
        ...mainBundleMeta(),
        swControlledAtMenu: Boolean(navigator.serviceWorker?.controller),
      },
    };

    const history = [record, ...safeReadHistory()].slice(0, HISTORY_LIMIT);
    safeWriteHistory(history);

    const navState = safeSessionGet() ?? {};
    safeSessionSet({ ...navState, completed: true, pendingRedirect: false });

    if (new URLSearchParams(window.location.search).get('startupTrace') === '1') {
      window.__startupTrace = record;
      this.renderDebugOverlay(history);
    }

    return record;
  }

  getHistory(): StartupTraceRecord[] {
    return safeReadHistory();
  }

  showDebugOverlay(): boolean {
    const history = safeReadHistory();
    if (history.length === 0) return false;
    window.__startupTrace = history[0];
    this.renderDebugOverlay(history);
    return true;
  }

  private markAtPerformance(name: string, perfMs: number): void {
    const elapsed = performance.timeOrigin + perfMs - this.startedAtWallMs;
    this.pushMark(name, elapsed);
  }

  private pushMark(name: string, elapsed: number): void {
    if (!name || !Number.isFinite(elapsed)) return;
    this.marks.push({ name, tMs: roundMs(elapsed) });
  }

  private renderDebugOverlay(history: StartupTraceRecord[]): void {
    document.getElementById('ofeliya-startup-trace')?.remove();

    const current = history[0];
    if (!current) return;

    const overlay = document.createElement('div');
    overlay.id = 'ofeliya-startup-trace';
    overlay.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'left:8px',
      'right:8px',
      'top:8px',
      'max-height:72vh',
      'overflow:auto',
      'padding:10px 12px',
      'border:1px solid rgba(143,232,255,.75)',
      'border-radius:10px',
      'background:rgba(4,8,16,.94)',
      'color:#dffaff',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace',
      'white-space:pre-wrap',
      'box-shadow:0 6px 24px rgba(0,0,0,.45)',
    ].join(';');

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть startup trace');
    close.style.cssText = [
      'float:right',
      'margin:-4px -4px 4px 8px',
      'width:28px',
      'height:28px',
      'border:1px solid #8fe8ff',
      'border-radius:8px',
      'background:#101827',
      'color:#fff',
      'font-size:20px',
      'line-height:20px',
    ].join(';');
    close.addEventListener('click', () => overlay.remove());

    const body = document.createElement('pre');
    body.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;';
    const marks = current.marks
      .map((mark, index) => {
        const prev = index > 0 ? current.marks[index - 1].tMs : 0;
        return `${mark.tMs.toFixed(1).padStart(7)} ms  +${(mark.tMs - prev)
          .toFixed(1)
          .padStart(6)}  ${mark.name}`;
      })
      .join('\n');

    const previous = history
      .slice(1, 4)
      .map(
        (trace, index) =>
          `prev ${index + 1}: ${trace.totalMs.toFixed(1)} ms · redirects=${String(
            trace.meta.redirectCount ?? 0
          )} · renderer=${String(trace.meta.rendererActual ?? 'n/a')} · TTFB=${String(
            trace.meta.navTtfbMs ?? 'n/a'
          )}ms · bundle=${String(trace.meta.bundleFetchMs ?? 'n/a')}ms`
      )
      .join('\n');

    body.textContent = [
      `OFELIYA STARTUP TRACE · ${current.totalMs.toFixed(1)} ms`,
      `redirects=${String(current.meta.redirectCount ?? 0)} · platform=${String(
        current.meta.platformFinal ?? current.meta.platformInitial ?? 'unknown'
      )} · renderer=${String(current.meta.rendererActual ?? 'unknown')}`,
      `SW=${String(current.meta.swControlledAtMenu ?? false)} · nav=${String(
        current.meta.navigationType ?? 'unknown'
      )} · DPR=${String(current.meta.devicePixelRatio ?? 1)}`,
      `TTFB=${String(current.meta.navTtfbMs ?? 'n/a')}ms · responseEnd=${String(
        current.meta.navResponseEndMs ?? 'n/a'
      )}ms · DOMContentLoaded=${String(current.meta.navDomContentLoadedMs ?? 'n/a')}ms`,
      `bundle=${String(current.meta.bundleFetchMs ?? 'n/a')}ms / ${String(
        current.meta.bundleTransferBytes ?? 'n/a'
      )}B · fonts=${String(current.meta.fontsOutcome ?? 'n/a')}`,
      `viewport=${String(current.meta.viewportSourceFirst ?? 'n/a')} ${String(
        current.meta.viewportWidthFirst ?? '?'
      )}×${String(current.meta.viewportHeightFirst ?? '?')} → ${String(
        current.meta.viewportSourceSecond ?? 'n/a'
      )}`,
      '',
      marks,
      previous ? `\n${previous}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    overlay.append(close, body);
    document.body.appendChild(overlay);
  }
}

export const StartupTrace = new StartupTraceImpl();

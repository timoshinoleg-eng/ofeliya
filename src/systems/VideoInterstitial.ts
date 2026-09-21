export type VideoInterstitialId =
  | 'startIntro'
  | 'bloodstreamToHeart'
  | 'defeat'
  | 'victory'
  | 'immunePrimeIntro'
  | 'cardiacTitanIntro';

type VideoAsset = {
  file: string;
  durationMs: number;
};

type PlayOptions = {
  onComplete: () => void;
  onFail: () => void;
  maxStartWaitMs?: number;
  maxDurationMs?: number;
  ariaLabel?: string;
};

const VIDEO_ASSETS: Record<VideoInterstitialId, VideoAsset> = {
  startIntro: { file: '01_start_intro.mp4', durationMs: 2250 },
  bloodstreamToHeart: { file: '02_bloodstream_to_heart.mp4', durationMs: 7417 },
  defeat: { file: '04_defeat.mp4', durationMs: 2250 },
  victory: { file: '06_victory_canonical.mp4', durationMs: 7584 },
  immunePrimeIntro: { file: '07_immune_prime_intro.mp4', durationMs: 8500 },
  cardiacTitanIntro: { file: '08_cardiac_titan_intro.mp4', durationMs: 8500 },
};

const DEFAULT_START_WATCHDOG_MS = 900;
const STALL_WATCHDOG_MS = 900;

function videoEnabled(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('video');
  if (forced === '0') return false;
  if (forced === '1') return true;
  return navigator.webdriver !== true;
}

function assetUrl(id: VideoInterstitialId): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}video/${VIDEO_ASSETS[id].file}`;
}

function makeVideo(id: VideoInterstitialId, preload: 'metadata' | 'auto'): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = assetUrl(id);
  video.preload = preload;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  return video;
}

export class VideoInterstitial {
  private static preloaded = new Map<VideoInterstitialId, HTMLVideoElement>();
  private static cancelActivePlayback: (() => void) | null = null;

  static isEnabled(): boolean {
    return videoEnabled();
  }

  static preload(id: VideoInterstitialId): void {
    if (!videoEnabled() || this.preloaded.has(id)) return;
    const video = makeVideo(id, 'auto');
    this.preloaded.set(id, video);
    try {
      video.load();
    } catch {
      this.preloaded.delete(id);
    }
  }

  static cancelActive(): void {
    this.cancelActivePlayback?.();
    this.cancelActivePlayback = null;
  }

  static play(id: VideoInterstitialId, options: PlayOptions): boolean {
    if (!videoEnabled()) return false;

    const host = document.getElementById('game');
    if (!host) return false;

    this.cancelActive();

    const video = this.preloaded.get(id) ?? makeVideo(id, 'auto');
    this.preloaded.delete(id);
    video.preload = 'auto';

    const overlay = document.createElement('div');
    overlay.dataset.ofeliyaVideo = id;
    overlay.setAttribute('role', 'button');
    overlay.setAttribute('aria-label', options.ariaLabel ?? 'Пропустить видео');
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '10000',
      overflow: 'hidden',
      background: '#050308',
      opacity: '0',
      transition: 'opacity 120ms linear',
      cursor: 'pointer',
      touchAction: 'manipulation',
    });

    Object.assign(video.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: 'cover',
      pointerEvents: 'none',
      background: '#050308',
    });
    overlay.appendChild(video);
    host.appendChild(overlay);

    let settled = false;
    let started = false;
    let startTimer = 0;
    let stallTimer = 0;
    let maxTimer = 0;

    const clearTimers = (): void => {
      if (startTimer) window.clearTimeout(startTimer);
      if (stallTimer) window.clearTimeout(stallTimer);
      if (maxTimer) window.clearTimeout(maxTimer);
      startTimer = 0;
      stallTimer = 0;
      maxTimer = 0;
    };

    const cleanup = (): void => {
      clearTimers();
      video.pause();
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Best-effort media release.
      }
      overlay.remove();
      if (this.cancelActivePlayback === cancelOnly) this.cancelActivePlayback = null;
    };

    const finish = (kind: 'complete' | 'fail'): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (kind === 'complete') options.onComplete();
      else options.onFail();
    };

    const cancelOnly = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
    };

    const clearStallWatchdog = (): void => {
      if (!stallTimer) return;
      window.clearTimeout(stallTimer);
      stallTimer = 0;
    };

    const armStallWatchdog = (): void => {
      if (!started || settled || stallTimer) return;
      stallTimer = window.setTimeout(() => finish('fail'), STALL_WATCHDOG_MS);
    };

    video.addEventListener('playing', () => {
      if (settled) return;
      started = true;
      if (startTimer) {
        window.clearTimeout(startTimer);
        startTimer = 0;
      }
      clearStallWatchdog();
      overlay.style.opacity = '1';
    });
    video.addEventListener('timeupdate', clearStallWatchdog);
    video.addEventListener('waiting', armStallWatchdog);
    video.addEventListener('stalled', armStallWatchdog);
    video.addEventListener('error', () => finish('fail'));
    video.addEventListener('abort', () => finish('fail'));
    video.addEventListener('ended', () => finish('complete'));
    overlay.addEventListener('pointerup', () => finish('complete'));

    const startWait = options.maxStartWaitMs ?? DEFAULT_START_WATCHDOG_MS;
    startTimer = window.setTimeout(() => {
      if (!started) finish('fail');
    }, startWait);

    const hardLimit =
      options.maxDurationMs ?? VIDEO_ASSETS[id].durationMs + Math.max(1200, startWait);
    maxTimer = window.setTimeout(() => finish(started ? 'complete' : 'fail'), hardLimit);

    this.cancelActivePlayback = cancelOnly;

    try {
      video.currentTime = 0;
    } catch {
      // Some WebViews reject currentTime until metadata is available.
    }

    void video.play().catch(() => finish('fail'));
    return true;
  }
}

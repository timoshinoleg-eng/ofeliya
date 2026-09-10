/**
 * V5: шаринг-видео — короткий клип последних секунд забега (MediaRecorder).
 *
 * Подход «скользящее окно»: рекордер стартует в начале забега и каждые
 * ROLL_MS секунд «ротация» (остановить → выбросить → заново), поэтому в любой
 * момент в `chunks` лежит только ПОСЛЕДНЕЕ окно (~ROLL_MS). При конце забега
 * stop() отдаёт клип последних секунд (момент победы) БЕЗ перекодировки/trim.
 *
 * Feature-detection: на устройствах без MediaRecorder/captureStream/подходящего
 * mime canRecord()=false → вызывающий делает фолбэк на текст/изображение.
 * WebGL-захват требует preserveDrawingBuffer=true (включается в main.ts только
 * когда canRecord()=true, чтобы не терять FPS на остальных устройствах).
 */

export interface RecordedClip {
  blob: Blob;
  mime: string;
}

const ROLL_MS = 12_000; // окно клипа ~12 с
const VIDEO_BITS = 2_500_000; // ~2.5 Мбит/с → ~3.7 МБ за 12 с

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  try {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
  } catch {
    /* нет MediaRecorder */
  }
  return '';
}

class ShareVideoImpl {
  private canvas: HTMLCanvasElement | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private rollTimer: number | null = null;
  private mime = '';

  /** false — шаринг-видео недоступен (делаем фолбэк на текст/карточку). */
  canRecord(): boolean {
    try {
      if (typeof MediaRecorder === 'undefined') return false;
      if (typeof HTMLCanvasElement === 'undefined') return false;
      if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
      this.mime = pickMime();
      return this.mime !== '';
    } catch {
      return false;
    }
  }

  /** Старт записи (скользящее окно). false — не удалось (не бросаем). */
  start(canvas: HTMLCanvasElement | null): boolean {
    if (!canvas || !this.canRecord()) return false;
    try {
      this.canvas = canvas;
      this.begin();
      this.rollTimer = window.setInterval(() => this.begin(), ROLL_MS);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  private begin(): void {
    if (!this.canvas) return;
    this.disposeRec();
    this.chunks = [];
    try {
      const stream = this.canvas.captureStream(30);
      const rec = new MediaRecorder(stream, {
        mimeType: this.mime,
        videoBitsPerSecond: VIDEO_BITS,
      });
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      rec.start(1000);
      this.rec = rec;
    } catch {
      this.rec = null;
    }
  }

  private disposeRec(): void {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    try {
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* тихо */
    }
  }

  /** Остановить и отдать клип последних ~ROLL_MS (null — нечего отдавать). */
  stop(): Promise<RecordedClip | null> {
    if (this.rollTimer) {
      window.clearInterval(this.rollTimer);
      this.rollTimer = null;
    }
    const rec = this.rec;
    this.rec = null;
    this.canvas = null;
    return new Promise((resolve) => {
      if (!rec) {
        resolve(null);
        return;
      }
      if (rec.state === 'inactive') {
        this.haltTracks(rec);
        resolve(this.assemble());
        return;
      }
      rec.onstop = () => {
        this.haltTracks(rec);
        resolve(this.assemble());
      };
      try {
        rec.stop();
      } catch {
        this.haltTracks(rec);
        resolve(this.assemble());
      }
    });
  }

  private haltTracks(rec: MediaRecorder): void {
    try {
      rec.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* тихо */
    }
  }

  private assemble(): RecordedClip | null {
    if (this.chunks.length === 0) return null;
    return { blob: new Blob(this.chunks, { type: this.mime }), mime: this.mime };
  }
}

export const ShareVideo = new ShareVideoImpl();

/**
 * Поделиться клипом через Web Share API с файлом. true — файл ушёл (диалог
 * шаринга вызван); false — не поддерживается или пользователь отменил →
 * вызывающий делает фолбэк (текст/карточка).
 */
export async function shareClip(
  clip: RecordedClip,
  text: string,
  link?: string
): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[]; text?: string; url?: string }) => boolean;
    share?: (data: { files?: File[]; text?: string; url?: string }) => Promise<void>;
  };
  if (!nav.share) return false;
  try {
    const ext = clip.mime.includes('mp4') ? 'mp4' : 'webm';
    const file = new File([clip.blob], `ofeliya-clip-${Date.now()}.${ext}`, {
      type: clip.mime.split(';')[0],
    });
    // Если файлы поддерживаются — шлём клип; иначе — только текст/ссылку.
    if (nav.canShare) {
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text, ...(link ? { url: link } : {}) });
        return true;
      }
      if (nav.canShare({ text, ...(link ? { url: link } : {}) })) {
        await nav.share({ text, ...(link ? { url: link } : {}) });
        return true;
      }
      return false;
    }
    await nav.share({ files: [file], text, ...(link ? { url: link } : {}) });
    return true;
  } catch {
    /* AbortError (отмена) / NotAllowedError → фолбэк */
    return false;
  }
}

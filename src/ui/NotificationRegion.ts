export interface NotificationSurface {
  setVisible(visible: boolean): void;
  destroy(): void;
}

type Notice = { key: string; present: (done: () => void) => NotificationSurface };
type ActiveNotice = { notice: Notice; surface?: NotificationSurface };

/** Run-owned FIFO for the shared tutorial/system-message region. No gameplay clock. */
export class NotificationRegion {
  private queue: Notice[] = [];
  private seen = new Set<string>();
  private current: ActiveNotice | null = null;
  private blocked = false;
  private closed = false;

  get occupied(): boolean { return this.current !== null || this.queue.length > 0; }

  enqueue(key: string, present: Notice['present']): void {
    if (this.closed || this.seen.has(key)) return;
    this.seen.add(key);
    this.queue.push({ key, present });
    this.flush();
  }

  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
    this.current?.surface?.setVisible(!blocked);
    this.flush();
  }

  cancel(key: string | readonly string[]): void {
    const keys = new Set(typeof key === 'string' ? [key] : key);
    this.queue = this.queue.filter(notice => !keys.has(notice.key));
    if (this.current && keys.has(this.current.notice.key)) {
      const old = this.current;
      this.current = null;
      old.surface?.destroy();
    }
    this.flush();
  }

  /** Terminal boundary. Pass false after Phaser has already taken ownership of scene cleanup. */
  destroy(disposeSurface = true): void {
    this.closed = true;
    this.queue = [];
    const old = this.current;
    this.current = null;
    if (disposeSurface) old?.surface?.destroy();
  }

  private flush(): void {
    if (this.closed || this.blocked || this.current || this.queue.length === 0) return;
    const current: ActiveNotice = { notice: this.queue.shift()! };
    this.current = current;
    const surface = current.notice.present(() => {
      if (this.current !== current) return;
      this.current = null;
      current.surface?.destroy();
      this.flush();
    });
    if (this.current === current) current.surface = surface;
    else surface.destroy(); // A synchronous completion cannot retain an orphan surface.
  }
}

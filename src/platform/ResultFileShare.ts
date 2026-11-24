/** Result of attempting native file sharing; cancellation must not trigger a fallback. */
export type FileShareOutcome = 'shared' | 'unsupported' | 'error' | 'cancelled';

type ShareNavigator = Pick<Navigator, 'canShare' | 'share'>;

/** Messenger-native sharing owns the user gesture; PNG files are browser-only. */
export function shareFileForPlatform(kind: 'browser' | 'telegram' | 'max', host: ShareNavigator | null, file: File, text: string): Promise<FileShareOutcome> {
  if (kind !== 'browser') return Promise.resolve('unsupported');
  return shareFile(host, file, text);
}
const failure = (error: unknown): FileShareOutcome =>
  error instanceof Object && 'name' in error && error.name === 'AbortError' ? 'cancelled' : 'error';

/** Call directly from a user gesture: navigator.share is invoked before the first await. */
export function shareFile(host: ShareNavigator | null, file: File, text: string): Promise<FileShareOutcome> {
  const data: ShareData = { files: [file], text };
  if (!host || typeof host.canShare !== 'function' || typeof host.share !== 'function') return Promise.resolve('unsupported');
  try { if (!host.canShare(data)) return Promise.resolve('unsupported'); }
  catch { return Promise.resolve('unsupported'); }
  try {
    return host.share(data).then(() => 'shared' as const, failure);
  } catch (error) {
    return Promise.resolve(failure(error));
  }
}

export interface PreparedFile { file: File; dispose(): void }

/** Owns one asynchronous preparation and discards resources after dismissal or replacement. */
export class PreparedShare {
  private generation = 0;
  private current: PreparedFile | null = null;
  get file(): File | null { return this.current?.file ?? null; }
  async prepare(pending: Promise<PreparedFile>): Promise<void> {
    const generation = ++this.generation;
    this.current?.dispose();
    this.current = null;
    const next = await pending;
    if (generation !== this.generation) { next.dispose(); return; }
    this.current = next;
  }
  dispose(): void {
    ++this.generation;
    this.current?.dispose();
    this.current = null;
  }
}

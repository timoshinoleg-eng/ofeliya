/** One failure boundary for release, bridge and game startup, including stalls. */
export async function runStartupBoundary(
  start: (signal: AbortSignal) => Promise<void>,
  failed: (error: unknown) => void,
  timeoutMs = 15_000
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => start(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          controller.abort();
          reject(new Error('Startup deadline exceeded'));
        }, timeoutMs);
      }),
    ]);
    return true;
  } catch (error) {
    controller.abort();
    failed(error);
    return false;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

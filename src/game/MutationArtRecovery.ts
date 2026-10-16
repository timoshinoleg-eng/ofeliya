import type Phaser from 'phaser';

const KEYS = ['mutation-prism', 'mutation-halo', 'mutation-singularity'] as const;
const packaged = new WeakMap<Phaser.Textures.Texture, boolean>();
const started = new WeakSet<Phaser.Game>();

/** Record provenance before the larger raw loader texture is released. Unknown textures are left alone. */
export function trackMutationArtSource(key: string, texture: Phaser.Textures.Texture, hasPackagedArt: boolean): void {
  if ((KEYS as readonly string[]).includes(key)) packaged.set(texture, hasPackagedArt);
}

/**
 * Recover only fallback mutation art after the first usable render. CanvasTexture identity,
 * frame sizes and every existing Image reference stay intact, including in an active run.
 * No scene-lifetime listener, retained raw GPU texture or per-frame polling is introduced.
 */
export function startMutationArtRecovery(game: Phaser.Game): void {
  if (started.has(game)) return;
  started.add(game);
  const targets = KEYS.flatMap(key => {
    if (!game.textures.exists(key)) return [];
    const texture = game.textures.get(key);
    return packaged.get(texture) === false ? [{ key, texture: texture as Phaser.Textures.CanvasTexture }] : [];
  });
  if (!targets.length) return;
  let stopped = false;
  const cancellations = new Set<() => void>();
  const stop = (): void => {
    stopped = true;
    game.events.off('postrender', begin);
    game.events.off('destroy', stop);
    for (const cancel of cancellations) cancel();
    cancellations.clear();
  };
  const waitForRetry = (): Promise<boolean> => new Promise(resolve => {
    const cancel = (): void => { clearTimeout(timer); cancellations.delete(cancel); resolve(false); };
    const timer = globalThis.setTimeout(() => { cancellations.delete(cancel); resolve(!stopped); }, 750);
    cancellations.add(cancel);
  });
  const load = (key: string): Promise<HTMLImageElement | null> => new Promise(resolve => {
    const image = new Image();
    image.decoding = 'async';
    let settled = false;
    const finish = (result: HTMLImageElement | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancellations.delete(cancel);
      image.onload = image.onerror = null;
      if (!result) image.src = '';
      resolve(result);
    };
    const cancel = (): void => finish(null);
    const timer = globalThis.setTimeout(cancel, 8000);
    cancellations.add(cancel);
    image.onload = () => finish(image);
    image.onerror = cancel;
    image.src = new URL(`art/${key}.webp`, document.baseURI).href;
  });
  const recover = async ({ key, texture }: typeof targets[number]): Promise<void> => {
    for (let attempt = 0; attempt < 2 && !stopped; attempt++) {
      try {
        const image = await load(key);
        if (stopped) return;
        if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
          if (!game.textures.exists(key) || game.textures.get(key) !== texture || packaged.get(texture) !== false) return;
          // Stage a complete bounded replacement before touching the still-visible fallback.
          const source = texture.getSourceImage() as HTMLCanvasElement;
          const staging = document.createElement('canvas');
          staging.width = source.width;
          staging.height = source.height;
          const staged = staging.getContext('2d');
          if (!staged) return;
          staged.drawImage(image, 0, 0, staging.width, staging.height);
          const context = texture.getContext();
          context.save();
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.globalAlpha = 1;
          context.globalCompositeOperation = 'source-over';
          context.clearRect(0, 0, source.width, source.height);
          context.drawImage(staging, 0, 0);
          context.restore();
          texture.refresh();
          packaged.set(texture, true);
          return;
        }
      } catch {
        // Art failure never invalidates the already usable procedural presentation.
      }
      if (attempt === 0 && !stopped && !(await waitForRetry())) return;
    }
  };
  async function begin(): Promise<void> {
    if (stopped) return;
    await Promise.all(targets.map(recover));
    stop();
  }
  game.events.once('destroy', stop);
  game.events.once('postrender', begin);
}

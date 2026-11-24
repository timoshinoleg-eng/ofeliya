import type Phaser from 'phaser';
import { UI_ICON_ATLAS_KEY } from '../ui/generated/iconFrames';

export const deferredMenuArtMetrics = { firstFrameMs: 0, organicComplete: false };
const started = new WeakSet<Phaser.Game>();

/** Optional presentation work belongs to the game lifecycle, never the Menu shutdown count. */
export function startDeferredMenuArt(game: Phaser.Game): void {
  if (started.has(game)) return;
  started.add(game);
  let alive = true;
  let bake: ((key: string) => void) | undefined;
  const keys = ['virus-player', 'immune-antibody', 'rna-fragment', 'heart-plasma'];
  const safe = (): boolean => alive && game.scene.isActive('Menu') &&
    !game.scene.isActive('Game') && !game.scene.isPaused('Game');
  const stop = (): void => {
    alive = false;
    bake = undefined;
    game.events.off('postrender', begin);
    game.events.off('postrender', tick);
    game.events.off('destroy', stop);
  };
  const tick = (): void => {
    if (!safe()) { stop(); return; }
    if (!bake) return;
    const key = keys.shift();
    if (key) bake(key);
    if (!keys.length) {
      deferredMenuArtMetrics.organicComplete = true;
      stop();
    }
  };
  const begin = (): void => {
    if (!game.scene.isActive('Menu')) return;
    game.events.off('postrender', begin);
    if (!safe()) { stop(); return; }
    deferredMenuArtMetrics.firstFrameMs = performance.now();
    const menu = game.scene.getScene('Menu');
    if (!menu.textures.exists(UI_ICON_ATLAS_KEY)) {
      const loader = menu.load;
      const previousRetries = loader.maxRetries;
      loader.maxRetries = 0;
      try {
        loader.atlas(UI_ICON_ATLAS_KEY, 'assets/ui-icons-atlas.png', 'assets/ui-icons-atlas.json',
          { responseType: 'blob', timeout: 1800 }, { responseType: '', timeout: 1800 });
      } finally { loader.maxRetries = previousRetries; }
      loader.start();
    }
    // Observe the transition even while the lazy import is pending. Once Menu
    // leaves, a later return cannot accidentally revive a stale bake.
    game.events.on('postrender', tick);
    void import('./OrganicNoise').then(({ prepareOrganicNoise, applyOrganicNoise }) => {
      if (!safe()) { stop(); return; }
      prepareOrganicNoise();
      bake = (key): void => {
        if (!safe() || !game.textures.exists(key)) return;
        const texture = game.textures.get(key) as Phaser.Textures.CanvasTexture;
        if (typeof texture.getContext !== 'function') return;
        const canvas = texture.getSourceImage() as HTMLCanvasElement;
        const ctx = texture.getContext();
        ctx.save();
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          applyOrganicNoise(ctx, canvas.width, canvas.height);
        } finally { ctx.restore(); }
        texture.refresh();
      };
    }).catch(stop);
  };
  game.events.on('postrender', begin);
  game.events.once('destroy', stop);
}

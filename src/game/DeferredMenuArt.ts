import type Phaser from 'phaser';
import { UI_ICON_ATLAS_KEY } from '../ui/generated/iconFrames';

export const deferredMenuArtMetrics = { firstFrameMs: 0, organicComplete: false };

const started = new WeakSet<Phaser.Game>();

/** Start optional work only after Menu has actually rendered. */
export function startDeferredMenuArt(game: Phaser.Game): void {
  if (started.has(game)) return;
  started.add(game);
  const begin = (): void => {
    if (!game.scene.isActive('Menu')) return;
    game.events.off('postrender', begin);
    game.events.off('destroy', cancel);
    deferredMenuArtMetrics.firstFrameMs = performance.now();
    const menu = game.scene.getScene('Menu');
    let alive = true;
    const stop = (): void => { alive = false; menu.events.off('update', tick); menu.events.off('shutdown', stop); };
    let tick = (): void => {};
    menu.events.once('shutdown', stop);
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
    void import('./OrganicNoise').then(({ prepareOrganicNoise, applyOrganicNoise }) => {
      if (!alive || !game.scene.isActive('Menu') || game.scene.isActive('Game')) return;
      prepareOrganicNoise();
      const keys = ['virus-player', 'immune-antibody', 'rna-fragment', 'heart-plasma'];
      tick = (): void => {
        if (!alive || !game.scene.isActive('Menu') || game.scene.isActive('Game')) { stop(); return; }
        const key = keys.shift();
        if (!key) { deferredMenuArtMetrics.organicComplete = true; stop(); return; }
        if (!menu.textures.exists(key)) return;
        const texture = menu.textures.get(key) as Phaser.Textures.CanvasTexture;
        if (typeof texture.getContext !== 'function') return;
        const canvas = texture.getSourceImage() as HTMLCanvasElement;
        const ctx = texture.getContext();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        applyOrganicNoise(ctx, canvas.width, canvas.height);
        ctx.restore();
        texture.refresh();
      };
      menu.events.on('update', tick);
    }).catch(() => { /* Optional presentation work. */ });
  };
  const cancel = (): void => { game.events.off('postrender', begin); };
  game.events.on('postrender', begin);
  game.events.once('destroy', cancel);
}

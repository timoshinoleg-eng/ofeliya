import type Phaser from 'phaser';

/** Two boot-baked, six-frame cycles; no runtime raster work, timers or gameplay RNG. */
export const BIOLOGICAL_FRAMES = 6;
export const BIOLOGICAL_KEYS = ['virus-player', 'immune-antibody'] as const;
export type BiologicalKey = (typeof BIOLOGICAL_KEYS)[number];
const ATLAS_KEYS = { 'virus-player': 'bio-cycle-virus-player', 'immune-antibody': 'bio-cycle-immune-antibody' } as const;
export const biologicalAtlasKey = (key: BiologicalKey): string => ATLAS_KEYS[key];

export function biologicalFrameAt(time: number, phase = 0, reduced = false): number {
  // Reduced mode visits three poses at half the texture-change frequency.
  const step = reduced ? 2 : 1;
  return (Math.floor(Math.max(0, time + phase) / (reduced ? 240 : 120)) * step) % BIOLOGICAL_FRAMES;
}

/** Inverse-map a local membrane ripple and independently drifting interior. Canvas/WebGL share pixels. */
export function bakeBiologicalFrame(
  source: Uint8ClampedArray, width: number, height: number, frame: number, key: BiologicalKey
): Uint8ClampedArray {
  if (frame === 0) return source.slice();
  const output = new Uint8ClampedArray(source.length);
  const phase = frame * Math.PI * 2 / BIOLOGICAL_FRAMES;
  const beat = Math.sin(phase), drift = (Math.cos(phase) - 1) * 0.5;
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const amplitude = key === 'virus-player' ? 3.2 : 2.6; // < one logical pixel at 4x backing
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = (x - cx) / cx, ny = (y - cy) / cy;
    const r2 = nx * nx + ny * ny;
    const boundary = Math.max(0, 1 - r2 * r2);
    const interior = Math.exp(-r2 * 8);
    const membrane = boundary * amplitude * (beat * Math.sin(ny * 5) + drift * Math.sin(nx * 4));
    const sx = Math.max(0, Math.min(width - 1, x - membrane * nx - interior * amplitude * beat));
    const sy = Math.max(0, Math.min(height - 1, y + membrane * ny - interior * amplitude * drift));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
    const fx = sx - x0, fy = sy - y0;
    const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4;
    const c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4;
    const wa = source[a + 3] * (1 - fx) * (1 - fy), wb = source[b + 3] * fx * (1 - fy);
    const wc = source[c + 3] * (1 - fx) * fy, wd = source[d + 3] * fx * fy;
    const target = (y * width + x) * 4;
    const alpha = wa + wb + wc + wd;
    output[target + 3] = alpha;
    // Premultiplied interpolation keeps transparent borders free of dark colour fringes.
    if (alpha > 0) for (let channel = 0; channel < 3; channel++) {
      const value = source[a + channel] * wa + source[b + channel] * wb + source[c + channel] * wc + source[d + channel] * wd;
      output[target + channel] = value / alpha;
    }
  }
  return output;
}

export function ensureBiologicalAnimations(scene: Phaser.Scene): void {
  for (const key of BIOLOGICAL_KEYS) {
    const atlasKey = biologicalAtlasKey(key);
    if (scene.textures.exists(atlasKey) || !scene.textures.exists(key)) continue;
    let atlas: Phaser.Textures.CanvasTexture | null = null;
    try {
      const texture = scene.textures.get(key) as Phaser.Textures.CanvasTexture;
      const frame = texture.get();
      const width = frame.cutWidth, height = frame.cutHeight;
      // Only canonical bounded backing is accepted; failure keeps the original art.
      if (width !== (key === 'virus-player' ? 224 : 152) || height !== width) continue;
      const source = texture.getContext().getImageData(0, 0, width, height);
      if (!source?.data || source.data.length !== width * height * 4) continue;
      atlas = scene.textures.createCanvas(atlasKey, width * BIOLOGICAL_FRAMES, height);
      if (!atlas) continue;
      const ctx = atlas.getContext();
      for (let i = 0; i < BIOLOGICAL_FRAMES; i++) {
        const image = ctx.createImageData(width, height);
        image.data.set(bakeBiologicalFrame(source.data, width, height, i, key));
        ctx.putImageData(image, i * width, 0);
        atlas.add(`bio-${i}`, 0, i * width, 0, width, height);
      }
      atlas.refresh();
    } catch {
      // Optional presentation must never block missing-art/Canvas startup.
      if (atlas) scene.textures.remove(atlasKey);
    }
  }
}

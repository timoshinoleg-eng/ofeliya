import type Phaser from 'phaser';
import { BIOLOGICAL_KEYS, type BiologicalKey } from './BiologicalAnimation';

export const BIOLOGICAL_HIT_MS = 180;
export const biologicalHitAtlasKey = (key: BiologicalKey): string => `bio-hit-${key}`;

/** Direction is in texture space; never rotates or scales a physics sprite. */
export function biologicalHitDirection(x: number, y: number, rotation = 0): number {
  if (!Number.isFinite(x + y + rotation) || Math.hypot(x, y) < 0.001) return 0;
  return ((Math.round((Math.atan2(y, x) - rotation) / (Math.PI / 2)) % 4) + 4) % 4;
}

export function biologicalHitFrame(elapsed: number, direction: number, reduced = false): string | null {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= BIOLOGICAL_HIT_MS) return null;
  const pose = reduced ? (elapsed < 90 ? 0 : 2) : Math.min(2, Math.floor(elapsed / 60));
  return `hit-${direction}-${pose}`;
}

/** Fixed-size boot-only inverse warp: local membrane indentation + separate nucleus lag. */
export function bakeBiologicalHit(
  source: Uint8ClampedArray, size: number, direction: number, pose: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source.length);
  const amplitude = [1, 0.52, 0.12][pose] * size * 0.055;
  const angle = direction * Math.PI / 2, dx = Math.cos(angle), dy = Math.sin(angle);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x - centre) / centre, ny = (y - centre) / centre;
    const r2 = nx * nx + ny * ny;
    const facing = nx * dx + ny * dy, tangent = -nx * dy + ny * dx;
    const contact = Math.exp(-Math.pow((facing + 0.52) / 0.28, 2) - tangent * tangent * 7);
    const interior = Math.exp(-r2 * 12) * 0.24;
    const warp = amplitude * (contact - interior) * Math.max(0, 1 - r2 * r2);
    const sx = Math.max(0, Math.min(size - 1, x - dx * warp));
    const sy = Math.max(0, Math.min(size - 1, y - dy * warp));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
    const a = (y0 * size + x0) * 4, b = (y0 * size + x1) * 4;
    const c = (y1 * size + x0) * 4, d = (y1 * size + x1) * 4;
    const wa = source[a + 3] * (1 - fx) * (1 - fy), wb = source[b + 3] * fx * (1 - fy);
    const wc = source[c + 3] * (1 - fx) * fy, wd = source[d + 3] * fx * fy;
    const target = (y * size + x) * 4;
    const alpha = wa + wb + wc + wd;
    output[target + 3] = alpha;
    if (alpha > 0) for (let channel = 0; channel < 3; channel++) {
      const value = source[a + channel] * wa + source[b + channel] * wb + source[c + channel] * wc + source[d + channel] * wd;
      output[target + channel] = value / alpha;
    }
  }
  return output;
}

export function ensureBiologicalImpacts(scene: Phaser.Scene): void {
  for (const key of BIOLOGICAL_KEYS) {
    const atlasKey = biologicalHitAtlasKey(key);
    if (scene.textures.exists(atlasKey) || !scene.textures.exists(key)) continue;
    let atlas: Phaser.Textures.CanvasTexture | null = null;
    try {
      const texture = scene.textures.get(key) as Phaser.Textures.CanvasTexture;
      const size = key === 'virus-player' ? 224 : 152;
      const frame = texture.get();
      if (frame.cutWidth !== size || frame.cutHeight !== size) continue;
      const source = texture.getContext().getImageData(0, 0, size, size).data;
      if (source.length !== size * size * 4) continue;
      // 4 columns, 3 rows; largest dimension 896, below conservative mobile texture limits.
      atlas = scene.textures.createCanvas(atlasKey, size * 4, size * 3);
      if (!atlas) continue;
      const context = atlas.getContext();
      for (let direction = 0; direction < 4; direction++) for (let pose = 0; pose < 3; pose++) {
        const image = context.createImageData(size, size);
        image.data.set(bakeBiologicalHit(source, size, direction, pose));
        context.putImageData(image, direction * size, pose * size);
        atlas.add(`hit-${direction}-${pose}`, 0, direction * size, pose * size, size, size);
      }
      atlas.refresh();
    } catch {
      if (atlas) scene.textures.remove(atlasKey);
    }
  }
}

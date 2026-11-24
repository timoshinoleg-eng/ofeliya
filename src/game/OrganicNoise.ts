import FastNoiseLite from '../vendor/FastNoiseLite.js';

export const NOISE_SIZE = 64;
export const organicBakeMetrics = { ms: 0, compositeMs: 0, skipped: false };
let cache: HTMLCanvasElement | null = null;
let attempted = false;

export function wrapSample(sample: (x: number, y: number) => number, x: number, y: number, size = NOISE_SIZE): number {
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const u = smooth(x / size), v = smooth(y / size);
  const a = sample(x, y) * (1 - u) + sample(x - size, y) * u;
  const b = sample(x, y - size) * (1 - u) + sample(x - size, y - size) * u;
  return a * (1 - v) + b * v;
}

export function prepareOrganicNoise(): void {
  if (attempted) return;
  attempted = true;
  const start = performance.now();
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = NOISE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const noise = new FastNoiseLite(41723);
    noise.SetNoiseType(FastNoiseLite.NoiseType.Cellular);
    noise.SetCellularReturnType(FastNoiseLite.CellularReturnType.Distance2Sub);
    noise.SetFrequency(0.09);
    // Sample a small periodic lattice and interpolate into the shared 64x64 raster.
    // The last lattice row and column are copies of the first, not independent noise.
    const side = 16, step = NOISE_SIZE / side;
    const field = new Float32Array((side + 1) ** 2);
    const sample = (x: number, y: number): number => noise.GetNoise(x, y);
    for (let y = 0; y < side; y++) {
      if (performance.now() - start > 25) return;
      for (let x = 0; x < side; x++) field[y * (side + 1) + x] = wrapSample(sample, x * step, y * step);
      field[y * (side + 1) + side] = field[y * (side + 1)];
    }
    field.set(field.subarray(0, side + 1), side * (side + 1));
    const image = ctx.createImageData(NOISE_SIZE, NOISE_SIZE);
    for (let y = 0; y < NOISE_SIZE; y++) {
      const fy = y / step, iy = Math.floor(fy), v = fy - iy;
      for (let x = 0; x < NOISE_SIZE; x++) {
        const fx = x / step, ix = Math.floor(fx), u = fx - ix;
        const i = iy * (side + 1) + ix;
        const a = field[i] * (1-u) + field[i+1] * u;
        const b = field[i+side+1] * (1-u) + field[i+side+2] * u;
        const value = Math.max(0, Math.min(255, Math.round((a*(1-v)+b*v+1)*127.5)));
        const pixel = (y * NOISE_SIZE + x) * 4;
        image.data[pixel] = image.data[pixel+1] = image.data[pixel+2] = value;
        image.data[pixel+3] = 255;
      }
    }
    if (performance.now() - start > 30) return;
    ctx.putImageData(image, 0, 0);
    cache = canvas;
  } finally {
    organicBakeMetrics.ms = performance.now() - start;
    organicBakeMetrics.skipped = !cache;
  }
}

export function applyOrganicNoise(ctx: CanvasRenderingContext2D, width: number, height: number, opaque = false): void {
  if (!cache || organicBakeMetrics.ms + organicBakeMetrics.compositeMs >= 28) return;
  const start = performance.now();
  ctx.save();
  ctx.globalCompositeOperation = opaque ? 'source-over' : 'source-atop';
  ctx.globalAlpha = 0.055;
  // Existing actor recipes can leave a large shadow blur behind. Do not blur the noise layer.
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowColor = 'transparent';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cache, 0, 0, width, height);
  ctx.restore();
  organicBakeMetrics.compositeMs += performance.now() - start;
}

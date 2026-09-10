#!/usr/bin/env node
/**
 * Генератор иконок OFELIYA (PWA/apple-touch) без зависимостей:
 * ручной PNG-энкодер (RGBA + zlib, встроен в Node) + геометрический рисунок:
 * тёмный фон, неоновое «ядро» (ядро в центре, кольцо, четыре прицельных метки).
 *
 * Запуск: node scripts/gen-icons.mjs → public/icons/icon-{192,512}.png, icon-180.png
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- PNG encoder (RGBA8) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // scanlines с filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Рисунок: ядро OFELIYA ----------
const BG = [11, 14, 26];
const CYAN = [53, 224, 255];
const WHITE = [232, 244, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c + 0.5;
      const dy = y - c + 0.5;
      const d = Math.hypot(dx, dy);
      const R = c; // радиус «поля»
      let col = BG;
      let a = 1;

      // мягкая виньетка фона
      const vg = d / R;
      col = mix([16, 20, 36], BG, Math.min(1, vg * 1.2));

      // внешнее кольцо (r ≈ 0.52R, ширина ≈ 0.05R)
      const ringR = 0.52 * R;
      const ringW = 0.045 * R;
      const ring = 1 - Math.min(1, Math.abs(d - ringR) / ringW);
      if (ring > 0) col = mix(col, CYAN, ring * 0.95);

      // прицельные метки: 4 тика на кольце под 0/90/180/270
      const ang = Math.atan2(dy, dx);
      const sector = (Math.cos(ang * 2) ** 4 + Math.sin(ang * 2) ** 4) ** 50; // ≈ ось
      if (sector > 0.6 && d > ringR + ringW && d < ringR + ringW + 0.16 * R) {
        col = mix(col, CYAN, 0.9);
      }

      // ядро: радиальное свечение
      const coreR = 0.30 * R;
      if (d < coreR) {
        const t = 1 - d / coreR;
        col = mix(CYAN, WHITE, t * 0.9);
      } else if (d < coreR * 1.5) {
        const t = 1 - (d - coreR) / (coreR * 0.5);
        col = mix(col, CYAN, t * 0.55); // гало
      }

      // маска: круг (иначе прозрачное углы → аккуратная иконка)
      if (d > R * 0.995) a = 0;

      const i = (y * size + x) * 4;
      px[i] = Math.round(col[0]);
      px[i + 1] = Math.round(col[1]);
      px[i + 2] = Math.round(col[2]);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

function downscale(master, size) {
  const ms = 512;
  const out = Buffer.alloc(size * size * 4);
  const f = ms / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.min(ms - 1, Math.floor(x * f));
      const sy = Math.min(ms - 1, Math.floor(y * f));
      const si = (sy * ms + sx) * 4;
      out[y * size * 4 + x * 4] = master[si];
      out[y * size * 4 + x * 4 + 1] = master[si + 1];
      out[y * size * 4 + x * 4 + 2] = master[si + 2];
      out[y * size * 4 + x * 4 + 3] = master[si + 3];
    }
  }
  return out;
}

const outDir = join(ROOT, 'public', 'icons');
mkdirSync(outDir, { recursive: true });
const master = draw(512);
writeFileSync(join(outDir, 'icon-512.png'), encodePng(512, master));
writeFileSync(join(outDir, 'icon-192.png'), encodePng(192, downscale(master, 192)));
writeFileSync(join(outDir, 'icon-180.png'), encodePng(180, downscale(master, 180)));
console.log('icons → public/icons/{icon-512,icon-192,icon-180}.png');

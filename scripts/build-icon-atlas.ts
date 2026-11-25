#!/usr/bin/env node
/**
 * VF-02 UI icon atlas builder.
 *
 * Bakes the local SVG sources (tools/icons-src, pinned upstream commits) into:
 *   - public/assets/ui-icons-atlas.png   (<= 1024x1024, RGBA)
 *   - public/assets/ui-icons-atlas.json  (Phaser hash atlas)
 *   - src/ui/generated/iconFrames.ts     (UI_ICON_ATLAS_KEY + UiIconFrame union)
 *   - <outDir>/build-info.json           (pixel hash + provenance for determinism checks)
 *
 * Rendering uses the existing Playwright Chromium (system Chrome as fallback) so the
 * output is deterministic for a given Chromium build and identical source bytes; no
 * new npm dependency, no sharp. Icons are 48px with 2px padding (52px cells), one
 * cell per palette variant, baked for the Canvas renderer.
 *
 * Usage: node --experimental-strip-types scripts/build-icon-atlas.ts [--out <dir>] [--check]
 *   --out   write the four artifacts into <dir> instead of the repository paths.
 *   --check fail if the committed build-info.json pixel hash differs from a fresh render.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'tools', 'icons-src');
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : root;
const checkOnly = args.includes('--check');

const ICON_BOX = 48;
const ICON_PAD = 2;
const CELL = ICON_BOX + ICON_PAD * 2;
const ATLAS_MAX = 1024;

interface ManifestIcon {
  frame: string;
  source: string;
  path: string;
  semantic: string;
}
interface Manifest {
  version: number;
  variants: { id: string; color: string }[];
  icons: ManifestIcon[];
}
interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function chromeExecutable(): string | undefined {
  if (process.env.OFELIYA_CHROME_PATH) return process.env.OFELIYA_CHROME_PATH;
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8')) as Manifest;
  const variants = manifest.variants.map((variant) => variant.id);
  if (new Set(variants).size !== variants.length) throw new Error('duplicate variant id');
  if (variants[0] !== 'default') throw new Error('first variant must be the default (un-suffixed) frame');

  const cells: { name: string; svg: string; color: string }[] = [];
  for (const icon of manifest.icons) {
    const svg = readFileSync(join(srcDir, 'svg', icon.source, icon.path), 'utf8');
    for (const variant of manifest.variants) {
      cells.push({
        name: variant.id === 'default' ? icon.frame : `${icon.frame}.${variant.id}`,
        svg,
        color: variant.color,
      });
    }
  }

  const cols = Math.floor(ATLAS_MAX / CELL);
  const rows = Math.ceil(cells.length / cols);
  const width = cols * CELL;
  const height = rows * CELL;
  if (width > ATLAS_MAX || height > ATLAS_MAX) {
    throw new Error(`atlas ${width}x${height} exceeds ${ATLAS_MAX}x${ATLAS_MAX}; add a variant cap or shrink cells`);
  }

  const { chromium } = process.platform === 'win32' ? await import('playwright') : await import('playwright-core');
  const executablePath = chromeExecutable();
  if (process.platform !== 'win32' && !executablePath) throw new Error('Chrome not found');
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  let payload: { pngBase64: string; pixelHash: string };
  try {
    const page = await browser.newPage();
    payload = await page.evaluate(
      async ({ cells: cellInputs, cols: colCount, cell, iconBox, width: atlasWidth, height: atlasHeight }) => {
        const master = document.createElement('canvas');
        master.width = atlasWidth;
        master.height = atlasHeight;
        const mctx = master.getContext('2d', { willReadFrequently: true });
        if (!mctx) throw new Error('2d context unavailable');
        const scratch = document.createElement('canvas');
        scratch.width = iconBox;
        scratch.height = iconBox;
        const sctx = scratch.getContext('2d');
        if (!sctx) throw new Error('2d context unavailable');

        const loadIcon = async (svg: string): Promise<{ image: HTMLImageElement; intrinsicW: number; intrinsicH: number }> => {
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const intrinsicW = image.naturalWidth || iconBox;
            const intrinsicH = image.naturalHeight || iconBox;
            return { image, intrinsicW, intrinsicH };
          } finally {
            URL.revokeObjectURL(url);
          }
        };

        for (let index = 0; index < cellInputs.length; index++) {
          const { svg, color } = cellInputs[index];
          const col = index % colCount;
          const row = Math.floor(index / colCount);
          const { image, intrinsicW, intrinsicH } = await loadIcon(svg);
          const scale = Math.min(iconBox / intrinsicW, iconBox / intrinsicH);
          const drawW = intrinsicW * scale;
          const drawH = intrinsicH * scale;
          const offsetX = (iconBox - drawW) / 2;
          const offsetY = (iconBox - drawH) / 2;
          const cellX = col * cell + ((cell - iconBox) / 2);
          const cellY = row * cell + ((cell - iconBox) / 2);

          sctx.clearRect(0, 0, iconBox, iconBox);
          sctx.globalCompositeOperation = 'source-over';
          sctx.drawImage(image, offsetX, offsetY, drawW, drawH);
          sctx.globalCompositeOperation = 'source-in';
          sctx.fillStyle = color;
          sctx.fillRect(0, 0, iconBox, iconBox);
          mctx.drawImage(scratch, cellX, cellY);
        }

        const pixels = mctx.getImageData(0, 0, atlasWidth, atlasHeight).data;
        let hash = 0x811c9dc5;
        for (let i = 0; i < pixels.length; i++) {
          hash ^= pixels[i];
          hash = Math.imul(hash, 0x01000193);
        }
        return {
          pngBase64: master.toDataURL('image/png').split(',')[1],
          pixelHash: (hash >>> 0).toString(16).padStart(8, '0'),
        };
      },
      { cells, cols, cell: CELL, iconBox: ICON_BOX, width, height }
    );
  } finally {
    await browser.close();
  }

  const png = Buffer.from(payload.pngBase64, 'base64');
  const frames: Record<string, { frame: CellRect; rotated: boolean; trimmed: boolean; spriteSourceSize: CellRect; sourceSize: { w: number; h: number } }> = {};
  cells.forEach((cellInfo, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    frames[cellInfo.name] = {
      frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL },
      sourceSize: { w: CELL, h: CELL },
    };
  });
  const atlasJson = {
    frames,
    meta: {
      app: 'ofeliya-build-icon-atlas',
      version: '1.0',
      image: 'ui-icons-atlas.png',
      format: 'RGBA8888',
      size: { w: width, h: height },
      scale: '1',
    },
  };

  const jsonText = JSON.stringify(atlasJson, null, 2) + '\n';
  const frameNames = manifest.icons.map((icon) => icon.frame).sort((a, b) => a.localeCompare(b));
  const iconFramesTs = `/** GENERATED by scripts/build-icon-atlas.ts from tools/icons-src/manifest.json — do not edit by hand. */
export const UI_ICON_ATLAS_KEY = 'ui-icons' as const;

export type UiIconFrame =
${frameNames.map((name) => `  | '${name}'`).join('\n')};

export const UI_ICON_FRAMES: readonly UiIconFrame[] = [
${frameNames.map((name) => `  '${name}',`).join('\n')}
];

export const UI_ICON_VARIANTS = ['default', 'host', 'immune', 'danger'] as const;
export type UiIconVariant = (typeof UI_ICON_VARIANTS)[number];
`;

  const buildInfo = {
    generatedBy: 'scripts/build-icon-atlas.ts',
    icons: manifest.icons.length,
    frames: cells.length,
    variants,
    cell: CELL,
    size: { w: width, h: height },
    pixelHashFNV1a: payload.pixelHash,
    pngSha256: createHash('sha256').update(png).digest('hex'),
    jsonSha256: createHash('sha256').update(jsonText).digest('hex'),
    manifestSha256: createHash('sha256').update(readFileSync(join(srcDir, 'manifest.json'))).digest('hex'),
  };

  const destinations = {
    png: join(outDir, 'public/assets/ui-icons-atlas.png'),
    json: join(outDir, 'public/assets/ui-icons-atlas.json'),
    ts: join(outDir, 'src/ui/generated/iconFrames.ts'),
    info: join(outDir, 'tools/icons-src/build-info.json'),
  };
  if (!checkOnly) {
    for (const target of Object.values(destinations)) mkdirSync(dirname(target), { recursive: true });
    writeFileSync(destinations.png, png);
    writeFileSync(destinations.json, jsonText);
    writeFileSync(destinations.ts, iconFramesTs);
    writeFileSync(destinations.info, JSON.stringify(buildInfo, null, 2) + '\n');
    console.log(`atlas ${width}x${height}, ${cells.length} frames (${manifest.icons.length} icons x ${variants.length} variants)`);
    console.log(`pixelHash ${payload.pixelHash}; wrote ${destinations.png}`);
  } else {
    const committed = JSON.parse(readFileSync(join(root, 'tools/icons-src/build-info.json'), 'utf8'));
    if (committed.pixelHashFNV1a !== buildInfo.pixelHashFNV1a) {
      throw new Error(`atlas pixel hash drift: committed ${committed.pixelHashFNV1a} vs fresh ${buildInfo.pixelHashFNV1a}`);
    }
    console.log(`determinism check ok: pixelHash ${payload.pixelHash}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

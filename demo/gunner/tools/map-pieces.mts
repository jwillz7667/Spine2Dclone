import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, type DecodedImage } from './cut-core.mts';

// Applies the human-reviewed piece mapping: source-layers/<sheet>/piece-NN.png pieces become
// source-layers/<character>/<part>.png. Sheets are cut into numbered pieces because Gemini's grid
// layouts drift between generations; a reviewer with eyes maps them once per generation.
//
// piece-map.json: { "<sheet-id>": { "<spec>": "<char>/<part>" | null } } where <spec> is:
//   "piece-01"           one piece, copied as is
//   "piece-01+piece-02"  composite preserving the pieces' relative positions on the sheet
//                        (for eye pairs that were drawn as one element but cut as two components)
//   "piece-03|piece-05"  composite side by side with a small gap (for pieces drawn far apart that
//                        belong together, like brow patches flanking another part)
//
// Usage: tsx map-pieces.mts

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const layersDir = join(root, 'source-layers');

interface PieceMeta {
  readonly file: string;
  readonly bbox: { x: number; y: number; w: number; h: number };
}

function loadPiece(sheet: string, piece: string): { img: DecodedImage; meta: PieceMeta } {
  const img = decodePng(readFileSync(join(layersDir, sheet, `${piece}.png`)));
  const manifest = JSON.parse(readFileSync(join(layersDir, sheet, 'pieces.json'), 'utf8')) as PieceMeta[];
  const meta = manifest.find((p) => p.file === `${piece}.png`);
  if (meta === undefined) throw new Error(`${sheet}/${piece} not in pieces.json`);
  return { img, meta };
}

function blank(w: number, h: number): DecodedImage {
  return { width: w, height: h, rgba: new Uint8Array(w * h * 4) };
}

function blit(dst: DecodedImage, src: DecodedImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const si = (y * src.width + x) * 4;
      if (src.rgba[si + 3] === 0) continue;
      const di = ((y + oy) * dst.width + (x + ox)) * 4;
      dst.rgba[di] = src.rgba[si]!;
      dst.rgba[di + 1] = src.rgba[si + 1]!;
      dst.rgba[di + 2] = src.rgba[si + 2]!;
      dst.rgba[di + 3] = src.rgba[si + 3]!;
    }
  }
}

function compositeSheet(sheet: string, pieces: string[]): DecodedImage {
  const loaded = pieces.map((p) => loadPiece(sheet, p));
  const minX = Math.min(...loaded.map((l) => l.meta.bbox.x));
  const minY = Math.min(...loaded.map((l) => l.meta.bbox.y));
  const maxX = Math.max(...loaded.map((l) => l.meta.bbox.x + l.img.width));
  const maxY = Math.max(...loaded.map((l) => l.meta.bbox.y + l.img.height));
  const out = blank(maxX - minX, maxY - minY);
  for (const l of loaded) blit(out, l.img, l.meta.bbox.x - minX, l.meta.bbox.y - minY);
  return out;
}

function compositeRow(sheet: string, pieces: string[]): DecodedImage {
  const loaded = pieces.map((p) => loadPiece(sheet, p).img);
  const gap = Math.round(Math.max(...loaded.map((i) => i.width)) * 0.18);
  const w = loaded.reduce((n, i) => n + i.width, 0) + gap * (loaded.length - 1);
  const h = Math.max(...loaded.map((i) => i.height));
  const out = blank(w, h);
  let x = 0;
  for (const img of loaded) {
    blit(out, img, x, Math.round((h - img.height) / 2));
    x += img.width + gap;
  }
  return out;
}

// Box-filter downscale (alpha-weighted) so every part fits atlas pages; ONE factor per character
// keeps relative part proportions true.
function downscale(img: DecodedImage, factor: number): DecodedImage {
  if (factor >= 1) return img;
  const w = Math.max(1, Math.round(img.width * factor));
  const h = Math.max(1, Math.round(img.height * factor));
  const out = blank(w, h);
  for (let y = 0; y < h; y += 1) {
    const sy0 = Math.floor(y / factor);
    const sy1 = Math.min(img.height, Math.max(sy0 + 1, Math.floor((y + 1) / factor)));
    for (let x = 0; x < w; x += 1) {
      const sx0 = Math.floor(x / factor);
      const sx1 = Math.min(img.width, Math.max(sx0 + 1, Math.floor((x + 1) / factor)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const si = (sy * img.width + sx) * 4;
          const sa = img.rgba[si + 3]!;
          r += img.rgba[si]! * sa;
          g += img.rgba[si + 1]! * sa;
          b += img.rgba[si + 2]! * sa;
          a += sa;
          n += 1;
        }
      }
      const di = (y * w + x) * 4;
      if (a > 0) {
        out.rgba[di] = Math.round(r / a);
        out.rgba[di + 1] = Math.round(g / a);
        out.rgba[di + 2] = Math.round(b / a);
        out.rgba[di + 3] = Math.round(a / n);
      }
    }
  }
  return out;
}

const MAX_PART_DIM = 900;

// #cropnose transform: Gemini insists on baking the dog nose into every mouth element. The nose is
// the top dark band of the piece; find where its dark-pixel row count collapses and crop below it,
// leaving only the mouth linework (the philtrum stub reconnects to the head's real nose at rig time).
function cropNose(img: DecodedImage): DecodedImage {
  const darkPerRow = new Array<number>(img.height).fill(0);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      const a = img.rgba[i + 3]!;
      if (a < 128) continue;
      const lum = 0.299 * img.rgba[i]! + 0.587 * img.rgba[i + 1]! + 0.114 * img.rgba[i + 2]!;
      if (lum < 95) darkPerRow[y] += 1;
    }
  }
  // The nose is the top dark blob; between it and the mouth there is always a narrow philtrum
  // neck where the dark row count dips (even when nose and mouth interiors are connected). Crop at
  // the dip: argmin of darkPerRow in [nose peak .. 65 percent height].
  const topHalfEnd = Math.floor(img.height * 0.5);
  let peakY = 0;
  for (let y = 0; y < topHalfEnd; y += 1) if (darkPerRow[y]! > darkPerRow[peakY]!) peakY = y;
  const searchEnd = Math.floor(img.height * 0.65);
  let cropY = peakY;
  for (let y = peakY; y <= searchEnd; y += 1) {
    if (darkPerRow[y]! < darkPerRow[cropY]!) cropY = y;
  }
  cropY = Math.min(img.height - 8, cropY + 1);
  const h = img.height - cropY;
  const out = blank(img.width, h);
  out.rgba.set(img.rgba.subarray(cropY * img.width * 4));
  // tight trim afterwards
  let minX = img.width, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (out.rgba[(y * img.width + x) * 4 + 3]! > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX) return out;
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const trimmed = blank(tw, th);
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const si = ((y + minY) * img.width + (x + minX)) * 4;
      const di = (y * tw + x) * 4;
      trimmed.rgba[di] = out.rgba[si]!;
      trimmed.rgba[di + 1] = out.rgba[si + 1]!;
      trimmed.rgba[di + 2] = out.rgba[si + 2]!;
      trimmed.rgba[di + 3] = out.rgba[si + 3]!;
    }
  }
  return trimmed;
}

const map = JSON.parse(readFileSync(join(here, 'piece-map.json'), 'utf8')) as Record<
  string,
  Record<string, string | null>
>;

// pass 1: build every part image in memory, grouped by character
const parts = new Map<string, Map<string, DecodedImage>>();
let discarded = 0;
for (const [sheet, entries] of Object.entries(map)) {
  for (const [spec, target] of Object.entries(entries)) {
    if (target === null) {
      discarded += 1;
      continue;
    }
    const [targetPath, transform] = target.split('#') as [string, string | undefined];
    let img: DecodedImage;
    if (spec.includes('+')) img = compositeSheet(sheet, spec.split('+'));
    else if (spec.includes('|')) img = compositeRow(sheet, spec.split('|'));
    else img = loadPiece(sheet, spec).img;
    if (transform === 'cropnose') img = cropNose(img);
    const [char, part] = targetPath.split('/') as [string, string];
    if (!parts.has(char)) parts.set(char, new Map());
    parts.get(char)!.set(part, img);
  }
}

// pass 2: per-character uniform downscale, then write
let written = 0;
for (const [char, charParts] of parts) {
  const maxDim = Math.max(...[...charParts.values()].flatMap((i) => [i.width, i.height]));
  const factor = Math.min(1, MAX_PART_DIM / maxDim);
  for (const [part, img] of charParts) {
    const dst = join(layersDir, char, `${part}.png`);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, encodePng(downscale(img, factor)));
    written += 1;
  }
  console.log(`${char}: ${charParts.size} parts, scale ${factor.toFixed(3)}`);
}
console.log(`piece map applied: ${written} parts written, ${discarded} discarded`);

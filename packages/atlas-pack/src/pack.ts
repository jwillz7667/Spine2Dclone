import { MaxRectsPacker, PACKING_LOGIC } from 'maxrects-packer';
import type { AtlasPage, AtlasRef, AtlasRegion } from '@marionette/format/types';
import { AtlasError } from './errors';

// TASK-1.3.4 Pack: THE deterministic core. It shells out to nothing and contains no randomness or clock.
// Given identical input it produces an identical AtlasRef (region coordinates, offsets, page assignment)
// and identical page pixels. Determinism is engineered, not assumed (see DETERMINISM below).

export interface PackConfig {
  // Page edge length in pixels. Default 2048; up to 4096 is allowed. Pages are square and fixed at this
  // size (smart sizing is off) so the output is predictable and diffable.
  readonly maxPageSize?: number;
  // Transparent gap reserved between packed regions, in pixels. Default 2.
  readonly padding?: number;
  // Opt-in deterministic 90-degree rotation packing. Default false (backward compatible: no region is ever
  // rotated). When true, the packer may store a sprite turned 90 degrees clockwise to fit more per page; a
  // rotated region carries `rotated: true` and its LOGICAL (unrotated) w/h, and both renderers turn it
  // back (runtime-web via PixiJS rotate=2, render-preview via its RegionSampler). Results stay
  // deterministic: the packer holds no clock or RNG and OUR fixed add order (below) is authoritative.
  readonly allowRotation?: boolean;
}

export interface TrimmedSprite {
  readonly name: string;
  readonly trimmedW: number;
  readonly trimmedH: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly originalW: number;
  readonly originalH: number;
  // Row-major RGBA of the trimmed region, length === trimmedW * trimmedH * 4.
  readonly pixels: Uint8Array;
}

export interface PageBitmap {
  readonly width: number;
  readonly height: number;
  // Row-major RGBA of the packed page, length === width * height * 4.
  readonly rgba: Uint8Array;
}

export interface PackResult {
  // The AtlasRef with provisional page file names (`atlas-<index>.png`). emitAtlas writes the PNGs.
  readonly atlas: AtlasRef;
  // pageBitmaps[i] is the packed bitmap for atlas.pages[i].
  readonly pageBitmaps: readonly PageBitmap[];
}

const DEFAULT_MAX_PAGE_SIZE = 2048;
const MAX_PAGE_SIZE_LIMIT = 4096;
const DEFAULT_PADDING = 2;
const PAGE_FILE_PREFIX = 'atlas';

interface ResolvedConfig {
  readonly maxPageSize: number;
  readonly padding: number;
  readonly allowRotation: boolean;
}

function resolveConfig(config: PackConfig | undefined): ResolvedConfig {
  const maxPageSize = config?.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const padding = config?.padding ?? DEFAULT_PADDING;
  const allowRotation = config?.allowRotation ?? false;

  if (!Number.isInteger(maxPageSize) || maxPageSize < 1 || maxPageSize > MAX_PAGE_SIZE_LIMIT) {
    throw new AtlasError(
      'ATLAS_INVALID_CONFIG',
      `maxPageSize must be an integer in [1, ${MAX_PAGE_SIZE_LIMIT}], received ${maxPageSize}`,
    );
  }
  if (!Number.isInteger(padding) || padding < 0) {
    throw new AtlasError(
      'ATLAS_INVALID_CONFIG',
      `padding must be a non-negative integer, received ${padding}`,
    );
  }
  return { maxPageSize, padding, allowRotation };
}

function validateSprites(sprites: readonly TrimmedSprite[], maxPageSize: number): void {
  const seen = new Set<string>();
  for (const sprite of sprites) {
    if (seen.has(sprite.name)) {
      throw new AtlasError('ATLAS_REGION_DUPLICATE', `duplicate region name "${sprite.name}"`);
    }
    seen.add(sprite.name);

    if (sprite.trimmedW < 1 || sprite.trimmedH < 1) {
      throw new AtlasError(
        'ATLAS_INVALID_CONFIG',
        `sprite "${sprite.name}" has non-positive trimmed size ${sprite.trimmedW}x${sprite.trimmedH}`,
      );
    }
    const expected = sprite.trimmedW * sprite.trimmedH * 4;
    if (sprite.pixels.length !== expected) {
      throw new AtlasError(
        'ATLAS_DIMENSION_MISMATCH',
        `sprite "${sprite.name}" pixel length ${sprite.pixels.length} does not match ${sprite.trimmedW}x${sprite.trimmedH}`,
      );
    }
    if (sprite.trimmedW > maxPageSize || sprite.trimmedH > maxPageSize) {
      throw new AtlasError(
        'ATLAS_SPRITE_TOO_LARGE',
        `sprite "${sprite.name}" (${sprite.trimmedW}x${sprite.trimmedH}) exceeds the ${maxPageSize}px page`,
      );
    }
  }
}

// DETERMINISM. (1) Input is pre-sorted by a fixed key: trimmed AREA descending, then NAME ascending. Two
// runs with the same sprites therefore feed the packer in the same order. (2) We call packer.add() one
// sprite at a time in that order, which bypasses maxrects-packer's own addArray() sort, so OUR sort is
// authoritative. (3) The packer is constructed with fixed options and contains no randomness or clock,
// so identical add order yields identical placement. (4) smart sizing is off, so every page is exactly
// maxPageSize square (no content-dependent shrink), keeping page dimensions diffable.
function sortSprites(sprites: readonly TrimmedSprite[]): TrimmedSprite[] {
  return [...sprites].sort((a, b) => {
    const areaA = a.trimmedW * a.trimmedH;
    const areaB = b.trimmedW * b.trimmedH;
    if (areaA !== areaB) return areaB - areaA;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
}

function blit(
  page: Uint8Array,
  pageWidth: number,
  sprite: TrimmedSprite,
  x: number,
  y: number,
): void {
  const rowBytes = sprite.trimmedW * 4;
  for (let row = 0; row < sprite.trimmedH; row += 1) {
    const srcStart = row * rowBytes;
    const dstStart = ((y + row) * pageWidth + x) * 4;
    page.set(sprite.pixels.subarray(srcStart, srcStart + rowBytes), dstStart);
  }
}

// Blit a sprite rotated 90 degrees CLOCKWISE into an (h x w) page rectangle at (x, y). This is the
// storage convention both renderers read back: a logical pixel (lx, ly) of the w x h content lands at
// page pixel (x + (h - 1 - ly), y + lx), which is PixiJS rotate=2 (its spritesheet parser's rotated
// frame) and the (u, v) -> (1 - v, u) mapping render-preview's RegionSampler uses. Verified end to end by
// the rotated-vs-unrotated pixel-parity test; keep this and those samplers in lockstep.
function blitRotated(
  page: Uint8Array,
  pageWidth: number,
  sprite: TrimmedSprite,
  x: number,
  y: number,
): void {
  const w = sprite.trimmedW;
  const h = sprite.trimmedH;
  const src = sprite.pixels;
  for (let ly = 0; ly < h; ly += 1) {
    const srcRow = ly * w * 4;
    const dstX = x + (h - 1 - ly);
    for (let lx = 0; lx < w; lx += 1) {
      const s = srcRow + lx * 4;
      const d = ((y + lx) * pageWidth + dstX) * 4;
      page[d] = src[s]!;
      page[d + 1] = src[s + 1]!;
      page[d + 2] = src[s + 2]!;
      page[d + 3] = src[s + 3]!;
    }
  }
}

export function packAtlas(sprites: readonly TrimmedSprite[], config?: PackConfig): PackResult {
  const { maxPageSize, padding, allowRotation } = resolveConfig(config);
  validateSprites(sprites, maxPageSize);

  if (sprites.length === 0) {
    return { atlas: { pages: [] }, pageBitmaps: [] };
  }

  // Default generic (Rectangle): the add(width, height, data) overload always builds an internal
  // Rectangle and stashes our sprite on `.data`, so bin.rects are Rectangles we read coordinates from.
  const packer = new MaxRectsPacker(maxPageSize, maxPageSize, padding, {
    // Fixed, reproducible options. smart:false fixes page dimensions at maxPageSize; pot/square off so
    // pages are not rounded; allowRotation from config (default false); MAX_AREA pins the placement
    // scoring; tag:false. The packer holds no clock or RNG, so with OUR fixed add order the rotation
    // decisions are deterministic (locked by the rotation determinism test).
    smart: false,
    pot: false,
    square: false,
    allowRotation,
    border: 0,
    tag: false,
    logic: PACKING_LOGIC.MAX_AREA,
  });

  for (const sprite of sortSprites(sprites)) {
    packer.add(sprite.trimmedW, sprite.trimmedH, sprite);
  }

  const pages: AtlasPage[] = [];
  const pageBitmaps: PageBitmap[] = [];

  packer.bins.forEach((bin, pageIndex) => {
    const pageWidth = bin.width;
    const pageHeight = bin.height;
    const rgba = new Uint8Array(pageWidth * pageHeight * 4);
    const regions: AtlasRegion[] = [];

    for (const rect of bin.rects) {
      // maxrects-packer types Rectangle.data as `any`; this single narrowing recovers the sprite metadata
      // we attached at add() time. It is the one unavoidable assertion at the library seam.
      const sprite = rect.data as TrimmedSprite;
      // rect.rot is set by the packer when it stored the sprite turned 90 degrees to fit; only possible
      // when allowRotation is on. The region keeps its LOGICAL (unrotated) w/h and offsets; the PAGE
      // footprint is (h x w), which is what blitRotated fills and what the renderers reconstruct.
      if (rect.rot) {
        blitRotated(rgba, pageWidth, sprite, rect.x, rect.y);
      } else {
        blit(rgba, pageWidth, sprite, rect.x, rect.y);
      }
      regions.push({
        name: sprite.name,
        x: rect.x,
        y: rect.y,
        w: sprite.trimmedW,
        h: sprite.trimmedH,
        rotated: rect.rot,
        offsetX: sprite.offsetX,
        offsetY: sprite.offsetY,
        originalW: sprite.originalW,
        originalH: sprite.originalH,
      });
    }

    pages.push({
      file: `${PAGE_FILE_PREFIX}-${pageIndex}.png`,
      width: pageWidth,
      height: pageHeight,
      regions,
    });
    pageBitmaps.push({ width: pageWidth, height: pageHeight, rgba });
  });

  return { atlas: { pages }, pageBitmaps };
}

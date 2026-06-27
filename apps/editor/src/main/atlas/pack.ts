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
  // Always false in Phase 1. The field exists to match the format and to fail loudly if a caller flips it.
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
}

function resolveConfig(config: PackConfig | undefined): ResolvedConfig {
  const maxPageSize = config?.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const padding = config?.padding ?? DEFAULT_PADDING;
  const allowRotation = config?.allowRotation ?? false;

  if (allowRotation) {
    throw new AtlasError(
      'ATLAS_ROTATION_UNSUPPORTED',
      'allowRotation is disabled in Phase 1 (the rotated-UV render path has no parity test)',
    );
  }
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
  return { maxPageSize, padding };
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

export function packAtlas(sprites: readonly TrimmedSprite[], config?: PackConfig): PackResult {
  const { maxPageSize, padding } = resolveConfig(config);
  validateSprites(sprites, maxPageSize);

  if (sprites.length === 0) {
    return { atlas: { pages: [] }, pageBitmaps: [] };
  }

  // Default generic (Rectangle): the add(width, height, data) overload always builds an internal
  // Rectangle and stashes our sprite on `.data`, so bin.rects are Rectangles we read coordinates from.
  const packer = new MaxRectsPacker(maxPageSize, maxPageSize, padding, {
    // Fixed, reproducible options. smart:false fixes page dimensions at maxPageSize; pot/square off so
    // pages are not rounded; allowRotation:false (Phase 1); MAX_AREA pins the placement scoring; tag:false.
    smart: false,
    pot: false,
    square: false,
    allowRotation: false,
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
      blit(rgba, pageWidth, sprite, rect.x, rect.y);
      regions.push({
        name: sprite.name,
        x: rect.x,
        y: rect.y,
        w: sprite.trimmedW,
        h: sprite.trimmedH,
        rotated: false,
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

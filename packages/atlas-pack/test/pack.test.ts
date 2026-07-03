import { describe, expect, it } from 'vitest';
import { decodedPagePixelHash, encodePng } from '../src/png';
import { isAtlasError } from '../src/errors';
import { packAtlas } from '../src/pack';
import type { TrimmedSprite } from '../src/pack';

function sprite(name: string, w: number, h: number, seed = 1): TrimmedSprite {
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i + seed) & 0xff;
  return {
    name,
    trimmedW: w,
    trimmedH: h,
    offsetX: 1,
    offsetY: 2,
    originalW: w + 4,
    originalH: h + 6,
    pixels,
  };
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('packAtlas', () => {
  it('packs small sprites that fit in one 2048 page into a single page', () => {
    const result = packAtlas([sprite('a', 10, 10), sprite('b', 12, 8), sprite('c', 6, 6)]);

    expect(result.atlas.pages).toHaveLength(1);
    expect(result.pageBitmaps).toHaveLength(1);
    const page = result.atlas.pages[0];
    expect(page?.width).toBe(2048);
    expect(page?.height).toBe(2048);
    expect(page?.regions.map((r) => r.name).sort()).toEqual(['a', 'b', 'c']);
  });

  it('forces multiple pages at a small maxPageSize with no region overlap and in-bounds placement', () => {
    const sprites = Array.from({ length: 8 }, (_unused, i) => sprite(`s${i}`, 30, 30, i + 1));

    const result = packAtlas(sprites, { maxPageSize: 64, padding: 2 });

    expect(result.atlas.pages.length).toBeGreaterThan(1);
    for (const page of result.atlas.pages) {
      expect(page.width).toBe(64);
      expect(page.height).toBe(64);
      for (const region of page.regions) {
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.x + region.w).toBeLessThanOrEqual(page.width);
        expect(region.y + region.h).toBeLessThanOrEqual(page.height);
      }
      for (let i = 0; i < page.regions.length; i += 1) {
        for (let j = i + 1; j < page.regions.length; j += 1) {
          const a = page.regions[i];
          const b = page.regions[j];
          if (a && b) expect(overlaps(a, b)).toBe(false);
        }
      }
    }
    const totalRegions = result.atlas.pages.reduce((sum, p) => sum + p.regions.length, 0);
    expect(totalRegions).toBe(8);
  });

  it('never marks a region rotated in Phase 1 and carries trim metadata through', () => {
    const result = packAtlas([sprite('only', 20, 30)]);
    const region = result.atlas.pages[0]?.regions[0];

    expect(region).toMatchObject({
      name: 'only',
      w: 20,
      h: 30,
      rotated: false,
      offsetX: 1,
      offsetY: 2,
      originalW: 24,
      originalH: 36,
    });
  });

  it('is deterministic: identical input yields deep-equal AtlasRef and identical page pixels', () => {
    const input = [
      sprite('torso', 60, 120, 3),
      sprite('armL', 44, 90, 4),
      sprite('armR', 44, 90, 5),
    ];

    const first = packAtlas(input, { maxPageSize: 128, padding: 2 });
    const second = packAtlas(input, { maxPageSize: 128, padding: 2 });

    expect(first.atlas).toEqual(second.atlas);
    expect(first.pageBitmaps.length).toBe(second.pageBitmaps.length);
    first.pageBitmaps.forEach((bitmap, index) => {
      const other = second.pageBitmaps[index];
      expect(other).toBeDefined();
      if (other) {
        const a = decodedPagePixelHash(encodePng(bitmap));
        const b = decodedPagePixelHash(encodePng(other));
        expect(a).toBe(b);
      }
    });
  });

  it('is order-independent: shuffled input yields the same AtlasRef (fixed sort key)', () => {
    const a = packAtlas(
      [sprite('torso', 60, 120, 3), sprite('armL', 44, 90, 4), sprite('armR', 44, 90, 5)],
      {
        maxPageSize: 128,
        padding: 2,
      },
    );
    const b = packAtlas(
      [sprite('armR', 44, 90, 5), sprite('torso', 60, 120, 3), sprite('armL', 44, 90, 4)],
      {
        maxPageSize: 128,
        padding: 2,
      },
    );

    expect(a.atlas).toEqual(b.atlas);
  });

  it('returns an empty atlas for empty input', () => {
    const result = packAtlas([]);
    expect(result.atlas.pages).toEqual([]);
    expect(result.pageBitmaps).toEqual([]);
  });

  it('rejects allowRotation in Phase 1', () => {
    try {
      packAtlas([sprite('a', 10, 10)], { allowRotation: true });
      throw new Error('expected packAtlas to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_ROTATION_UNSUPPORTED');
    }
  });

  it('rejects a maxPageSize above the 4096 limit', () => {
    try {
      packAtlas([sprite('a', 10, 10)], { maxPageSize: 8192 });
      throw new Error('expected packAtlas to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_INVALID_CONFIG');
    }
  });

  it('rejects duplicate region names', () => {
    try {
      packAtlas([sprite('dup', 10, 10), sprite('dup', 12, 12)]);
      throw new Error('expected packAtlas to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_REGION_DUPLICATE');
    }
  });

  it('rejects a sprite larger than a page', () => {
    try {
      packAtlas([sprite('huge', 200, 50)], { maxPageSize: 128 });
      throw new Error('expected packAtlas to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_SPRITE_TOO_LARGE');
    }
  });
});

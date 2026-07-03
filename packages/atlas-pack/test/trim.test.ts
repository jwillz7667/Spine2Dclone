import { describe, expect, it } from 'vitest';
import { isAtlasError } from '../src/errors';
import { makeRgba } from '../src/synthetic';
import { trimSprite } from '../src/trim';

describe('trimSprite', () => {
  it('trims a known transparent border to the expected bounding box', () => {
    const width = 64;
    const height = 128;
    const rgba = makeRgba({ width, height, contentX: 2, contentY: 4, contentW: 60, contentH: 120 });

    const trim = trimSprite(rgba, width, height);

    expect(trim).toMatchObject({
      offsetX: 2,
      offsetY: 4,
      trimmedW: 60,
      trimmedH: 120,
      originalW: 64,
      originalH: 128,
    });
    expect(trim.pixels.length).toBe(60 * 120 * 4);
  });

  it('returns a 1x1 transparent region for a fully transparent sprite (documented edge case)', () => {
    const rgba = new Uint8Array(10 * 10 * 4);

    const trim = trimSprite(rgba, 10, 10);

    expect(trim).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      trimmedW: 1,
      trimmedH: 1,
      originalW: 10,
      originalH: 10,
    });
    expect(Array.from(trim.pixels)).toEqual([0, 0, 0, 0]);
  });

  it('trims a single opaque pixel to a 1x1 region at its position', () => {
    const rgba = makeRgba({
      width: 16,
      height: 16,
      contentX: 5,
      contentY: 7,
      contentW: 1,
      contentH: 1,
    });

    const trim = trimSprite(rgba, 16, 16);

    expect(trim).toMatchObject({ offsetX: 5, offsetY: 7, trimmedW: 1, trimmedH: 1 });
  });

  it('reproduces a trimmed-vs-untrimmed placement at the math level (offset relationship)', () => {
    // A trimmed region drawn with its origin offset by (offsetX, offsetY) lands every opaque pixel at
    // the same on-screen position as the untrimmed original. Concretely, a content pixel at original
    // coordinate (offsetX + dx, offsetY + dy) sits at region-local (dx, dy); placing the region origin
    // at world W + (offsetX, offsetY) maps it back to world W + (offsetX + dx, offsetY + dy), i.e. its
    // untrimmed world position. We assert the pixel identity that underwrites that arithmetic.
    const width = 48;
    const height = 96;
    const offsetX = 2;
    const offsetY = 3;
    const rgba = makeRgba({
      width,
      height,
      contentX: offsetX,
      contentY: offsetY,
      contentW: 44,
      contentH: 90,
      seed: 9,
    });

    const trim = trimSprite(rgba, width, height);
    expect(trim.offsetX).toBe(offsetX);
    expect(trim.offsetY).toBe(offsetY);

    const dx = 10;
    const dy = 20;
    const regionIdx = (dy * trim.trimmedW + dx) * 4;
    const originalIdx = ((offsetY + dy) * width + (offsetX + dx)) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      expect(trim.pixels[regionIdx + channel]).toBe(rgba[originalIdx + channel]);
    }
  });

  it('throws ATLAS_DIMENSION_MISMATCH when the buffer length is wrong', () => {
    try {
      trimSprite(new Uint8Array(10), 8, 8);
      throw new Error('expected trimSprite to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_DIMENSION_MISMATCH');
    }
  });
});

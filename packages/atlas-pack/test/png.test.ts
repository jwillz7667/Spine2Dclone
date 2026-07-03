import { describe, expect, it } from 'vitest';
import { decodePng, decodedPagePixelHash, encodePng } from '../src/png';
import { isAtlasError } from '../src/errors';
import { makeRgba } from '../src/synthetic';

describe('png codec', () => {
  it('round-trips RGBA pixels through encode then decode', () => {
    const width = 20;
    const height = 12;
    const rgba = makeRgba({
      width,
      height,
      contentX: 1,
      contentY: 1,
      contentW: 18,
      contentH: 10,
      seed: 5,
    });

    const decoded = decodePng(encodePng({ width, height, rgba }));

    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it('hashes decoded pixels, so identical pixels hash equal', () => {
    const width = 16;
    const height = 16;
    const rgba = makeRgba({
      width,
      height,
      contentX: 0,
      contentY: 0,
      contentW: 16,
      contentH: 16,
      seed: 2,
    });

    const a = decodedPagePixelHash(encodePng({ width, height, rgba }));
    const b = decodedPagePixelHash(
      encodePng({
        width,
        height,
        rgba: makeRgba({
          width,
          height,
          contentX: 0,
          contentY: 0,
          contentW: 16,
          contentH: 16,
          seed: 2,
        }),
      }),
    );

    expect(a).toBe(b);
  });

  it('produces different hashes for different pixels', () => {
    const dims = { width: 16, height: 16, contentX: 0, contentY: 0, contentW: 16, contentH: 16 };
    const a = decodedPagePixelHash(
      encodePng({ width: 16, height: 16, rgba: makeRgba({ ...dims, seed: 1 }) }),
    );
    const b = decodedPagePixelHash(
      encodePng({ width: 16, height: 16, rgba: makeRgba({ ...dims, seed: 2 }) }),
    );

    expect(a).not.toBe(b);
  });

  it('throws ATLAS_DECODE_FAILED on non-PNG bytes', () => {
    try {
      decodePng(new Uint8Array([1, 2, 3, 4, 5]));
      throw new Error('expected decodePng to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_DECODE_FAILED');
    }
  });

  it('throws ATLAS_DIMENSION_MISMATCH when the RGBA length is wrong', () => {
    try {
      encodePng({ width: 4, height: 4, rgba: new Uint8Array(8) });
      throw new Error('expected encodePng to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_DIMENSION_MISMATCH');
    }
  });
});

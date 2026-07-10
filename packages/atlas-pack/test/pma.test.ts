import { describe, expect, it } from 'vitest';
import { isAtlasError } from '../src/errors';
import { premultiplyRgba } from '../src/pma';

// The pinned PMA rule is out_c = round(c * a / 255) (round-half-up), alpha unchanged. These are exact
// per-pixel assertions, not tolerances: a change to the rounding rule must break here and force a fixture
// regen (the decode side uses the inverse of exactly this rule within a PMA-aware epsilon).

describe('premultiplyRgba', () => {
  it('leaves a fully opaque pixel byte-identical (a=255 => out_c === c)', () => {
    const rgba = new Uint8Array([200, 100, 50, 255]);

    const out = premultiplyRgba(rgba, 1, 1);

    expect(Array.from(out)).toEqual([200, 100, 50, 255]);
  });

  it('collapses a fully transparent pixel to (0,0,0,0)', () => {
    const rgba = new Uint8Array([200, 100, 50, 0]);

    const out = premultiplyRgba(rgba, 1, 1);

    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('applies round(c*a/255) at half alpha with round-half-up ties', () => {
    // a=128: 255*128/255 = 128 (exact); 200*128/255 = 100.39 -> 100; 100*128/255 = 50.196 -> 50.
    const rgba = new Uint8Array([255, 200, 100, 128]);

    const out = premultiplyRgba(rgba, 1, 1);

    expect(Array.from(out)).toEqual([128, 100, 50, 128]);
  });

  it('rounds a 0.5 tie up (10 * 51 / 255 = 2.0; 5 * 51 / 255 = 1.0 exact boundary check)', () => {
    // Construct an exact .5: c=5, a=51 => 5*51/255 = 1.0 (no tie). Use c=1,a=128 => 128/255 = 0.5019 -> 1.
    const rgba = new Uint8Array([1, 5, 10, 128]);

    const out = premultiplyRgba(rgba, 1, 1);

    // 1*128/255 = 0.502 -> 1; 5*128/255 = 2.51 -> 3; 10*128/255 = 5.02 -> 5.
    expect(Array.from(out)).toEqual([1, 3, 5, 128]);
  });

  it('does not mutate the input buffer', () => {
    const rgba = new Uint8Array([200, 100, 50, 128]);
    const before = Array.from(rgba);

    premultiplyRgba(rgba, 1, 1);

    expect(Array.from(rgba)).toEqual(before);
  });

  it('premultiplies every pixel of a multi-pixel buffer independently', () => {
    // Two pixels: opaque red, half-alpha white.
    const rgba = new Uint8Array([255, 0, 0, 255, 255, 255, 255, 128]);

    const out = premultiplyRgba(rgba, 2, 1);

    expect(Array.from(out)).toEqual([255, 0, 0, 255, 128, 128, 128, 128]);
  });

  it('throws ATLAS_DIMENSION_MISMATCH when the buffer length disagrees with the dimensions', () => {
    const rgba = new Uint8Array(4 * 3); // 3 pixels

    try {
      premultiplyRgba(rgba, 2, 2); // claims 4 pixels
      expect.unreachable('expected a dimension-mismatch throw');
    } catch (error) {
      expect(isAtlasError(error)).toBe(true);
      if (isAtlasError(error)) expect(error.code).toBe('ATLAS_DIMENSION_MISMATCH');
    }
  });
});

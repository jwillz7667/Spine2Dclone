import { describe, expect, it } from 'vitest';
import { isAtlasError } from '../src/errors';
import {
  downsamplePage,
  resolveScaleVariants,
  scaleAtlasPage,
  scaleAtlasRef,
  scaleGeometry,
} from '../src/scale';
import type { AtlasPage, AtlasRef } from '@marionette/format/types';

function expectScaleError(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable('expected an ATLAS_INVALID_SCALE throw');
  } catch (error) {
    expect(isAtlasError(error)).toBe(true);
    if (isAtlasError(error)) expect(error.code).toBe('ATLAS_INVALID_SCALE');
  }
}

describe('resolveScaleVariants', () => {
  it('sorts descending, includes 1.0 first, and assigns factor + subfolder', () => {
    const variants = resolveScaleVariants([0.25, 1, 0.5]);

    expect(variants).toEqual([
      { scale: 1, factor: 1, dir: '' },
      { scale: 0.5, factor: 2, dir: '@0.5x' },
      { scale: 0.25, factor: 4, dir: '@0.25x' },
    ]);
  });

  it('de-duplicates repeated scales', () => {
    const variants = resolveScaleVariants([1, 1, 0.5, 0.5]);

    expect(variants.map((v) => v.scale)).toEqual([1, 0.5]);
  });

  it('rejects a list missing the canonical 1.0', () => {
    expectScaleError(() => resolveScaleVariants([0.5, 0.25]));
  });

  it('rejects a scale whose reciprocal is not an integer (0.75)', () => {
    expectScaleError(() => resolveScaleVariants([1, 0.75]));
  });

  it('rejects a scale out of the (0, 1] range', () => {
    expectScaleError(() => resolveScaleVariants([1, 2]));
    expectScaleError(() => resolveScaleVariants([1, 0]));
    expectScaleError(() => resolveScaleVariants([1, -0.5]));
  });
});

describe('scaleGeometry', () => {
  it('applies round-half-up to a scaled coordinate', () => {
    expect(scaleGeometry(5, 0.5)).toBe(3); // 2.5 -> 3
    expect(scaleGeometry(3, 0.5)).toBe(2); // 1.5 -> 2
    expect(scaleGeometry(10, 0.25)).toBe(3); // 2.5 -> 3
    expect(scaleGeometry(4, 0.5)).toBe(2); // 2.0 exact
    expect(scaleGeometry(100, 1)).toBe(100);
  });
});

describe('scaleAtlasPage / scaleAtlasRef', () => {
  const page: AtlasPage = {
    file: 'atlas-0.png',
    width: 128,
    height: 64,
    regions: [
      {
        name: 'torso',
        x: 10,
        y: 20,
        w: 40,
        h: 30,
        rotated: false,
        offsetX: 3,
        offsetY: 5,
        originalW: 44,
        originalH: 34,
      },
    ],
  };

  it('scales page dimensions and every region field with the pinned rule', () => {
    const scaled = scaleAtlasPage(page, 0.5);

    expect(scaled.file).toBe('atlas-0.png'); // basename unchanged; the subfolder disambiguates
    expect(scaled.width).toBe(64);
    expect(scaled.height).toBe(32);
    expect(scaled.regions[0]).toEqual({
      name: 'torso',
      x: 5,
      y: 10,
      w: 20,
      h: 15,
      rotated: false,
      offsetX: 2, // round(1.5) -> 2
      offsetY: 3, // round(2.5) -> 3
      originalW: 22,
      originalH: 17,
    });
  });

  it('is an identity at scale 1.0', () => {
    const atlas: AtlasRef = { pages: [page] };

    expect(scaleAtlasRef(atlas, 1)).toEqual(atlas);
  });
});

describe('downsamplePage', () => {
  it('copies the bitmap at factor 1 without aliasing the input', () => {
    const rgba = new Uint8Array([1, 2, 3, 4]);
    const out = downsamplePage({ width: 1, height: 1, rgba }, 1);

    expect(Array.from(out.rgba)).toEqual([1, 2, 3, 4]);
    expect(out.rgba).not.toBe(rgba);
  });

  it('box-averages a 2x2 block into one texel', () => {
    // Row-major RGBA: (0,0)=0s, (1,0)=20/40/60/80, (0,1)=40/80/120/160, (1,1)=60/120/180/240.
    const rgba = new Uint8Array([0, 0, 0, 0, 20, 40, 60, 80, 40, 80, 120, 160, 60, 120, 180, 240]);

    const out = downsamplePage({ width: 2, height: 2, rgba }, 2);

    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(Array.from(out.rgba)).toEqual([30, 60, 90, 120]);
  });

  it('rounds a 0.5 average tie up', () => {
    // Every channel: [10,10,11,11] -> sum 42 / 4 = 10.5 -> 11.
    const v = [10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11];
    const out = downsamplePage({ width: 2, height: 2, rgba: new Uint8Array(v) }, 2);

    expect(Array.from(out.rgba)).toEqual([11, 11, 11, 11]);
  });

  it('handles a non-multiple dimension via clamped partial edge blocks', () => {
    // 3x3 uniform image -> 2x2, every block (full or partial) averages to the same constant.
    const rgba = new Uint8Array(3 * 3 * 4).fill(100);
    const out = downsamplePage({ width: 3, height: 3, rgba }, 2);

    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.rgba)).toEqual(new Array(2 * 2 * 4).fill(100));
  });

  it('is deterministic: two runs on identical input produce byte-identical output', () => {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 37) & 0xff;

    const a = downsamplePage({ width: 8, height: 8, rgba }, 4);
    const b = downsamplePage({ width: 8, height: 8, rgba }, 4);

    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
  });
});

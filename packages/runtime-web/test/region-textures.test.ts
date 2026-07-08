import { describe, expect, it } from 'vitest';
import type { AtlasRef, AtlasRegion } from '@marionette/format/types';
import { buildRegionTextures, makeRegionTextureResolver, sliceRegion } from '../src';
import { makeSolidTexture } from './texture-fixtures';

// An atlas region rect within a page. Phase 1 regions are untrimmed and never rotated, so offset is 0
// and original == packed unless a test overrides them.
function atlasRegion(
  name: string,
  rect: { x: number; y: number; w: number; h: number },
  rotated = false,
): AtlasRegion {
  return {
    name,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    rotated,
    offsetX: 0,
    offsetY: 0,
    originalW: rect.w,
    originalH: rect.h,
  };
}

describe('region atlas textures', () => {
  it('slices a sub-texture whose frame is the region rect, sharing the page source', () => {
    const page = makeSolidTexture(128, 128);

    const sub = sliceRegion(page, atlasRegion('r', { x: 10, y: 4, w: 20, h: 12 }));

    expect(sub.frame.x).toBe(10);
    expect(sub.frame.y).toBe(4);
    expect(sub.frame.width).toBe(20);
    expect(sub.frame.height).toBe(12);
    // The texture reports the frame size (orig defaults to frame), which is what the size normalization
    // reads back as texW/texH.
    expect(sub.width).toBe(20);
    expect(sub.height).toBe(12);
    // The slice is a UV window over the page's shared source: no pixels copied, host owns the source.
    expect(sub.source).toBe(page.source);
  });

  it('builds a region-name map from loaded pages and skips pages not yet provided', () => {
    const atlas: AtlasRef = {
      pages: [
        {
          file: 'page0.png',
          width: 128,
          height: 128,
          regions: [
            atlasRegion('a', { x: 0, y: 0, w: 32, h: 32 }),
            atlasRegion('b', { x: 32, y: 0, w: 16, h: 48 }),
          ],
        },
        {
          file: 'page1.png',
          width: 64,
          height: 64,
          regions: [atlasRegion('c', { x: 0, y: 0, w: 64, h: 64 })],
        },
      ],
    };
    const page0 = makeSolidTexture(128, 128);

    // Only page0 is loaded; page1 is omitted, so its region must be absent (it falls back to placeholder).
    const regionTextures = buildRegionTextures(atlas, new Map([['page0.png', page0]]));

    expect([...regionTextures.keys()].sort()).toEqual(['a', 'b']);
    expect(regionTextures.get('a')!.width).toBe(32);
    expect(regionTextures.get('a')!.height).toBe(32);
    expect(regionTextures.get('b')!.width).toBe(16);
    expect(regionTextures.get('b')!.height).toBe(48);
    expect(regionTextures.get('a')!.source).toBe(page0.source);
    expect(regionTextures.has('c')).toBe(false);
  });

  it('resolves known region names to their texture and unknown names to null', () => {
    const tex = makeSolidTexture(8, 8);
    const resolve = makeRegionTextureResolver(new Map([['known', tex]]));

    expect(resolve('known')).toBe(tex);
    expect(resolve('unknown')).toBeNull();
  });

  it('slices a rotated region with swapped frame, logical orig, and PixiJS rotate=2', () => {
    const page = makeSolidTexture(128, 128);
    // Logical content 20 (w) x 12 (h) stored turned 90 degrees CW into a (12 x 20) page rectangle at (10,4).
    const rotated = atlasRegion('rot', { x: 10, y: 4, w: 20, h: 12 }, true);

    const sub = sliceRegion(page, rotated);

    // The frame is the STORED page rectangle: dims swapped to (h x w) = (12 x 20).
    expect(sub.frame.x).toBe(10);
    expect(sub.frame.y).toBe(4);
    expect(sub.frame.width).toBe(12);
    expect(sub.frame.height).toBe(20);
    // Texture.width/height read back as the LOGICAL (unrotated) size (w x h), which the placement math uses.
    expect(sub.width).toBe(20);
    expect(sub.height).toBe(12);
    // rotate=2 is PixiJS groupD8 "S" (90 degrees clockwise), matching the atlas-pack storage convention.
    expect(sub.rotate).toBe(2);
    expect(sub.source).toBe(page.source);
  });
});

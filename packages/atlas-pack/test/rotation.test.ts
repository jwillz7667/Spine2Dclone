import { describe, expect, it } from 'vitest';
import { packAtlas } from '../src/pack';
import type { PageBitmap, TrimmedSprite } from '../src/pack';

// PP-C2: deterministic 90-degree rotation packing. `allowRotation` is opt-in (default false, verified in
// pack.test.ts) and, when set, may store a sprite turned 90 degrees clockwise into an (h x w) page
// rectangle to fit more per page. These tests lock the determinism and the exact pixel storage convention
// both renderers reconstruct (runtime-web PixiJS rotate=2, render-preview RegionSampler).

// A sprite whose every pixel encodes its own (lx, ly), so a wrong rotation shows up as swapped channels.
function patternSprite(name: string, w: number, h: number): TrimmedSprite {
  const pixels = new Uint8Array(w * h * 4);
  for (let ly = 0; ly < h; ly += 1) {
    for (let lx = 0; lx < w; lx += 1) {
      const i = (ly * w + lx) * 4;
      pixels[i] = lx & 0xff;
      pixels[i + 1] = ly & 0xff;
      pixels[i + 2] = (lx + ly) & 0xff;
      pixels[i + 3] = 255;
    }
  }
  return { name, trimmedW: w, trimmedH: h, offsetX: 0, offsetY: 0, originalW: w, originalH: h, pixels };
}

// The reference 90-degree-clockwise rotation of a w x h image into an (h x w) buffer, row-major. Mirrors
// pack.ts blitRotated: source (lx, ly) lands at stored (h - 1 - ly, lx).
function rotate90CW(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const storedW = h;
  for (let ly = 0; ly < h; ly += 1) {
    for (let lx = 0; lx < w; lx += 1) {
      const s = (ly * w + lx) * 4;
      const sx = h - 1 - ly;
      const sy = lx;
      const d = (sy * storedW + sx) * 4;
      out[d] = src[s]!;
      out[d + 1] = src[s + 1]!;
      out[d + 2] = src[s + 2]!;
      out[d + 3] = src[s + 3]!;
    }
  }
  return out;
}

// Extract the (footprintW x footprintH) sub-rectangle at (x, y) from a packed page, row-major RGBA.
function extract(
  page: PageBitmap,
  x: number,
  y: number,
  footprintW: number,
  footprintH: number,
): Uint8Array {
  const out = new Uint8Array(footprintW * footprintH * 4);
  for (let row = 0; row < footprintH; row += 1) {
    const src = ((y + row) * page.width + x) * 4;
    out.set(page.rgba.subarray(src, src + footprintW * 4), row * footprintW * 4);
  }
  return out;
}

const ROTATION_SCENARIO: readonly TrimmedSprite[] = [
  patternSprite('wide', 60, 20),
  patternSprite('tall', 20, 60),
  patternSprite('sq', 40, 40),
  patternSprite('bar', 50, 12),
];

describe('rotation packing', () => {
  it('packs deterministically with 90-degree rotation when allowRotation is set', () => {
    const config = { maxPageSize: 80, padding: 2, allowRotation: true };

    const first = packAtlas(ROTATION_SCENARIO, config);
    const second = packAtlas(ROTATION_SCENARIO, config);

    // Byte-for-byte reproducible placement (region coords, page assignment, rotated flags).
    expect(first.atlas).toEqual(second.atlas);

    // At least one region rotated (the scenario is chosen to force it), and 'tall' is that region with its
    // LOGICAL (unrotated) w/h preserved; a rotated region's page footprint is (h x w).
    const allRegions = first.atlas.pages.flatMap((p) => p.regions);
    const tall = allRegions.find((r) => r.name === 'tall');
    expect(tall?.rotated).toBe(true);
    expect(tall).toMatchObject({ w: 20, h: 60 });
    expect(allRegions.some((r) => r.rotated)).toBe(true);
  });

  it('stores a rotated region as its source turned 90 degrees clockwise', () => {
    const result = packAtlas(ROTATION_SCENARIO, {
      maxPageSize: 80,
      padding: 2,
      allowRotation: true,
    });

    // Locate the rotated 'tall' region and the page it landed on.
    let region: (typeof result.atlas.pages)[number]['regions'][number] | undefined;
    let pageIndex = -1;
    result.atlas.pages.forEach((page, index) => {
      const found = page.regions.find((r) => r.name === 'tall' && r.rotated);
      if (found) {
        region = found;
        pageIndex = index;
      }
    });
    expect(region).toBeDefined();
    if (!region) return;

    const source = ROTATION_SCENARIO.find((s) => s.name === 'tall')!;
    // The page footprint of a rotated region is (h x w) = (60 x 20).
    const stored = extract(result.pageBitmaps[pageIndex]!, region.x, region.y, region.h, region.w);
    const expected = rotate90CW(source.pixels, source.trimmedW, source.trimmedH);

    expect(Array.from(stored)).toEqual(Array.from(expected));
  });

  it('leaves the same scenario unrotated (and possibly multi-page) without allowRotation', () => {
    const rotated = packAtlas(ROTATION_SCENARIO, { maxPageSize: 80, padding: 2, allowRotation: true });
    const straight = packAtlas(ROTATION_SCENARIO, { maxPageSize: 80, padding: 2 });

    const straightRotatedFlags = straight.atlas.pages.flatMap((p) =>
      p.regions.map((r) => r.rotated),
    );
    expect(straightRotatedFlags.every((flag) => flag === false)).toBe(true);
    // Rotation is opt-in and does something here, so the two packings differ.
    expect(rotated.atlas).not.toEqual(straight.atlas);
  });
});

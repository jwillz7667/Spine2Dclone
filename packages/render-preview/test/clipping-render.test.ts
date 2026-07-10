import { describe, expect, it } from 'vitest';
import { renderFrame } from '@marionette/render-preview';
import {
  CLIP_FIT,
  CLIP_LEFT_HALF,
  clipDocument,
  regionDocument,
  TWO_COLOR_DARK,
  TWO_COLOR_TEXEL,
} from './scenarios';
import { solidPage, pageSource } from './scenarios';
import { decode, pixelAt } from './helpers';

// Clipping render (ADR-0012 section 3, PP-C8 part 2). A `clipping` attachment clips the geometry of the
// slots in its draw-order range to its world polygon. These tests prove (1) the region is visibly CUT (the
// clipped half shows the background, the surviving half shows the region), and (2) the clip composes with
// the shading paths: two-color dark tint, per-slot blend mode, and slot x attachment tint all apply to the
// clipped triangles exactly as to unclipped ones (the clip routes through the SAME rasterizeTriangle).

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;
const WHITE_ATLAS = pageSource('page.png', solidPage(8, 8, WHITE));

// Under CLIP_FIT (64x64, scale 1, origin at image center) the region spans world [-20, 20]^2 -> image
// [12, 52]^2. The clip keeps world x < 0, i.e. image x < 32. So (20, 32) survives and (44, 32) is clipped.
const INSIDE = { x: 20, y: 32 } as const;
const CLIPPED = { x: 44, y: 32 } as const;

describe('clipping render (ADR-0012, PP-C8 part 2)', () => {
  it('visibly cuts a region: the surviving half draws, the clipped half shows the background', () => {
    const img = decode(
      renderFrame({
        document: clipDocument({
          regionWidth: 40,
          regionHeight: 40,
          regionColor: { r: 1, g: 0, b: 0, a: 1 },
          slotColor: WHITE,
          blendMode: 'normal',
          clipVertices: CLIP_LEFT_HALF,
        }),
        atlas: WHITE_ATLAS,
        viewport: { width: 64, height: 64, fit: CLIP_FIT },
        background: { r: 0, g: 0, b: 0, a: 0 },
      }).png,
    );

    // Surviving (left) half: opaque red. Clipped (right) half: the transparent background.
    const inside = pixelAt(img, INSIDE.x, INSIDE.y);
    expect(inside.r).toBeGreaterThan(200);
    expect(inside.a).toBe(255);
    expect(pixelAt(img, CLIPPED.x, CLIPPED.y).a).toBe(0);
  });

  it('control: without a clip the same right-half pixel IS the region (so the cut is the clip)', () => {
    const img = decode(
      renderFrame({
        document: regionDocument({
          boneRotation: 0,
          regionWidth: 40,
          regionHeight: 40,
          regionColor: { r: 1, g: 0, b: 0, a: 1 },
          slotColor: WHITE,
          blendMode: 'normal',
        }),
        atlas: WHITE_ATLAS,
        viewport: { width: 64, height: 64, fit: CLIP_FIT },
        background: { r: 0, g: 0, b: 0, a: 0 },
      }).png,
    );

    // The very pixel that was clipped above is opaque red here: the geometry exists; only the clip removed it.
    const clipped = pixelAt(img, CLIPPED.x, CLIPPED.y);
    expect(clipped.r).toBeGreaterThan(200);
    expect(clipped.a).toBe(255);
  });

  it('composes with the two-color DARK tint: the surviving half shades through the two-color combine', () => {
    const twoColorAtlas = pageSource('page.png', solidPage(8, 8, TWO_COLOR_TEXEL));
    const img = decode(
      renderFrame({
        document: clipDocument({
          regionWidth: 40,
          regionHeight: 40,
          regionColor: WHITE,
          slotColor: WHITE,
          blendMode: 'normal',
          clipVertices: CLIP_LEFT_HALF,
          slotDarkColor: TWO_COLOR_DARK,
        }),
        atlas: twoColorAtlas,
        viewport: { width: 64, height: 64, fit: CLIP_FIT },
        background: { r: 0, g: 0, b: 0, a: 0 },
      }).png,
    );

    // out = texel*light + (1 - texel)*dark = 0.5*white + 0.5*red = (1, 0.5, 0.5) -> (255, ~128, ~128, 255),
    // the SAME interior the unclipped two-color golden locks, proving the dark tint applies to clipped tris.
    const inside = pixelAt(img, INSIDE.x, INSIDE.y);
    expect(inside.r).toBeGreaterThan(250);
    expect(Math.abs(inside.g - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(inside.b - 128)).toBeLessThanOrEqual(2);
    expect(inside.a).toBe(255);
    // Clipped half: background.
    expect(pixelAt(img, CLIPPED.x, CLIPPED.y).a).toBe(0);
  });

  it('composes with the per-slot blend mode: the surviving half blends, the clipped half is pure background', () => {
    const background = { r: 0.4, g: 0.6, b: 0.8, a: 1 };
    const img = decode(
      renderFrame({
        document: clipDocument({
          regionWidth: 40,
          regionHeight: 40,
          regionColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
          slotColor: WHITE,
          blendMode: 'multiply',
          clipVertices: CLIP_LEFT_HALF,
        }),
        atlas: WHITE_ATLAS,
        viewport: { width: 64, height: 64, fit: CLIP_FIT },
        background,
      }).png,
    );

    // Clipped half: the OPAQUE background, unblended (102, 153, 204). Proves no source reached it.
    const clipped = pixelAt(img, CLIPPED.x, CLIPPED.y);
    expect(clipped.r).toBe(102);
    expect(clipped.g).toBe(153);
    expect(clipped.b).toBe(204);
    expect(clipped.a).toBe(255);

    // Surviving half: multiply darkens r (0.5*0.4 = 0.2 -> ~51), so it differs from the background: the blend
    // ran on the clipped triangles.
    const inside = pixelAt(img, INSIDE.x, INSIDE.y);
    expect(inside.r).toBeLessThan(80);
  });
});

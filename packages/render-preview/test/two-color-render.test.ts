import { describe, expect, it } from 'vitest';
import { renderFrame } from '@marionette/render-preview';
import { decode, pixelAt } from './helpers';
import {
  regionDocument,
  twoColorRegionScenario,
  TWO_COLOR_DARK,
  TWO_COLOR_TEXEL,
} from './scenarios';

// End-to-end two-color (dark tint) render, node-agnostic (decodes the PNG and asserts a hand-derived
// interior pixel, no pinned-Node byte dependency). The two-color-region golden byte-locks the same scene;
// this test proves the actual math independent of the golden's platform bytes.

describe('render-preview two-color dark tint', () => {
  it('fills the shadow term with the dark tint at an interior pixel', () => {
    const png = renderFrame(twoColorRegionScenario()).png;
    const img = decode(png);

    // The 40x40 region is content-fit into 64x64, centered, so the geometric center is a solid interior
    // pixel (all four bilinear taps are the mid-gray page texel 0.5). out = texel*light + (1-texel)*dark
    // with light = white, dark = red: r = 0.5 + 0.5*1 = 1.0, g = 0.5 + 0.5*0 = 0.5, b = 0.5. a = 1.
    const center = pixelAt(img, 32, 32);

    expect(center.r).toBe(255); // 1.0
    expect(center.g).toBe(128); // 0.5 -> round(127.5) = 128
    expect(center.b).toBe(128); // 0.5
    expect(center.a).toBe(255);
  });

  it('is byte-identical to the single-color path when the slot has no dark color', () => {
    // Same scene with the SAME gray page and white light but NO darkColor: the interior pixel is the plain
    // light multiply (texel * white = the gray texel), so the dark path never perturbs a non-two-color slot.
    const noDark = renderFrame({
      document: regionDocument({
        boneRotation: 0,
        regionWidth: 40,
        regionHeight: 40,
        regionColor: { r: 1, g: 1, b: 1, a: 1 },
        slotColor: { r: 1, g: 1, b: 1, a: 1 },
        blendMode: 'normal',
      }),
      atlas: twoColorRegionScenario().atlas,
      viewport: { width: 64, height: 64, fit: 'content' },
      background: { r: 0, g: 0, b: 0, a: 0 },
    }).png;
    const center = pixelAt(decode(noDark), 32, 32);

    const gray = Math.round(TWO_COLOR_TEXEL.r * 255);
    expect(center.r).toBe(gray);
    expect(center.g).toBe(gray);
    expect(center.b).toBe(gray);
  });

  it('shows the dark tint verbatim where the texel is black', () => {
    // A black page (texel 0) with a colored dark tint: out = 0*light + 1*dark = dark, so the interior pixel
    // is the dark tint exactly (proves the shadow term, not the light term, drives dark texels).
    const png = renderFrame({
      document: regionDocument({
        boneRotation: 0,
        regionWidth: 40,
        regionHeight: 40,
        regionColor: { r: 1, g: 1, b: 1, a: 1 },
        slotColor: { r: 1, g: 1, b: 1, a: 1 },
        blendMode: 'normal',
        slotDarkColor: TWO_COLOR_DARK,
      }),
      atlas: { pages: new Map([['page.png', blackPage()]]) },
      viewport: { width: 64, height: 64, fit: 'content' },
      background: { r: 0, g: 0, b: 0, a: 0 },
    }).png;
    const center = pixelAt(decode(png), 32, 32);

    expect(center.r).toBe(Math.round(TWO_COLOR_DARK.r * 255)); // 255
    expect(center.g).toBe(Math.round(TWO_COLOR_DARK.g * 255)); // 0
    expect(center.b).toBe(Math.round(TWO_COLOR_DARK.b * 255)); // 0
    expect(center.a).toBe(255);
  });
});

function blackPage(): { width: number; height: number; rgba: Uint8Array } {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = 255; // opaque black
  return { width: 8, height: 8, rgba };
}

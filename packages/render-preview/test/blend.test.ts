import { describe, expect, it } from 'vitest';
import type { BlendMode } from '@marionette/format/types';
import { renderFrame } from '@marionette/render-preview';
import { blendScenario } from './scenarios';
import { decode, pixelAt, type Rgba } from './helpers';

// The four blend modes over an opaque background B=(0.4,0.6,0.8) with an opaque grey source S=(0.5,0.5,0.5).
// With source alpha 1 the premultiplied GPU equations reduce to (verified by hand, see raster.ts):
//   normal:   S                          -> (128,128,128)
//   additive: clamp(S + B)               -> (230,255,255)
//   multiply: S * B                      -> ( 51, 77,102)
//   screen:   S + B - S*B                -> (179,204,230)
const EXPECTED: Record<BlendMode, Rgba> = {
  normal: { r: 128, g: 128, b: 128, a: 255 },
  additive: { r: 230, g: 255, b: 255, a: 255 },
  multiply: { r: 51, g: 77, b: 102, a: 255 },
  screen: { r: 179, g: 204, b: 230, a: 255 },
};

describe('blend modes over a colored background', () => {
  for (const mode of Object.keys(EXPECTED) as BlendMode[]) {
    it(`composites ${mode} at the frame center`, () => {
      const image = decode(renderFrame(blendScenario(mode)).png);

      // 32x32 viewport, region covers the center; sample the center pixel.
      expect(pixelAt(image, 16, 16)).toEqual(EXPECTED[mode]);
    });
  }
});

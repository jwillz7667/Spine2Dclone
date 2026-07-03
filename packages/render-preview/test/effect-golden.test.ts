import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderComposedFrame, renderEffectFrame } from '@marionette/render-preview';
import {
  burstScenario,
  composedGoldenScenarios,
  composedScenario,
  effectGoldenScenarios,
  sparkScenario,
  trailScenario,
} from './effect-scenarios';
import { bytesEqual, decode, pixelAt } from './helpers';

function goldenBytes(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`./goldens/${name}.png`, import.meta.url))),
  );
}

describe('effect golden PNG byte-equality', () => {
  for (const { name, options } of effectGoldenScenarios()) {
    it(`matches the committed golden for ${name}`, () => {
      const { png } = renderEffectFrame(options);

      expect(bytesEqual(png, goldenBytes(name))).toBe(true);
    });
  }

  for (const { name, options } of composedGoldenScenarios()) {
    it(`matches the committed golden for ${name}`, () => {
      const { png } = renderComposedFrame(options);

      expect(bytesEqual(png, goldenBytes(name))).toBe(true);
    });
  }
});

describe('effect determinism', () => {
  it('renders an emitter burst byte-identically on repeated calls', () => {
    const options = burstScenario();

    const first = renderEffectFrame(options).png;
    const second = renderEffectFrame(options).png;

    expect(bytesEqual(first, second)).toBe(true);
  });

  it('renders a composed skeleton+effect frame byte-identically on repeated calls', () => {
    const options = composedScenario();

    const first = renderComposedFrame(options).png;
    const second = renderComposedFrame(options).png;

    expect(bytesEqual(first, second)).toBe(true);
  });

  it('renders a bone-anchored ribbon byte-identically across two fresh scenarios', () => {
    // The ribbon resolver is stateful (call-counting), so a fresh scenario is built per render; identical
    // inputs must still produce identical bytes.
    const first = renderEffectFrame(trailScenario()).png;
    const second = renderEffectFrame(trailScenario()).png;

    expect(bytesEqual(first, second)).toBe(true);
  });
});

describe('additive particle compositing (hand-derived)', () => {
  it('composites one additive particle over the opaque background at the exact expected pixel', () => {
    // The spark is a single at-rest white particle (tint = colorOverLife = 0.4 per channel, alpha 1) at
    // scale 2, covering the 32x32 frame center; the background is opaque (0.2, 0.2, 0.2). With source
    // alpha 1 the additive equation reduces (premultiplied space, see raster.ts) to per channel:
    //   D' = S + D = 0.4 + 0.2 = 0.6 -> round(0.6 * 255) = 153.
    // The particle quad (region 8 x scale 2 = 16 world units, so +/-8 about the center) covers the center
    // (16, 16) but not the far corner (2, 2), which stays the background: 0.2 -> round(0.2 * 255) = 51.
    const image = decode(renderEffectFrame(sparkScenario()).png);

    expect(pixelAt(image, 16, 16)).toEqual({ r: 153, g: 153, b: 153, a: 255 });
    expect(pixelAt(image, 2, 2)).toEqual({ r: 51, g: 51, b: 51, a: 255 });
  });
});

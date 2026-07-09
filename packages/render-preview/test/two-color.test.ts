import { describe, expect, it } from 'vitest';
import { combineTwoColor, type Color } from '@marionette/render-preview';

// The shared two-color (light + dark) parity vectors. This SAME table is asserted verbatim in
// packages/runtime-web/test/two-color.test.ts against runtime-web's own combineTwoColor, so the CPU
// rasterizer and the GPU-shader math are proven byte-consistent at the math-module level (PP-C8 standing
// order: every render feature has a shared-math parity test). Editing a number here without editing the
// runtime-web copy is the drift this table exists to catch.
export interface TwoColorVector {
  readonly name: string;
  readonly texel: Color;
  readonly light: Color;
  readonly dark: Color;
  readonly expected: { readonly r: number; readonly g: number; readonly b: number };
}

export const TWO_COLOR_VECTORS: readonly TwoColorVector[] = [
  {
    name: 'white texel, white light, black dark -> white (single-color identity)',
    texel: { r: 1, g: 1, b: 1, a: 1 },
    light: { r: 1, g: 1, b: 1, a: 1 },
    dark: { r: 0, g: 0, b: 0, a: 1 },
    expected: { r: 1, g: 1, b: 1 },
  },
  {
    name: 'black texel shows the dark tint verbatim',
    texel: { r: 0, g: 0, b: 0, a: 1 },
    light: { r: 1, g: 1, b: 1, a: 1 },
    dark: { r: 0.2, g: 0.1, b: 0.3, a: 1 },
    expected: { r: 0.2, g: 0.1, b: 0.3 },
  },
  {
    name: 'mid texel splits between light and dark per channel',
    texel: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    light: { r: 1, g: 0, b: 0, a: 1 },
    dark: { r: 0, g: 0, b: 1, a: 1 },
    expected: { r: 0.5, g: 0, b: 0.5 },
  },
  {
    name: 'general straight-alpha case, dark alpha ignored',
    texel: { r: 0.8, g: 0.4, b: 0.2, a: 0.5 },
    light: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    // dark.a is deliberately not 1 to prove the combine never reads it.
    dark: { r: 0.1, g: 0.2, b: 0.3, a: 0.25 },
    expected: { r: 0.42, g: 0.32, b: 0.34 },
  },
  {
    name: 'black dark collapses to the single-color light multiply',
    texel: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
    light: { r: 0.5, g: 0.25, b: 0.75, a: 1 },
    dark: { r: 0, g: 0, b: 0, a: 1 },
    expected: { r: 0.3, g: 0.15, b: 0.45 },
  },
];

describe('combineTwoColor', () => {
  for (const vector of TWO_COLOR_VECTORS) {
    it(`matches the pinned two-color formula: ${vector.name}`, () => {
      const out = combineTwoColor(vector.texel, vector.light, vector.dark);

      expect(out.r).toBeCloseTo(vector.expected.r, 12);
      expect(out.g).toBeCloseTo(vector.expected.g, 12);
      expect(out.b).toBeCloseTo(vector.expected.b, 12);
    });
  }

  it('carries the texel alpha through unchanged (the caller folds item alpha as srcAlpha)', () => {
    const out = combineTwoColor(
      { r: 0.3, g: 0.7, b: 0.9, a: 0.42 },
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    );

    expect(out.a).toBe(0.42);
  });

  it('a black dark term is byte-identical to the single-color light multiply', () => {
    const texel: Color = { r: 0.31, g: 0.62, b: 0.17, a: 1 };
    const light: Color = { r: 0.8, g: 0.5, b: 0.2, a: 1 };

    const two = combineTwoColor(texel, light, { r: 0, g: 0, b: 0, a: 1 });

    expect(two.r).toBe(texel.r * light.r);
    expect(two.g).toBe(texel.g * light.g);
    expect(two.b).toBe(texel.b * light.b);
  });
});

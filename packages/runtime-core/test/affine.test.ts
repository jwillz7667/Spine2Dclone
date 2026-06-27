import { describe, expect, it } from 'vitest';
import {
  compose,
  composeInto,
  decompose,
  getRotationDeg,
  getTranslation,
  identity,
  invert,
  MAT2X3_STRIDE,
  multiply,
  multiplyInto,
  transformPoint,
} from '../src/math/affine';
import type { Mat2x3 } from '../src/math/affine';

function expectClose(
  actual: Mat2x3 | readonly number[],
  expected: readonly number[],
  epsilon = 1e-9,
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(epsilon);
  }
}

describe('affine math', () => {
  it('multiply by identity returns the other matrix exactly', () => {
    const m: Mat2x3 = compose(3, 4, 37, 1.5, 0.5, 0, 0);
    expect(multiply(identity(), m)).toEqual(m);
    expect(multiply(m, identity())).toEqual(m);
  });

  it('multiply is associative on a fixed triple (within epsilon)', () => {
    const a = compose(1, 2, 30, 1, 1, 0, 0);
    const b = compose(3, 4, 45, 2, 1, 0, 0);
    const c = compose(-2, 5, 10, 1, 1, 0, 0);

    expectClose(multiply(multiply(a, b), c), multiply(a, multiply(b, c)));
  });

  it('invert round-trips to identity within 1e-9', () => {
    const m = compose(10, 5, 30, 2, 1.5, 0, 0);
    expectClose(multiply(m, invert(m)), identity());
    expectClose(multiply(invert(m), m), identity());
  });

  it('transformPoint matches hand-computed values', () => {
    // [a,b,c,d,tx,ty] = [2,0,0,3,10,20]: scale (2,3) then translate (10,20).
    const m: Mat2x3 = [2, 0, 0, 3, 10, 20];
    expect(transformPoint(m, 5, 7)).toEqual([20, 41]);
  });

  it('compose with zero shear and unit scale matches the rotation layout', () => {
    // 90 degrees: [cos, sin, -sin, cos, x, y] = [~0, 1, -1, ~0, 0, 0].
    expectClose(compose(0, 0, 90, 1, 1, 0, 0), [0, 1, -1, 0, 0, 0]);
  });

  it('getRotationDeg and getTranslation read back a composed transform', () => {
    const m = compose(7, -3, 35, 1, 1, 0, 0);
    expect(getRotationDeg(m)).toBeCloseTo(35, 9);
    expect(getTranslation(m)).toEqual([7, -3]);
  });

  it('multiplyInto agrees with the pure multiply (the dual implementations stay in lockstep)', () => {
    const parent = compose(5, 6, 25, 1.2, 0.8, 0, 0);
    const child = compose(-1, 2, 50, 1, 1, 0, 0);
    const packed = new Float64Array(3 * MAT2X3_STRIDE);
    for (let i = 0; i < MAT2X3_STRIDE; i += 1) {
      packed[i] = parent[i]!;
      packed[MAT2X3_STRIDE + i] = child[i]!;
    }
    multiplyInto(packed, 2 * MAT2X3_STRIDE, packed, 0, packed, MAT2X3_STRIDE);

    expectClose(
      Array.from(packed.subarray(2 * MAT2X3_STRIDE, 3 * MAT2X3_STRIDE)),
      multiply(parent, child),
      0,
    );
  });

  it('composeInto agrees with the pure compose', () => {
    const out = new Float64Array(MAT2X3_STRIDE);
    composeInto(out, 0, 9, -4, 63, 1.1, 0.9, 0, 0);

    expectClose(Array.from(out), compose(9, -4, 63, 1.1, 0.9, 0, 0), 0);
  });
});

describe('decompose (inverse of compose)', () => {
  // compose(decompose(m)) must reproduce m for any non-degenerate m. These cases span rotation,
  // non-uniform scale, shear (input via compose), translation, a reflection (negative determinant),
  // and an over-180 rotation, which together exercise every branch of the decomposition.
  const cases: ReadonlyArray<{ label: string; m: Mat2x3 }> = [
    { label: 'identity', m: identity() },
    { label: 'pure rotation', m: compose(0, 0, 37, 1, 1, 0, 0) },
    { label: 'rotation + translation', m: compose(12, -8, 145, 1, 1, 0, 0) },
    { label: 'non-uniform scale', m: compose(3, 4, 50, 2, 0.5, 0, 0) },
    { label: 'shearX present', m: compose(1, 2, 20, 1.3, 0.7, 25, 0) },
    { label: 'shearY present', m: compose(5, 5, -40, 1.1, 1.4, 0, 18) },
    { label: 'both shears', m: compose(0, 0, 60, 0.9, 1.2, 15, -22) },
    { label: 'over 180 rotation', m: compose(0, 0, 200, 1, 1, 0, 0) },
    { label: 'reflection (negative det)', m: [1, 0, 0, -1, 7, -3] },
  ];

  it.each(cases)('round-trips $label through compose', ({ m }) => {
    const t = decompose(m);
    const rebuilt = compose(t.x, t.y, t.rotationDeg, t.scaleX, t.scaleY, t.shearXDeg, t.shearYDeg);
    expectClose(rebuilt, m, 1e-9);
  });

  it('recovers the exact authored params when shearY is zero', () => {
    const t = decompose(compose(11, -6, 73, 1.7, 0.4, 31, 0));
    expect(t.x).toBeCloseTo(11, 9);
    expect(t.y).toBeCloseTo(-6, 9);
    expect(t.rotationDeg).toBeCloseTo(73, 9);
    expect(t.scaleX).toBeCloseTo(1.7, 9);
    expect(t.scaleY).toBeCloseTo(0.4, 9);
    expect(t.shearXDeg).toBeCloseTo(31, 9);
    expect(t.shearYDeg).toBe(0);
  });

  it('translation maps straight through', () => {
    const t = decompose([1, 0, 0, 1, 42, -17]);
    expect(t.x).toBe(42);
    expect(t.y).toBe(-17);
  });
});

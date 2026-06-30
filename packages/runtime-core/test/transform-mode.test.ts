import { describe, expect, it } from 'vitest';
import { multiplyInto } from '../src/math/affine';
import {
  TRANSFORM_MODE_NO_ROTATION_OR_REFLECTION,
  TRANSFORM_MODE_NO_SCALE,
  TRANSFORM_MODE_NO_SCALE_OR_REFLECTION,
  TRANSFORM_MODE_NORMAL,
  TRANSFORM_MODE_ONLY_TRANSLATION,
  transformModeToCode,
  worldFromParentByMode,
} from '../src/skeleton/transform-mode';

// Bone transformMode inheritance (handoff section 6; the solve that honors bone.transformMode). Locks the
// per-mode world-transform math against hand-computed expectations and proves every non-normal mode is
// OBSERVABLY different from `normal` under a rotated, non-uniformly-scaled parent (the A.2 observability
// requirement: a mode no fixture can distinguish from `normal` has zero cross-implementation verification).

function world(parent: readonly number[], local: readonly number[], mode: number): number[] {
  const out = new Float64Array(6);
  worldFromParentByMode(out, 0, Float64Array.from(parent), 0, Float64Array.from(local), 0, mode);
  return Array.from(out);
}

describe('transformModeToCode', () => {
  it('maps every format mode to its integer code', () => {
    expect(transformModeToCode('normal')).toBe(TRANSFORM_MODE_NORMAL);
    expect(transformModeToCode('onlyTranslation')).toBe(TRANSFORM_MODE_ONLY_TRANSLATION);
    expect(transformModeToCode('noRotationOrReflection')).toBe(
      TRANSFORM_MODE_NO_ROTATION_OR_REFLECTION,
    );
    expect(transformModeToCode('noScale')).toBe(TRANSFORM_MODE_NO_SCALE);
    expect(transformModeToCode('noScaleOrReflection')).toBe(TRANSFORM_MODE_NO_SCALE_OR_REFLECTION);
  });
});

describe('worldFromParentByMode', () => {
  // Parent world: a 90deg rotation with non-uniform scale (2, 3) and translation (10, 20).
  // compose(_,_,90,2,3,0,0) = [0, 2, -3, 0, ...]; psx = |Xcol| = 2, psy = |Ycol| = 3.
  const PARENT = [0, 2, -3, 0, 10, 20];
  // Child local: identity orientation, translation (5, 7), so the effective parent 2x2 is read directly.
  const LOCAL = [1, 0, 0, 1, 5, 7];

  it('normal is byte-identical to multiplyInto (the existing world-composition op)', () => {
    const out = new Float64Array(6);
    multiplyInto(out, 0, Float64Array.from(PARENT), 0, Float64Array.from(LOCAL), 0);
    expect(world(PARENT, LOCAL, TRANSFORM_MODE_NORMAL)).toEqual(Array.from(out));
  });

  it('normal: full inheritance (parent applied to position, parent 2x2 to orientation)', () => {
    // pos = PARENT applied to (5,7) = (0*5 + -3*7 + 10, 2*5 + 0*7 + 20) = (-11, 30); 2x2 = parent 2x2.
    expect(world(PARENT, LOCAL, TRANSFORM_MODE_NORMAL)).toEqual([0, 2, -3, 0, -11, 30]);
  });

  it('onlyTranslation: parent translation + local offset, local orientation only', () => {
    // pos = (10 + 5, 20 + 7) = (15, 27); 2x2 = local identity (parent rotation/scale dropped).
    expect(world(PARENT, LOCAL, TRANSFORM_MODE_ONLY_TRANSLATION)).toEqual([1, 0, 0, 1, 15, 27]);
  });

  it('noRotationOrReflection: parent SCALE magnitudes only (rotation dropped), full parent position', () => {
    // effective 2x2 = diag(psx, psy) = diag(2, 3); pos = full parent applied = (-11, 30).
    expect(world(PARENT, LOCAL, TRANSFORM_MODE_NO_ROTATION_OR_REFLECTION)).toEqual([
      2, 0, 0, 3, -11, 30,
    ]);
  });

  it('noScale: parent ROTATION only (scale removed), full parent position', () => {
    // unit columns: (0/2, 2/2) = (0, 1); (-3/3, 0/3) = (-1, 0) => [0, 1, -1, 0]; pos = (-11, 30).
    expect(world(PARENT, LOCAL, TRANSFORM_MODE_NO_SCALE)).toEqual([0, 1, -1, 0, -11, 30]);
  });

  it('every non-normal mode is observably different from normal under a rotated, scaled parent', () => {
    const normal = world(PARENT, LOCAL, TRANSFORM_MODE_NORMAL);
    for (const mode of [
      TRANSFORM_MODE_ONLY_TRANSLATION,
      TRANSFORM_MODE_NO_ROTATION_OR_REFLECTION,
      TRANSFORM_MODE_NO_SCALE,
    ]) {
      expect(world(PARENT, LOCAL, mode)).not.toEqual(normal);
    }
  });

  describe('reflected parent distinguishes noScale from noScaleOrReflection', () => {
    // Parent with a reflected basis: compose(_,_,90,2,-3,0,0) = [0, 2, 3, 0, ...], det = -6 < 0.
    const REFLECTED = [0, 2, 3, 0, 10, 20];

    it('noScale preserves the reflection (det stays negative)', () => {
      // unit columns: (0, 1); (3/3, 0) = (1, 0) => [0, 1, 1, 0], det = -1.
      const out = world(REFLECTED, LOCAL, TRANSFORM_MODE_NO_SCALE);
      expect(out.slice(0, 4)).toEqual([0, 1, 1, 0]);
      expect(out[0]! * out[3]! - out[1]! * out[2]!).toBeLessThan(0);
    });

    it('noScaleOrReflection removes the reflection (Y rebuilt perpendicular to X, det positive)', () => {
      // det < 0 triggers the flip: ec = -eb = -1, ed = ea = 0 => [0, 1, -1, 0], det = +1.
      const out = world(REFLECTED, LOCAL, TRANSFORM_MODE_NO_SCALE_OR_REFLECTION);
      expect(out.slice(0, 4)).toEqual([0, 1, -1, 0]);
      expect(out[0]! * out[3]! - out[1]! * out[2]!).toBeGreaterThan(0);
    });

    it('the two modes differ exactly when the parent is reflected', () => {
      expect(world(REFLECTED, LOCAL, TRANSFORM_MODE_NO_SCALE)).not.toEqual(
        world(REFLECTED, LOCAL, TRANSFORM_MODE_NO_SCALE_OR_REFLECTION),
      );
    });
  });
});

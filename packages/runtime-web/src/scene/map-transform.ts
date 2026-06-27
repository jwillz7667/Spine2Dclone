import type { Mat2x3 } from '@marionette/runtime-core';

// A 2x3 world matrix decomposed into the transform channels a PixiJS display object recomposes from:
// position, rotation (radians), per-axis scale, and skew. This mirrors PixiJS's own matrix
// decomposition (Matrix.decompose / Container.setFromMatrix) so that assigning these channels to a
// Container reproduces the source world matrix exactly. The module imports no PixiJS, so the mapping
// is unit-testable in CI without a WebGL context (phase-0-foundations.md WP-0.5, TASK-0.5.1).
export interface DisplayTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number; // radians
  readonly scaleX: number;
  readonly scaleY: number;
  readonly skewX: number;
  readonly skewY: number;
}

// When the two recovered skew angles cancel (or differ by a full turn) the matrix is a pure rotation
// plus axis scale, so we collapse to a single rotation; otherwise the matrix shears and we keep the
// skew pair with zero rotation. The threshold matches PixiJS's own decomposition tolerance.
const SKEW_EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;

// Decompose [a, b, c, d, tx, ty] (the runtime-core world layout, column-vector form per
// conformance-and-ci.md appendix A.3) into Pixi transform channels. Scale is recovered as the column
// norms, so it is always non-negative; reflection and shear are carried by the skew pair, exactly as
// PixiJS does, which is what makes a decompose-then-recompose round-trip bit-faithful.
export function mapWorldToDisplay(world: Mat2x3): DisplayTransform {
  const [a, b, c, d, tx, ty] = world;

  const skewX = -Math.atan2(-c, d);
  const skewY = Math.atan2(b, a);

  const delta = Math.abs(skewX + skewY);
  const isPureRotation = delta < SKEW_EPSILON || Math.abs(TWO_PI - delta) < SKEW_EPSILON;

  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);

  if (isPureRotation) {
    return { x: tx, y: ty, rotation: skewY, scaleX, scaleY, skewX: 0, skewY: 0 };
  }
  return { x: tx, y: ty, rotation: 0, scaleX, scaleY, skewX, skewY };
}

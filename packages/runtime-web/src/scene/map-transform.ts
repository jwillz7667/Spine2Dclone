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

// The minimal structural shape of a display object this module can drive: position / scale / skew
// points with a set(x, y) method and a settable rotation. A PixiJS Container (and therefore Sprite
// and Graphics) satisfies it, but the interface names no PixiJS type, so this stays Pixi-free and
// unit-testable without a WebGL context, exactly like mapWorldToDisplay (TASK-0.5.1 invariant).
export interface DisplayTarget {
  readonly position: { set(x: number, y: number): void };
  readonly scale: { set(x: number, y: number): void };
  readonly skew: { set(x: number, y: number): void };
  rotation: number;
}

// When the two recovered skew angles cancel (or differ by a full turn) the matrix is a pure rotation
// plus axis scale, so we collapse to a single rotation; otherwise the matrix shears and we keep the
// skew pair with zero rotation. The threshold matches PixiJS's own decomposition tolerance.
const SKEW_EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;

// Decompose the world matrix [a, b, c, d, tx, ty] (the runtime-core world layout, column-vector form
// per conformance-and-ci.md appendix A.3) into Pixi transform channels and assign them DIRECTLY onto a
// display target, allocating nothing. This is the per-frame render path: the player decomposes a
// solved world matrix straight onto a pooled sprite or bone graphic without an intermediate object.
// Scale is recovered as the column norms (always non-negative); reflection and shear are carried by
// the skew pair, exactly as PixiJS does, which is what makes a decompose-then-recompose round-trip
// bit-faithful. This is the SINGLE decomposition implementation; mapWorldToDisplay delegates to it, so
// what the renderer assigns to a sprite is, by construction, what tooling/tests read back.
export function applyWorldToTarget(
  target: DisplayTarget,
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
): void {
  const skewX = -Math.atan2(-c, d);
  const skewY = Math.atan2(b, a);

  const delta = Math.abs(skewX + skewY);
  const isPureRotation = delta < SKEW_EPSILON || Math.abs(TWO_PI - delta) < SKEW_EPSILON;

  target.position.set(tx, ty);
  target.scale.set(Math.hypot(a, b), Math.hypot(c, d));
  if (isPureRotation) {
    target.rotation = skewY;
    target.skew.set(0, 0);
  } else {
    target.rotation = 0;
    target.skew.set(skewX, skewY);
  }
}

// Pure-functional view of applyWorldToTarget for tooling and tests (scene description, the curve
// preview, conformance assertions). It allocates the returned record plus a capture adapter, so it is
// NOT the per-frame path; the renderer calls applyWorldToTarget. Routing both through one decomposition
// guarantees they cannot drift.
export function mapWorldToDisplay(world: Mat2x3): DisplayTransform {
  const out = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };
  const capture: DisplayTarget = {
    position: {
      set: (x: number, y: number): void => {
        out.x = x;
        out.y = y;
      },
    },
    scale: {
      set: (x: number, y: number): void => {
        out.scaleX = x;
        out.scaleY = y;
      },
    },
    skew: {
      set: (x: number, y: number): void => {
        out.skewX = x;
        out.skewY = y;
      },
    },
    get rotation(): number {
      return out.rotation;
    },
    set rotation(r: number) {
      out.rotation = r;
    },
  };
  applyWorldToTarget(capture, world[0], world[1], world[2], world[3], world[4], world[5]);
  return out;
}

import {
  decompose,
  invert,
  multiply,
  type DecomposedTransform,
  type Mat2x3,
} from '@marionette/runtime-core';

// Group-transform math for a multi-bone gizmo gesture (PP-D1): build a pivot-centered WORLD transform for
// the gesture (rotation or anisotropic scale about the primary selection's pivot) and reproject each
// non-primary bone's LOCAL transform so it orbits/scales about that pivot. Pure Mat2x3 math over
// runtime-core, so it is unit-tested without a renderer or a document. World composition here matches the
// solve: world = parent.world * local, and multiply(a, b) applies b first then a.

// A world rotation of `angleRad` about the pivot point. In the [a,b,c,d,tx,ty] layout with the editor's
// Y-down world, [cos, sin, -sin, cos] rotates +x toward +y (clockwise on screen), matching the gizmo's
// accumulated drag angle.
export function rotationAboutPivot(pivotX: number, pivotY: number, angleRad: number): Mat2x3 {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return aboutPivot(pivotX, pivotY, [cos, sin, -sin, cos, 0, 0]);
}

// A world scale about the pivot along axes rotated by `axisAngleRad` (the primary bone's world x-axis
// angle), with per-axis factors fx, fy. This is R(axis) * diag(fx, fy) * R(-axis) conjugated to the
// pivot, so a uniform (fx == fy) scale is orientation-independent and a per-axis scale acts along the
// primary's local axes exactly like the single-bone scale handle.
export function scaleAboutPivot(
  pivotX: number,
  pivotY: number,
  axisAngleRad: number,
  fx: number,
  fy: number,
): Mat2x3 {
  const cos = Math.cos(axisAngleRad);
  const sin = Math.sin(axisAngleRad);
  const rot: Mat2x3 = [cos, sin, -sin, cos, 0, 0];
  const rotInv: Mat2x3 = [cos, -sin, sin, cos, 0, 0];
  const scale: Mat2x3 = [fx, 0, 0, fy, 0, 0];
  return aboutPivot(pivotX, pivotY, multiply(multiply(rot, scale), rotInv));
}

// Conjugate a linear world transform `m` by a translation to the pivot: T(pivot) * m * T(-pivot).
function aboutPivot(pivotX: number, pivotY: number, m: Mat2x3): Mat2x3 {
  const toPivot: Mat2x3 = [1, 0, 0, 1, pivotX, pivotY];
  const fromPivot: Mat2x3 = [1, 0, 0, 1, -pivotX, -pivotY];
  return multiply(multiply(toPivot, m), fromPivot);
}

// The bone's new LOCAL transform after applying the pivot-centered world transform to its current world,
// re-expressed under its (unchanged) parent world. Because decompose/compose reproduce the matrix exactly,
// setting the bone's local fields to this reproduces `pivotWorld * oldWorld` as its world, so the orbit is
// world-exact regardless of the shear convention decompose uses.
export function reprojectLocal(
  pivotWorld: Mat2x3,
  oldWorld: Mat2x3,
  parentWorld: Mat2x3,
): DecomposedTransform {
  const newWorld = multiply(pivotWorld, oldWorld);
  return decompose(multiply(invert(parentWorld), newWorld));
}

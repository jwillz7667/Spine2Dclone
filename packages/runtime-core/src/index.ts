// Public barrel for @marionette/runtime-core: the platform-agnostic solve core (handoff section 6).
// NO PixiJS, NO DOM, NO Zod; it imports @marionette/format TYPES only, so the solve logic ports
// unchanged to C#/Godot. Phase-0 scope: the 2x3 affine library and the world-transform pass (solve
// steps 1 and 4). Phase-1 (WP-1.4) adds animation sampling: timeline lookup, per-CurveType curve
// evaluation, and the locked solve order (steps 1 to 4) into a caller-owned pose buffer. Steps 5 and
// 6 (skinning/deform, render) stay out of core.

export type { Mat2x3, DecomposedTransform } from './math/affine';
export {
  MAT2X3_STRIDE,
  identity,
  multiply,
  compose,
  decompose,
  transformPoint,
  invert,
  getRotationDeg,
  getTranslation,
} from './math/affine';

export type { Pose } from './skeleton/pose';
export { SETUP_STRIDE, SLOT_COLOR_STRIDE } from './skeleton/pose';
export { buildPose } from './skeleton/build-pose';
export { resetToSetupPose, computeWorldTransforms } from './skeleton/world-transform';
export { sampleSkeleton, AnimationNotFoundError } from './skeleton/sample';
export { BEZIER_SEGMENTS } from './skeleton/curve';

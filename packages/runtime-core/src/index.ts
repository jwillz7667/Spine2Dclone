// Public barrel for @marionette/runtime-core: the platform-agnostic solve core (handoff section 6).
// Phase-0 scope (phase-0-foundations.md WP-0.4): the 2x3 affine library and the world-transform pass
// (solve steps 1 and 4 only, reset and world transforms). NO PixiJS, NO DOM, NO Zod; it imports
// @marionette/format TYPES only, so the solve logic ports unchanged to C#/Godot. Steps 2, 3, 5, 6
// (timelines, constraints, skinning, blend) arrive in Phase 1 and later.

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
export { SETUP_STRIDE } from './skeleton/pose';
export { buildPose } from './skeleton/build-pose';
export { resetToSetupPose, computeWorldTransforms } from './skeleton/world-transform';

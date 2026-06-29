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

export type {
  Pose,
  ResolvedIkConstraint,
  ResolvedTransformConstraint,
  DeformScratch,
} from './skeleton/pose';
export { SETUP_STRIDE, SLOT_COLOR_STRIDE } from './skeleton/pose';
export { buildPose } from './skeleton/build-pose';
export { resetToSetupPose, computeWorldTransforms } from './skeleton/world-transform';
export { sampleSkeleton, AnimationNotFoundError } from './skeleton/sample';
// Mesh-vertex sampling (solve-order step 5): skin + deform a mesh attachment into world space, reusing
// a pose already solved by sampleSkeleton. The behavioral source of truth the conformance harness and
// runtime-web mesh rendering build on.
export { sampleMeshVertices, skinMeshInto, MeshAttachmentError } from './skeleton/mesh-sample';
export type { MeshAttachmentErrorReason } from './skeleton/mesh-sample';
// The bezier easing sampler is the single shared function (R1.2, LAW 4): the editor curve-editor
// preview samples through these exact functions so what the animator sees equals what sampleSkeleton
// plays. BEZIER_SEGMENTS pins the parameterization; buildBezierTable/evalBezierY are the eval.
export { BEZIER_SEGMENTS, buildBezierTable, evalBezierY } from './skeleton/curve';

// Phase-2 pure solve primitives (ADR-0003): on-demand world resolution, the canonical affine world-
// channel decompose/recompose, one/two-bone IK, the transform constraint, skinning, and deform. These
// are standalone math (not yet wired into the per-frame sample order); the behavioral source of truth
// that Unity/Godot mirror and the conformance fixtures lock.
export type { WorldChannels } from './solve';
export {
  decomposeWorld,
  composeWorld,
  resolveWorld,
  resolveWorldMat,
  solveIkOneBone,
  solveIkTwoBone,
  solveTransformConstraint,
  solveSkin,
  solveSkinUnweighted,
  applyDeform,
} from './solve';
export type { TransformMix, TransformOffset } from './solve';

// Phase-3 effects solve primitives (phase-3-vfx-particles.md section 8.3, WP-3.1): the normative
// seeded integer PRNG and the per-particle draw-order helper. PixiJS-free and math-bridge-free; the
// cross-runtime determinism anchor (the PRNG golden vector locks the integer stream). The emitter
// solve, sprite/ribbon solve, and EffectSystem land in WP-3.2 to WP-3.4 on top of these.
export { makePrng, nextU32, nextUnit, drawRange, hash32 } from './effects';
export type { PrngState } from './effects';
export { makeSpawnState, drawParticleInitialState, spawnDrawCount } from './effects';
export type { SpawnDrawInputs, SpawnState } from './effects';

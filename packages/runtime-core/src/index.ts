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

// Phase-3 effects solve (phase-3-vfx-particles.md section 8, WP-3.1 to 3.4): the normative seeded
// integer PRNG and per-particle draw order (3.1), the SoA particle pool + over-life curve eval and the
// fixed-dt emitter solve (3.2), the sprite-animator + ribbon-trail solve (3.3), and the EffectSystem +
// by-name trigger API + anchor model + bundles (3.4). PixiJS-free and math-bridge-free: the behavioral
// source of truth runtime-web renders and Unity/Godot reimplement. The PRNG golden vector and the
// integer step schedule lock the cross-runtime determinism (counts, spawnOrder, frame, alive are
// integer-EXACT; positions/colors are on the float epsilon path).
export { makePrng, nextU32, nextUnit, drawRange, hash32 } from './effects';
export type { PrngState } from './effects';
export { makeSpawnState, drawParticleInitialState, spawnDrawCount } from './effects';
export type { SpawnDrawInputs, SpawnState } from './effects';
export {
  makeParticlePool,
  makeParticlePoolState,
  resetParticlePool,
  acquireSlot,
  releaseSlot,
  makeTrailRing,
  resetTrailRing,
  pushTrailPoint,
  makeTrailRings,
  makeSpawnScratch,
} from './effects';
export type { ParticlePool, ParticlePoolState, TrailRing } from './effects';
export {
  prepareLifeCurveNumber,
  prepareLifeCurveRgb,
  evalLifeCurveNumber,
  evalLifeCurveRgbInto,
} from './effects';
export type { PreparedLifeCurveNumber, PreparedLifeCurveRgb } from './effects';
export {
  prepareEmitter,
  makeEmitterInstance,
  stepEmitterOnce,
  isEmitterDone,
  DEG_TO_RAD,
} from './effects';
export type { PreparedEmitter, EmitterInstance } from './effects';
export {
  prepareSpriteAnimator,
  makeSpriteAnimatorState,
  stepSpriteAnimatorOnce,
  isSpriteAnimatorDone,
  screenCoverTransformInto,
} from './effects';
export type { PreparedSpriteAnimator, SpriteAnimatorState } from './effects';
export { prepareRibbon, makeRibbonInstance, recordRibbonPoint, buildRibbonStrip } from './effects';
export type { PreparedRibbon, RibbonInstance } from './effects';
export { resolveAnchor, expandBundle } from './effects';
export type { EffectAnchor, BoneAnchorResolver, ExpandedBundleItem } from './effects';
export {
  EffectSystem,
  EffectNotFoundError,
  BundleNotFoundError,
  DEFAULT_MAX_LIVE_PARTICLES,
} from './effects';
export type {
  EffectInstanceId,
  EffectTrigger,
  QualityTier,
  SystemOptions,
  BudgetWarning,
  ReadonlyEffectFrame,
  ReadonlyInstanceFrame,
  ReadonlyEmitterView,
  ReadonlySpriteView,
  ReadonlyRibbonView,
} from './effects';

// Phase-4 slot sequencer (phase-4 section 5.4, WP-4.7): the deterministic presentation core. The pinned
// integer/fixed-point counter-rollup evaluation (the cross-runtime determinism surface, section 5.4.2)
// lands first; the full (SpinResult, SlotScene) -> PresentationTimeline sequencer grows the slot barrel.
export { rollupValueAt, CURVE_TYPES } from './slot';
export type { CurveType } from './slot';

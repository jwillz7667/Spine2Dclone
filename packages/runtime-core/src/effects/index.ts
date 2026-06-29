// Barrel for the platform-agnostic effects solve (phase-3-vfx-particles.md section 8, WP-3.1 to 3.4).
// PixiJS-free, math-bridge-free: the contract-first behavioral source of truth runtime-web renders and
// Unity/Godot reimplement. Layered: the seeded PRNG + per-particle draw order (3.1), the SoA pool and
// over-life curve eval, the emitter solve (3.2), the sprite-animator + ribbon solve (3.3), and the
// EffectSystem + trigger API + anchors + bundles (3.4).

// WP-3.1: seeded integer PRNG and the normative per-particle draw order.
export { makePrng, nextU32, nextUnit, drawRange, hash32 } from './prng';
export type { PrngState } from './prng';
export { makeSpawnState, drawParticleInitialState, spawnDrawCount } from './draw-order';
export type { SpawnDrawInputs, SpawnState } from './draw-order';

// WP-3.2: SoA particle pool (section 8.2), over-life curve eval (section 8.5), and the emitter solve
// (sections 8.2, 8.4). The pool/curve primitives are exported so conformance probes and the designer
// preview can drive them directly (the curve eval shares the skeletal BEZIER_SEGMENTS sampler).
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
} from './pool';
export type { ParticlePool, ParticlePoolState, TrailRing } from './pool';
export {
  prepareLifeCurveNumber,
  prepareLifeCurveRgb,
  evalLifeCurveNumber,
  evalLifeCurveRgbInto,
  BEZIER_SEGMENTS,
} from './life-curve';
export type { PreparedLifeCurveNumber, PreparedLifeCurveRgb } from './life-curve';
export {
  prepareEmitter,
  makeEmitterInstance,
  stepEmitterOnce,
  isEmitterDone,
  DEG_TO_RAD,
} from './emitter-solve';
export type { PreparedEmitter, EmitterInstance } from './emitter-solve';

// WP-3.3: sprite-animator and ribbon-trail solve (section 8.6).
export {
  prepareSpriteAnimator,
  makeSpriteAnimatorState,
  stepSpriteAnimatorOnce,
  isSpriteAnimatorDone,
  screenCoverTransformInto,
} from './sprite-animator-solve';
export type { PreparedSpriteAnimator, SpriteAnimatorState } from './sprite-animator-solve';
export {
  prepareRibbon,
  makeRibbonInstance,
  recordRibbonPoint,
  buildRibbonStrip,
} from './ribbon-solve';
export type { PreparedRibbon, RibbonInstance } from './ribbon-solve';

// WP-3.4: EffectSystem + trigger API + anchor model + bundles (sections 8.7, 8.8).
export { resolveAnchor } from './anchor';
export type { EffectAnchor, BoneAnchorResolver } from './anchor';
export { expandBundle } from './bundle';
export type { ExpandedBundleItem } from './bundle';
export {
  EffectSystem,
  EffectNotFoundError,
  BundleNotFoundError,
  DEFAULT_MAX_LIVE_PARTICLES,
} from './system';
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
} from './system';

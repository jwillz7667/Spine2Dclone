// Public barrel for @marionette/conformance (conformance-and-ci.md A.1). The package is the
// cross-runtime behavioral-truth check: committed reference rigs, one sample-spec per rig, the
// expected-output fixtures generated from runtime-core, the single tolerance policy, and the compare
// engine. Consumers import only from this barrel. Phase 1 lands the rig-2bone bone-sampling contract;
// the runtime-web playback harness (B.2 / WP-V.4) and the remaining ten rigs (A.2) land later (see
// README). NO PixiJS, NO document-core, NO renderer (enforced by the boundaries lint).

// Reference-rig registry + landed-rig gating (A.2, B.2).
export { RIG_IDS, RIG_PHASE, CONFORMANCE_PHASE, LANDED_RIG_IDS } from './registry';
export type { RigId } from './registry';

// Effect-conformance rig registry + landed-effect gating (phase-3-vfx-particles.md WP-3.10). A parallel
// track to the skeleton rigs; capturing solved PARTICLE state, never bone affines.
export { EFFECT_IDS, EFFECT_PHASE, EFFECT_CONFORMANCE_PHASE, LANDED_EFFECT_IDS } from './registry';
export type { EffectId } from './registry';

// Schemas + typed boundary validators (A.3, A.4, Law 3).
export { validateRig } from './schema/rig';
export { validateFixture, FixtureValidationError, fixtureSchema } from './schema/fixture';
export type { Fixture, FixtureSample, Affine } from './schema/fixture';
export {
  validateSampleSpec,
  SampleSpecValidationError,
  sampleSpecSchema,
} from './schema/sample-spec';
export type { SampleSpec } from './schema/sample-spec';

// Effects (particle) schemas + typed boundary validators (phase-3-vfx-particles.md section 8.9, Law 3).
export { validateEffectsRig } from './schema/effects-rig';
export {
  validateEffectsFixture,
  EffectsFixtureValidationError,
  effectsFixtureSchema,
} from './schema/effects-fixture';
export type {
  EffectsFixture,
  EffectsSample,
  EmitterState,
  SpriteState,
  RibbonState,
  ParticleRow,
  RibbonVertex,
} from './schema/effects-fixture';
export {
  validateEffectsSampleSpec,
  EffectsSampleSpecValidationError,
  effectsSampleSpecSchema,
} from './schema/effects-sample-spec';
export type { EffectsSampleSpec } from './schema/effects-sample-spec';

// The single tolerance source (A.5) and the parity comparison engine (B.5).
export {
  WORLD_TRANSLATION,
  WORLD_BASIS,
  COLOR,
  EVENT_FLOAT,
  PARTICLE,
  PARTICLE_COLOR,
  withinTolerance,
} from './compare/tolerance';
export type { Tolerance } from './compare/tolerance';
export { compareFixtures, compareAffine } from './compare/compare';
export type { DriftReport, DriftFailure, QuantityClass } from './compare/compare';

// The particle parity comparison engine (phase-3-vfx-particles.md section 8.9, WP-3.10): integer lanes
// EXACT, float lanes within the PARTICLE / PARTICLE_COLOR tolerance.
export { compareEffectsFixtures } from './compare/compare-effects';
export type {
  EffectsDriftReport,
  EffectsDriftFailure,
  EffectsQuantityClass,
} from './compare/compare-effects';

// The pure fixture builder (A.6, INV-2): runtime-core + format types only, no I/O.
export { buildFixture, buildFixtureSamples } from './build-fixture';
export type { FixtureProvenance } from './build-fixture';

// The pure particle fixture builder (phase-3-vfx-particles.md WP-3.10, INV-2): runtime-core effects
// solve + format effects types only, no I/O, no random beyond the seeded PRNG.
export { buildEffectsFixture, buildEffectsSamples, selectEffect } from './build-effects-fixture';
export type { EffectsFixtureProvenance } from './build-effects-fixture';

// Filesystem-backed loaders for the committed corpus (the rig loader / fixture loader of A.1).
export {
  loadRig,
  loadSampleSpec,
  loadFixture,
  rigPath,
  specPath,
  fixturePath,
  LOCK_PATH,
  loadEffectsRig,
  loadEffectsSampleSpec,
  loadEffectsFixture,
  effectsRigPath,
  effectsSpecPath,
  effectsFixturePath,
  EFFECTS_LOCK_PATH,
  loadPerfBaseline,
  PERF_BASELINE_PATH,
} from './io';
export type { PerfBaseline } from './io';

// Internal barrel for the effects-format Zod schema source of truth (phase-3-vfx-particles.md
// section 8.1). Not part of the public package surface; consumers import effects types from
// `@marionette/format/effects-types` and the effects validator from `@marionette/format/effects`.
export { rangeFSchema, vec2Schema, rgbSchema } from './primitives';
export { lifeCurveNumberSchema, lifeCurveRgbSchema } from './life-curve';
export {
  spawnConfigSchema,
  emitterShapeSchema,
  particleTextureSchema,
  trailSpecSchema,
  emitterLayerSchema,
  spriteAnimatorLayerSchema,
  ribbonTrailLayerSchema,
  effectLayerSchema,
} from './layers';
export { effectConfigSchema } from './effect';
export { bundleItemSchema, effectBundleSchema } from './bundle';
export { effectsDocumentSchema } from './document';
export { projectMemberSchema, projectManifestSchema } from './manifest';

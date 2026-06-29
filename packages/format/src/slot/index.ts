// Public value barrel for the slot authoring format (format-contract section 15, phase-4 WP-4.4).
// Available at `@marionette/format/slot`. CD-1 relocates `SymbolId` and the authored slot-scene
// sub-schemas into `packages/format`; this barrel is their one import surface. WP-4.1 carried only
// `SymbolId` (the brand `math-bridge` needs); WP-4.4 (plus the WP-4.5 grid and WP-4.6 symbol schemas)
// grows it with the `SlotSceneDocument` envelope, the `SlotScene` aggregate, the sub-schemas, the
// validator, the slot content hash, and the slot project manifest validator.

export { symbolIdSchema, symbolId } from './symbol-id';

// Sub-schemas (Zod). The grid is owned by WP-4.5; symbol-anim-set by WP-4.6; the other three are
// minimal-but-valid here and grow in WP-4.8/4.9/4.10.
export {
  gridConfigSchema,
  anticipationConfigSchema,
  gridTopologySchema,
  gravityRuleSchema,
} from './grid-config';
export { symbolAnimSetSchema } from './symbol-anim-set';
export {
  winSequenceConfigSchema,
  winSequenceSchema,
  winSequenceStepSchema,
  winStepActionSchema,
  winTargetRuleSchema,
  escalationThresholdsSchema,
  escalationTierSchema,
} from './win-sequence-config';
export {
  featureFlowGraphSchema,
  featureFlowNodeSchema,
  featureFlowTransitionSchema,
  featureFlowCinematicSchema,
} from './feature-flow-graph';
export { tumbleChoreographySchema, rollupCurveSchema } from './tumble-choreography';

// The aggregate, the envelope, and SceneRefs (Zod).
export {
  slotSceneSchema,
  slotSceneDocumentSchema,
  sceneRefsSchema,
  sceneRefEntrySchema,
} from './scene-document';

// The slot project manifest (Zod).
export { slotProjectManifestSchema, slotProjectMemberSchema } from './manifest';

// The validator, the throwing wrapper, and the typed-error surface.
export { validateSlotScene, parseSlotSceneDocument } from './validate';
export type { ValidateSlotSceneOptions } from './validate';
export { validateSlotProjectManifest, parseSlotProjectManifest } from './validate/manifest';
export type { ResolvedMemberHashes } from './validate/manifest';
export {
  SlotSceneValidationError,
  SLOT_SCENE_ERROR_CODES,
  SLOT_SCENE_WARNING_CODES,
} from './validate/errors';
export type {
  SlotSceneError,
  SlotSceneErrorCode,
  SlotSceneWarning,
  SlotSceneWarningCode,
  SlotSceneValidationReport,
  SlotManifestValidationReport,
} from './validate/errors';
export type { SceneResolver, ResolvedSkeleton, ResolvedVfxPreset } from './validate/resolver';

// The slot content hash (reuses the one canonicalizer; format-contract section 15.5).
export { computeSlotSceneHash, verifySlotSceneContentHash } from './hash/hash';

// The slot scene format version constant (independent of the skeletal and effects version lines).
export { SLOT_SCENE_FORMAT_VERSION } from '../version/constants';

// The type-only contract surface (zero runtime); also available directly at
// @marionette/format/slot-types.
export type * from './types';

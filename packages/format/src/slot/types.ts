// Type-only contract surface for the slot authoring format (zero runtime), mirroring
// `@marionette/format/types` and `@marionette/format/effects-types`. Available at
// `@marionette/format/slot-types`. CD-1: `SymbolId` and the authored slot-scene types live in `format`
// so `math-bridge` can import the types without pulling in any validator runtime. Every export here is
// a pure `export type` re-export of a `z.infer` derived type (or a hand-written interface), so the
// compiled types.js is side-effect-free and never pulls Zod into a type-only consumer.
export type { SymbolId } from './symbol-id';

// Grid (WP-4.5) and symbol library (WP-4.6).
export type { GridConfig, AnticipationConfig, GridTopology, GravityRule } from './grid-config';
export type { SymbolAnimSet } from './symbol-anim-set';

// Minimal-but-valid sub-schemas that grow in WP-4.8/4.9/4.10.
export type { WinSequenceConfig, WinSequence, WinSequenceStep } from './win-sequence-config';
export type {
  FeatureFlowGraph,
  FeatureFlowNode,
  FeatureFlowTransition,
  FeatureFlowCinematic,
} from './feature-flow-graph';
export type { TumbleChoreography, RollupCurve } from './tumble-choreography';

// The aggregate, the envelope, and the references.
export type { SlotScene, SlotSceneDocument, SceneRefs, SceneRefEntry } from './scene-document';

// The slot project manifest.
export type { SlotProjectManifest, SlotProjectMember } from './manifest';

// The validator's typed-error surface and the injected resolver interface.
export type {
  SlotSceneError,
  SlotSceneErrorCode,
  SlotSceneWarning,
  SlotSceneWarningCode,
  SlotSceneValidationReport,
  SlotManifestValidationReport,
} from './validate/errors';
export type { SceneResolver, ResolvedSkeleton, ResolvedVfxPreset } from './validate/resolver';

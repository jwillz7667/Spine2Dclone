// Type-only public surface for @marionette/format (zero runtime). Imported by runtime-core via
// `import type { ... } from "@marionette/format/types"`. Every export below is a pure `export type`
// re-export of a `z.infer` derived type, so with verbatimModuleSyntax the compiled types.js is
// side-effect-free and never pulls Zod into a type-only consumer (format-contract section 1.3, 3).
export type { RGBA } from './schema/color';
export type { CurveType } from './schema/curve';
export type { Bone, TransformMode } from './schema/bone';
export type { Slot, BlendMode } from './schema/slot';
export type {
  Attachment,
  RegionAttachment,
  MeshAttachment,
  LinkedMeshAttachment,
  ClippingAttachment,
  PointAttachment,
  BoundingBoxAttachment,
  Sequence,
} from './schema/attachment';
export type { Skin } from './schema/skin';
export type { IkConstraint, TransformConstraint } from './schema/constraint';
export type {
  Animation,
  BoneTimelines,
  SlotTimelines,
  Keyframe,
  IkFrame,
  TransformFrame,
  DeformTimelines,
  DrawOrderOffset,
  DrawOrderKeyframe,
  EventKeyframe,
  SequenceMode,
  SequenceKeyframe,
} from './schema/animation';
export type { EventDef, EventAudio } from './schema/event';
export type { SkeletonMeta } from './schema/metadata';
export type { AtlasRef, AtlasPage, AtlasRegion } from './schema/atlas';
export type { SkeletonDocument } from './schema/document';

// The sibling effects format types (phase-3-vfx-particles.md section 8.1). Re-exported here so a
// type-only consumer (runtime-core) can reach them through the single `@marionette/format/types`
// entry point the boundary lint permits. They are also available at `@marionette/format/effects-types`.
export type {
  RangeF,
  Vec2,
  RGB,
  LifeCurve,
  LifeStop,
  LifeCurveNumber,
  LifeCurveRgb,
  SpawnConfig,
  EmitterShape,
  ParticleTexture,
  TrailSpec,
  EmitterLayer,
  SpriteAnimatorLayer,
  RibbonTrailLayer,
  EffectLayer,
  EffectConfig,
  BundleItem,
  EffectBundle,
  EffectsDocument,
  ProjectMember,
  ProjectManifest,
} from './effects/types';

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
  ClippingAttachment,
  PointAttachment,
  BoundingBoxAttachment,
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
} from './schema/animation';
export type { AtlasRef, AtlasPage, AtlasRegion } from './schema/atlas';
export type { SkeletonDocument } from './schema/document';

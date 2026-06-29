// The frozen shared primitive sub-contract (phase-3-vfx-particles.md section 8.1). Three primitives,
// `BlendMode`, `AtlasRef` (with `AtlasPage`/`AtlasRegion`), and `CurveType`, are depended on by BOTH
// `SkeletonDocument` and `EffectsDocument`; neither document owns them. This module is the canonical
// shared re-export point: it RE-EXPORTS the existing schemas and types from their current homes
// (schema/slot, schema/atlas, schema/curve) WITHOUT moving or rewriting them, so the SkeletonDocument
// byte shape is unchanged. The effects schemas import these primitives from here.
//
// Versioning rule of record (section 5.3, 8.1): a breaking change to any `common` primitive bumps
// `FORMAT_COMMON_VERSION` AND, in the same PR, both `CURRENT_FORMAT_VERSION` and
// `EFFECTS_FORMAT_VERSION`, with both validators and both fixture sets regenerated. A non-breaking
// addition to one document that does not touch `common` bumps only that document's version. This is
// the precise sense in which the two document version lines are independent.

export { blendModeSchema } from '../schema/slot';
export type { BlendMode } from '../schema/slot';
export { atlasRefSchema, atlasPageSchema, atlasRegionSchema } from '../schema/atlas';
export type { AtlasRef, AtlasPage, AtlasRegion } from '../schema/atlas';
export { curveSchema } from '../schema/curve';
export type { CurveType } from '../schema/curve';

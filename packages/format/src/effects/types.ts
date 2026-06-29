// Type-only public surface for the effects sibling format (zero runtime). Every export is a pure
// `export type` re-export of a `z.infer` derived type (or a hand-written generic), so with
// verbatimModuleSyntax the compiled types.js is side-effect-free and never pulls Zod into a type-only
// consumer (runtime-core imports `RangeF` from here via `@marionette/format/effects-types`).
export type { RangeF, Vec2, RGB } from './schema/primitives';
export type { LifeCurve, LifeStop, LifeCurveNumber, LifeCurveRgb } from './schema/life-curve';
export type {
  SpawnConfig,
  EmitterShape,
  ParticleTexture,
  TrailSpec,
  EmitterLayer,
  SpriteAnimatorLayer,
  RibbonTrailLayer,
  EffectLayer,
} from './schema/layers';
export type { EffectConfig } from './schema/effect';
export type { BundleItem, EffectBundle } from './schema/bundle';
export type { EffectsDocument } from './schema/document';
export type { ProjectMember, ProjectManifest } from './schema/manifest';

// The shared `common` primitives both documents depend on, re-exported here for convenience so an
// effects consumer can reach BlendMode / AtlasRef / CurveType from one entry point.
export type { BlendMode, AtlasRef, AtlasPage, AtlasRegion, CurveType } from '../common';

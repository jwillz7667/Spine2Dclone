// Public barrel for @marionette/runtime-web: PixiJS v8 playback that consumes runtime-core's solve
// output and renders it; also powers the editor viewport (phase-0-foundations.md WP-0.5, WP-1.10). It
// builds the setup-pose scene (tapered-diamond bones plus tinted region sprites) from a validated
// SkeletonDocument and PLAYS an animation by sampling runtime-core per frame into a reused pose
// (SkeletonView.syncAnimated). The setup and animated paths share one render-from-pose path and one
// region-placement math, so the editor viewport (which reuses this view) cannot drift from the player.
export { SkeletonView } from './scene/skeleton-view';
export type {
  BoneRender,
  AttachmentRender,
  MeshRender,
  SceneDescription,
} from './scene/skeleton-view';
export { mapWorldToDisplay, applyWorldToTarget } from './scene/map-transform';
export type { DisplayTransform, DisplayTarget } from './scene/map-transform';
export { computeRegionSized, placeRegion } from './scene/region-placement';
// Region atlas-texture resolution (handoff 8.9): the host builds a region -> Texture resolver and
// injects it via SkeletonView.setTextureResolver. buildRegionTextures slices region sub-textures from
// loaded atlas page textures; makeRegionTextureResolver wraps the resulting map. A region without a
// texture falls back to the 1x1 white placeholder, so placement is identical whether or not a texture
// is present (the texture only fills the quad the solve places).
export {
  buildRegionTextures,
  makeRegionTextureResolver,
  sliceRegion,
  RotatedRegionUnsupportedError,
} from './scene/region-textures';
export type { RegionTextureResolver } from './scene/region-textures';
// Phase 3 particle rendering (phase-3-vfx-particles.md WP-3.5): the single format-BlendMode -> PixiJS
// blend mapping shared by the slot renderer and the particle renderer (section 7.4, no second blend
// path), and the pure SoA -> render-instance bridge that turns an EffectSystem emitter view into the
// flat per-instance arrays a pooled ParticleContainer uploads (TASK-3.5.2, allocation-free after warmup).
export { blendModeToPixi } from './scene/blend-mode';
export { makeParticleRenderBatch, fillEmitterBatch } from './scene/particle-render-batch';
export type { ParticleRenderBatch } from './scene/particle-render-batch';
// Phase 5 atlas texture-variant selection (phase-5 WP-5.2, TASK-5.2.8): the NORMATIVE selector mapping the
// static GPU capability set to a compressed target (ASTC/BC7/ETC2) or the canonical PNG fallback, plus the
// pure WebGL extension-to-capability mapping. Shared by web/Unity/Godot (this is the web reference); reads
// only the static capability set, never frame rate (deterministic). The GPU transcode/decode is the GL edge.
export { selectTextureVariant, gpuCapabilitiesFromExtensions } from './atlas/variant-select';
export type {
  TextureVariant,
  CompressedTextureTarget,
  GpuCapabilities,
} from './atlas/variant-select';
// Phase 4 slot TimelinePlayer (phase-4 WP-4.11): the pure, allocation-free directive cursor + pinned
// counter-rollup display value (the non-GL heart of the player). The GL render path that consumes the
// dispatched directives needs a WebGL context and is the remainder of WP-4.11.
export {
  makeTimelineCursor,
  resetTimelineCursor,
  advanceTimelineTo,
  counterRollupDisplayValue,
  currentRollupValue,
} from './slot/timeline-cursor';
export type { TimelineCursor } from './slot/timeline-cursor';
export { loopTime } from './transport';
// Headless sampling harness (TASK-1.10.4): samples the SAME runtime-core path the player renders,
// with no GL/render context, so WP-1.13 can check editor-vs-runtime parity in plain Node/Vitest.
export { samplePlaybackWorlds } from './headless/sample-playback';
export type { SampledFrame } from './headless/sample-playback';

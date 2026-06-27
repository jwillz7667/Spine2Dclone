// Public barrel for @marionette/runtime-web: PixiJS v8 playback that consumes runtime-core's solve
// output and renders it; also powers the editor viewport (phase-0-foundations.md WP-0.5, WP-1.10). It
// builds the setup-pose scene (tapered-diamond bones plus tinted region sprites) from a validated
// SkeletonDocument and PLAYS an animation by sampling runtime-core per frame into a reused pose
// (SkeletonView.syncAnimated). The setup and animated paths share one render-from-pose path and one
// region-placement math, so the editor viewport (which reuses this view) cannot drift from the player.
export { SkeletonView } from './scene/skeleton-view';
export type { BoneRender, AttachmentRender, SceneDescription } from './scene/skeleton-view';
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
export { loopTime } from './transport';
// Headless sampling harness (TASK-1.10.4): samples the SAME runtime-core path the player renders,
// with no GL/render context, so WP-1.13 can check editor-vs-runtime parity in plain Node/Vitest.
export { samplePlaybackWorlds } from './headless/sample-playback';
export type { SampledFrame } from './headless/sample-playback';

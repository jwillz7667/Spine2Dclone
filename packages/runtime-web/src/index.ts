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
export { loopTime } from './transport';

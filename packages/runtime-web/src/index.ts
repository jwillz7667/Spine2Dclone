// Public barrel for @marionette/runtime-web: PixiJS v8 playback that consumes runtime-core's solve
// output and renders it; also powers the editor viewport (phase-0-foundations.md WP-0.5). Phase-0
// scope: build the setup-pose scene (tapered-diamond bones plus tinted region sprites) from a
// validated SkeletonDocument. No animation; the pose is solve steps 1 and 4 only.
export { SkeletonView } from './scene/skeleton-view';
export type { BoneRender, AttachmentRender, SceneDescription } from './scene/skeleton-view';
export { mapWorldToDisplay } from './scene/map-transform';
export type { DisplayTransform } from './scene/map-transform';

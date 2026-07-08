# @marionette/runtime-web

The TypeScript + PixiJS v8 playback runtime. It renders validated documents by driving
`@marionette/runtime-core` per frame, and it also powers the editor viewport (the editor imports
`SkeletonView` directly), so what you author is what ships: one render path, one placement math.

Dependencies: `@marionette/format`, `@marionette/runtime-core` (workspace), `pixi.js` pinned exact
at `8.19.0`.

## Rendering today

`SkeletonView` (`src/scene/skeleton-view.ts`) builds a PixiJS `Container` scene from a
`SkeletonDocument` and exposes:

- `sync(document)`: setup pose.
- `syncAnimated(document, animationId, time)` and `syncAnimatedLoop(document, animationId, elapsed)`:
  single-animation sampling.
- `syncState(document, animationState)`: multi-track playback through the runtime-core
  `AnimationState` (ADR-0005).
- `setTextureResolver(resolver)`: bind decoded atlas page textures; without a resolver, attachments
  render as tintable 1x1 white placeholders.

What renders: **bones** (tapered-diamond `Graphics`), **region attachments** (`Sprite`, anchor 0.5,
slot x attachment tint, world matrix applied via `applyWorldToTarget`), and **mesh attachments**
(`Mesh` + `MeshGeometry`; UVs and triangles built once, only the position buffer is rewritten in
place each frame from the skinned world-space vertices). Per-slot blend modes map through the
single shared `blendModeToPixi`.

## Known gaps (precise, current)

- **Particles are not GL-rendered yet.** The pure SoA-to-instance bridge exists
  (`src/scene/particle-render-batch.ts`); the GL upload (pooled sprites, the ribbon MeshRope, the
  screen-cover quad) is the non-headless remainder of WP-3.5.
- **Slot scenes are not GL-rendered yet.** The pure, allocation-free directive cursor exists
  (`src/slot/timeline-cursor.ts`, including the fixed-point rollup display value); the GL consumer
  is the remainder of WP-4.11.
- **Compressed-texture variants**: `selectTextureVariant` (`src/atlas/variant-select.ts`) is the
  normative pure selector (WP-5.2); the live GPU capability read and transcode is the WP-5.2.8
  remainder.
- **Only the `default` skin renders**; skin switching is a pending authoring surface.

Trim and rotation (closed): atlas trim offsets are applied to region-attachment placement
(`sizeForTexture` + `skeleton-view.ts`, reading the trim off `document.atlas`), so a trimmed region
renders where its untrimmed original would (PP-C1). Rotated regions slice with a swapped frame, logical
`orig`, and PixiJS `rotate=2` (`sliceRegion`), so both the sprite and mesh paths sample them turned-back
(PP-C2). Both mirror `@marionette/render-preview` exactly and are locked by placement-parity tests; the
GL PIXEL parity itself is the usual non-headless remainder.

## Headless parity

`samplePlaybackWorlds` (`src/headless/sample-playback.ts`) samples the same playback path with no
WebGL, which is how CI proves editor-vs-runtime parity (WP-1.13) and how the conformance suite
drives the web runtime in a headless container.

## Public surface (barrel highlights)

`SkeletonView`, scene types (`BoneRender`, `AttachmentRender`, `MeshRender`, `SceneDescription`),
transform mapping (`mapWorldToDisplay`, `applyWorldToTarget`), region placement
(`computeRegionSized`, `placeRegion`), region textures (`buildRegionTextures`,
`makeRegionTextureResolver`, `sliceRegion`), `blendModeToPixi`, the particle batch bridge
(`makeParticleRenderBatch`, `fillEmitterBatch`), texture variant selection
(`selectTextureVariant`, `gpuCapabilitiesFromExtensions`), the slot timeline cursor
(`makeTimelineCursor`, `advanceTimelineTo`, `counterRollupDisplayValue`), `loopTime`, and
`samplePlaybackWorlds`.

## Run

```sh
pnpm --filter @marionette/runtime-web typecheck
pnpm --filter @marionette/runtime-web test   # vitest, 15 test files (parity, mesh render, perf, no-alloc)
pnpm --filter @marionette/runtime-web build
```

Documents arrive validated; this package passes `verifyHash: false` (runtimes treat the content
hash as opaque).

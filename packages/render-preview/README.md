# @marionette/render-preview

A pure-TypeScript CPU rasterizer (ADR-0006) that renders one frame of a `SkeletonDocument`, a
particle effect, or both composed, to PNG bytes with no GPU, no PixiJS, and no DOM. It exists so a
headless authoring agent (the MCP `render_frame` tool) can SEE its work and iterate. It is a
preview renderer, not the shipped renderer: geometry is exact, shading is preview-quality.

Determinism: same document and inputs produce byte-identical PNG output on a given platform and
Node (no clock, no RNG, pinned scanline fill rule, pinned bilinear sampling, pinned PNG encoder
options: RGBA color type 6, `filterType: 0`, `deflateLevel: 9`, `deflateStrategy: 3`).

Geometry cannot drift from the real runtime because it is not re-implemented: bone worlds come from
`runtime-core`, mesh vertices from `skinMeshInto` / `sampleMeshVertices`, region corners from
`regionWorldCorners` (which mirrors runtime-web's placement math and is locked by a parity test),
and effect state from a real `EffectSystem` stepped at the effect's `simulationDt`.

## API

- `renderFrame({ document, animation?, time?, atlas, viewport, background?, validate? })` returns
  `{ png, width, height }` (`src/render-frame.ts`). Validates before solving by default.
- `renderEffectFrame(...)` and `renderComposedFrame(...)` (`src/render-effect-frame.ts`): trigger a
  named effect or bundle with an explicit seed, step deterministically from 0 to `time`, rasterize
  the read-only frame state; composed mode draws skeleton plus effect in one image.
- Rasterizer internals: `Framebuffer` with premultiplied-alpha float lanes and a pinned top-left
  triangle fill rule (`src/raster.ts`); blend modes normal/additive/multiply/screen; `encodePng`
  (`src/png.ts`).
- `renderSequence(options)` (`src/render-sequence.ts`, PP-C10): a streaming clip renderer. Samples a
  single animation (or an `AnimationState` via a factory, advanced 1/fps per frame) over a
  `from`/`to` range at a caller-chosen fps, with an optional composed effect overlay and a stable
  content-fit camera framed over the whole clip. Frames arrive through a generator or `forEach`
  callback backed by ONE reused RGBA scratch buffer, so consumers must encode or copy each frame
  before advancing (the bundled encoders do); a 10 second 60 fps clip never holds 600 PNGs.
- Media encoders (`src/encode/`, PP-C10, zero new dependencies): `encodeGif` (first-principles
  GIF89a: deterministic median-cut quantizer over a bounded 5-bit histogram, standard-timing
  variable-width LZW, transparency via a reserved index, fps-derived delays, infinite loop) and
  `encodeApng` (lossless truecolor+alpha acTL/fcTL/fdAT assembly over the pinned pngjs codec).
  Both are byte-locked by committed goldens; WebM/MP4 export is deliberately deferred to the
  editor-edge encoder (PP-D6).
- Typed errors: `InvalidViewportError`, `ZeroContentFitError`, `UnknownAnimationError`,
  `MalformedAtlasPageError`, `EffectTriggerError`, `InvalidFpsError`, `InvalidFrameRangeError`,
  `EmptySequenceError`. (`RotatedRegionUnsupportedError` was retired in PP-C2: rotated regions are
  now sampled turned-back, matching runtime-web.)

**In scope (v1):** region and mesh attachments, per-slot blend modes, slot x attachment tint and
alpha, bilinear sampling, particle/bundle/composed rendering. Atlas trim offsets (PP-C1) place a trimmed
region where its untrimmed original would sit; rotated atlas regions (PP-C2) are sampled in place. Both
mirror runtime-web exactly (`regionWorldCorners` + the trim/rotation samplers), locked by parity tests.
**Stage F2 (PP-C8):** the two-color dark tint (`two-color.ts`, the shared light+dark formula, with a
byte-golden and a math parity test against runtime-web), linked meshes (rendered as their resolved parent
geometry via `resolveRenderMesh`, with the linked mesh's own texture and color), and sequence attachments
(the resolved frame's atlas region is named by `sequenceRegionName` and sampled per frame).
**PP-C8 part 2 (clipping):** a `clipping` attachment clips the geometry of the slots in its draw-order range
to its world polygon, in both `renderFrame` and `renderSequence`. The clip STATE (world polygon + clipped
slot set) comes from runtime-core (`clipping.ts`); the clip GEOMETRY op is runtime-core's pooled
`clipTriangleList` (Sutherland-Hodgman with barycentrics), fan-triangulated and UV-re-interpolated in
`raster-clip.ts` through the same scanline fill, so tint/alpha/blend/dark compose with clipping unchanged.
**Out of scope (documented):** point/bounding-box attachments (non-drawing hit/anchor geometry), slot-scene
composition.

## Run

```sh
pnpm --filter @marionette/render-preview typecheck
pnpm --filter @marionette/render-preview test        # vitest, incl. byte-exact golden PNG gates
pnpm --filter @marionette/render-preview gen:golden  # regenerate golden PNGs (deliberate, reviewed)
pnpm --filter @marionette/render-preview build
```

Dependencies: `@marionette/format`, `@marionette/runtime-core` (workspace), `pngjs` (pure JS, for
reproducible bytes). Consumers: the MCP server's `render_frame` tool and the demo players.

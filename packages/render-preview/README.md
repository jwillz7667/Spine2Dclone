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
- Typed errors: `InvalidViewportError`, `ZeroContentFitError`, `UnknownAnimationError`,
  `RotatedRegionUnsupportedError`, `MalformedAtlasPageError`, `EffectTriggerError`.

**In scope (v1):** region and mesh attachments, per-slot blend modes, slot x attachment tint and
alpha, bilinear sampling, particle/bundle/composed rendering.
**Out of scope (documented):** clipping masks, tint-black, point/bounding-box attachments,
slot-scene composition.

## Run

```sh
pnpm --filter @marionette/render-preview typecheck
pnpm --filter @marionette/render-preview test        # vitest, incl. byte-exact golden PNG gates
pnpm --filter @marionette/render-preview gen:golden  # regenerate golden PNGs (deliberate, reviewed)
pnpm --filter @marionette/render-preview build
```

Dependencies: `@marionette/format`, `@marionette/runtime-core` (workspace), `pngjs` (pure JS, for
reproducible bytes). Consumers: the MCP server's `render_frame` tool and the demo players.

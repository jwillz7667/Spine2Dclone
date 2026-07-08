# @marionette/atlas-pack

The deterministic sprite-atlas packing pipeline (ADR-0007). It is pure library code with an
injected filesystem, so the same pipeline runs in the Electron editor main process and in the
headless MCP server. Background removal (rembg) is deliberately excluded; that is an editor-only
asset-prep concern (`apps/editor/src/main/atlas/rembg.ts`).

## Pipeline

`runAtlasPipeline({ sourceDir, outputDir, fileStore, config? })` (`src/pipeline.ts`) returns a
format `AtlasRef` and is the composition of four pure stages:

1. **Import** (`src/import-sprites.ts`): read and decode source PNGs through the `AtlasFileStore`
   abstraction with bounded concurrency (`MAX_IMPORT_CONCURRENCY = 8` via `mapWithConcurrency`).
2. **Trim** (`src/trim.ts`): alpha bounding-box trim, preserving original dimensions and offsets.
3. **Pack** (`src/pack.ts`): deterministic MaxRects packing (`maxrects-packer`). `PackConfig`:
   `maxPageSize` (default 2048, max 4096, fixed-size square pages), `padding` (default 2),
   `allowRotation` (default `false`, backward compatible: no region rotates). When `allowRotation` is
   `true`, a sprite may be stored turned 90 degrees clockwise into an `(h x w)` page rectangle to fit
   more per page; that region carries `rotated: true` and keeps its LOGICAL (unrotated) `w`/`h` and trim
   offsets. Both runtimes read the storage back (runtime-web via PixiJS `rotate=2`, render-preview via its
   `RegionSampler`), and the rotated-vs-unrotated pixel-parity test locks the convention. Results stay
   deterministic: the packer holds no clock or RNG and the fixed add order (trimmed area desc, then name
   asc) is authoritative.
4. **Emit** (`src/emit.ts`): one PNG per page (`MAX_EMIT_CONCURRENCY = 8`), encoded with pure-JS
   `pngjs` (never a native codec) so output bytes are identical across platforms.

The page/region model reuses `AtlasRef` / `AtlasPage` / `AtlasRegion` from
`@marionette/format/types`; region names derive from source file base names.

## Public surface

Functions `runAtlasPipeline`, `importSprites`, `trimSprite`, `packAtlas`, `emitAtlas`,
`decodePng`, `encodePng`, `decodedPagePixelHash`, `mapWithConcurrency`, `createNodeFileStore`;
class `AtlasError` with a 9-code `AtlasErrorCode` union (`ATLAS_INVALID_CONFIG`,
`ATLAS_SPRITE_TOO_LARGE`, `ATLAS_REGION_DUPLICATE`, `ATLAS_DIMENSION_MISMATCH`, `ATLAS_DECODE_FAILED`,
`ATLAS_ENCODE_FAILED`, plus three rembg codes raised only by the editor integration). `ATLAS_ROTATION_UNSUPPORTED`
was retired when rotation packing landed (PP-C2): `allowRotation: true` is now a supported opt-in, not an error. Test helpers (an in-memory file store and synthetic sprite
generators) live on the separate `./testing` subpath so they never ship in product import graphs.

## Run

```sh
pnpm --filter @marionette/atlas-pack typecheck
pnpm --filter @marionette/atlas-pack test       # vitest: concurrency, import, pack, pipeline, png, trim
pnpm --filter @marionette/atlas-pack build
```

Dependencies: `@marionette/format` (workspace), `maxrects-packer`, `pngjs`.

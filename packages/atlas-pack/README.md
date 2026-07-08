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
   `allowRotation` must stay `false` (rotation throws `ATLAS_ROTATION_UNSUPPORTED`; the runtimes do
   not consume rotated regions).
4. **Emit** (`src/emit.ts`): one PNG per page (`MAX_EMIT_CONCURRENCY = 8`), encoded with pure-JS
   `pngjs` (never a native codec) so output bytes are identical across platforms.

The page/region model reuses `AtlasRef` / `AtlasPage` / `AtlasRegion` from
`@marionette/format/types`; region names derive from source file base names.

## Public surface

Functions `runAtlasPipeline`, `importSprites`, `trimSprite`, `packAtlas`, `emitAtlas`,
`decodePng`, `encodePng`, `decodedPagePixelHash`, `mapWithConcurrency`, `createNodeFileStore`;
class `AtlasError` with a 10-code `AtlasErrorCode` union (`ATLAS_INVALID_CONFIG`,
`ATLAS_ROTATION_UNSUPPORTED`, `ATLAS_SPRITE_TOO_LARGE`, `ATLAS_REGION_DUPLICATE`,
`ATLAS_DIMENSION_MISMATCH`, `ATLAS_DECODE_FAILED`, `ATLAS_ENCODE_FAILED`, plus three rembg codes
raised only by the editor integration). Test helpers (an in-memory file store and synthetic sprite
generators) live on the separate `./testing` subpath so they never ship in product import graphs.

## Run

```sh
pnpm --filter @marionette/atlas-pack typecheck
pnpm --filter @marionette/atlas-pack test       # vitest: concurrency, import, pack, pipeline, png, trim
pnpm --filter @marionette/atlas-pack build
```

Dependencies: `@marionette/format` (workspace), `maxrects-packer`, `pngjs`.

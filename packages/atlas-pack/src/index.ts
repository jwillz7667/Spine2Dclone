// Public surface of the deterministic atlas-pack pipeline (ADR-0007). The pipeline (import -> alpha-trim
// -> maxrects pack -> emit) is pure and shells out to nothing, so both the editor main process and the
// headless MCP server can pack. Two consumers, one seamed package. Background removal (rembg) is NOT here:
// it is editor-only, env-gated asset prep the pack path never calls, and stays in apps/editor.
//
// The in-memory AtlasFileStore and the synthetic sprite/PNG generators are test/dev support and are
// exposed only from the '@marionette/atlas-pack/testing' subpath, never this production barrel.

export { AtlasError, isAtlasError } from './errors';
export type { AtlasErrorCode } from './errors';

export { createNodeFileStore } from './file-store';
export type { AtlasFileStore } from './file-store';

export { mapWithConcurrency } from './concurrency';

export { decodePng, encodePng, decodedPagePixelHash } from './png';
export type { DecodedImage } from './png';

export { trimSprite } from './trim';
export type { TrimResult } from './trim';

export { packAtlas } from './pack';
export type { PackConfig, TrimmedSprite, PackResult, PageBitmap } from './pack';

export { importSprites, MAX_IMPORT_CONCURRENCY } from './import-sprites';
export type { ImportedSprite } from './import-sprites';

export { emitAtlas, MAX_EMIT_CONCURRENCY } from './emit';

export { runAtlasPipeline } from './pipeline';
export type { RunAtlasPipelineParams } from './pipeline';

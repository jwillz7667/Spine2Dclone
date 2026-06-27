// Public surface of the main-process atlas pack service (WP-1.3). The IPC layer imports only from this
// barrel. The pack step (packAtlas) is pure and deterministic and shells out to nothing; rembg lives in a
// separate, env-gated asset-prep function the pack path never calls.

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

export { REMBG_ENV, resolveRembgConfig, requireRembgConfig, removeBackground } from './rembg';
export type { RembgConfig } from './rembg';

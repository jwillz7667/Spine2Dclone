import { join } from 'node:path';
import { mapWithConcurrency } from './concurrency';
import { AtlasError } from './errors';
import { encodePng } from './png';
import type { AtlasFileStore } from './file-store';
import type { AtlasRef } from '@marionette/format/types';
import type { PageBitmap } from './pack';

// TASK-1.3.5 Emit: write one PNG per page to the atlas directory and return the final AtlasRef. Writes are
// bounded (at most MAX_EMIT_CONCURRENCY in flight). The AtlasRef itself is unchanged; emit is the
// filesystem side effect that materializes the page bitmaps the pack step produced.

export const MAX_EMIT_CONCURRENCY = 8;

export async function emitAtlas(
  atlas: AtlasRef,
  pageBitmaps: readonly PageBitmap[],
  dir: string,
  fileStore: AtlasFileStore,
): Promise<AtlasRef> {
  if (atlas.pages.length !== pageBitmaps.length) {
    throw new AtlasError(
      'ATLAS_INVALID_CONFIG',
      `page count mismatch: ${atlas.pages.length} pages but ${pageBitmaps.length} bitmaps`,
    );
  }

  await mapWithConcurrency(atlas.pages, MAX_EMIT_CONCURRENCY, async (page, index) => {
    const bitmap = pageBitmaps[index];
    if (bitmap === undefined) {
      throw new AtlasError('ATLAS_INVALID_CONFIG', `missing bitmap for page ${index}`);
    }
    if (bitmap.width !== page.width || bitmap.height !== page.height) {
      throw new AtlasError(
        'ATLAS_INVALID_CONFIG',
        `bitmap ${bitmap.width}x${bitmap.height} does not match page ${index} (${page.width}x${page.height})`,
      );
    }
    const png = encodePng({ width: bitmap.width, height: bitmap.height, rgba: bitmap.rgba });
    await fileStore.writeBytes(join(dir, page.file), png);
  });

  return atlas;
}

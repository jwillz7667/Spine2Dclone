import { emitAtlas } from './emit';
import { importSprites } from './import-sprites';
import { packAtlas } from './pack';
import { trimSprite } from './trim';
import type { AtlasFileStore } from './file-store';
import type { PackConfig } from './pack';
import type { AtlasRef } from '@marionette/format/types';

// The deterministic pack pipeline the IPC layer calls: import -> trim -> pack -> emit. It shells out to
// nothing and never touches rembg (TASK-1.3.2). The renderer-side SetAtlasRef command and progress UI
// are wired separately when the document model gains an editable atlas field (TASK-1.3.6, out of scope
// here); this function is the clean seam they call.

export interface RunAtlasPipelineParams {
  // Directory of already-cut source PNGs (alpha present). Background removal, if any, ran earlier and
  // separately (rembg.ts).
  readonly sourceDir: string;
  // Directory the packed page PNGs are written to.
  readonly outputDir: string;
  readonly fileStore: AtlasFileStore;
  readonly config?: PackConfig;
}

export async function runAtlasPipeline(params: RunAtlasPipelineParams): Promise<AtlasRef> {
  const { sourceDir, outputDir, fileStore, config } = params;

  const imported = await importSprites(sourceDir, fileStore);
  const trimmed = imported.map((sprite) => {
    const trim = trimSprite(sprite.rgba, sprite.width, sprite.height);
    return {
      name: sprite.name,
      trimmedW: trim.trimmedW,
      trimmedH: trim.trimmedH,
      offsetX: trim.offsetX,
      offsetY: trim.offsetY,
      originalW: trim.originalW,
      originalH: trim.originalH,
      pixels: trim.pixels,
    };
  });

  const { atlas, pageBitmaps } = packAtlas(trimmed, config);
  return emitAtlas(atlas, pageBitmaps, outputDir, fileStore);
}

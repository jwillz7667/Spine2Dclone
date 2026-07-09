import type { AtlasRef, AtlasRegion } from '@marionette/format/types';
import type { AtlasImportPage } from '../../shared';

// Asset thumbnails for the Assets panel (PP-D5). Each atlas region gets a small preview cropped from its
// page PNG. The page bitmap is decoded ONCE per page (createImageBitmap) and every region on that page is
// cropped from it, so a hundred regions on one page cost one decode. The results are data URLs cached by
// the caller (ephemeral editor state, never the document). The decode/draw path needs a DOM (canvas +
// createImageBitmap), so it is glue covered by typecheck + lint like atlas-textures.ts; the pure sizing
// math (thumbnailBox) is unit-tested.

// The maximum edge length of a thumbnail box in CSS pixels.
export const THUMBNAIL_MAX = 40;

export interface ThumbnailBox {
  readonly w: number;
  readonly h: number;
}

// Fit a region's (width, height) into a `max` by `max` box preserving aspect ratio, never upscaling past
// the region's own size, and never rounding below 1px on either edge. A degenerate (zero or negative)
// region collapses to a 1x1 box so a thumbnail element always has a valid size.
export function thumbnailBox(regionW: number, regionH: number, max: number): ThumbnailBox {
  if (regionW <= 0 || regionH <= 0) return { w: 1, h: 1 };
  const scale = Math.min(1, max / regionW, max / regionH);
  return {
    w: Math.max(1, Math.round(regionW * scale)),
    h: Math.max(1, Math.round(regionH * scale)),
  };
}

// Crop one region from a decoded page bitmap into a thumbnail data URL. Honors a rotated-packed region
// (the packer may store a region turned 90 degrees; the editor packs non-rotated today, but this stays
// correct if that changes) by rotating the draw so the thumbnail shows the region upright. Returns null
// when a 2D context is unavailable.
function drawRegionThumbnail(
  bitmap: ImageBitmap,
  region: AtlasRegion,
  max: number,
): string | null {
  const box = thumbnailBox(region.w, region.h, max);
  const canvas = document.createElement('canvas');
  canvas.width = box.w;
  canvas.height = box.h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = true;

  if (region.rotated) {
    // The packed rect in the page is (region.h wide, region.w tall); draw it rotated -90 degrees so the
    // region reads upright in the box. The source rect stays axis-aligned in page space.
    ctx.save();
    ctx.translate(0, box.h);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(bitmap, region.x, region.y, region.h, region.w, 0, 0, box.h, box.w);
    ctx.restore();
  } else {
    ctx.drawImage(bitmap, region.x, region.y, region.w, region.h, 0, 0, box.w, box.h);
  }
  return canvas.toDataURL('image/png');
}

// Build a region-name -> data-URL thumbnail map from the atlas and its page bytes. Pages with no bytes
// (nothing to decode) are skipped, so a partially restored atlas still thumbnails what it can. Decoding is
// bounded by the page count and runs sequentially to keep peak memory to one page bitmap at a time.
export async function buildThumbnails(
  atlas: AtlasRef,
  pages: readonly AtlasImportPage[],
  max: number = THUMBNAIL_MAX,
): Promise<Map<string, string>> {
  const bytesByFile = new Map(pages.map((page) => [page.file, page.data]));
  const thumbnails = new Map<string, string>();
  for (const page of atlas.pages) {
    const data = bytesByFile.get(page.file);
    if (data === undefined) continue;
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
    try {
      for (const region of page.regions) {
        const url = drawRegionThumbnail(bitmap, region, max);
        if (url !== null) thumbnails.set(region.name, url);
      }
    } finally {
      bitmap.close();
    }
  }
  return thumbnails;
}

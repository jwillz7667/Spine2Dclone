import { AtlasError } from './errors';
import type { PageBitmap } from './pack';
import type { AtlasPage, AtlasRef, AtlasRegion } from '@marionette/format/types';

// Multi-resolution scale variants (phase-5 WP-5.2, TASK-5.2.1 export-profile-driven page profiles). The
// export profile lists a set of scales (e.g. 1.0, 0.5, 0.25); the pipeline emits the canonical page at 1.0
// plus a box-downsampled page per additional scale, into per-variant subfolders. Everything here is PURE
// and deterministic: box averaging with a pinned rounding rule shells out to no image library, so the same
// input yields byte-identical variant pages on the pinned toolchain (WP-1.3 determinism extended).
//
// ROUNDING IS PINNED. Two rules, both round-half-up (Math.round, ties toward +Infinity):
//   1. Geometry: a coordinate/dimension v at scale s becomes round(v * s). Page dimensions, region x/y/w/h,
//      trim offsets, and original sizes all use this ONE rule so a variant's regions stay consistent with
//      its downscaled pixels.
//   2. Pixels: an output texel is the round-half-up average of the covered source block (box filter).
// Do not change either rule without regenerating the committed variant fixtures.

// A scale must be in (0, 1] AND have an integer reciprocal (1, 0.5, 0.25, 0.2, 0.125, ...), so a page
// downsamples by an exact integer box factor and no fractional resampling (which would be renderer- and
// rounding-sensitive) is ever needed. 0.75 (reciprocal 1.333...) is rejected on purpose.
const SCALE_EPSILON = 1e-9;

export interface ScaleVariant {
  // The scale factor: 1 for the canonical page, < 1 for a downscale.
  readonly scale: number;
  // The integer box factor (1 / scale), e.g. scale 0.5 -> factor 2.
  readonly factor: number;
  // The subfolder the variant's pages are written under, relative to the atlas output dir. The canonical
  // 1.0 variant uses '' (the root, where AtlasPage.file lives); every downscale uses '@<scale>x'.
  readonly dir: string;
}

// Deterministic, locale-free decimal label for a scale (String(): 0.5 -> "0.5", 0.25 -> "0.25", 1 -> "1").
function scaleLabel(scale: number): string {
  return String(scale);
}

// Resolve a raw scale list into ordered, validated ScaleVariants. The canonical 1.0 MUST be present (it is
// the page AtlasPage.file references); the list is de-duplicated and sorted DESCENDING (1.0 first) so the
// emit order is fixed. Throws ATLAS_INVALID_SCALE on any out-of-range or non-reciprocal-integer scale.
export function resolveScaleVariants(scales: readonly number[]): ScaleVariant[] {
  const seen = new Set<number>();
  const variants: ScaleVariant[] = [];
  for (const scale of scales) {
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
      throw new AtlasError(
        'ATLAS_INVALID_SCALE',
        `scale ${scale} must be in the half-open range (0, 1]`,
      );
    }
    const reciprocal = 1 / scale;
    const factor = Math.round(reciprocal);
    if (Math.abs(reciprocal - factor) > SCALE_EPSILON) {
      throw new AtlasError(
        'ATLAS_INVALID_SCALE',
        `scale ${scale} must have an integer reciprocal (1/scale = ${reciprocal})`,
      );
    }
    if (seen.has(scale)) continue;
    seen.add(scale);
    variants.push({ scale, factor, dir: scale === 1 ? '' : `@${scaleLabel(scale)}x` });
  }
  if (!seen.has(1)) {
    throw new AtlasError('ATLAS_INVALID_SCALE', 'scale variants must include the canonical 1.0');
  }
  return variants.sort((a, b) => b.scale - a.scale);
}

// Scale a single geometry value with the pinned round-half-up rule (rule 1 above).
export function scaleGeometry(value: number, scale: number): number {
  return Math.round(value * scale);
}

function scaleRegion(region: AtlasRegion, scale: number): AtlasRegion {
  return {
    name: region.name,
    x: scaleGeometry(region.x, scale),
    y: scaleGeometry(region.y, scale),
    w: scaleGeometry(region.w, scale),
    h: scaleGeometry(region.h, scale),
    rotated: region.rotated,
    offsetX: scaleGeometry(region.offsetX, scale),
    offsetY: scaleGeometry(region.offsetY, scale),
    originalW: scaleGeometry(region.originalW, scale),
    originalH: scaleGeometry(region.originalH, scale),
  };
}

// Scale one page's geometry (dimensions + regions). The `file` basename is unchanged across variants: the
// per-variant subfolder (ScaleVariant.dir) is what disambiguates the pages on disk.
export function scaleAtlasPage(page: AtlasPage, scale: number): AtlasPage {
  return {
    file: page.file,
    width: scaleGeometry(page.width, scale),
    height: scaleGeometry(page.height, scale),
    regions: page.regions.map((region) => scaleRegion(region, scale)),
  };
}

// Scale a whole AtlasRef's geometry to a variant (used to describe the downscaled variant in the manifest).
export function scaleAtlasRef(atlas: AtlasRef, scale: number): AtlasRef {
  return { pages: atlas.pages.map((page) => scaleAtlasPage(page, scale)) };
}

// Box-downsample a page bitmap by an integer factor (rule 2 above). Output dimensions are derived with the
// SAME round-half-up geometry rule (round(width / factor)) so the pixels and the scaled region coordinates
// agree. Each output texel averages the covered source block; a partial edge block (when a dimension is not
// an exact multiple of the factor) averages only its covered source texels, so the transform is total for
// any page size, not just multiples of the factor. Averaging runs on whatever pixels are passed in, so the
// caller premultiplies FIRST when PMA is on (averaging in premultiplied space avoids dark fringes).
export function downsamplePage(bitmap: PageBitmap, factor: number): PageBitmap {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new AtlasError(
      'ATLAS_INVALID_SCALE',
      `downsample factor must be a positive integer, got ${factor}`,
    );
  }
  if (factor === 1) {
    return { width: bitmap.width, height: bitmap.height, rgba: Uint8Array.from(bitmap.rgba) };
  }
  const { width, height, rgba } = bitmap;
  const outW = Math.round(width / factor);
  const outH = Math.round(height / factor);
  const out = new Uint8Array(outW * outH * 4);
  for (let oy = 0; oy < outH; oy += 1) {
    const sy0 = oy * factor;
    const sy1 = Math.min(sy0 + factor, height);
    for (let ox = 0; ox < outW; ox += 1) {
      const sx0 = ox * factor;
      const sx1 = Math.min(sx0 + factor, width);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        let idx = (sy * width + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx += 1) {
          r += rgba[idx]!;
          g += rgba[idx + 1]!;
          b += rgba[idx + 2]!;
          a += rgba[idx + 3]!;
          idx += 4;
          count += 1;
        }
      }
      const di = (oy * outW + ox) * 4;
      out[di] = Math.round(r / count);
      out[di + 1] = Math.round(g / count);
      out[di + 2] = Math.round(b / count);
      out[di + 3] = Math.round(a / count);
    }
  }
  return { width: outW, height: outH, rgba: out };
}

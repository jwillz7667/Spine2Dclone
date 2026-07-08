import { Sprite, Texture } from 'pixi.js';
import { multiply, type Mat2x3 } from '@marionette/runtime-core';

// Region attachment rendering (handoff section 8.3). A region renders as a Sprite tinted by the
// slot/attachment color, showing either its resolved atlas texture (handoff 8.9) or, when no texture is
// available, a 1x1 white placeholder (Texture.WHITE) that the tint colors solid. The anchor is centered
// so the sprite origin is the attachment origin, matching the centered region quad the world transform
// places. The world transform (which folds the attachment size into its scale channel) is applied by
// map-transform's applyWorldToTarget, so there is no separate width/height assignment here: scale is the
// single source of truth for the sprite size, avoiding the Pixi footgun where setting `width` and
// `scale` overwrite each other.
export function createAttachmentSprite(): Sprite {
  const sprite = new Sprite(Texture.WHITE);
  sprite.anchor.set(0.5);
  return sprite;
}

// The atlas trim of a region (PP-C1): the packed content window (w x h) at (offsetX, offsetY) inside the
// ORIGINAL untrimmed image (originalW x originalH). Fields mirror AtlasRegion; SkeletonView reads them off
// document.atlas. render-preview carries the same shape (geometry.ts RegionTrim); the two placement paths
// stay in parity because both express trim as a fraction of the original image.
export interface RegionTrim {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly w: number;
  readonly h: number;
  readonly originalW: number;
  readonly originalH: number;
}

// Normalize a region's unit-quad sizing matrix for the pixel size of the texture that fills it, and offset
// it for atlas trim. A Pixi Sprite renders its texture as a quad of texture.width x texture.height in local
// space (anchored at its center), but computeRegionSized maps a UNIT quad (the geometry assumes a 1x1
// source, as the white placeholder is). Folding scale(1/texW, 1/texH) in makes the sprite draw its texW x
// texH texture into exactly the authored width x height world quad, whatever texture fills it (the 1x1
// placeholder factor is the identity, so that path is unchanged).
//
// With trim, the texture only covers a sub-rectangle of the ORIGINAL image, so the quad must (a) scale by
// the original image size (width/originalW, height/originalH) rather than the packed size, and (b) shift
// to the content's center inside the original: an original-image coordinate p maps to unit coordinate
// -0.5 + p/original, so the content center (offset + packed/2) lands at (offset + packed/2)/original - 0.5.
// Combined into one post-multiplied matrix, a sprite-local corner (+/-texW/2, +/-texH/2) maps to the
// trimmed unit corner regionWorldCorners uses, which is what keeps runtime-web and render-preview identical
// for trimmed regions. Untrimmed (no trim argument) reduces to the plain scale(1/texW, 1/texH). Constant
// per region + texture, so SkeletonView computes it ONCE at scene build, never per frame.
export function sizeForTexture(
  sized: Mat2x3,
  texWidth: number,
  texHeight: number,
  trim?: RegionTrim,
): Mat2x3 {
  if (trim === undefined) {
    return multiply(sized, [1 / texWidth, 0, 0, 1 / texHeight, 0, 0]);
  }
  const inner: Mat2x3 = [
    trim.w / (trim.originalW * texWidth),
    0,
    0,
    trim.h / (trim.originalH * texHeight),
    (trim.offsetX + trim.w / 2) / trim.originalW - 0.5,
    (trim.offsetY + trim.h / 2) / trim.originalH - 0.5,
  ];
  return multiply(sized, inner);
}

// Pack a [0, 1] RGB triple into a 0xRRGGBB tint. Channels are already range-checked by the format
// validator (COLOR_RANGE), so this only quantizes each to 8 bits.
export function packTint(r: number, g: number, b: number): number {
  return (to8Bit(r) << 16) | (to8Bit(g) << 8) | to8Bit(b);
}

function to8Bit(channel: number): number {
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

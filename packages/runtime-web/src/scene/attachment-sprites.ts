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

// Normalize a region's unit-quad sizing matrix for the pixel size of the texture that fills it. A Pixi
// Sprite renders its texture as a quad of texture.width x texture.height in local space, but
// computeRegionSized maps a UNIT quad (the geometry assumes a 1x1 source, as the white placeholder is).
// To keep a region's WORLD PLACEMENT byte-identical whatever texture fills it, fold scale(1/texW, 1/texH)
// in: the sprite then draws its texW x texH texture into exactly the same authored width x height world
// quad the placeholder occupied. For the 1x1 placeholder this factor is the identity (1/1, 1/1), so the
// placeholder path is unchanged; a real atlas texture (e.g. 64x32) needs the per-axis reciprocal, and a
// non-square texture is handled by the independent x and y factors. This depends only on the region and
// its (constant-per-scene) texture, so SkeletonView computes it ONCE at scene build, never per frame.
export function sizeForTexture(sized: Mat2x3, texWidth: number, texHeight: number): Mat2x3 {
  return multiply(sized, [1 / texWidth, 0, 0, 1 / texHeight, 0, 0]);
}

// Pack a [0, 1] RGB triple into a 0xRRGGBB tint. Channels are already range-checked by the format
// validator (COLOR_RANGE), so this only quantizes each to 8 bits.
export function packTint(r: number, g: number, b: number): number {
  return (to8Bit(r) << 16) | (to8Bit(g) << 8) | to8Bit(b);
}

function to8Bit(channel: number): number {
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

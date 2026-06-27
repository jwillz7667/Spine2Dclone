import { Sprite, Texture } from 'pixi.js';

// Region attachment rendering (handoff section 8.3). Phase 0 has no atlas, so every region renders as
// a single 1x1 white texture tinted by the slot/attachment color and scaled to the attachment size
// (real atlas textures arrive in Phase 1, handoff 8.9). The anchor is centered so the sprite origin
// is the attachment origin, matching the centered region quad the world transform places. The world
// transform (which folds the attachment size into its scale channel, the texture being 1x1) is applied
// by map-transform's applyWorldToTarget, so there is no separate width/height assignment here: scale is
// the single source of truth for the sprite size, avoiding the Pixi footgun where setting `width` and
// `scale` overwrite each other.
export function createAttachmentSprite(): Sprite {
  const sprite = new Sprite(Texture.WHITE);
  sprite.anchor.set(0.5);
  return sprite;
}

// Pack a [0, 1] RGB triple into a 0xRRGGBB tint. Channels are already range-checked by the format
// validator (COLOR_RANGE), so this only quantizes each to 8 bits.
export function packTint(r: number, g: number, b: number): number {
  return (to8Bit(r) << 16) | (to8Bit(g) << 8) | to8Bit(b);
}

function to8Bit(channel: number): number {
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

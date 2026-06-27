import { Graphics } from 'pixi.js';

// Bone visualization (handoff section 8.3): a tapered diamond drawn from the bone origin to its tip
// along +X in bone-local space. The caller positions the Graphics by the bone's world transform, so
// the geometry stays local and inherits rotation and scale from the bone. Bones are presentation
// chrome, so they use a fixed translucent gold that reads over any tinted attachment art rather than
// a per-bone color.
const BONE_FILL = 0xffd166;
const BONE_FILL_ALPHA = 0.35;
const BONE_OUTLINE = 0xffe7a8;
const BONE_OUTLINE_ALPHA = 0.9;
const BONE_OUTLINE_WIDTH = 1;

// The diamond's half-width at its base, as a fraction of bone length, clamped so a very short or
// zero-length bone still renders a visible marker rather than a degenerate sliver.
const BASE_WIDTH_FRACTION = 0.1;
const MIN_BASE_HALF = 2;
const MAX_BASE_HALF = 12;

function baseHalf(length: number): number {
  return Math.min(MAX_BASE_HALF, Math.max(MIN_BASE_HALF, length * BASE_WIDTH_FRACTION));
}

// The tapered-diamond outline in bone-local space, flat as [x0, y0, x1, y1, ...]: a short tail behind
// the origin, the widest base just ahead of it, and the point at the tip along +X. Returned as plain
// numbers so the geometry is assertable without a Pixi context. The tip never falls behind the base,
// so a zero-length bone degenerates to a small visible diamond instead of inverting.
export function boneDiamondVertices(length: number): number[] {
  const h = baseHalf(length);
  const tip = Math.max(length, h);
  return [-h, 0, h, h, tip, 0, h, -h];
}

// Draw (or redraw) the bone diamond into an existing Graphics, clearing prior geometry first so the
// object can be reused across syncs when the bone length changes.
export function drawBone(graphics: Graphics, length: number): void {
  graphics
    .clear()
    .poly(boneDiamondVertices(length))
    .fill({ color: BONE_FILL, alpha: BONE_FILL_ALPHA })
    .stroke({ width: BONE_OUTLINE_WIDTH, color: BONE_OUTLINE, alpha: BONE_OUTLINE_ALPHA });
}

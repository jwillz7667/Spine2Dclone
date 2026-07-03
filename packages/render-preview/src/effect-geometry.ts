import { DEG_TO_RAD } from '@marionette/runtime-core';

// Quad geometry for effect draw items (particles and world/screen sprite quads). A particle or sprite
// renders as a centered, rotated, axis-scaled quad, the CPU-preview counterpart of the pooled PixiJS
// Sprite runtime-web uploads (particle-render-batch.ts + attachment-sprites.ts createAttachmentSprite,
// anchor 0.5). Pure math over the runtime-core degrees-to-radians factor; no PixiJS.

// The four corners of a centered unit quad in the fixed order that pairs with EFFECT_QUAD_UVS
// [0,0, 1,0, 1,1, 0,1]: top-left, top-right, bottom-right, bottom-left (the sprite convention where local
// -x/-y is texture uv (0,0)), matching the region quad in geometry.ts.
const UNIT_QUAD_CORNERS: readonly (readonly [number, number])[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

// The quad UVs (normalized over the region's texture window) and the two-triangle index list, shared by
// every particle and sprite quad.
export const EFFECT_QUAD_UVS: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1];
export const EFFECT_QUAD_TRIANGLES: readonly number[] = [0, 1, 2, 0, 2, 3];

// Build the four world (or image) corners of a centered quad: half-width/half-height extents, rotated by
// `rotationDeg` about the center, then translated to (centerX, centerY). Returns eight numbers as
// interleaved x/y pairs in the UNIT_QUAD_CORNERS order. The rotation uses the shared DEG_TO_RAD factor so
// the spin matches the emitter/sprite solve exactly.
export function quadCorners(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationDeg: number,
): number[] {
  const rad = rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: number[] = [];
  for (const corner of UNIT_QUAD_CORNERS) {
    const lx = corner[0] * (2 * halfWidth);
    const ly = corner[1] * (2 * halfHeight);
    out.push(centerX + lx * cos - ly * sin, centerY + lx * sin + ly * cos);
  }
  return out;
}

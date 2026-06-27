import { compose, multiply, type Mat2x3 } from '@marionette/runtime-core';
import type { RegionAttachment } from '@marionette/format/types';

// The single region-placement math shared by the runtime-web player and the editor viewport
// (phase-1-bone-puppet.md TASK-1.10.3). The viewport adds overlays only; placement itself flows
// through these two functions so the two render paths cannot drift. This module uses runtime-core's
// affine library and re-implements no transform math (INV: runtime-core solves, runtime-web renders).

// The constant part of a region's placement: attachmentLocal * scale(width, height), where
// attachmentLocal = compose(x, y, rotation, scaleX, scaleY) is the attachment's offset in bone-local
// space (the Spine region convention). The size scale is innermost so the 1x1 centered texture becomes
// a width-by-height quad in attachment-local axes BEFORE the attachment offset and the bone world
// transform are applied. This depends only on the region, so it is computed ONCE per region at
// scene-build time and reused every frame (no per-frame allocation of the size/offset matrix).
export function computeRegionSized(region: RegionAttachment): Mat2x3 {
  const attachmentLocal = compose(
    region.x,
    region.y,
    region.rotation,
    region.scaleX,
    region.scaleY,
    0,
    0,
  );
  return multiply(attachmentLocal, [region.width, 0, 0, region.height, 0, 0]);
}

// A region attachment's world transform: its driving bone's world matrix times the region's constant
// sized-local matrix (from computeRegionSized). spriteWorld = boneWorld * attachmentLocal * size.
export function placeRegion(boneWorld: Mat2x3, sized: Mat2x3): Mat2x3 {
  return multiply(boneWorld, sized);
}

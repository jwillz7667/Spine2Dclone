import { compose, multiply, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import type { RegionAttachment } from '@marionette/format/types';

// Region-quad world geometry, mirroring the SAME placement math the runtime-web player and editor
// viewport use (packages/runtime-web/src/scene/region-placement.ts computeRegionSized/placeRegion). We
// cannot import runtime-web here (it depends on PixiJS; ADR-0006 forbids it), so the small placement
// math is reproduced against runtime-core's affine library ONLY, with runtime-web cited as the source of
// truth. The rasterizer and the runtimes therefore cannot drift on where a region lands: same bone world
// times the same sized-local matrix.

// A world-space point (x, y). The rasterizer maps these to image pixels via the viewport transform.
export interface Point {
  readonly x: number;
  readonly y: number;
}

// The four corners of a region's unit-centered quad, in the fixed order that pairs with the region UVs
// [0,0, 1,0, 1,1, 0,1]: top-left, top-right, bottom-right, bottom-left in the attachment's local frame
// (the Pixi sprite convention: local -x/-y is texture uv (0,0)). Triangulated as [0,1,2, 0,2,3].
const UNIT_QUAD_CORNERS: readonly (readonly [number, number])[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

// The atlas trim of a region: the packed (trimmed) content window (w x h) sits at (offsetX, offsetY)
// inside the ORIGINAL untrimmed image (originalW x originalH). Field names mirror AtlasRegion so building
// one is a straight copy. A trimmed region must render exactly where its untrimmed original would: the
// attachment's width x height quad is the ORIGINAL footprint, and the trimmed texture fills only the
// sub-rectangle the opaque content occupied (atlas-pack trim.ts records the offset for this).
export interface RegionTrim {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly w: number;
  readonly h: number;
  readonly originalW: number;
  readonly originalH: number;
}

// The four unit-space corners the region's texture window actually occupies, in UNIT_QUAD_CORNERS order.
// No trim (undefined) => the full centered unit quad (+/-0.5), byte-identical to the pre-trim placement.
// Trimmed => the content sub-rectangle expressed as a fraction of the ORIGINAL image mapped onto the same
// +/-0.5 quad: an original-image coordinate p maps to unit coordinate -0.5 + p/original. The +/-0.5
// corners fall out EXACTLY when offset is 0 and packed == original (integer 0/original and original/
// original), so the untrimmed path has no floating-point drift. Only WHERE the quad sits changes; the UVs
// stay [0,0, 1,0, 1,1, 0,1] because the texture window IS the trimmed content.
function trimmedUnitCorners(trim: RegionTrim | undefined): readonly (readonly [number, number])[] {
  if (trim === undefined) return UNIT_QUAD_CORNERS;
  const left = -0.5 + trim.offsetX / trim.originalW;
  const right = -0.5 + (trim.offsetX + trim.w) / trim.originalW;
  const top = -0.5 + trim.offsetY / trim.originalH;
  const bottom = -0.5 + (trim.offsetY + trim.h) / trim.originalH;
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

// The region UVs matching UNIT_QUAD_CORNERS (normalized over the region's texture window).
export const REGION_QUAD_UVS: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1];

// The region quad's two triangles (indices into the four corners).
export const REGION_QUAD_TRIANGLES: readonly number[] = [0, 1, 2, 0, 2, 3];

// The constant part of a region's placement: attachmentLocal * scale(width, height), where
// attachmentLocal = compose(x, y, rotation, scaleX, scaleY) is the attachment's offset in bone-local
// space (the region convention). This is a verbatim reproduction of region-placement.ts
// computeRegionSized; the size scale is innermost so the unit-centered quad becomes a width-by-height
// quad in attachment-local axes BEFORE the attachment offset and the bone world transform are applied.
export function regionSizedLocal(region: RegionAttachment): Mat2x3 {
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

// The four world-space corners of a region attachment: transform the (trim-adjusted) unit-quad corners by
// boneWorld * regionSizedLocal(region). Feeding the corners through the sized-local matrix reproduces
// exactly the sprite-corner world positions runtime-web computes (its sprite is a texW x texH quad whose
// sizing folds in the trim + scale(1/texW, 1/texH), so the texture size cancels and the world quad is the
// authored width x height quad; see region-placement.ts computeRegionSized and attachment-sprites.ts
// sizeForTexture). Texture-size-independent by construction, so this is the
// placement parity primitive. `trim` (from the region's AtlasRegion) offsets the quad so a trimmed texture
// lands where the untrimmed original would; omit it for an untrimmed region or a region with no atlas
// entry, which yields the full centered quad exactly.
export function regionWorldCorners(
  boneWorld: Mat2x3,
  region: RegionAttachment,
  trim?: RegionTrim,
): readonly [Point, Point, Point, Point] {
  const world = multiply(boneWorld, regionSizedLocal(region));
  const corners = trimmedUnitCorners(trim).map((corner) => {
    const [x, y] = transformPoint(world, corner[0], corner[1]);
    return { x, y };
  });
  return [corners[0]!, corners[1]!, corners[2]!, corners[3]!];
}

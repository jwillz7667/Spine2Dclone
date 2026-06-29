import type { RGBA } from '@marionette/format/types';
import type { MeshInit } from '@marionette/document-core';
import type { Point } from './point';
import { flattenPoints } from './point';

// REGION -> UNWEIGHTED MESH conversion geometry (TASK-2.1.1): compute the MeshInit that
// GenerateMeshFromRegionCommand consumes when "convert to mesh" runs on a region attachment. The result is
// the 4-corner hull quad (so the mesh overlays the region exactly), full-region UVs, the default 2-triangle
// fan, flat (unweighted) vertices, and the region's size/color carried through. Pure and deterministic;
// the command does the document swap.

// The region fields this conversion reads. A real RegionAttachmentEntity / format RegionAttachment is
// structurally assignable here; the narrow shape keeps the module decoupled and trivially testable. The
// placement (x, y, rotation, scaleX, scaleY) is the attachment-local offset; width/height is the quad size
// in attachment-local axes; color rides through to the mesh.
export interface RegionSource {
  readonly x: number;
  readonly y: number;
  readonly rotation: number; // degrees, the format/region convention
  readonly scaleX: number;
  readonly scaleY: number;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
}

// The four corners of the region quad in BONE-LOCAL space, in CCW winding for UV (0,0),(1,0),(1,1),(0,1).
// The region renders as a CENTERED unit quad (corners at +/-0.5) transformed by
// compose(x, y, rotation, scaleX, scaleY) * scale(width, height) (runtime-web computeRegionSized). The
// mesh vertices live in that same bone-local space, so the hull corners are exactly those four transformed
// points and the mesh overlays the region pixel-for-pixel. UV order matches corner order so the texture
// maps identically to the region. Returned as Points so the hull is reusable (e.g. as a grid-fill seed).
export function regionQuadCorners(region: RegionSource): Point[] {
  // Unit centered quad corners paired with their UVs, in the canonical CCW UV order.
  const unit: readonly Point[] = [
    { x: -0.5, y: -0.5 }, // uv 0,0
    { x: 0.5, y: -0.5 }, // uv 1,0
    { x: 0.5, y: 0.5 }, // uv 1,1
    { x: -0.5, y: 0.5 }, // uv 0,1
  ];
  const rad = (region.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return unit.map((u) => {
    // scale(width,height) then scale(scaleX,scaleY) then rotate then translate(x,y).
    const sx = u.x * region.width * region.scaleX;
    const sy = u.y * region.height * region.scaleY;
    return {
      x: region.x + sx * cos - sy * sin,
      y: region.y + sx * sin + sy * cos,
    };
  });
}

// The full-region UVs for the 4 corners (top-left origin, the atlas-region convention), in the same order
// as regionQuadCorners.
export const REGION_QUAD_UVS: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1];

// The default 2-triangle fan over the 4 corners (CCW), index triples into the corner array.
export const REGION_QUAD_TRIANGLES: readonly number[] = [0, 1, 2, 0, 2, 3];

// Compute the unweighted MeshInit for GenerateMeshFromRegionCommand: the 4-corner hull quad placed in
// bone-local space, full-region UVs, the default 2 triangles, flat vertices, and the region's size + color.
// `bones` is omitted (unweighted: binding is WP-2.3) and `edges` is omitted (no wireframe on the seed mesh).
export function regionToMeshInit(region: RegionSource): MeshInit {
  const corners = regionQuadCorners(region);
  return {
    uvs: [...REGION_QUAD_UVS],
    triangles: [...REGION_QUAD_TRIANGLES],
    hullLength: 4,
    width: region.width,
    height: region.height,
    color: { ...region.color },
    vertices: flattenPoints(corners),
  };
}

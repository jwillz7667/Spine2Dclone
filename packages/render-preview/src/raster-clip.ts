import { clipTriangleList, makeClipBuffers, type ClipBuffers } from '@marionette/runtime-core';
import type { ClipRegion } from './clipping';
import type { DrawItem } from './draw-items';
import { Framebuffer, rasterizeTriangle, type RasterTriangle } from './raster';
import { projectX, projectY, type WorldToImage } from './viewport';

// Clip-aware rasterization for the CPU preview (ADR-0012 section 3, PP-C8). A DrawItem whose slot falls in a
// clip region's range is NOT drawn whole; its triangle stream is clipped to the clip's world polygon via
// runtime-core's clipTriangleList (the Sutherland-Hodgman op that carries per-output-vertex barycentrics of
// the SOURCE triangle), then the clipped rings are fan-triangulated and rasterized through the SAME pinned
// scanline fill the unclipped path uses. UVs are re-interpolated from the source triangle's uvs by the
// barycentrics; the item's tint/alpha/blend/dark are uniform per item, so they compose with clipping exactly
// as on the unclipped path (no per-vertex color to re-interpolate here). Zero steady-state allocation in the
// heavy inner op: the clip runs into PP-B2's pooled ClipBuffers, reused across every item and frame.

export interface ClipScratch {
  readonly buffers: ClipBuffers;
  // Reused f64 copy of the item's world positions (clipTriangleList reads a typed array). Grown on demand.
  triVerts: Float64Array;
}

export function makeClipScratch(): ClipScratch {
  return { buffers: makeClipBuffers(), triVerts: new Float64Array(0) };
}

// Rasterize one DrawItem clipped to `region`'s world polygon. The item's slot is a member of the region's
// clipped-slot set (the caller decided that). Draws nothing when the clip removes the whole item.
export function rasterizeClippedWorldItem(
  fb: Framebuffer,
  item: DrawItem,
  region: ClipRegion,
  transform: WorldToImage,
  scratch: ClipScratch,
): void {
  const positions = item.worldPositions;
  if (scratch.triVerts.length < positions.length) {
    scratch.triVerts = new Float64Array(positions.length);
  }
  const triVerts = scratch.triVerts;
  for (let i = 0; i < positions.length; i += 1) triVerts[i] = positions[i]!;

  const buffers = scratch.buffers;
  const result = clipTriangleList(
    region.prepared,
    region.worldPolygon,
    triVerts,
    item.triangles,
    buffers,
  );
  if (result.ringCount === 0) return;

  const uvs = item.uvs;
  const triangles = item.triangles;
  let vertexOffset = 0;
  for (let ring = 0; ring < result.ringCount; ring += 1) {
    const ringLen = buffers.ringVertexCount[ring]!;
    const sourceTri = buffers.ringSourceTri[ring]!;
    const s0 = triangles[sourceTri * 3]!;
    const s1 = triangles[sourceTri * 3 + 1]!;
    const s2 = triangles[sourceTri * 3 + 2]!;
    const su0 = uvs[s0 * 2]!;
    const sv0 = uvs[s0 * 2 + 1]!;
    const su1 = uvs[s1 * 2]!;
    const sv1 = uvs[s1 * 2 + 1]!;
    const su2 = uvs[s2 * 2]!;
    const sv2 = uvs[s2 * 2 + 1]!;

    // Fan-triangulate the convex output ring: (0, i, i+1) for i in 1 .. ringLen - 2.
    for (let i = 1; i + 1 < ringLen; i += 1) {
      const tri = buildFanTriangle(
        buffers,
        transform,
        vertexOffset,
        0,
        i,
        i + 1,
        su0,
        sv0,
        su1,
        sv1,
        su2,
        sv2,
      );
      rasterizeTriangle(fb, tri, item.sampler, item.tint, item.alpha, item.blend, item.dark);
    }
    vertexOffset += ringLen;
  }
}

// Build one image-space RasterTriangle from three clipped ring vertices (indices a, b, c within the ring that
// starts at `vertexOffset` in the pooled buffers). Each vertex projects its world position and interpolates
// (u, v) from the source triangle's uvs by its barycentrics (ADR-0012 section 3.2 intersection convention).
function buildFanTriangle(
  buffers: ClipBuffers,
  transform: WorldToImage,
  vertexOffset: number,
  a: number,
  b: number,
  c: number,
  su0: number,
  sv0: number,
  su1: number,
  sv1: number,
  su2: number,
  sv2: number,
): RasterTriangle {
  const va = vertexOffset + a;
  const vb = vertexOffset + b;
  const vc = vertexOffset + c;
  const positions = buffers.positions;
  const bary = buffers.bary;

  const b0a = bary[va * 3]!;
  const b1a = bary[va * 3 + 1]!;
  const b2a = bary[va * 3 + 2]!;
  const b0b = bary[vb * 3]!;
  const b1b = bary[vb * 3 + 1]!;
  const b2b = bary[vb * 3 + 2]!;
  const b0c = bary[vc * 3]!;
  const b1c = bary[vc * 3 + 1]!;
  const b2c = bary[vc * 3 + 2]!;

  return {
    x0: projectX(transform, positions[va * 2]!),
    y0: projectY(transform, positions[va * 2 + 1]!),
    u0: b0a * su0 + b1a * su1 + b2a * su2,
    v0: b0a * sv0 + b1a * sv1 + b2a * sv2,
    x1: projectX(transform, positions[vb * 2]!),
    y1: projectY(transform, positions[vb * 2 + 1]!),
    u1: b0b * su0 + b1b * su1 + b2b * su2,
    v1: b0b * sv0 + b1b * sv1 + b2b * sv2,
    x2: projectX(transform, positions[vc * 2]!),
    y2: projectY(transform, positions[vc * 2 + 1]!),
    u2: b0c * su0 + b1c * su1 + b2c * su2,
    v2: b0c * sv0 + b1c * sv1 + b2c * sv2,
  };
}

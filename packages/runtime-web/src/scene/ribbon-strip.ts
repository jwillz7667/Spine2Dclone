import type { ReadonlyRibbonView } from '@marionette/runtime-core';

// The pure triangle-strip geometry bridge for a RibbonTrailLayer (phase-3-vfx-particles.md section 8.6,
// WP-3.5 / PP-C3). runtime-core's buildRibbonStrip solves two strip vertices per recorded trail point
// (left/right, interleaved in the ReadonlyRibbonView vx/vy lanes) plus per-vertex color/alpha taper. This
// module turns that CPU-side strip into the flat, pre-allocated PixiJS MeshGeometry buffers a single Mesh
// draws: a positions buffer written in place each frame, a UVs buffer built once (u runs head to tail, v
// is 0 on the left edge and 1 on the right), and a triangle-index buffer built once for the full capacity.
//
// It is the renderer-side counterpart of the ribbon solve and the SAME strip the editor preview and the
// web player draw, so the two embeddings cannot diverge. The pieces here are pure (no PixiJS type touches
// the math): geometry sizing, index winding, UV assignment, and the per-frame position fill are all
// conformance-checkable in plain Node. The GL edge this feeds (uploading the buffers, the vertex shader,
// and per-vertex color/alpha shading of the taper) needs a WebGL context and is not exercised headlessly.
//
// Allocation discipline (INV no per-frame allocation): the index and UV buffers are built ONCE at the
// ribbon's max-segment capacity; the positions buffer is pre-allocated once and written in place every
// frame. fillStripPositions allocates nothing and returns the live point count.

// Two strip vertices (left, right) per trail point; each vertex carries an x and a y lane.
const VERTS_PER_POINT = 2;
const COORDS_PER_VERTEX = 2;

// The float length of the positions / UV buffers for `maxPoints` trail points (2 vertices x 2 coords).
export function stripBufferLength(maxPoints: number): number {
  return maxPoints * VERTS_PER_POINT * COORDS_PER_VERTEX;
}

// The triangle indices for a strip of `maxPoints` points (built ONCE per ribbon at capacity). Between
// consecutive points k and k+1 the quad [Lk, Rk, Lk+1, Rk+1] (Lk = 2k, Rk = 2k+1) splits into two
// triangles wound (Lk, Rk, Lk+1) and (Rk, Rk+1, Lk+1). Unused tail points are collapsed onto the last
// live point by fillStripPositions, so their triangles are degenerate (zero area) and draw nothing; the
// index buffer therefore stays constant and never reallocates as the live point count changes per frame.
export function buildStripIndices(maxPoints: number): Uint32Array {
  const quadCount = Math.max(0, maxPoints - 1);
  const indices = new Uint32Array(quadCount * 6);
  let w = 0;
  for (let k = 0; k < quadCount; k += 1) {
    const l0 = k * 2;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    indices[w] = l0;
    indices[w + 1] = r0;
    indices[w + 2] = l1;
    indices[w + 3] = r0;
    indices[w + 4] = r1;
    indices[w + 5] = l1;
    w += 6;
  }
  return indices;
}

// The UVs for a strip of `maxPoints` points (built ONCE). u runs 0 (head, k = 0) to 1 (tail) across the
// points so the region texture stretches along the ribbon; v is 0 on the left edge and 1 on the right, so
// the texture spans the ribbon width. maxPoints == 1 puts the single point's u at 0 (degenerate strip).
export function buildStripUVs(maxPoints: number): Float32Array {
  const uvs = new Float32Array(stripBufferLength(maxPoints));
  const denom = maxPoints > 1 ? maxPoints - 1 : 1;
  for (let k = 0; k < maxPoints; k += 1) {
    const u = k / denom;
    const base = k * 4;
    uvs[base] = u; // left x
    uvs[base + 1] = 0; // left v
    uvs[base + 2] = u; // right x
    uvs[base + 3] = 1; // right v
  }
  return uvs;
}

// Write the ribbon's live strip vertices into a pre-allocated positions buffer (2 vertices per point,
// x/y interleaved as PixiJS expects: [x0, y0, x1, y1, ...]). The live points come straight from the
// ReadonlyRibbonView (already solved by buildRibbonStrip in runtime-core's step). Unused tail points are
// collapsed onto the last live vertex so their triangles are degenerate and invisible, which keeps the
// index buffer constant. Returns the live point count. Allocation-free: it only writes into `positions`.
export function fillStripPositions(positions: Float32Array, view: ReadonlyRibbonView): number {
  const count = view.vertexCount;
  const vertexFloats = count * VERTS_PER_POINT * COORDS_PER_VERTEX;
  for (let k = 0; k < count; k += 1) {
    const left = k * 2;
    const right = left + 1;
    const base = k * 4;
    positions[base] = view.vx[left]!;
    positions[base + 1] = view.vy[left]!;
    positions[base + 2] = view.vx[right]!;
    positions[base + 3] = view.vy[right]!;
  }
  // Collapse the remaining capacity onto the last written vertex (or the origin when empty) so the
  // trailing triangles are degenerate. This is what lets the strip length shrink and grow per frame with
  // a constant index / position buffer and zero reallocation.
  if (vertexFloats < positions.length) {
    const lastX = count > 0 ? positions[vertexFloats - 2]! : 0;
    const lastY = count > 0 ? positions[vertexFloats - 1]! : 0;
    for (let i = vertexFloats; i < positions.length; i += 2) {
      positions[i] = lastX;
      positions[i + 1] = lastY;
    }
  }
  return count;
}

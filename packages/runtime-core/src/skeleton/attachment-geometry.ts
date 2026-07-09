import type {
  BoundingBoxAttachment,
  ClippingAttachment,
  PointAttachment,
} from '@marionette/format/types';
import { MAT2X3_STRIDE } from '../math/affine';
import type { Pose } from './pose';

// Non-drawing geometry attachments (ADR-0012, PP-B2): clipping evaluation, bounding-box hit testing, and
// point resolution. These READ the solved pose (pose.world written by computeWorldTransforms, pose.drawOrder
// written by sampleSkeleton) and never write it, so they are post-step-4 accessors that change no existing
// fixture (Law 1: presentation-only, outcome-independent). NO PixiJS, NO DOM, NO Zod, NO Node built-ins,
// NO Math.random / Date.now: pure solve math that ports unchanged to C#/GDScript.
//
// In our format a clipping/boundingbox vertex stream is ALWAYS unweighted (no `bones` manifest, unlike a
// mesh, ADR-0002), so a polygon vertex's world position is slotBoneWorld * (x, y), exactly the unweighted
// mesh transform. A point is a single local (x, y, rotation) composed with the slot bone's world.

const RAD_TO_DEG = 180 / Math.PI;

// The world matrix offset of the bone a slot rides, or -1 when the slot or its bone is unknown (a
// defensive value for an unvalidated document; a validated rig always resolves it).
function slotBoneOffset(pose: Pose, slotIndex: number): number {
  if (slotIndex < 0 || slotIndex >= pose.slotCount) return -1;
  const boneIndex = pose.slotBoneIndices[slotIndex]!;
  return boneIndex < 0 ? -1 : boneIndex * MAT2X3_STRIDE;
}

// Transform a flat unweighted local vertex stream [x0, y0, x1, y1, ...] into world space by the world
// matrix at `world[boneOffset ..]`: world_i = slotBoneWorld * (x_i, y_i). Writes 2 world lanes per logical
// vertex into `out` (sized >= vertices.length) and returns the vertex count. Allocation-free.
export function transformUnweightedVerticesInto(
  vertices: readonly number[],
  world: Float64Array,
  boneOffset: number,
  out: Float64Array,
): number {
  const a = world[boneOffset]!;
  const b = world[boneOffset + 1]!;
  const c = world[boneOffset + 2]!;
  const d = world[boneOffset + 3]!;
  const tx = world[boneOffset + 4]!;
  const ty = world[boneOffset + 5]!;
  const length = vertices.length;
  for (let i = 0; i < length; i += 2) {
    const x = vertices[i]!;
    const y = vertices[i + 1]!;
    out[i] = a * x + c * y + tx;
    out[i + 1] = b * x + d * y + ty;
  }
  return length / 2;
}

// ---------------------------------------------------------------------------------------------------
// Point attachment (ADR-0012 section 2)
// ---------------------------------------------------------------------------------------------------

// A point attachment's resolved world state: world position and world rotation in degrees.
export interface PointWorld {
  readonly x: number;
  readonly y: number;
  readonly rotationDeg: number;
}

// Resolve a point attachment's world position (slotBoneWorld * (x, y)) and world rotation (point.rotation +
// the bone's world x-axis angle, ADR-0012 section 2). `boneOffset` is the slot bone's world matrix offset.
// Pure; returns a small record (a one-shot accessor, not a per-frame hot loop).
export function resolvePointWorld(
  point: PointAttachment,
  world: Float64Array,
  boneOffset: number,
): PointWorld {
  const a = world[boneOffset]!;
  const b = world[boneOffset + 1]!;
  const c = world[boneOffset + 2]!;
  const d = world[boneOffset + 3]!;
  const tx = world[boneOffset + 4]!;
  const ty = world[boneOffset + 5]!;
  const x = a * point.x + c * point.y + tx;
  const y = b * point.x + d * point.y + ty;
  const boneRotationDeg = Math.atan2(b, a) * RAD_TO_DEG;
  return { x, y, rotationDeg: point.rotation + boneRotationDeg };
}

// Resolve a point attachment for the slot it rides, reading the slot bone's world matrix from the solved
// pose. Returns null when the slot's bone is unknown (a defensive path for an unvalidated document).
export function resolvePointWorldForSlot(
  pose: Pose,
  slotIndex: number,
  point: PointAttachment,
): PointWorld | null {
  const offset = slotBoneOffset(pose, slotIndex);
  if (offset < 0) return null;
  return resolvePointWorld(point, pose.world, offset);
}

// ---------------------------------------------------------------------------------------------------
// Bounding-box hit testing (ADR-0012 section 4)
// ---------------------------------------------------------------------------------------------------

// Transform a bounding-box attachment's polygon into world space for the slot it rides, into `out` (sized
// >= box.vertices.length). Returns the vertex count, or -1 when the slot's bone is unknown.
export function boundingBoxWorldVerticesForSlot(
  pose: Pose,
  slotIndex: number,
  box: BoundingBoxAttachment,
  out: Float64Array,
): number {
  const offset = slotBoneOffset(pose, slotIndex);
  if (offset < 0) return -1;
  return transformUnweightedVerticesInto(box.vertices, pose.world, offset, out);
}

// Even-odd (crossing-number) point-in-polygon test over a world-space polygon (ADR-0012 section 4). The
// polygon is `worldVertices` (flat [x0, y0, ...], `vertexCount` logical vertices). A point is inside iff a
// ray toward +x crosses an odd number of edges; the half-open `[yMin, yMax)` span convention avoids
// double-counting a shared vertex. Orientation-independent (CW or CCW authored polygon hits identically).
// Allocation-free; the boolean is deterministic (compared EXACT in conformance).
export function hitTestPolygon(
  worldVertices: Float64Array,
  vertexCount: number,
  px: number,
  py: number,
): boolean {
  let inside = false;
  let j = vertexCount - 1;
  for (let i = 0; i < vertexCount; i += 1) {
    const ax = worldVertices[i * 2]!;
    const ay = worldVertices[i * 2 + 1]!;
    const bx = worldVertices[j * 2]!;
    const by = worldVertices[j * 2 + 1]!;
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

// Hit-test a world point against a bounding-box attachment for the slot it rides: transform the box into
// `scratch` (sized >= box.vertices.length) then run the even-odd test. Returns false when the slot's bone
// is unknown. Allocation-free given a reused scratch buffer.
export function hitTestBoundingBox(
  pose: Pose,
  slotIndex: number,
  box: BoundingBoxAttachment,
  px: number,
  py: number,
  scratch: Float64Array,
): boolean {
  const count = boundingBoxWorldVerticesForSlot(pose, slotIndex, box, scratch);
  if (count < 3) return false;
  return hitTestPolygon(scratch, count, px, py);
}

// ---------------------------------------------------------------------------------------------------
// Clipping evaluation (ADR-0012 section 3)
// ---------------------------------------------------------------------------------------------------

// The precomputed, pose-independent data for one clip attachment (ADR-0012 section 3.2/3.3): the polygon
// convexity (decided once on the LOCAL polygon, affine invariant) and, for a concave polygon, the ear-clip
// triangle topology (indices into the polygon vertices) reused every frame with world vertices. `pieceCount`
// is 1 (convex) or V-2 (concave); the worst-case bounds size a caller's output pool.
export interface PreparedClip {
  readonly vertexCount: number;
  readonly convex: boolean;
  // Concave only: (V-2)*3 vertex indices, three per ear triangle. Empty for a convex polygon.
  readonly earTriangles: Int32Array;
  readonly pieceCount: number;
  // Worst-case output vertices and rings PER INPUT TRIANGLE (ADR-0012 section 3.3).
  readonly maxOutputVerticesPerTri: number;
  readonly maxRingsPerTri: number;
}

// Twice the signed area of a flat polygon [x0, y0, ...] over `count` vertices via the shoelace sum; positive
// for a counter-clockwise ring (standard math convention, cross-product-consistent). Used to decide winding
// for ear-clipping (local) and the per-frame convex-piece reorientation (world).
function signedArea2(vertices: ArrayLike<number>, offset: number, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const ix = vertices[offset + i * 2]!;
    const iy = vertices[offset + i * 2 + 1]!;
    const nx = vertices[offset + next * 2]!;
    const ny = vertices[offset + next * 2 + 1]!;
    sum += ix * ny - nx * iy;
  }
  return sum;
}

// True iff the local polygon is convex: every consecutive-edge cross product shares one sign (collinear
// zeros allowed). A reflection flips all signs together, so this decision is affine invariant (ADR-0012
// section 3.2).
function isConvexPolygon(vertices: readonly number[], count: number): boolean {
  let sign = 0;
  for (let i = 0; i < count; i += 1) {
    const ax = vertices[i * 2]!;
    const ay = vertices[i * 2 + 1]!;
    const bx = vertices[((i + 1) % count) * 2]!;
    const by = vertices[((i + 1) % count) * 2 + 1]!;
    const cx = vertices[((i + 2) % count) * 2]!;
    const cy = vertices[((i + 2) % count) * 2 + 1]!;
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross > 0) {
      if (sign < 0) return false;
      sign = 1;
    } else if (cross < 0) {
      if (sign > 0) return false;
      sign = -1;
    }
  }
  return true;
}

// Point-in-triangle by three same-side cross-product signs (inclusive of the boundary), for the ear guard.
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Ear-clip a concave (or convex) local polygon into triangle index triples (ADR-0012 section 3.2). Standard
// O(V^2) ear clipping over a CCW-normalized index ring; a point-in-triangle guard rejects a candidate ear
// that contains any other polygon vertex. Deterministic (fixed scan order). Returns a flat (V-2)*3 index
// array referencing the ORIGINAL vertex indices, so the topology is reused every frame with world vertices.
function earClip(vertices: readonly number[], count: number): Int32Array {
  const triangles = new Int32Array(Math.max(0, count - 2) * 3);
  if (count < 3) return triangles;

  // Normalize to CCW so the "convex vertex" test (positive cross) is consistent.
  const ccw = signedArea2(vertices, 0, count) > 0;
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) indices.push(ccw ? i : count - 1 - i);

  const px = (k: number): number => vertices[indices[k]! * 2]!;
  const py = (k: number): number => vertices[indices[k]! * 2 + 1]!;

  let out = 0;
  let remaining = indices.length;
  let guard = 0;
  const guardLimit = count * count + 1;
  while (remaining > 3 && guard < guardLimit) {
    guard += 1;
    let clipped = false;
    for (let k = 0; k < remaining; k += 1) {
      const prev = (k - 1 + remaining) % remaining;
      const next = (k + 1) % remaining;
      const ax = px(prev);
      const ay = py(prev);
      const bx = px(k);
      const by = py(k);
      const cx = px(next);
      const cy = py(next);
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (cross <= 0) continue; // reflex or collinear: not an ear tip

      let containsOther = false;
      for (let m = 0; m < remaining; m += 1) {
        if (m === prev || m === k || m === next) continue;
        if (pointInTriangle(px(m), py(m), ax, ay, bx, by, cx, cy)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      triangles[out] = indices[prev]!;
      triangles[out + 1] = indices[k]!;
      triangles[out + 2] = indices[next]!;
      out += 3;
      indices.splice(k, 1);
      remaining -= 1;
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate polygon: stop rather than spin
  }
  if (remaining === 3) {
    triangles[out] = indices[0]!;
    triangles[out + 1] = indices[1]!;
    triangles[out + 2] = indices[2]!;
  }
  return triangles;
}

// Prepare a clip attachment once: decide convexity on the LOCAL polygon (affine invariant) and, when
// concave, ear-clip its topology (ADR-0012 section 3.2/3.3). Records the worst-case output bounds a caller
// uses to size the clip output pool. A polygon with V < 3 yields pieceCount 0 (no clip region).
export function prepareClipping(clip: ClippingAttachment): PreparedClip {
  const vertexCount = clip.vertices.length / 2;
  if (vertexCount < 3) {
    return {
      vertexCount,
      convex: true,
      earTriangles: new Int32Array(0),
      pieceCount: 0,
      maxOutputVerticesPerTri: 0,
      maxRingsPerTri: 0,
    };
  }
  const convex = isConvexPolygon(clip.vertices, vertexCount);
  if (convex) {
    return {
      vertexCount,
      convex: true,
      earTriangles: new Int32Array(0),
      pieceCount: 1,
      maxOutputVerticesPerTri: 3 + vertexCount,
      maxRingsPerTri: 1,
    };
  }
  const earTriangles = earClip(clip.vertices, vertexCount);
  const pieceCount = vertexCount - 2;
  return {
    vertexCount,
    convex: false,
    earTriangles,
    pieceCount,
    // Each ear-clip piece is a 3-edge convex triangle, so a clipped subject triangle has at most 6 verts.
    maxOutputVerticesPerTri: 6 * pieceCount,
    maxRingsPerTri: pieceCount,
  };
}

// Resolve a clip attachment's world-space polygon for the slot it rides, into `out` (sized >= 2*V). Returns
// the vertex count, or -1 when the slot's bone is unknown. Allocation-free.
export function resolveClipWorldPolygonForSlot(
  pose: Pose,
  slotIndex: number,
  clip: ClippingAttachment,
  out: Float64Array,
): number {
  const offset = slotBoneOffset(pose, slotIndex);
  if (offset < 0) return -1;
  return transformUnweightedVerticesInto(clip.vertices, pose.world, offset, out);
}

// The render position of a slot index within the current draw order (pose.drawOrder maps render position ->
// slot index), or -1 if absent. Linear scan; the slot count is small.
function renderPositionOf(pose: Pose, slotIndex: number): number {
  for (let position = 0; position < pose.slotCount; position += 1) {
    if (pose.drawOrder[position] === slotIndex) return position;
  }
  return -1;
}

// Compute the clipped slot set for a clip attachment (ADR-0012 section 3.1): the slots at render positions
// pClip+1 .. pEnd inclusive in the CURRENT draw order, i.e. the slots drawn after the clip slot up to and
// including the `end` slot. Fills `outSlotIndices` (sized >= pose.slotCount) with those slot indices in
// ascending render-position order and returns the count. Empty (returns 0) when the end slot is at or before
// the clip slot, or when either slot is unresolved. Allocation-free.
export function computeClippedSlotRange(
  pose: Pose,
  clipSlotIndex: number,
  endSlotIndex: number,
  outSlotIndices: Int32Array,
): number {
  const pClip = renderPositionOf(pose, clipSlotIndex);
  const pEnd = renderPositionOf(pose, endSlotIndex);
  if (pClip < 0 || pEnd < 0 || pEnd <= pClip) return 0;
  let count = 0;
  for (let position = pClip + 1; position <= pEnd; position += 1) {
    outSlotIndices[count] = pose.drawOrder[position]!;
    count += 1;
  }
  return count;
}

// Pooled output for clipTriangleList (ADR-0012 section 3.3): the flat output vertex positions and their
// barycentric coordinates (with respect to the source input triangle), the per-ring vertex counts, and the
// per-ring source-triangle index. `scratchA`/`scratchB` are the Sutherland-Hodgman ping-pong buffers, each
// stride SUBJECT_STRIDE (x, y, b0, b1, b2). Every buffer grows only when a larger job than any before
// appears (size-keyed), so steady-state clipping of same-or-smaller streams allocates nothing.
export interface ClipBuffers {
  positions: Float64Array;
  bary: Float64Array;
  ringVertexCount: Int32Array;
  ringSourceTri: Int32Array;
  scratchA: Float64Array;
  scratchB: Float64Array;
}

// The result of one clip: how many rings and how many total output vertices were written (the caller reads
// ringVertexCount[0..ringCount) and walks positions/bary in step).
export interface ClipResult {
  readonly ringCount: number;
  readonly vertexCount: number;
}

const SUBJECT_STRIDE = 5; // x, y, b0, b1, b2

// Allocate empty clip buffers; clipTriangleList grows them to the job's worst case on first use.
export function makeClipBuffers(): ClipBuffers {
  return {
    positions: new Float64Array(0),
    bary: new Float64Array(0),
    ringVertexCount: new Int32Array(0),
    ringSourceTri: new Int32Array(0),
    scratchA: new Float64Array(0),
    scratchB: new Float64Array(0),
  };
}

// Grow the clip buffers to hold a triangle stream of `triangleCount` triangles clipped by `prepared`
// (ADR-0012 section 3.3 worst case). Size-keyed: only reallocates a buffer that is too small. Called once
// per new larger job; steady-state reuse allocates nothing.
function ensureClipCapacity(
  buffers: ClipBuffers,
  prepared: PreparedClip,
  triangleCount: number,
): void {
  const maxVertices = triangleCount * prepared.maxOutputVerticesPerTri;
  const maxRings = triangleCount * prepared.maxRingsPerTri;
  // The largest per-pass subject size: 3 + (whole polygon edges) in the convex case, else 6 for a triangle.
  const maxSubject = prepared.convex ? 3 + prepared.vertexCount : 6;
  if (buffers.positions.length < maxVertices * 2) buffers.positions = new Float64Array(maxVertices * 2);
  if (buffers.bary.length < maxVertices * 3) buffers.bary = new Float64Array(maxVertices * 3);
  if (buffers.ringVertexCount.length < maxRings) buffers.ringVertexCount = new Int32Array(maxRings);
  if (buffers.ringSourceTri.length < maxRings) buffers.ringSourceTri = new Int32Array(maxRings);
  if (buffers.scratchA.length < maxSubject * SUBJECT_STRIDE) {
    buffers.scratchA = new Float64Array(maxSubject * SUBJECT_STRIDE);
    buffers.scratchB = new Float64Array(maxSubject * SUBJECT_STRIDE);
  }
}

// Clip a world-space triangle stream against a clip attachment's world polygon (ADR-0012 section 3), the
// geometry operation a CPU rasterizer needs. `worldPolygon` is the polygon filled by
// resolveClipWorldPolygonForSlot; `triVerts` is the flat world xy of the source geometry (e.g. a skinned +
// deformed mesh via skinMeshInto); `triIndices` is the flat 3-per-triangle index array (mesh.triangles).
// Writes, per input triangle, one convex output ring (convex polygon) or, for a concave clip polygon, one
// ring per ear-clip piece it intersects, into the pooled `buffers`, and returns the ring and vertex counts.
// Each output vertex carries its barycentric coordinates with respect to its source triangle so a renderer
// interpolates UVs/colors without re-solving. Deterministic (fixed piece/edge/vertex order); allocation-free
// in steady state (buffers grow once per larger job).
export function clipTriangleList(
  prepared: PreparedClip,
  worldPolygon: Float64Array,
  triVerts: Float32Array | Float64Array,
  triIndices: readonly number[],
  buffers: ClipBuffers,
): ClipResult {
  const triangleCount = Math.floor(triIndices.length / 3);
  if (prepared.pieceCount === 0 || triangleCount === 0) return { ringCount: 0, vertexCount: 0 };
  ensureClipCapacity(buffers, prepared, triangleCount);

  let ringCount = 0;
  let vertexCount = 0;
  const V = prepared.vertexCount;

  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = triIndices[t * 3]!;
    const i1 = triIndices[t * 3 + 1]!;
    const i2 = triIndices[t * 3 + 2]!;

    if (prepared.convex) {
      seedSubjectTriangle(triVerts, i0, i1, i2, buffers.scratchA);
      // Result is normalized into scratchB, so emitRing always reads scratchB.
      const outLen = clipSubjectAgainstConvex(buffers, 3, worldPolygon, 0, V);
      const written = emitRing(buffers, buffers.scratchB, outLen, t, ringCount, vertexCount);
      if (written > 0) {
        vertexCount += written;
        ringCount += 1;
      }
    } else {
      for (let piece = 0; piece < prepared.pieceCount; piece += 1) {
        // Re-seed the subject triangle into scratchA for each piece (the previous piece's ping-pong
        // overwrote it); each piece intersects the SAME source triangle against a different clip triangle.
        seedSubjectTriangle(triVerts, i0, i1, i2, buffers.scratchA);
        const outLen = clipSubjectAgainstTriangle(buffers, 3, worldPolygon, prepared.earTriangles, piece);
        const written = emitRing(buffers, buffers.scratchB, outLen, t, ringCount, vertexCount);
        if (written > 0) {
          vertexCount += written;
          ringCount += 1;
        }
      }
    }
  }
  return { ringCount, vertexCount };
}

// Write the three source-triangle corners (positions + canonical barycentrics) into a subject scratch.
function seedSubjectTriangle(
  triVerts: Float32Array | Float64Array,
  i0: number,
  i1: number,
  i2: number,
  subject: Float64Array,
): void {
  writeSubject(subject, 0, triVerts[i0 * 2]!, triVerts[i0 * 2 + 1]!, 1, 0, 0);
  writeSubject(subject, 1, triVerts[i1 * 2]!, triVerts[i1 * 2 + 1]!, 0, 1, 0);
  writeSubject(subject, 2, triVerts[i2 * 2]!, triVerts[i2 * 2 + 1]!, 0, 0, 1);
}

function writeSubject(
  buffer: Float64Array,
  vertexIndex: number,
  x: number,
  y: number,
  b0: number,
  b1: number,
  b2: number,
): void {
  const base = vertexIndex * SUBJECT_STRIDE;
  buffer[base] = x;
  buffer[base + 1] = y;
  buffer[base + 2] = b0;
  buffer[base + 3] = b1;
  buffer[base + 4] = b2;
}

// Clip the subject polygon (seeded in buffers.scratchA, `subjectLen` vertices) against a whole convex clip
// polygon `poly[polyOffset ..]` over `polyCount` vertices, ping-ponging between scratchA and scratchB. The
// clip polygon is reoriented CCW per pass by its signed area (ADR-0012 winding rule) so the left-of-edge
// inside test is correct even under a reflecting transform. The result is NORMALIZED into buffers.scratchB
// (copied there when the last pass landed in scratchA), and the vertex count is returned. Allocation-free.
function clipSubjectAgainstConvex(
  buffers: ClipBuffers,
  subjectLen: number,
  poly: Float64Array,
  polyOffset: number,
  polyCount: number,
): number {
  const ccw = signedArea2(poly, polyOffset, polyCount) >= 0;
  let src = buffers.scratchA;
  let dst = buffers.scratchB;
  let len = subjectLen;
  for (let e = 0; e < polyCount; e += 1) {
    const ai = ccw ? e : polyCount - 1 - e;
    const bi = ccw ? (e + 1) % polyCount : (polyCount - 2 - e + polyCount) % polyCount;
    const ax = poly[polyOffset + ai * 2]!;
    const ay = poly[polyOffset + ai * 2 + 1]!;
    const bx = poly[polyOffset + bi * 2]!;
    const by = poly[polyOffset + bi * 2 + 1]!;
    len = clipAgainstEdge(src, len, ax, ay, bx, by, dst);
    const swap = src;
    src = dst;
    dst = swap;
    if (len === 0) break;
  }
  return finishInScratchB(buffers, src, len);
}

// Clip the subject polygon (seeded in buffers.scratchA) against one ear-clip triangle piece (three polygon
// vertices named by earTriangles[piece*3 ..]), ping-ponging between scratchA and scratchB. Same
// CCW-reorient-then-left-of-edge rule as the convex path; the result is normalized into buffers.scratchB.
function clipSubjectAgainstTriangle(
  buffers: ClipBuffers,
  subjectLen: number,
  poly: Float64Array,
  earTriangles: Int32Array,
  piece: number,
): number {
  const t0 = earTriangles[piece * 3]!;
  const t1 = earTriangles[piece * 3 + 1]!;
  const t2 = earTriangles[piece * 3 + 2]!;
  const x0 = poly[t0 * 2]!;
  const y0 = poly[t0 * 2 + 1]!;
  const x1 = poly[t1 * 2]!;
  const y1 = poly[t1 * 2 + 1]!;
  const x2 = poly[t2 * 2]!;
  const y2 = poly[t2 * 2 + 1]!;
  const area2 = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  // A zero-area (collinear or unfilled) ear piece has no clip region: emit nothing rather than let the
  // zero-length edges pass every subject vertex through as a spurious full ring.
  if (area2 === 0) return 0;
  const ccw = area2 >= 0;
  // Edge endpoints in CCW order (0 -> 1 -> 2 -> 0), reversed when the world piece is CW.
  const px1 = ccw ? x1 : x2;
  const py1 = ccw ? y1 : y2;
  const px2 = ccw ? x2 : x1;
  const py2 = ccw ? y2 : y1;

  let src = buffers.scratchA;
  let dst = buffers.scratchB;
  let len = subjectLen;
  len = clipAgainstEdge(src, len, x0, y0, px1, py1, dst);
  let swap = src;
  src = dst;
  dst = swap;
  if (len > 0) {
    len = clipAgainstEdge(src, len, px1, py1, px2, py2, dst);
    swap = src;
    src = dst;
    dst = swap;
  }
  if (len > 0) {
    len = clipAgainstEdge(src, len, px2, py2, x0, y0, dst);
    swap = src;
    src = dst;
    dst = swap;
  }
  return finishInScratchB(buffers, src, len);
}

// Ensure the final clipped ring lives in buffers.scratchB (copying it from scratchA if the last pass landed
// there), so the emitter always reads scratchB. Returns the vertex count unchanged.
function finishInScratchB(buffers: ClipBuffers, resultBuffer: Float64Array, len: number): number {
  if (resultBuffer !== buffers.scratchB && len > 0) {
    const total = len * SUBJECT_STRIDE;
    for (let i = 0; i < total; i += 1) buffers.scratchB[i] = resultBuffer[i]!;
  }
  return len;
}

// Sutherland-Hodgman single-edge clip: keep the part of the subject polygon on the LEFT of (or on) the
// directed edge A -> B. Emits kept vertices and edge-crossing intersections (barycentrics lerped by the
// same t) into `out`; returns the output vertex count. Left-of test: cross(B-A, P-A) >= 0. `out` must be a
// distinct buffer from `subject` (the ping-pong guarantees this).
function clipAgainstEdge(
  subject: Float64Array,
  subjectLen: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: Float64Array,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  let outLen = 0;
  let sBase = (subjectLen - 1) * SUBJECT_STRIDE;
  let sInside = ex * (subject[sBase + 1]! - ay) - ey * (subject[sBase]! - ax) >= 0;
  for (let i = 0; i < subjectLen; i += 1) {
    const eBase = i * SUBJECT_STRIDE;
    const px = subject[eBase]!;
    const py = subject[eBase + 1]!;
    const eInside = ex * (py - ay) - ey * (px - ax) >= 0;
    if (eInside) {
      if (!sInside) {
        outLen = emitIntersection(subject, sBase, eBase, ax, ay, ex, ey, out, outLen);
      }
      copyVertex(subject, eBase, out, outLen * SUBJECT_STRIDE);
      outLen += 1;
    } else if (sInside) {
      outLen = emitIntersection(subject, sBase, eBase, ax, ay, ex, ey, out, outLen);
    }
    sBase = eBase;
    sInside = eInside;
  }
  return outLen;
}

// Emit the intersection of subject edge (S -> E) with the clip line through A along (ex, ey), lerping all
// five subject lanes (x, y, b0, b1, b2) by t = dS / (dS - dE), where d is the signed left-of distance.
function emitIntersection(
  subject: Float64Array,
  sBase: number,
  eBase: number,
  ax: number,
  ay: number,
  ex: number,
  ey: number,
  out: Float64Array,
  outLen: number,
): number {
  const dS = ex * (subject[sBase + 1]! - ay) - ey * (subject[sBase]! - ax);
  const dE = ex * (subject[eBase + 1]! - ay) - ey * (subject[eBase]! - ax);
  const denom = dS - dE;
  const t = denom !== 0 ? dS / denom : 0;
  const outBase = outLen * SUBJECT_STRIDE;
  for (let lane = 0; lane < SUBJECT_STRIDE; lane += 1) {
    const s = subject[sBase + lane]!;
    const e = subject[eBase + lane]!;
    out[outBase + lane] = s + t * (e - s);
  }
  return outLen + 1;
}

function copyVertex(src: Float64Array, srcBase: number, dst: Float64Array, dstBase: number): void {
  for (let lane = 0; lane < SUBJECT_STRIDE; lane += 1) dst[dstBase + lane] = src[srcBase + lane]!;
}

// Emit one clipped ring (from the SH scratch) into the pooled output buffers, dropping degenerate rings
// (fewer than 3 vertices, no area). Returns the number of vertices written (0 if dropped).
function emitRing(
  buffers: ClipBuffers,
  ringScratch: Float64Array,
  ringLen: number,
  sourceTri: number,
  ringIndex: number,
  vertexBase: number,
): number {
  if (ringLen < 3) return 0;
  for (let v = 0; v < ringLen; v += 1) {
    const base = v * SUBJECT_STRIDE;
    const outVertex = vertexBase + v;
    buffers.positions[outVertex * 2] = ringScratch[base]!;
    buffers.positions[outVertex * 2 + 1] = ringScratch[base + 1]!;
    buffers.bary[outVertex * 3] = ringScratch[base + 2]!;
    buffers.bary[outVertex * 3 + 1] = ringScratch[base + 3]!;
    buffers.bary[outVertex * 3 + 2] = ringScratch[base + 4]!;
  }
  buffers.ringVertexCount[ringIndex] = ringLen;
  buffers.ringSourceTri[ringIndex] = sourceTri;
  return ringLen;
}

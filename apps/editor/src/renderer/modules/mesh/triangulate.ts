import { MeshError } from './mesh-error';
import type { Point } from './point';

// EAR-CLIPPING polygon triangulation, implemented from first principles (TASK-2.1.4 / 2.1.7).
//
// Algorithm: the classic ear-clipping method (see Meisters, "Polygons have ears", 1975, and the standard
// computational-geometry textbook formulation, e.g. de Berg et al., "Computational Geometry", and David
// Eberly's "Triangulation by Ear Clipping" note). A simple polygon with n >= 3 vertices has at least two
// "ears": a vertex whose adjacent edge triangle contains no other polygon vertex. We repeatedly find an
// ear, emit its triangle, and remove the ear tip; n-2 triangles result. This is NOT a copy of earcut,
// cdt2d, poly2tri, or any Spine code; it is the canonical textbook procedure written here directly.
//
// Determinism: the polygon vertices are scanned in a FIXED order (ascending index, wrapping), the first
// valid ear found each pass is clipped, and all arithmetic is plain IEEE-754 on the inputs in input order,
// so the same input always yields byte-identical output (a Definition-of-Done requirement; reproducible
// fixtures depend on it).
//
// Failure: degenerate or self-intersecting input THROWS a typed MeshError instead of returning an empty or
// partial mesh (TASK-2.1.7). Returning [] silently would defer the failure to the format validator far
// from the cause; here the editor can surface "your outline is collinear / not simple" at the point of
// edit.
//
// Swap seam (the wrapper requirement): callers import ONLY `triangulate` from this file. The ear-clipping
// engine is the private `earClip` below. Swapping to earcut / cdt2d later is a one-file change: re-point
// `triangulate` at the new engine, keep the signature and the MeshError contract, and every call site and
// test is unaffected.

const EPSILON = 1e-9;

// Triangulate a simple polygon. `hull` is the ordered outline (CW or CCW); `interior` are extra points to
// be incorporated (grid-fill / added vertices). Returns a flat list of triangle INDEX triples into the
// combined vertex array `[...hull, ...interior]` (so index 0..hull.length-1 are hull points, the rest are
// interior points), matching the MeshGeometry `triangles` contract the document commands expect.
//
// `edges` is accepted for forward compatibility (a future constrained triangulation honoring required
// edges); the ear-clipping engine ignores it today but the parameter is part of the stable seam so adding
// constraint support later does not change call sites. When `interior` is empty this triangulates the hull
// alone; with interior points present they are folded in by inserting each into the triangle that contains
// it and re-fanning (a simple, deterministic incremental insertion sufficient for v1 meshes).
export function triangulate(
  hull: readonly Point[],
  interior: readonly Point[] = [],
  _edges?: readonly [number, number][],
): number[] {
  if (hull.length < 3) {
    throw new MeshError(
      'degenerate',
      `triangulate needs a hull of at least 3 points, received ${hull.length}`,
    );
  }
  const hullTriangles = earClip(hull);
  if (interior.length === 0) return hullTriangles;
  return insertInterior(hull, interior, hullTriangles);
}

// The ear-clipping engine over a single closed polygon. Operates on a linked list of remaining vertex
// indices and clips one ear per outer-loop pass. Private so the public `triangulate` is the only seam.
function earClip(polygon: readonly Point[]): number[] {
  const n = polygon.length;
  // The signed area decides the winding; we normalize ear tests to CCW so the convex/contains predicates
  // are sign-stable regardless of how the caller wound the outline. `verts` is the working cyclic list of
  // still-unclipped ORIGINAL vertex indices, in CCW order (reversed when the input was CW). Splicing out
  // an ear tip preserves the order, which keeps the output deterministic.
  const ccw = signedArea(polygon) > 0;
  const triangles: number[] = [];
  const verts: number[] = ccw ? polygon.map((_, i) => i) : reversedIndices(n);
  let guard = 0;
  const maxGuard = n * n; // a simple polygon clips in at most n-2 ears; n*n bounds pathological loops

  while (verts.length > 3) {
    let clipped = false;
    for (let i = 0; i < verts.length; i += 1) {
      const prev = verts[(i - 1 + verts.length) % verts.length]!;
      const curr = verts[i]!;
      const next = verts[(i + 1) % verts.length]!;
      if (isEar(polygon, verts, prev, curr, next)) {
        triangles.push(prev, curr, next);
        verts.splice(i, 1); // remove the ear tip
        clipped = true;
        break;
      }
    }
    guard += 1;
    if (!clipped || guard > maxGuard) {
      throw new MeshError(
        verts.length === polygon.length ? 'collinear' : 'notSimple',
        'ear-clipping made no progress: the polygon is collinear, degenerate, or self-intersecting',
      );
    }
  }
  // The final triangle.
  triangles.push(verts[0]!, verts[1]!, verts[2]!);
  return triangles;
}

// ORIGINAL indices listed in reversed order, used to flip a CW outline to CCW while keeping references to
// the caller's vertex array intact.
function reversedIndices(n: number): number[] {
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(i);
  return out;
}

// An ear at `curr` (with neighbors prev/next, all ORIGINAL indices) is convex AND its triangle contains no
// other remaining polygon vertex. Standard ear predicate; CCW-normalized so convexity is cross >= 0.
function isEar(
  polygon: readonly Point[],
  remaining: readonly number[],
  prev: number,
  curr: number,
  next: number,
): boolean {
  const a = polygon[prev]!;
  const b = polygon[curr]!;
  const c = polygon[next]!;
  if (cross(a, b, c) <= EPSILON) return false; // reflex or collinear tip: not an ear (in CCW order)
  for (const idx of remaining) {
    if (idx === prev || idx === curr || idx === next) continue;
    if (pointInTriangle(polygon[idx]!, a, b, c)) return false;
  }
  return true;
}

// 2D cross product of (b-a) x (c-a): positive => CCW turn at b.
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// Signed area (shoelace); positive for CCW input.
function signedArea(poly: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

// Point-in-triangle via the three half-plane signs (barycentric sign test), inclusive of edges within
// EPSILON so a vertex lying exactly on an ear edge still blocks the ear (avoids creating sliver overlaps).
function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const hasNeg = d1 < -EPSILON || d2 < -EPSILON || d3 < -EPSILON;
  const hasPos = d1 > EPSILON || d2 > EPSILON || d3 > EPSILON;
  return !(hasNeg && hasPos);
}

// Fold interior points into an already-triangulated hull by point-in-triangle location plus a local fan
// re-split: each interior point replaces the triangle that contains it with three triangles to its corners
// (a deterministic incremental insertion). Sufficient for v1 grid-fill meshes; the swap seam lets a future
// constrained Delaunay replace the whole module without touching callers. An interior point not inside any
// triangle is dropped (it lies outside the hull and cannot be skinned), keeping the output a valid manifold.
function insertInterior(
  hull: readonly Point[],
  interior: readonly Point[],
  hullTriangles: readonly number[],
): number[] {
  const points: Point[] = [...hull, ...interior];
  // Triangles as index triples; start from the hull triangulation.
  let tris: number[][] = [];
  for (let i = 0; i < hullTriangles.length; i += 3) {
    tris.push([hullTriangles[i]!, hullTriangles[i + 1]!, hullTriangles[i + 2]!]);
  }
  for (let k = 0; k < interior.length; k += 1) {
    const pIndex = hull.length + k;
    const p = points[pIndex]!;
    const containing = tris.findIndex((t) =>
      pointInTriangleInclusive(p, points[t[0]!]!, points[t[1]!]!, points[t[2]!]!),
    );
    if (containing === -1) continue; // outside the hull: skip
    const [a, b, c] = tris[containing]!;
    const next: number[][] = [];
    for (let t = 0; t < tris.length; t += 1) {
      if (t === containing) continue;
      next.push(tris[t]!);
    }
    next.push([a!, b!, pIndex], [b!, c!, pIndex], [c!, a!, pIndex]);
    tris = next;
  }
  const flat: number[] = [];
  for (const t of tris) flat.push(t[0]!, t[1]!, t[2]!);
  return flat;
}

function pointInTriangleInclusive(p: Point, a: Point, b: Point, c: Point): boolean {
  return pointInTriangle(p, a, b, c);
}

import { triangulate } from './triangulate';
import type { Point } from './point';

// AUTO GRID-FILL geometry (TASK-2.1.5): generate a regular interior grid of vertices over a hull's
// bounding box, KEEP only the grid points strictly inside the hull, then triangulate the hull plus those
// interior points into a manifold the AutoGridFillMesh command consumes. Pure and deterministic: the grid
// is walked in a fixed row-major order and the triangulation engine is deterministic, so the same hull and
// cell size always yield the same vertices and triangles.

// Axis-aligned bounds of a point set.
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundsOf(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// The interior grid points strictly inside `hull`, sampled at `cellSize` spacing across the hull's
// bounding box. A smaller cell size yields more vertices (the unit test pins this scaling). Points on or
// outside the hull boundary are excluded so they do not duplicate hull vertices or fall outside the mesh.
// Walked row-major (y outer, x inner) for a deterministic, stable vertex order.
export function interiorGridPoints(hull: readonly Point[], cellSize: number): Point[] {
  if (cellSize <= 0) return [];
  const { minX, minY, maxX, maxY } = boundsOf(hull);
  const points: Point[] = [];
  // Start one cell in from the min so samples sit in the interior rather than on the bounding edge.
  for (let y = minY + cellSize; y < maxY; y += cellSize) {
    for (let x = minX + cellSize; x < maxX; x += cellSize) {
      const p = { x, y };
      if (pointStrictlyInsidePolygon(p, hull)) points.push(p);
    }
  }
  return points;
}

// The full grid-fill result: the combined vertex list (hull first, then interior) and the triangle index
// triples into it. The combined order matches the triangulate contract (hull indices precede interior),
// which is the order the MeshAutoFill `vertices` stream and `triangles` expect.
export interface GridFillResult {
  readonly vertices: Point[]; // [...hull, ...interior]
  readonly triangles: number[]; // index triples into `vertices`
  readonly hullLength: number; // hull.length, so the command knows the hull/interior split
}

// Generate interior grid vertices clipped to the hull and triangulate hull + interior into one mesh.
export function gridFill(hull: readonly Point[], cellSize: number): GridFillResult {
  const interior = interiorGridPoints(hull, cellSize);
  const triangles = triangulate(hull, interior);
  return {
    vertices: [...hull, ...interior],
    triangles,
    hullLength: hull.length,
  };
}

// Even-odd (ray-crossing) point-in-polygon, STRICT: a point exactly on an edge or vertex is treated as
// outside, so interior grid samples never coincide with the hull boundary. Standard crossing-number test.
function pointStrictlyInsidePolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

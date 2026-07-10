import { pathCurveCount } from '../document';

// Pure geometry for the viewport Path tool overlay (PP-D11). No PixiJS, no document access: it turns a path
// attachment's flat control-point stream (local space) into the primitives the overlay draws (a flattened
// spline polyline, the draggable control-point dots tagged anchor vs handle, and the anchor-to-handle
// tethers). The PixiJS overlay (path-overlay.ts) maps these local points to screen space and strokes them;
// keeping the math here makes it unit-testable in the node vitest env, mirroring mesh-edit.ts under
// mesh-overlay.ts.

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

// A control point tagged for display: its flat-stream index, position, and whether it is a curve ANCHOR (on
// the spline) or a HANDLE (a Bezier control tangent). Anchors sit at stream indices that are multiples of 3.
export interface ControlPointHandle {
  readonly index: number;
  readonly point: Vec2;
  readonly role: 'anchor' | 'handle';
}

// A straight tether the overlay draws from an anchor to one of its Bezier handles, so the author sees which
// handle belongs to which anchor.
export interface HandleTether {
  readonly anchor: Vec2;
  readonly handle: Vec2;
}

// The default number of line segments the overlay samples per cubic curve. Fixed (not curvature-adaptive) so
// the flattened polyline is deterministic; 24 is smooth at typical authoring zoom.
export const DEFAULT_SEGMENTS_PER_CURVE = 24;

function pointFromFlat(vertices: readonly number[], index: number): Vec2 {
  return { x: vertices[index * 2] ?? 0, y: vertices[index * 2 + 1] ?? 0 };
}

// A single cubic Bezier point at parameter t, from the standard basis.
export function cubicPointAt(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

// The four control points of curve `index` in a spline of `pointCount` control points; a closed spline's
// final curve wraps its end anchor to point 0.
function curveControlIndices(
  index: number,
  pointCount: number,
  closed: boolean,
): [number, number, number, number] {
  const base = index * 3;
  const end = closed ? (base + 3) % pointCount : base + 3;
  return [base, base + 1, base + 2, end];
}

// Flatten the spline to a polyline the overlay strokes: `segmentsPerCurve` samples per curve, sharing the
// touching anchor between consecutive curves (so a C-curve open spline yields C*segments + 1 points). Returns
// an empty array when the control-point count does not fit a cubic spline of the given openness.
export function flattenPathSpline(
  vertices: readonly number[],
  closed: boolean,
  segmentsPerCurve: number = DEFAULT_SEGMENTS_PER_CURVE,
): Vec2[] {
  const pointCount = vertices.length / 2;
  const curves = pathCurveCount(pointCount, closed);
  if (curves === undefined || segmentsPerCurve < 1) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < curves; i += 1) {
    const [i0, i1, i2, i3] = curveControlIndices(i, pointCount, closed);
    const p0 = pointFromFlat(vertices, i0);
    const p1 = pointFromFlat(vertices, i1);
    const p2 = pointFromFlat(vertices, i2);
    const p3 = pointFromFlat(vertices, i3);
    // Include the start point once for the first curve; every curve then adds its samples for t in (0, 1].
    if (i === 0) out.push(p0);
    for (let s = 1; s <= segmentsPerCurve; s += 1) {
      out.push(cubicPointAt(p0, p1, p2, p3, s / segmentsPerCurve));
    }
  }
  return out;
}

// The draggable control points tagged anchor vs handle, in stream order (the index is the MovePathControlPoint
// pointIndex).
export function pathControlHandles(vertices: readonly number[]): ControlPointHandle[] {
  const pointCount = vertices.length / 2;
  const out: ControlPointHandle[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    out.push({
      index: i,
      point: pointFromFlat(vertices, i),
      role: i % 3 === 0 ? 'anchor' : 'handle',
    });
  }
  return out;
}

// The anchor-to-handle tethers, one per handle: each curve contributes its start anchor -> first handle and
// its end anchor -> second handle. Returns an empty array for an invalid control-point count.
export function pathHandleTethers(vertices: readonly number[], closed: boolean): HandleTether[] {
  const pointCount = vertices.length / 2;
  const curves = pathCurveCount(pointCount, closed);
  if (curves === undefined) return [];
  const out: HandleTether[] = [];
  for (let i = 0; i < curves; i += 1) {
    const [i0, i1, i2, i3] = curveControlIndices(i, pointCount, closed);
    out.push({ anchor: pointFromFlat(vertices, i0), handle: pointFromFlat(vertices, i1) });
    out.push({ anchor: pointFromFlat(vertices, i3), handle: pointFromFlat(vertices, i2) });
  }
  return out;
}

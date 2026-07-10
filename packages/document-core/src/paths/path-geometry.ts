// Pure, deterministic path geometry for the editable path attachment (PP-D11). No I/O, no solve, no
// document access: these operate on a flat list of 2D control-point positions (the setup-pose local
// coordinates the editor drags) and the `closed` flag, and return the cumulative arc-length table the
// format REQUIRES on every path attachment (ADR-0011 section 1). Authoring OWNS this table (a cubic
// Bezier's arc length has no closed form; the format commits the authored value so every runtime shares
// one number instead of each integrating and risking drift), so the command layer recomputes it here on
// every control-point edit.
//
// A path attachment is a piecewise cubic Bezier spline. Control points are laid out anchor, handle,
// handle, anchor, ... with consecutive curves SHARING their touching anchor (ADR-0011 section geometry):
//   open  spline of C curves: a0 h h a1 h h a2 ... a(C-1) h h aC   -> V = 3C + 1 points
//   closed spline of C curves: a0 h h a1 h h a2 ... a(C-1) h h     -> V = 3C     points (last wraps to a0)

// A 2D point in the attachment's local space.
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

// Gauss-Legendre 5-point rule on [-1, 1] (abscissae and weights). A degree-5 Gauss rule integrates
// polynomials up to degree 9 EXACTLY; in particular it integrates a constant exactly, which is what makes
// the evenly-spaced straight-line case return the endpoint distance to machine precision (see the tests).
// The integrand here is the SPEED |B'(t)| (the square root of a quartic), not a polynomial, so a single
// interval is not exact for a curved segment; we combine the rule with a pinned subdivision below for
// accuracy while keeping the computation fully deterministic.
const GL5_NODES = [
  0.0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664,
] as const;
const GL5_WEIGHTS = [
  0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891,
  0.2369268850561891,
] as const;

// Pinned subdivision: each curve's [0, 1] parameter interval is split into this many equal sub-intervals
// and the Gauss-Legendre rule is applied per sub-interval. Pinning the count (rather than adapting to a
// tolerance) keeps the result a pure, deterministic function of the control points, so the same rig always
// yields the same table. Sixteen sub-intervals with GL-5 (80 speed samples per curve) drives the relative
// error below ~1e-9 for typical authoring curves while staying cheap.
const ARC_LENGTH_SUBDIVISIONS = 16;

// The derivative of a cubic Bezier at parameter t along one axis, from the standard basis:
//   B'(t) = 3(1-t)^2 (p1-p0) + 6(1-t)t (p2-p1) + 3t^2 (p3-p2).
function cubicDerivative(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

// Arc length of a single cubic Bezier segment: the integral over t in [0, 1] of the speed |B'(t)|,
// evaluated by Gauss-Legendre quadrature over ARC_LENGTH_SUBDIVISIONS equal sub-intervals.
export function cubicBezierLength(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): number {
  const step = 1 / ARC_LENGTH_SUBDIVISIONS;
  const half = step / 2;
  let total = 0;
  for (let s = 0; s < ARC_LENGTH_SUBDIVISIONS; s += 1) {
    const mid = (s + 0.5) * step;
    for (let i = 0; i < GL5_NODES.length; i += 1) {
      const t = mid + half * GL5_NODES[i]!;
      const dx = cubicDerivative(p0.x, p1.x, p2.x, p3.x, t);
      const dy = cubicDerivative(p0.y, p1.y, p2.y, p3.y, t);
      total += GL5_WEIGHTS[i]! * Math.hypot(dx, dy);
    }
  }
  // Each sub-interval contributes (step / 2) * Sum(w_i f). The GL weights sum to 2, so the shared factor
  // is (step / 2) applied once to the accumulated sum.
  return total * half;
}

// The number of cubic curves a control-point count implies for the given openness, or undefined when the
// count does not fit a cubic spline (the PATH_VERTEX_COUNT rule, ADR-0011 section 1.3): closed needs
// V >= 3 and V % 3 == 0; open needs V >= 4 and (V - 1) % 3 == 0.
export function pathCurveCount(pointCount: number, closed: boolean): number | undefined {
  if (closed) {
    if (pointCount >= 3 && pointCount % 3 === 0) return pointCount / 3;
    return undefined;
  }
  if (pointCount >= 4 && (pointCount - 1) % 3 === 0) return (pointCount - 1) / 3;
  return undefined;
}

// The four control points of curve `index` in a spline of `points`. Consecutive curves share their
// touching anchor; a closed spline's final curve wraps its end anchor back to point 0.
function curveControlPoints(
  points: readonly Vec2[],
  index: number,
  closed: boolean,
): [Vec2, Vec2, Vec2, Vec2] {
  const base = index * 3;
  const endIndex = closed ? (base + 3) % points.length : base + 3;
  return [points[base]!, points[base + 1]!, points[base + 2]!, points[endIndex]!];
}

// The cumulative arc-length table the format stores on the path attachment: lengths[i] is the total arc
// length from the path start to the END of curve i, so the array is non-decreasing and its last entry is
// the whole path length. One entry per curve. Returns an empty array when the point count does not fit a
// cubic spline of the given openness (a shape the PATH_VERTEX_COUNT validator rejects; the caller never
// persists such a table).
export function computePathLengths(points: readonly Vec2[], closed: boolean): number[] {
  const curves = pathCurveCount(points.length, closed);
  if (curves === undefined) return [];
  const lengths = new Array<number>(curves);
  let cumulative = 0;
  for (let i = 0; i < curves; i += 1) {
    const [p0, p1, p2, p3] = curveControlPoints(points, i, closed);
    cumulative += cubicBezierLength(p0, p1, p2, p3);
    lengths[i] = cumulative;
  }
  return lengths;
}

// Read a flat, unweighted vertex stream ([x0, y0, x1, y1, ...]) as an array of points. The path attachment
// stores control points with the shared mesh vertex codec (ADR-0011 section 1.2); the EDITABLE path
// entity is the unweighted case, so its stream is a plain interleaved coordinate list.
export function pointsFromFlat(vertices: readonly number[]): Vec2[] {
  const points = new Array<Vec2>(vertices.length / 2);
  for (let i = 0; i < points.length; i += 1) {
    points[i] = { x: vertices[i * 2]!, y: vertices[i * 2 + 1]! };
  }
  return points;
}

// Flatten an array of points back to the interleaved unweighted vertex stream.
export function flatFromPoints(points: readonly Vec2[]): number[] {
  const vertices = new Array<number>(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    vertices[i * 2] = points[i]!.x;
    vertices[i * 2 + 1] = points[i]!.y;
  }
  return vertices;
}

// The cumulative arc-length table computed directly from an unweighted flat vertex stream, the form the
// command layer holds. A convenience over pointsFromFlat + computePathLengths.
export function computePathLengthsFromFlat(vertices: readonly number[], closed: boolean): number[] {
  return computePathLengths(pointsFromFlat(vertices), closed);
}

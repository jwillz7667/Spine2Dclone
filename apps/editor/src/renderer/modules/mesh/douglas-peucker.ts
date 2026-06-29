import type { Point } from './point';

// DOUGLAS-PEUCKER polyline simplification (TASK-2.1.6), from first principles.
//
// Algorithm: the Ramer-Douglas-Peucker recursive split-and-merge (Ramer 1972; Douglas & Peucker 1973).
// Given the two endpoints of a polyline, find the vertex with the greatest perpendicular distance to the
// segment between them. If that distance exceeds `tolerance`, keep the vertex and recurse on the two
// sub-polylines; otherwise discard every intermediate vertex (they are within tolerance of the chord).
// The result is a subset of the input points in the same order, with near-collinear runs collapsed. This
// is the textbook procedure written directly (no library).
//
// Determinism: a fixed recursive split on the single farthest vertex (lowest index wins a tie via the
// strict `> maxDist` comparison) gives the same output for the same input every time.
//
// Use: it post-processes the marching-squares contour (hundreds of axis-aligned pixel steps) down to the
// handful of real corners that seed a mesh hull. Operates on an OPEN polyline; the perimeter-trace caller
// passes the closed contour as an open run (first point repeated implicitly handled there).

// Simplify a polyline to the points whose perpendicular deviation from the running chord exceeds
// `tolerance`. A tolerance of 0 keeps ALL points (nothing is within zero distance of the chord unless it
// lies exactly on it; an exactly-collinear midpoint has distance 0 and IS removed, since 0 is not > 0).
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifyRange(points, 0, points.length - 1, tolerance, keep);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) out.push(points[i]!);
  }
  return out;
}

// Simplify a CLOSED contour (a polygon ring; the first point is NOT repeated at the end). A naive open
// simplify would force-keep both the first and last ring points even when they sit mid-edge, leaving a
// spurious corner (a traced rectangle would keep 5 points instead of 4). To simplify a ring correctly we
// anchor on the two FARTHEST-APART vertices (true corners on opposite sides of the ring), split the ring
// into the two arcs between them, simplify each arc as an open polyline, and concatenate. The two anchors
// are always kept; every other vertex survives only if it deviates beyond tolerance from its arc chord.
export function simplifyClosed(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 3) return points.slice();
  // Find the pair of vertices with the greatest separation to use as the two split anchors.
  let bestA = 0;
  let bestB = 1;
  let bestDistSq = -1;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = points[i]!.x - points[j]!.x;
      const dy = points[i]!.y - points[j]!.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > bestDistSq) {
        bestDistSq = distSq;
        bestA = i;
        bestB = j;
      }
    }
  }
  // Arc 1: bestA -> bestB (forward). Arc 2: bestB -> bestA (forward, wrapping).
  const arc1: Point[] = [];
  for (let i = bestA; i !== bestB; i = (i + 1) % n) arc1.push(points[i]!);
  arc1.push(points[bestB]!);
  const arc2: Point[] = [];
  for (let i = bestB; i !== bestA; i = (i + 1) % n) arc2.push(points[i]!);
  arc2.push(points[bestA]!);
  // Simplify each arc as an open polyline; the shared anchors are the arc endpoints (kept by simplify).
  // Concatenate dropping the duplicated trailing anchors so each ring vertex appears once.
  const s1 = simplify(arc1, tolerance);
  const s2 = simplify(arc2, tolerance);
  return [...s1.slice(0, -1), ...s2.slice(0, -1)];
}

// Recursively mark the farthest in-range vertex to keep when its deviation exceeds tolerance.
function simplifyRange(
  points: readonly Point[],
  first: number,
  last: number,
  tolerance: number,
  keep: boolean[],
): void {
  if (last <= first + 1) return; // no interior points between first and last
  const a = points[first]!;
  const b = points[last]!;
  let maxDist = -1;
  let maxIndex = -1;
  for (let i = first + 1; i < last; i += 1) {
    const dist = perpendicularDistance(points[i]!, a, b);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > tolerance && maxIndex !== -1) {
    keep[maxIndex] = true;
    simplifyRange(points, first, maxIndex, tolerance, keep);
    simplifyRange(points, maxIndex, last, tolerance, keep);
  }
  // else: every interior vertex is within tolerance of the chord, drop them all (already false).
}

// Perpendicular distance from `p` to the line through a-b. A degenerate (a == b) segment falls back to the
// point-to-endpoint distance so a closed run with coincident endpoints still measures sensibly.
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // |cross((p-a), (b-a))| / |b-a| is the unsigned perpendicular distance to the infinite line.
  const numerator = Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy);
  return numerator / Math.sqrt(lengthSq);
}

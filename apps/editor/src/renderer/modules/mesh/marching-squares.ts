import { MeshError } from './mesh-error';
import type { Point } from './point';

// MARCHING SQUARES alpha-silhouette contour tracing (TASK-2.1.6), from first principles.
//
// Algorithm: the standard Moore-neighbor / marching-squares boundary trace (see the classic
// marching-squares contouring method and the Moore boundary-tracing algorithm). We binarize the alpha
// mask at `threshold`, find the first opaque pixel in scan order, then walk the boundary keeping the
// opaque region on a consistent side, emitting one hull point per boundary step. The result is an ordered,
// closed contour polygon in PIXEL coordinates (x right, y down: image space, matching the trimmed-region
// convention in inspector-logic.ts where image-Y and world-Y share orientation). This is NOT copied from
// any library; it is the textbook procedure written directly.
//
// Output coordinates: the contour is traced on the GRID of pixel CENTERS, so a filled axis-aligned
// rectangle of opaque pixels from column c0..c1 and row r0..r1 yields a rectangular contour whose corners
// sit at the outer pixel centers (c0, r0)..(c1, r1). The downstream Douglas-Peucker simplify collapses the
// many collinear edge samples to the 4 corners (TASK-2.1.6), so the rectangle round-trips to 4 points
// within a pixel, which is the unit-test contract.
//
// Failure: a fully transparent mask (no pixel above threshold) THROWS MeshError('emptyMask') rather than
// returning an empty hull, so the editor surfaces "this sprite is fully transparent, nothing to trace".

export interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8Array | readonly number[]; // row-major, length width*height, 0..255
}

// Eight-connected Moore neighborhood offsets in CLOCKWISE order starting from the left neighbor; the trace
// rotates through these to find the next boundary pixel (Moore-neighbor tracing). Order is fixed so the
// trace is deterministic.
const MOORE: readonly Point[] = [
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
];

// Trace the alpha silhouette into an ordered, closed contour polygon (pixel-center coordinates). A pixel is
// opaque when its alpha is strictly greater than `threshold` (0..255). The contour winds CLOCKWISE in
// image space (y-down) and does not repeat the start point.
export function traceAlphaSilhouette(mask: AlphaMask, threshold: number): Point[] {
  const { width, height } = mask;
  if (width <= 0 || height <= 0) {
    throw new MeshError('emptyMask', `mask has non-positive size ${width}x${height}`);
  }
  const opaque = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return (mask.alpha[y * width + x] ?? 0) > threshold;
  };

  // Find the start: the first opaque pixel in row-major scan order. Its left neighbor is guaranteed empty
  // (it is the leftmost opaque pixel of the first opaque row reached), giving a valid backtrack seed.
  let start: Point | null = null;
  for (let y = 0; y < height && start === null; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (opaque(x, y)) {
        start = { x, y };
        break;
      }
    }
  }
  if (start === null) {
    throw new MeshError('emptyMask', 'alpha mask has no pixel above the threshold');
  }

  // Single opaque pixel: the contour is that one point (degenerate but valid; simplify keeps it).
  const contour: Point[] = [start];
  let current = start;
  // The pixel we entered `current` from (the previous boundary pixel). Seed with the empty left neighbor.
  let backtrack: Point = { x: start.x - 1, y: start.y };
  const maxSteps = width * height * 8 + 8; // bound the walk; a closed contour returns well within this

  for (let step = 0; step < maxSteps; step += 1) {
    // Begin scanning the Moore neighborhood at the position just clockwise from the backtrack direction.
    const startDir = mooreIndexOf(current, backtrack);
    let found: Point | null = null;
    let prevEmpty = backtrack;
    for (let k = 1; k <= MOORE.length; k += 1) {
      const dir = MOORE[(startDir + k) % MOORE.length]!;
      const cand = { x: current.x + dir.x, y: current.y + dir.y };
      if (opaque(cand.x, cand.y)) {
        found = cand;
        break;
      }
      prevEmpty = cand; // the last empty cell before the found opaque one becomes the next backtrack
    }
    if (found === null) break; // isolated pixel: contour is just the start
    backtrack = prevEmpty;
    // Closed the loop: returned to the start having left it at least once.
    if (found.x === start.x && found.y === start.y && contour.length > 1) break;
    contour.push(found);
    current = found;
  }
  return contour;
}

// The Moore-ring index (0..7) of neighbor `from` relative to `center`. Used to resume the clockwise scan
// just past the cell we backtracked from.
function mooreIndexOf(center: Point, from: Point): number {
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  for (let i = 0; i < MOORE.length; i += 1) {
    if (MOORE[i]!.x === dx && MOORE[i]!.y === dy) return i;
  }
  return 0; // backtrack not adjacent (shouldn't happen): default to the left neighbor slot
}

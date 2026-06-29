import type { CurveType, LifeCurve, RGB } from '@marionette/format/types';
import { BEZIER_SEGMENTS, buildBezierTable, evalBezierY } from '../skeleton/curve';

// Over-life / over-length curve evaluation (phase-3-vfx-particles.md section 8.5, WP-3.2). A LifeCurve
// is a list of stops over the normalized parameter u in [0, 1]; eval finds the bracketing segment
// [t_i, t_{i+1}], normalizes n = (u - t_i)/(t_{i+1} - t_i), applies the segment's CurveType easing via
// the SAME BEZIER_SEGMENTS sampling the skeletal animation sampler uses (one math path, R3.6), and
// interpolates the value. u <= 0 clamps to the first stop; u >= 1 clamps to the last. There is no
// second easing implementation: bezier easing routes through buildBezierTable/evalBezierY from the
// skeleton curve module. No PixiJS, no DOM.

// A scalar LifeCurve prepared for allocation-free evaluation: the stop times, the scalar values, and a
// per-segment easing descriptor. Bezier tables are precomputed ONCE here (at instance creation), so the
// per-step eval never allocates. Segment i eases the transition from stop i to stop i+1.
export interface PreparedLifeCurveNumber {
  readonly times: Float64Array; // stop t values, strictly increasing, first === 0, last === 1
  readonly values: Float64Array; // stop scalar values
  readonly kinds: Uint8Array; // per-segment easing kind (CURVE_LINEAR/STEPPED/BEZIER)
  readonly bezierBase: Int32Array; // per-segment base offset into bezierTable, or -1 if not bezier
  readonly bezierTable: Float64Array; // packed (x, y) bezier sample pairs for all bezier segments
  readonly stopCount: number;
}

// An RGB LifeCurve prepared the same way, with three value lanes per stop interpolated independently.
export interface PreparedLifeCurveRgb {
  readonly times: Float64Array;
  readonly r: Float64Array;
  readonly g: Float64Array;
  readonly b: Float64Array;
  readonly kinds: Uint8Array;
  readonly bezierBase: Int32Array;
  readonly bezierTable: Float64Array;
  readonly stopCount: number;
}

const CURVE_LINEAR = 0;
const CURVE_STEPPED = 1;
const CURVE_BEZIER = 2;

// Classify one stop's outgoing curve and, if bezier, append its sampled table to `lanes`, returning the
// base offset (or -1). Mirrors the skeleton curve module's CURVE_* mapping so the eval shares one math
// path. The last stop has no outgoing segment, so its curve is ignored by the caller.
function prepareSegment(
  curve: CurveType,
  kinds: Uint8Array,
  bezierBase: Int32Array,
  index: number,
  lanes: number[],
): void {
  if (typeof curve === 'object') {
    kinds[index] = CURVE_BEZIER;
    bezierBase[index] = lanes.length;
    const table = buildBezierTable(curve.cx1, curve.cy1, curve.cx2, curve.cy2);
    for (let k = 0; k < table.length; k += 1) lanes.push(table[k]!);
  } else if (curve === 'stepped') {
    kinds[index] = CURVE_STEPPED;
    bezierBase[index] = -1;
  } else {
    kinds[index] = CURVE_LINEAR;
    bezierBase[index] = -1;
  }
}

export function prepareLifeCurveNumber(curve: LifeCurve<number>): PreparedLifeCurveNumber {
  const stops = curve.stops;
  const stopCount = stops.length;
  const times = new Float64Array(stopCount);
  const values = new Float64Array(stopCount);
  const kinds = new Uint8Array(stopCount);
  const bezierBase = new Int32Array(stopCount).fill(-1);
  const lanes: number[] = [];
  for (let i = 0; i < stopCount; i += 1) {
    const stop = stops[i]!;
    times[i] = stop.t;
    values[i] = stop.value;
    // Only a non-final stop has an outgoing segment to ease.
    if (i < stopCount - 1) prepareSegment(stop.curve, kinds, bezierBase, i, lanes);
  }
  return {
    times,
    values,
    kinds,
    bezierBase,
    bezierTable: new Float64Array(lanes),
    stopCount,
  };
}

export function prepareLifeCurveRgb(curve: LifeCurve<RGB>): PreparedLifeCurveRgb {
  const stops = curve.stops;
  const stopCount = stops.length;
  const times = new Float64Array(stopCount);
  const r = new Float64Array(stopCount);
  const g = new Float64Array(stopCount);
  const b = new Float64Array(stopCount);
  const kinds = new Uint8Array(stopCount);
  const bezierBase = new Int32Array(stopCount).fill(-1);
  const lanes: number[] = [];
  for (let i = 0; i < stopCount; i += 1) {
    const stop = stops[i]!;
    times[i] = stop.t;
    r[i] = stop.value.r;
    g[i] = stop.value.g;
    b[i] = stop.value.b;
    if (i < stopCount - 1) prepareSegment(stop.curve, kinds, bezierBase, i, lanes);
  }
  return {
    times,
    r,
    g,
    b,
    kinds,
    bezierBase,
    bezierTable: new Float64Array(lanes),
    stopCount,
  };
}

// The bracketing segment index for parameter u: the greatest i with times[i] <= u, clamped to
// [0, stopCount - 2] so a successor stop always exists. Below the first stop returns 0; at or above the
// last returns the last segment. A small linear scan (LifeCurves have a handful of stops); allocation
// free. This mirrors the skeleton findSegmentIndex contract but over the normalized [0, 1] parameter.
function segmentIndex(times: Float64Array, stopCount: number, u: number): number {
  const lastSeg = stopCount - 2;
  if (u <= times[0]!) return 0;
  if (u >= times[stopCount - 1]!) return lastSeg;
  let i = 0;
  while (i < lastSeg && times[i + 1]! <= u) i += 1;
  return i;
}

// The eased interpolation fraction within segment i at parameter u (the same shape as the skeleton's
// segmentFraction). Stepped holds the start value (returns 0); linear is the normalized position;
// bezier is the eased y read from the precomputed table. u clamped to the segment; the span guard
// avoids NaN on a degenerate (zero-width) segment that the validator forbids anyway.
function segmentFraction(
  times: Float64Array,
  kinds: Uint8Array,
  bezierBase: Int32Array,
  bezierTable: Float64Array,
  i: number,
  u: number,
): number {
  const kind = kinds[i]!;
  if (kind === CURVE_STEPPED) return 0;
  const t0 = times[i]!;
  const span = times[i + 1]! - t0;
  let nx = span > 0 ? (u - t0) / span : 0;
  if (nx <= 0) return 0;
  if (nx > 1) nx = 1;
  if (kind === CURVE_BEZIER) return evalBezierY(bezierTable, bezierBase[i]!, nx);
  return nx;
}

// Evaluate a scalar LifeCurve at u in [0, 1]. Clamps outside the range. Allocation-free.
export function evalLifeCurveNumber(curve: PreparedLifeCurveNumber, u: number): number {
  const { times, values, kinds, bezierBase, bezierTable, stopCount } = curve;
  if (u <= times[0]!) return values[0]!;
  if (u >= times[stopCount - 1]!) return values[stopCount - 1]!;
  const i = segmentIndex(times, stopCount, u);
  const f = segmentFraction(times, kinds, bezierBase, bezierTable, i, u);
  const a = values[i]!;
  const b = values[i + 1]!;
  return a + (b - a) * f;
}

// The render-color output is three channels; eval writes them into the pool's outR/outG/outB lanes at
// the given slot, so the caller passes the buffers directly (no tuple allocation in the step path).
export function evalLifeCurveRgbInto(
  curve: PreparedLifeCurveRgb,
  u: number,
  outR: Float64Array,
  outG: Float64Array,
  outB: Float64Array,
  slot: number,
): void {
  const { times, r, g, b, kinds, bezierBase, bezierTable, stopCount } = curve;
  if (u <= times[0]!) {
    outR[slot] = r[0]!;
    outG[slot] = g[0]!;
    outB[slot] = b[0]!;
    return;
  }
  if (u >= times[stopCount - 1]!) {
    outR[slot] = r[stopCount - 1]!;
    outG[slot] = g[stopCount - 1]!;
    outB[slot] = b[stopCount - 1]!;
    return;
  }
  const i = segmentIndex(times, stopCount, u);
  const f = segmentFraction(times, kinds, bezierBase, bezierTable, i, u);
  outR[slot] = r[i]! + (r[i + 1]! - r[i]!) * f;
  outG[slot] = g[i]! + (g[i + 1]! - g[i]!) * f;
  outB[slot] = b[i]! + (b[i + 1]! - b[i]!) * f;
}

// The bezier sample resolution this module shares with the skeletal sampler, re-exported so a consumer
// (the designer preview, a conformance probe) can assert the one-math-path property without reaching
// into the skeleton module.
export { BEZIER_SEGMENTS };

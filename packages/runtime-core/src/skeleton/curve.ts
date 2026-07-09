import type {
  BoneTimelines,
  DrawOrderKeyframe,
  IkFrame,
  Keyframe,
  RGBA,
  SlotTimelines,
  TransformFrame,
} from '@marionette/format/types';
import type {
  PreparedAttachmentTrack,
  PreparedDrawOrderTimeline,
  PreparedStepBoolTrack,
  PreparedTrack,
} from './prepared';

// Timeline curve evaluation and the solve-side track representation (WP-1.4, section 8.3, LAW 4).
// This is OUR first-principles bezier easing: no Spine source, no iterative root finding. The cubic
// is sampled on build into a fixed (x,y) table; sampling brackets by x and lerps y. No PixiJS, no
// DOM, no Date.now or Math.random (the solve is a pure function of document and time).

// The piecewise-linear resolution of the bezier easing curve (section 8.3). A committed design
// constant: it is cheap and deterministic, can show mild faceting on very slow eases, and raising it
// changes solve output, so it is a deliberate fixture-regenerating change, not an ad hoc tunable.
export const BEZIER_SEGMENTS = 10;

// BEZIER_SEGMENTS segments means BEZIER_SEGMENTS + 1 sampled points, each an (x, y) pair (2 lanes).
const BEZIER_POINTS = BEZIER_SEGMENTS + 1;

// Segment curve kinds, stored as small ints in PreparedTrack.curveKinds.
const CURVE_LINEAR = 0;
const CURVE_STEPPED = 1;
const CURVE_BEZIER = 2;

// A cubic bezier coordinate at parameter s, expanded form (no fused multiply-add reassociation, so
// other runtimes can match the operation order; section 8.3). P0 and P3 are the implicit easing
// endpoints (0 and 1); P1 and P2 are a control component (cx/cy).
function bezier1d(p0: number, p1: number, p2: number, p3: number, s: number): number {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}

// Sample the easing cubic at BEZIER_SEGMENTS equal-parameter steps into (x, y) pairs and append them
// to `out`. Endpoints are implicit (0,0) and (1,1); control points are (cx1,cy1), (cx2,cy2). The
// build-time assertion guards section 8.3's monotonic-x property (the format constrains cx1,cx2 to
// [0,1], which makes X(s) non-decreasing); if a future change ever breaks it the bracket lookup would
// be ill-defined, so we fail loudly at build rather than sample garbage.
function appendBezierTable(
  out: number[],
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
): void {
  let previousX = Number.NEGATIVE_INFINITY;
  for (let k = 0; k <= BEZIER_SEGMENTS; k += 1) {
    const s = k / BEZIER_SEGMENTS;
    const x = bezier1d(0, cx1, cx2, 1, s);
    const y = bezier1d(0, cy1, cy2, 1, s);
    if (x < previousX) {
      throw new Error(
        `bezier x table is not non-decreasing at s=${s} (x=${x} < previous ${previousX}); ` +
          'control x must be within [0, 1] (validator CURVE_BEZIER_X_RANGE)',
      );
    }
    previousX = x;
    out.push(x, y);
  }
}

// Evaluate the eased y for normalized input nx in (0, 1], reading the packed (x,y) table at `base`.
// Deterministic tie-break (section 8.3): find the LOWEST point index j with x[j] >= nx (lower bound),
// take the segment [j-1, j]; if that segment is flat (x1 == x0) return y0, otherwise lerp y by the
// position of nx within [x0, x1]. The denominator guard makes a flat spot return y0 rather than NaN
// and keeps the result independent of search direction.
export function evalBezierY(table: Float64Array, base: number, nx: number): number {
  let lo = 0;
  let hi = BEZIER_POINTS - 1; // x[hi] == 1 >= nx for nx in (0, 1], so a bound always exists
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (table[base + mid * 2]! >= nx) hi = mid;
    else lo = mid + 1;
  }
  // lo is the lowest index whose x >= nx. The bracketing segment is [lo-1, lo]; if nx sits at or below
  // x[0] (== 0) use the first segment [0, 1].
  const j = lo === 0 ? 1 : lo;
  const k = j - 1;
  const x0 = table[base + k * 2]!;
  const x1 = table[base + j * 2]!;
  const y0 = table[base + k * 2 + 1]!;
  const y1 = table[base + j * 2 + 1]!;
  const span = x1 - x0;
  if (span <= 0) return y0;
  return y0 + ((y1 - y0) * (nx - x0)) / span;
}

// Build a standalone packed bezier table (BEZIER_POINTS (x,y) pairs). Used by the unit tests to probe
// the eval directly; the solve packs many segments into one PreparedTrack.bezierTable instead.
export function buildBezierTable(cx1: number, cy1: number, cx2: number, cy2: number): Float64Array {
  const lanes: number[] = [];
  appendBezierTable(lanes, cx1, cy1, cx2, cy2);
  return new Float64Array(lanes);
}

// Build a numeric PreparedTrack from keyframes. `writeValue` copies one keyframe's components into the
// packed values buffer; passing it keeps the time/curve/bezier bookkeeping in one place across the
// scalar, vec2, and color channels. Bezier tables are precomputed here, once.
function buildTrack<TValue>(
  keys: readonly Keyframe<TValue>[],
  componentCount: number,
  writeValue: (key: Keyframe<TValue>, out: Float64Array, base: number) => void,
): PreparedTrack {
  const keyCount = keys.length;
  const times = new Float64Array(keyCount);
  const values = new Float64Array(keyCount * componentCount);
  const curveKinds = new Uint8Array(keyCount);
  const bezierBase = new Int32Array(keyCount).fill(-1);
  const bezierLanes: number[] = [];

  for (let i = 0; i < keyCount; i += 1) {
    const key = keys[i]!;
    times[i] = key.time;
    writeValue(key, values, i * componentCount);

    const curve = key.curve;
    if (typeof curve === 'object') {
      curveKinds[i] = CURVE_BEZIER;
      // Only a non-final keyframe has an outgoing segment to ease; the last curve is ignored.
      if (i < keyCount - 1) {
        bezierBase[i] = bezierLanes.length;
        appendBezierTable(bezierLanes, curve.cx1, curve.cy1, curve.cx2, curve.cy2);
      }
    } else if (curve === 'stepped') {
      curveKinds[i] = CURVE_STEPPED;
    } else {
      curveKinds[i] = CURVE_LINEAR;
    }
  }

  return {
    keyCount,
    componentCount,
    times,
    values,
    curveKinds,
    bezierBase,
    bezierTable: new Float64Array(bezierLanes),
  };
}

type RotateKeys = NonNullable<BoneTimelines['rotate']>;
type Vec2Keys = NonNullable<BoneTimelines['translate']>;
type ColorKeys = NonNullable<SlotTimelines['color']>;
type AttachmentFrames = NonNullable<SlotTimelines['attachment']>;

export function buildScalarTrack(keys: RotateKeys): PreparedTrack {
  return buildTrack(keys, 1, (key, out, base) => {
    out[base] = key.value.angle;
  });
}

export function buildVec2Track(keys: Vec2Keys): PreparedTrack {
  return buildTrack(keys, 2, (key, out, base) => {
    out[base] = key.value.x;
    out[base + 1] = key.value.y;
  });
}

export function buildColorTrack(keys: ColorKeys): PreparedTrack {
  return buildTrack(keys, 4, (key, out, base) => {
    const color: RGBA = key.value.color;
    out[base] = color.r;
    out[base + 1] = color.g;
    out[base + 2] = color.b;
    out[base + 3] = color.a;
  });
}

// The scalar `mix` channel of an IK timeline: one interpolated lane read from each IkFrame.mix.
export function buildIkMixTrack(frames: readonly Keyframe<IkFrame>[]): PreparedTrack {
  return buildTrack(frames, 1, (key, out, base) => {
    out[base] = key.value.mix;
  });
}

// The bend-direction channel of an IK timeline: stepped (ADR-0003 section 7), so it carries no curve
// and no eased value, only the 0/1 flag held until the next key. The format keys the signed `bend`
// (ADR-0009); the stored flag is 1 when bend > 0, matching the pre-0.4.0 `bendPositive` boolean exactly.
export function buildBendTrack(frames: readonly Keyframe<IkFrame>[]): PreparedStepBoolTrack {
  const keyCount = frames.length;
  const times = new Float64Array(keyCount);
  const values = new Uint8Array(keyCount);
  for (let i = 0; i < keyCount; i += 1) {
    const frame = frames[i]!;
    times[i] = frame.time;
    values[i] = frame.value.bend > 0 ? 1 : 0;
  }
  return { keyCount, times, values };
}

// One mix channel of a transform-constraint timeline. The channel is built from ONLY the keyframes
// that key it (the chosen absent-channel semantics, documented in sample.ts): each kept keyframe's
// outgoing curve drives the segment to the next kept keyframe. A channel no keyframe keys yields null,
// and step 2 then holds the constraint's base value for it. Returns null for an all-absent channel.
export function buildTransformMixTrack(
  frames: readonly Keyframe<TransformFrame>[],
  channel: keyof TransformFrame,
): PreparedTrack | null {
  const present = frames.filter((frame) => frame.value[channel] !== undefined);
  if (present.length === 0) return null;
  return buildTrack(present, 1, (key, out, base) => {
    out[base] = key.value[channel] ?? 0;
  });
}

// A deform timeline flattened to one track: `componentCount` == 2 * vertexCount lanes (the flat
// [dx0, dy0, dx1, dy1, ...] offsets) interpolated together by the keyframe curve. All keyframes share
// the same offsets length (the validated DEFORM_OFFSET_LENGTH invariant); the first key sizes the
// track. An empty timeline never reaches here (the caller drops zero-key channels).
export function buildDeformTrack(
  frames: readonly Keyframe<{ offsets: number[] }>[],
): PreparedTrack {
  const componentCount = frames[0]?.value.offsets.length ?? 0;
  return buildTrack(frames, componentCount, (key, out, base) => {
    const offsets = key.value.offsets;
    for (let c = 0; c < componentCount; c += 1) {
      out[base + c] = offsets[c]!;
    }
  });
}

export function buildAttachmentTrack(frames: AttachmentFrames): PreparedAttachmentTrack {
  const keyCount = frames.length;
  const times = new Float64Array(keyCount);
  const names: (string | null)[] = new Array<string | null>(keyCount).fill(null);
  for (let i = 0; i < keyCount; i += 1) {
    const frame = frames[i]!;
    times[i] = frame.time;
    names[i] = frame.name;
  }
  return { keyCount, times, names };
}

// The segment index for time t: the greatest i with times[i] <= t, clamped to [0, keyCount-1]. Below
// the first key it returns 0 and at or above the last key it returns the last index, which is how the
// sampler clamps within the period (TASK-1.4.1). It does NOT wrap; looping is the transport's job.
export function findSegmentIndex(times: Float64Array, keyCount: number, t: number): number {
  const last = keyCount - 1;
  if (t <= times[0]!) return 0;
  if (t >= times[last]!) return last;
  let lo = 0;
  let hi = last; // invariant: times[lo] <= t < times[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

// The interpolation fraction within segment i at time t, honoring the segment's curve. Returns 0 for
// stepped (hold the start value), for the clamped-after-last segment (no successor), and below the
// segment start; for linear it is the normalized position, for bezier it is the eased y. The time
// denominator is positive by the validated strict-ascending invariant; the guard only avoids NaN if
// that invariant is ever violated, it is not a correctness branch for valid input.
export function segmentFraction(track: PreparedTrack, i: number, t: number): number {
  if (i + 1 >= track.keyCount) return 0;
  const kind = track.curveKinds[i]!;
  if (kind === CURVE_STEPPED) return 0;

  const t0 = track.times[i]!;
  const span = track.times[i + 1]! - t0;
  let nx = span > 0 ? (t - t0) / span : 0;
  if (nx <= 0) return 0;
  if (nx > 1) nx = 1;

  if (kind === CURVE_BEZIER) return evalBezierY(track.bezierTable, track.bezierBase[i]!, nx);
  return nx;
}

// Component c of segment i interpolated by fraction f. At the clamped-after-last index there is no
// successor keyframe, so the start value is returned (the held last value).
export function segmentComponent(track: PreparedTrack, i: number, f: number, c: number): number {
  const cc = track.componentCount;
  const a = track.values[i * cc + c]!;
  if (i + 1 >= track.keyCount) return a;
  const b = track.values[(i + 1) * cc + c]!;
  return a + (b - a) * f;
}

// The active attachment name at time t (stepped: hold the segment-start name until the next key,
// clamped within the period). Returns the name string or null (null shows nothing).
export function sampleAttachmentName(track: PreparedAttachmentTrack, t: number): string | null {
  const i = findSegmentIndex(track.times, track.keyCount, t);
  return track.names[i] ?? null;
}

// The boolean value at time t (stepped: hold the segment-start flag until the next key, clamped within
// the period), used for the IkFrame `bend` direction (ADR-0003 section 7).
export function sampleStepBool(track: PreparedStepBoolTrack, t: number): boolean {
  const i = findSegmentIndex(track.times, track.keyCount, t);
  return track.values[i] === 1;
}

// The index of the active draw-order key at time t: the LATEST key at or before t (stepped). Returns -1
// when t is below the first key, meaning NO reorder is active yet and the setup order holds (ADR-0008:
// "empty means setup order" extends to "before the first key means setup order"). This differs from the
// value/attachment channels' below-first-key clamp on purpose: draw order treats setup order as the
// identity a key departs from, so before any key the pose is setup, not the first key's reorder.
export function findDrawOrderKeyIndex(timeline: PreparedDrawOrderTimeline, t: number): number {
  const { keyCount, times } = timeline;
  if (keyCount === 0 || t < times[0]!) return -1;
  // Linear scan from the end for the last key with time <= t. Draw-order timelines are short (a handful
  // of reorders per clip), so a scan is cheaper than a binary search and allocation-free.
  for (let i = keyCount - 1; i >= 0; i -= 1) {
    if (times[i]! <= t) return i;
  }
  return -1;
}

// Build a prepared draw-order timeline (ADR-0008 section 3, PP-B4): resolve each key's compact
// {slot, offset} list into a FULL render-order permutation ONCE at build time, so step-2 application is
// a single typed-array copy with zero per-frame allocation. Build-time only.
export function buildDrawOrderTimeline(
  keys: readonly DrawOrderKeyframe[],
  slotIndexByName: ReadonlyMap<string, number>,
  slotCount: number,
): PreparedDrawOrderTimeline {
  const keyCount = keys.length;
  const times = new Float64Array(keyCount);
  const orders: Int32Array[] = [];
  for (let k = 0; k < keyCount; k += 1) {
    const key = keys[k]!;
    times[k] = key.time;
    orders.push(resolveDrawOrder(key.offsets, slotIndexByName, slotCount));
  }
  return { keyCount, times, orders };
}

// Derive ONE key's full render-order permutation from its offset diff (ADR-0008 section 3). Each listed
// slot is pinned to its target render position (setup index + offset); every unlisted slot keeps its
// relative setup order, filling the remaining positions front-to-back. The result is order[pos] = slot.
// The validator guarantees the listed targets are in range and collision-free for a validated document;
// out-of-range or unknown-slot entries (only reachable from an unvalidated draft) are skipped defensively.
function resolveDrawOrder(
  offsets: DrawOrderKeyframe['offsets'],
  slotIndexByName: ReadonlyMap<string, number>,
  slotCount: number,
): Int32Array {
  const order = new Int32Array(slotCount).fill(-1);
  const listed = new Uint8Array(slotCount);
  for (let o = 0; o < offsets.length; o += 1) {
    const entry = offsets[o]!;
    const slotIndex = slotIndexByName.get(entry.slot) ?? -1;
    if (slotIndex < 0) continue;
    const target = slotIndex + entry.offset;
    if (target < 0 || target >= slotCount) continue;
    order[target] = slotIndex;
    listed[slotIndex] = 1;
  }
  let nextUnlisted = 0;
  for (let pos = 0; pos < slotCount; pos += 1) {
    if (order[pos] !== -1) continue;
    while (nextUnlisted < slotCount && listed[nextUnlisted] === 1) nextUnlisted += 1;
    order[pos] = nextUnlisted;
    nextUnlisted += 1;
  }
  return order;
}

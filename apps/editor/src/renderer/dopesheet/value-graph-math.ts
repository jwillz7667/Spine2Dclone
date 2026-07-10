import type { CurveType } from '@marionette/format/types';
import { sampleCurve, type CurvePoint } from './curve-preview';
import { clamp, timeToX, xToTime, type DopesheetView } from './timeline-math';
import type { ValueKey, ValueLane } from './value-graph-channels';

// Pure math for the value-vs-time graph editor (PP-D3): the vertical value<->pixel transform, key/handle
// hit-testing, the value-space curve polyline, and the load-bearing value<->normalized bezier-handle
// mapping. The horizontal axis reuses the dopesheet's time<->pixel transform (timeline-math) so the graph
// and the dopesheet pan/zoom together. No React, no DOM, no PixiJS: exhaustively unit-tested.

export type BezierCurve = Extract<CurveType, { type: 'bezier' }>;
export type BezierHandle = 'p1' | 'p2';

// The vertical view: the value range [vMin, vMax] mapped across `heightPx` pixels, inset by `padPx` top and
// bottom so keys never sit on the panel edge. Higher values map to SMALLER y (screen up). valueToY and
// yToValue are exact inverses for any vMax > vMin.
export interface ValueView {
  readonly vMin: number;
  readonly vMax: number;
  readonly heightPx: number;
  readonly padPx: number;
}

export const DEFAULT_VALUE_VIEW: ValueView = { vMin: -1, vMax: 1, heightPx: 200, padPx: 16 };

function plotHeight(view: ValueView): number {
  return Math.max(1, view.heightPx - 2 * view.padPx);
}

export function valueToY(view: ValueView, value: number): number {
  const span = view.vMax - view.vMin;
  const frac = span > 0 ? (value - view.vMin) / span : 0.5;
  return view.padPx + (1 - frac) * plotHeight(view);
}

export function yToValue(view: ValueView, y: number): number {
  const frac = (y - view.padPx) / plotHeight(view);
  return view.vMin + (1 - frac) * (view.vMax - view.vMin);
}

// Frame a value window around [min, max] with symmetric margin. A flat set (min == max, e.g. a single key or
// a constant channel) expands to a unit window centered on the value so the line still sits mid-panel. An
// empty extent falls back to the default window's value span.
export function frameValueView(
  extent: readonly [number, number] | null,
  heightPx: number,
  padPx: number,
  marginFrac: number,
): ValueView {
  if (extent === null) {
    return { vMin: DEFAULT_VALUE_VIEW.vMin, vMax: DEFAULT_VALUE_VIEW.vMax, heightPx, padPx };
  }
  const [min, max] = extent;
  const span = max - min;
  if (span <= 0) return { vMin: min - 1, vMax: min + 1, heightPx, padPx };
  const margin = span * marginFrac;
  return { vMin: min - margin, vMax: max + margin, heightPx, padPx };
}

// Frame the time axis around [t0, t1] across `widthPx` pixels with symmetric margin, returning the horizontal
// pan/zoom the dopesheet view uses. A zero-width time extent (a single key time) centers a default one-second
// window on it. An empty extent frames [0, 1]. scrollY is preserved by the caller (this only sets x).
export function frameTimeView(
  extent: readonly [number, number] | null,
  widthPx: number,
  marginFrac: number,
): { readonly scrollX: number; readonly zoomX: number } {
  const width = Math.max(1, widthPx);
  const [t0, t1] = extent ?? [0, 1];
  const rawSpan = t1 - t0;
  // A zero-width extent (a single key time) gets a default one-second window CENTERED on it, so the lone key
  // sits mid-panel rather than hugging the left edge.
  const span = rawSpan > 0 ? rawSpan : 1;
  const base = rawSpan > 0 ? t0 : t0 - span / 2;
  const margin = span * marginFrac;
  const lo = base - margin;
  const spanWithMargin = span + 2 * margin;
  const zoomX = width / spanWithMargin;
  // scrollX so that timeToX(view, lo) === 0: timeToX = time*zoomX - scrollX.
  const scrollX = lo * zoomX;
  return { scrollX, zoomX };
}

// Zoom the value axis around a fixed screen y (the cursor), keeping the value under it stationary. factor > 1
// zooms in (a smaller value span, more detail); the value at anchorY maps back to anchorY afterwards.
export function zoomValueViewAround(view: ValueView, anchorY: number, factor: number): ValueView {
  const anchorValue = yToValue(view, anchorY);
  const fracFromBottom = (anchorValue - view.vMin) / (view.vMax - view.vMin || 1);
  const span = (view.vMax - view.vMin) / factor;
  const vMin = anchorValue - fracFromBottom * span;
  return { vMin, vMax: vMin + span, heightPx: view.heightPx, padPx: view.padPx };
}

// Pan the value axis by a pixel delta, shifting the visible value window so the content follows the drag. A
// downward drag (dyPx > 0) reveals higher values at the top (the window slides up in value).
export function panValueViewByPixels(view: ValueView, dyPx: number): ValueView {
  const dValue = (dyPx / plotHeight(view)) * (view.vMax - view.vMin);
  return {
    vMin: view.vMin + dValue,
    vMax: view.vMax + dValue,
    heightPx: view.heightPx,
    padPx: view.padPx,
  };
}

// Map a lane key to a pixel point through the shared time transform and the value transform.
export function keyToPixel(
  timeView: DopesheetView,
  valueView: ValueView,
  key: ValueKey,
): { readonly x: number; readonly y: number } {
  return { x: timeToX(timeView, key.time), y: valueToY(valueView, key.value) };
}

// A hit on a key dot: which lane and which keyframe (a key may appear on two lanes of a vec2 channel, so the
// lane disambiguates which component the drag edits).
export interface GraphKeyHit {
  readonly laneKey: string;
  readonly keyframeId: ValueKey['id'];
}

// The nearest visible key dot within `radiusPx` of (px, py), or null. Ties break to the earliest lane then
// the earliest key, so the result is deterministic. Only lanes in `visible` are considered.
export function hitTestGraphKey(
  lanes: readonly ValueLane[],
  visible: ReadonlySet<string>,
  timeView: DopesheetView,
  valueView: ValueView,
  px: number,
  py: number,
  radiusPx: number,
): GraphKeyHit | null {
  let best: GraphKeyHit | null = null;
  let bestDist = radiusPx;
  for (const lane of lanes) {
    if (!visible.has(lane.key)) continue;
    for (const key of lane.keys) {
      const p = keyToPixel(timeView, valueView, key);
      const dist = Math.hypot(px - p.x, py - p.y);
      if (dist <= bestDist) {
        // Strictly-less keeps the first (earliest) key on an exact tie.
        if (best === null || dist < bestDist) {
          best = { laneKey: lane.key, keyframeId: key.id };
          bestDist = dist;
        }
      }
    }
  }
  return best;
}

// A value-space bezier segment between two adjacent keys A -> B on one lane. tSpan is always > 0 (channel
// times are strictly ascending); vSpan may be zero (a flat segment), which is the degenerate case the handle
// inverse handles.
export interface ValueSegment {
  readonly t0: number;
  readonly v0: number;
  readonly t1: number;
  readonly v1: number;
}

export interface HandlePoint {
  readonly time: number;
  readonly value: number;
}

// Forward map a normalized bezier control handle into value-space (time, value). The stored easing runs from
// the implicit endpoints (0,0) to (1,1); cx is the fractional time across the segment and cy the fractional
// value between v0 and v1 (cy outside [0,1] is overshoot, mapped past the endpoints). p1 is the outgoing
// handle of A, p2 the incoming handle of B.
export function handleToValueSpace(
  seg: ValueSegment,
  curve: BezierCurve,
  handle: BezierHandle,
): HandlePoint {
  const cx = handle === 'p1' ? curve.cx1 : curve.cx2;
  const cy = handle === 'p1' ? curve.cy1 : curve.cy2;
  return {
    time: seg.t0 + cx * (seg.t1 - seg.t0),
    value: seg.v0 + cy * (seg.v1 - seg.v0),
  };
}

// Inverse map: place a value-space handle point back onto the normalized curve, returning a NEW curve with
// only the dragged handle changed. cx is clamped to [0, 1] (the format constrains control x so the easing
// stays a function of time); cy is the fractional value position, UNCLAMPED (overshoot stays expressible).
//
// Degenerate value axis (v1 == v0, a flat segment): the value delta carries no information (every cy maps to
// the same value), so cy cannot be recovered from the point. The existing cy is retained, making a vertical
// drag on a flat segment a no-op while the horizontal (time/cx) drag still applies. This is the one place the
// forward/inverse round-trip is not invertible, and it is deliberate.
export function valueSpaceToHandle(
  seg: ValueSegment,
  curve: BezierCurve,
  handle: BezierHandle,
  point: HandlePoint,
): BezierCurve {
  const tSpan = seg.t1 - seg.t0;
  const vSpan = seg.v1 - seg.v0;
  const cx = clamp(tSpan !== 0 ? (point.time - seg.t0) / tSpan : 0, 0, 1);
  const existingCy = handle === 'p1' ? curve.cy1 : curve.cy2;
  const cy = vSpan !== 0 ? (point.value - seg.v0) / vSpan : existingCy;
  if (handle === 'p1') {
    return { type: 'bezier', cx1: cx, cy1: cy, cx2: curve.cx2, cy2: curve.cy2 };
  }
  return { type: 'bezier', cx1: curve.cx1, cy1: curve.cy1, cx2: cx, cy2: cy };
}

// Sample a segment's eased VALUE curve as value-space points. Reuses the SHARED easing sampler (curve-preview
// -> runtime-core), then maps each normalized (nx, ny) into (time, value): linear draws the straight A->B
// line, stepped holds v0 then jumps at B, bezier eases through the same table the solve uses, so the drawn
// curve equals what plays. `curve` is the segment's outgoing curve.
export function sampleSegmentValueSpace(
  seg: ValueSegment,
  curve: CurveType,
  sampleCount: number,
): HandlePoint[] {
  const normalized: CurvePoint[] = sampleCurve(curve, sampleCount);
  const tSpan = seg.t1 - seg.t0;
  const vSpan = seg.v1 - seg.v0;
  return normalized.map((p) => ({ time: seg.t0 + p.x * tSpan, value: seg.v0 + p.y * vSpan }));
}

// The full value-space polyline for a lane: each adjacent pair of keys contributes its eased segment, and the
// final key contributes its own point (no outgoing segment). An empty or single-key lane yields just its
// point(s). Consecutive segments share the boundary key point (the sampler includes both endpoints), which is
// harmless for a polyline. `sampleCount` is the per-segment sample resolution.
export function sampleLaneValueSpace(lane: ValueLane, sampleCount: number): HandlePoint[] {
  const keys = lane.keys;
  if (keys.length === 0) return [];
  if (keys.length === 1) {
    const only = keys[0]!;
    return [{ time: only.time, value: only.value }];
  }
  const points: HandlePoint[] = [];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const seg: ValueSegment = { t0: a.time, v0: a.value, t1: b.time, v1: b.value };
    points.push(...sampleSegmentValueSpace(seg, a.curve, sampleCount));
  }
  return points;
}

// The value-space handle points for a lane's outgoing bezier segment at key index `i`, or null when there is
// no such bezier segment (the key is last, or its outgoing curve is not a bezier). Used to draw and hit-test
// the two control handles of the selected key.
export function laneSegmentHandles(
  lane: ValueLane,
  i: number,
): {
  readonly seg: ValueSegment;
  readonly curve: BezierCurve;
  readonly p1: HandlePoint;
  readonly p2: HandlePoint;
} | null {
  const a = lane.keys[i];
  const b = lane.keys[i + 1];
  if (a === undefined || b === undefined) return null;
  if (typeof a.curve !== 'object') return null;
  const seg: ValueSegment = { t0: a.time, v0: a.value, t1: b.time, v1: b.value };
  return {
    seg,
    curve: a.curve,
    p1: handleToValueSpace(seg, a.curve, 'p1'),
    p2: handleToValueSpace(seg, a.curve, 'p2'),
  };
}

// The nearer of the two handles to (px, py) within `radiusPx`, or null. Handle points are mapped through the
// same time+value transforms as the dots so the pixel distance is what the user sees.
export function hitTestHandle(
  seg: ValueSegment,
  curve: BezierCurve,
  timeView: DopesheetView,
  valueView: ValueView,
  px: number,
  py: number,
  radiusPx: number,
): BezierHandle | null {
  const p1 = handleToValueSpace(seg, curve, 'p1');
  const p2 = handleToValueSpace(seg, curve, 'p2');
  const d1 = Math.hypot(px - timeToX(timeView, p1.time), py - valueToY(valueView, p1.value));
  const d2 = Math.hypot(px - timeToX(timeView, p2.time), py - valueToY(valueView, p2.value));
  const min = Math.min(d1, d2);
  if (min > radiusPx) return null;
  return d1 <= d2 ? 'p1' : 'p2';
}

// Convert a pixel point to a (time, value) pair through the inverse transforms (for a value-space handle
// drag: the panel maps the pointer here, then valueSpaceToHandle folds it into the stored curve).
export function pixelToHandlePoint(
  timeView: DopesheetView,
  valueView: ValueView,
  px: number,
  py: number,
): HandlePoint {
  return { time: xToTime(timeView, px), value: yToValue(valueView, py) };
}

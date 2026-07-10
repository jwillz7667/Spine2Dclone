import { describe, expect, it } from 'vitest';
import type { DopesheetView } from './timeline-math';
import { timeToX } from './timeline-math';
import {
  SetKeyframeCommand,
  type AnimationId,
  type Document,
  type KeyframeTarget,
} from '../document';
import type { TrackNames } from './tracks';
import { buildValueLanes } from './value-graph-channels';
import { addAnimation, addBone, createEmptyDocument } from './seed-document';
import {
  frameTimeView,
  frameValueView,
  handleToValueSpace,
  hitTestGraphKey,
  hitTestHandle,
  keyToPixel,
  laneSegmentHandles,
  panValueViewByPixels,
  pixelToHandlePoint,
  sampleLaneValueSpace,
  sampleSegmentValueSpace,
  valueSpaceToHandle,
  valueToY,
  yToValue,
  zoomValueViewAround,
  type BezierCurve,
  type ValueSegment,
  type ValueView,
} from './value-graph-math';

const IDENTITY: BezierCurve = { type: 'bezier', cx1: 1 / 3, cy1: 1 / 3, cx2: 2 / 3, cy2: 2 / 3 };
const TIME_VIEW: DopesheetView = { scrollX: 0, zoomX: 100, scrollY: 0 };
const VALUE_VIEW: ValueView = { vMin: -1, vMax: 1, heightPx: 200, padPx: 16 };

function names(): TrackNames {
  return {
    boneName: () => 'arm',
    slotName: (id) => String(id),
    ikName: (id) => String(id),
    transformName: (id) => String(id),
    pathName: (id) => String(id),
    physicsName: (id) => String(id),
    skinName: (key) => String(key),
  };
}

function rig(keys: readonly { time: number; value: number; curve?: BezierCurve }[]): {
  doc: Document;
  animId: AnimationId;
} {
  const doc = createEmptyDocument();
  const boneId = addBone(doc, 'arm');
  const animId = addAnimation(doc, 'idle', 4);
  const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
  for (const k of keys) {
    doc.history.execute(
      new SetKeyframeCommand(animId, target, k.time, { angle: k.value }, k.curve ?? 'linear'),
    );
  }
  return { doc, animId };
}

describe('value graph vertical transform', () => {
  it('maps value to y with higher values up, and inverts exactly', () => {
    // vMax sits at the top pad, vMin at the bottom pad.
    expect(valueToY(VALUE_VIEW, VALUE_VIEW.vMax)).toBeCloseTo(16, 9);
    expect(valueToY(VALUE_VIEW, VALUE_VIEW.vMin)).toBeCloseTo(184, 9);
    for (const v of [-1, -0.3, 0, 0.42, 1]) {
      expect(yToValue(VALUE_VIEW, valueToY(VALUE_VIEW, v))).toBeCloseTo(v, 9);
    }
  });
});

describe('value graph pan and zoom', () => {
  it('keeps the value under the cursor fixed while zooming', () => {
    const anchorY = 60;
    const anchorValue = yToValue(VALUE_VIEW, anchorY);
    const zoomed = zoomValueViewAround(VALUE_VIEW, anchorY, 2);
    // The span halved (zoomed in 2x) and the anchor value still maps to the same y.
    expect(zoomed.vMax - zoomed.vMin).toBeCloseTo((VALUE_VIEW.vMax - VALUE_VIEW.vMin) / 2, 9);
    expect(valueToY(zoomed, anchorValue)).toBeCloseTo(anchorY, 9);
  });

  it('pans the value window by a pixel delta and is reversible', () => {
    const panned = panValueViewByPixels(VALUE_VIEW, 20);
    const back = panValueViewByPixels(panned, -20);
    expect(back.vMin).toBeCloseTo(VALUE_VIEW.vMin, 9);
    expect(back.vMax).toBeCloseTo(VALUE_VIEW.vMax, 9);
    // A downward drag slides the window up in value (higher values appear).
    expect(panned.vMin).toBeGreaterThan(VALUE_VIEW.vMin);
  });
});

describe('value graph framing', () => {
  it('frames a value extent with symmetric margin', () => {
    const view = frameValueView([2, 6], 200, 16, 0.1);
    expect(view.vMin).toBeCloseTo(1.6, 9);
    expect(view.vMax).toBeCloseTo(6.4, 9);
  });

  it('expands a flat extent to a unit window centered on the value', () => {
    expect(frameValueView([3, 3], 200, 16, 0.1)).toMatchObject({ vMin: 2, vMax: 4 });
  });

  it('falls back to the default value window for an empty extent', () => {
    expect(frameValueView(null, 120, 8, 0.1)).toEqual({
      vMin: -1,
      vMax: 1,
      heightPx: 120,
      padPx: 8,
    });
  });

  it('frames a time extent so the padded window fills the width', () => {
    const { scrollX, zoomX } = frameTimeView([0, 2], 100, 0);
    const view: DopesheetView = { scrollX, zoomX, scrollY: 0 };
    expect(timeToX(view, 0)).toBeCloseTo(0, 9);
    expect(timeToX(view, 2)).toBeCloseTo(100, 9);
  });

  it('centers a default window on a single-key time extent', () => {
    const { scrollX, zoomX } = frameTimeView([1, 1], 100, 0);
    const view: DopesheetView = { scrollX, zoomX, scrollY: 0 };
    // A one-second window centered on t=1: t=0.5 -> left edge, t=1.5 -> right edge.
    expect(timeToX(view, 0.5)).toBeCloseTo(0, 9);
    expect(timeToX(view, 1.5)).toBeCloseTo(100, 9);
  });
});

describe('value <-> normalized handle mapping', () => {
  const seg: ValueSegment = { t0: 0.1, v0: -2, t1: 0.7, v1: 5 };

  it('round-trips normalized -> value-space -> normalized within tight tolerance', () => {
    const curve: BezierCurve = { type: 'bezier', cx1: 0.25, cy1: 0.8, cx2: 0.6, cy2: -0.3 };
    const back1 = valueSpaceToHandle(seg, curve, 'p1', handleToValueSpace(seg, curve, 'p1'));
    expect(back1.cx1).toBeCloseTo(0.25, 12);
    expect(back1.cy1).toBeCloseTo(0.8, 12);
    const back2 = valueSpaceToHandle(seg, curve, 'p2', handleToValueSpace(seg, curve, 'p2'));
    expect(back2.cx2).toBeCloseTo(0.6, 12);
    expect(back2.cy2).toBeCloseTo(-0.3, 12);
  });

  it('round-trips EXACTLY for a canonical unit segment', () => {
    const unit: ValueSegment = { t0: 0, v0: 0, t1: 1, v1: 1 };
    const point = handleToValueSpace(unit, IDENTITY, 'p1');
    expect(point).toEqual({ time: 1 / 3, value: 1 / 3 });
    const back = valueSpaceToHandle(unit, IDENTITY, 'p1', point);
    expect(back.cx1).toBe(1 / 3);
    expect(back.cy1).toBe(1 / 3);
  });

  it('round-trips value-space -> normalized -> value-space for an arbitrary point', () => {
    const curve: BezierCurve = { type: 'bezier', cx1: 0.5, cy1: 0.5, cx2: 0.5, cy2: 0.5 };
    const point = { time: 0.4, value: 1.5 };
    const roundtrip = handleToValueSpace(seg, valueSpaceToHandle(seg, curve, 'p1', point), 'p1');
    expect(roundtrip.time).toBeCloseTo(point.time, 12);
    expect(roundtrip.value).toBeCloseTo(point.value, 12);
  });

  it('clamps control x to [0, 1] when the handle is dragged past the segment endpoints', () => {
    const past = valueSpaceToHandle(seg, IDENTITY, 'p1', { time: seg.t1 + 1, value: 0 });
    expect(past.cx1).toBe(1);
    const before = valueSpaceToHandle(seg, IDENTITY, 'p1', { time: seg.t0 - 1, value: 0 });
    expect(before.cx1).toBe(0);
  });

  it('preserves overshoot: cy outside [0, 1] survives the round-trip', () => {
    const overshoot: BezierCurve = { type: 'bezier', cx1: 0.3, cy1: 1.4, cx2: 0.7, cy2: -0.6 };
    const back = valueSpaceToHandle(seg, overshoot, 'p2', handleToValueSpace(seg, overshoot, 'p2'));
    expect(back.cy2).toBeCloseTo(-0.6, 12);
  });

  it('degenerate flat segment: a vertical drag is a no-op (cy retained), time still applies', () => {
    const flat: ValueSegment = { t0: 0, v0: 3, t1: 1, v1: 3 };
    const curve: BezierCurve = { type: 'bezier', cx1: 0.2, cy1: 0.45, cx2: 0.8, cy2: 0.55 };
    // Drag p1 to a wildly different value at time 0.5: cy stays, cx becomes 0.5.
    const next = valueSpaceToHandle(flat, curve, 'p1', { time: 0.5, value: 999 });
    expect(next.cy1).toBe(0.45);
    expect(next.cx1).toBe(0.5);
  });
});

describe('value-space curve sampling', () => {
  const seg: ValueSegment = { t0: 0, v0: 0, t1: 1, v1: 10 };

  it('samples a linear segment as the straight A -> B line', () => {
    const points = sampleSegmentValueSpace(seg, 'linear', 3);
    expect(points).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 5 },
      { time: 1, value: 10 },
    ]);
  });

  it('samples a stepped segment as a hold at v0 then a jump to v1', () => {
    const points = sampleSegmentValueSpace(seg, 'stepped', 3);
    expect(points).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 0 },
      { time: 1, value: 10 },
    ]);
  });

  it('samples a bezier segment with endpoints exactly at v0 and v1', () => {
    const points = sampleSegmentValueSpace(seg, IDENTITY, 8);
    expect(points[0]).toEqual({ time: 0, value: 0 });
    expect(points[points.length - 1]).toEqual({ time: 1, value: 10 });
  });

  it('builds a whole-lane polyline spanning all segments, and a single point for one key', () => {
    const { doc, animId } = rig([
      { time: 0, value: 0 },
      { time: 1, value: 10 },
      { time: 2, value: -4 },
    ]);
    const lane = buildValueLanes(doc.model.getAnimation(animId)!, names())[0]!;
    const poly = sampleLaneValueSpace(lane, 4);
    expect(poly[0]).toEqual({ time: 0, value: 0 });
    expect(poly[poly.length - 1]).toEqual({ time: 2, value: -4 });

    const single = rig([{ time: 0.5, value: 7 }]);
    const oneLane = buildValueLanes(single.doc.model.getAnimation(single.animId)!, names())[0]!;
    expect(sampleLaneValueSpace(oneLane, 4)).toEqual([{ time: 0.5, value: 7 }]);
  });
});

describe('value graph hit testing', () => {
  it('hits the nearest visible key dot within the radius, and misses outside it', () => {
    const { doc, animId } = rig([
      { time: 0, value: -0.5 },
      { time: 1, value: 0.5 },
    ]);
    const lane = buildValueLanes(doc.model.getAnimation(animId)!, names())[0]!;
    const visible = new Set([lane.key]);
    const target = lane.keys[1]!;
    const p = keyToPixel(TIME_VIEW, VALUE_VIEW, target);

    const hit = hitTestGraphKey([lane], visible, TIME_VIEW, VALUE_VIEW, p.x + 2, p.y - 1, 7);
    expect(hit).toEqual({ laneKey: lane.key, keyframeId: target.id });

    expect(
      hitTestGraphKey([lane], visible, TIME_VIEW, VALUE_VIEW, p.x + 40, p.y + 40, 7),
    ).toBeNull();
  });

  it('ignores keys of a hidden lane', () => {
    const { doc, animId } = rig([{ time: 0, value: 0 }]);
    const lane = buildValueLanes(doc.model.getAnimation(animId)!, names())[0]!;
    const p = keyToPixel(TIME_VIEW, VALUE_VIEW, lane.keys[0]!);
    expect(hitTestGraphKey([lane], new Set(), TIME_VIEW, VALUE_VIEW, p.x, p.y, 7)).toBeNull();
  });

  it('hits the nearer bezier handle and returns its value-space handle points', () => {
    const { doc, animId } = rig([
      { time: 0, value: 0, curve: IDENTITY },
      { time: 1, value: 1 },
    ]);
    const lane = buildValueLanes(doc.model.getAnimation(animId)!, names())[0]!;
    const handles = laneSegmentHandles(lane, 0)!;
    expect(handles.p1).toEqual({ time: 1 / 3, value: 1 / 3 });
    expect(handles.p2).toEqual({ time: 2 / 3, value: 2 / 3 });

    const p1px = {
      x: timeToX(TIME_VIEW, handles.p1.time),
      y: valueToY(VALUE_VIEW, handles.p1.value),
    };
    expect(
      hitTestHandle(handles.seg, handles.curve, TIME_VIEW, VALUE_VIEW, p1px.x + 1, p1px.y, 8),
    ).toBe('p1');

    // The last key has no outgoing segment; a linear segment has no bezier handles.
    expect(laneSegmentHandles(lane, 1)).toBeNull();
  });

  it('inverts a pixel point back to a (time, value) handle point', () => {
    const point = pixelToHandlePoint(TIME_VIEW, VALUE_VIEW, 250, 100);
    expect(point.time).toBeCloseTo(2.5, 9);
    expect(point.value).toBeCloseTo(yToValue(VALUE_VIEW, 100), 9);
  });
});

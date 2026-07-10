import { describe, expect, it } from 'vitest';
import {
  cubicPointAt,
  flattenPathSpline,
  pathControlHandles,
  pathHandleTethers,
  type Vec2,
} from './path-overlay-geometry';

// Pure path-overlay geometry unit tests (PP-D11). The viewport Path tool's overlay renders these primitives;
// the math carries no PixiJS or document state, so it is tested directly (the .ts overlay that strokes them
// is covered by typecheck + lint, mirroring mesh-overlay over mesh-edit).

const p = (x: number, y: number): Vec2 => ({ x, y });

// A straight two-curve open spline along x: anchors at 0, 90, 180, handles at the curve thirds.
const OPEN_TWO_CURVE = [0, 0, 30, 0, 60, 0, 90, 0, 120, 0, 150, 0, 180, 0];

describe('cubicPointAt', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(cubicPointAt(p(0, 0), p(1, 2), p(3, 4), p(6, 0), 0)).toEqual({ x: 0, y: 0 });
    expect(cubicPointAt(p(0, 0), p(1, 2), p(3, 4), p(6, 0), 1)).toEqual({ x: 6, y: 0 });
  });

  it('sits on the straight line for an evenly-spaced straight cubic', () => {
    // Handles at the thirds keep the curve on the segment; the midpoint is the segment midpoint.
    const mid = cubicPointAt(p(0, 0), p(30, 0), p(60, 0), p(90, 0), 0.5);
    expect(mid.x).toBeCloseTo(45, 10);
    expect(mid.y).toBeCloseTo(0, 10);
  });
});

describe('flattenPathSpline', () => {
  it('samples C*segments + 1 points for an open C-curve spline', () => {
    const poly = flattenPathSpline(OPEN_TWO_CURVE, false, 8);
    expect(poly.length).toBe(2 * 8 + 1);
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[poly.length - 1]!.x).toBeCloseTo(180, 10);
  });

  it('samples C*segments points for a closed spline (wraps to the first anchor)', () => {
    // A closed 3-curve loop (V = 9): the last point is the first curve's first sample, not the start anchor.
    const closed = [0, 0, 30, 0, 60, 0, 90, 0, 90, 30, 90, 60, 60, 90, 30, 90, 0, 90];
    const poly = flattenPathSpline(closed, true, 6);
    expect(poly.length).toBe(3 * 6 + 1); // start anchor once + 3*6 samples
    // The closing curve wraps back toward the first anchor (0, 0).
    expect(poly[poly.length - 1]!.x).toBeCloseTo(0, 6);
    expect(poly[poly.length - 1]!.y).toBeCloseTo(0, 6);
  });

  it('returns an empty polyline for an invalid control-point count', () => {
    expect(flattenPathSpline([0, 0, 1, 1], false, 8)).toEqual([]); // 2 points fit no cubic spline
  });
});

describe('pathControlHandles', () => {
  it('tags anchors at multiples of 3 and handles elsewhere', () => {
    const handles = pathControlHandles(OPEN_TWO_CURVE);
    expect(handles.map((h) => h.role)).toEqual([
      'anchor',
      'handle',
      'handle',
      'anchor',
      'handle',
      'handle',
      'anchor',
    ]);
    expect(handles[3]!.point).toEqual({ x: 90, y: 0 });
    expect(handles[3]!.index).toBe(3);
  });
});

describe('pathHandleTethers', () => {
  it('emits two tethers per curve, each anchoring a handle', () => {
    const tethers = pathHandleTethers(OPEN_TWO_CURVE, false);
    expect(tethers).toHaveLength(2 * 2); // two curves, two handles each
    // Curve 0: anchor (0,0) -> handle (30,0), and anchor (90,0) -> handle (60,0).
    expect(tethers[0]).toEqual({ anchor: { x: 0, y: 0 }, handle: { x: 30, y: 0 } });
    expect(tethers[1]).toEqual({ anchor: { x: 90, y: 0 }, handle: { x: 60, y: 0 } });
  });

  it('wraps the closing curve tether to the first anchor for a closed spline', () => {
    const closed = [0, 0, 30, 0, 60, 0, 90, 0, 90, 30, 90, 60, 60, 90, 30, 90, 0, 90];
    const tethers = pathHandleTethers(closed, true);
    // The last curve's end anchor tether wraps to point 0 = (0, 0).
    expect(tethers[tethers.length - 1]!.anchor).toEqual({ x: 0, y: 0 });
  });
});

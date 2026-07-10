import { describe, expect, it } from 'vitest';
import {
  computePathLengths,
  computePathLengthsFromFlat,
  cubicBezierLength,
  flatFromPoints,
  pathCurveCount,
  pointsFromFlat,
  type Vec2,
} from '../src';

// Pure path-geometry unit tests (PP-D11). The arc-length quadrature carries no document state, so it is
// tested directly against closed-form cases. The commands that recompute the table on edit are tested in
// path-attachment-commands.

const p = (x: number, y: number): Vec2 => ({ x, y });

describe('cubicBezierLength', () => {
  // The load-bearing closed-form case: a cubic whose handles sit at the one-third points of a straight
  // segment has a CONSTANT speed |B'(t)| = |p3 - p0|, so its arc length is exactly the endpoint distance.
  // Gauss-Legendre integrates a constant exactly, so the quadrature must return that distance to machine
  // precision (this is the "closed-form straight-line case" the arc-length module is pinned against).
  it('returns the endpoint distance for an evenly-spaced straight cubic (exact)', () => {
    const length = cubicBezierLength(p(0, 0), p(3, 0), p(6, 0), p(9, 0));
    expect(length).toBeCloseTo(9, 12);
  });

  it('is exact for an evenly-spaced straight cubic along a diagonal', () => {
    // p0=(0,0) .. p3=(30,40): distance 50; handles at the 1/3 and 2/3 points keep the speed constant.
    const length = cubicBezierLength(p(0, 0), p(10, 40 / 3), p(20, 80 / 3), p(30, 40));
    expect(length).toBeCloseTo(50, 10);
  });

  it('is zero for a degenerate curve with all control points coincident', () => {
    expect(cubicBezierLength(p(5, 5), p(5, 5), p(5, 5), p(5, 5))).toBe(0);
  });

  it('scales linearly when every control point is scaled about the origin', () => {
    const base = cubicBezierLength(p(0, 0), p(1, 2), p(3, 1), p(4, 4));
    const scaled = cubicBezierLength(p(0, 0), p(3, 6), p(9, 3), p(12, 12));
    expect(scaled).toBeCloseTo(3 * base, 9);
  });

  it('is at least the straight endpoint distance for a curved segment', () => {
    // A bowed curve is never shorter than the chord between its anchors.
    const length = cubicBezierLength(p(0, 0), p(0, 10), p(10, 10), p(10, 0));
    expect(length).toBeGreaterThan(Math.hypot(10, 0));
  });

  it('matches a high-resolution polyline reference within tolerance', () => {
    // Independent reference: sample the curve densely and sum chord lengths. The quadrature must agree.
    const cp: [Vec2, Vec2, Vec2, Vec2] = [p(0, 0), p(0, 20), p(20, 20), p(20, 0)];
    const bez = (t: number, a: number): number => {
      const u = 1 - t;
      const [c0, c1, c2, c3] = cp;
      const v = a === 0 ? [c0.x, c1.x, c2.x, c3.x] : [c0.y, c1.y, c2.y, c3.y];
      return u * u * u * v[0]! + 3 * u * u * t * v[1]! + 3 * u * t * t * v[2]! + t * t * t * v[3]!;
    };
    const steps = 20000;
    let reference = 0;
    let prevX = bez(0, 0);
    let prevY = bez(0, 1);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = bez(t, 0);
      const y = bez(t, 1);
      reference += Math.hypot(x - prevX, y - prevY);
      prevX = x;
      prevY = y;
    }
    expect(cubicBezierLength(cp[0], cp[1], cp[2], cp[3])).toBeCloseTo(reference, 4);
  });
});

describe('pathCurveCount', () => {
  it('derives the curve count for an open spline (V = 3C + 1)', () => {
    expect(pathCurveCount(4, false)).toBe(1);
    expect(pathCurveCount(7, false)).toBe(2);
    expect(pathCurveCount(10, false)).toBe(3);
  });

  it('derives the curve count for a closed spline (V = 3C)', () => {
    expect(pathCurveCount(3, true)).toBe(1);
    expect(pathCurveCount(6, true)).toBe(2);
    expect(pathCurveCount(9, true)).toBe(3);
  });

  it('rejects counts that fit no cubic spline of the given openness', () => {
    expect(pathCurveCount(5, false)).toBeUndefined(); // open needs (V-1) % 3 == 0
    expect(pathCurveCount(1, false)).toBeUndefined();
    expect(pathCurveCount(4, true)).toBeUndefined(); // closed needs V % 3 == 0
    expect(pathCurveCount(0, true)).toBeUndefined();
  });
});

describe('computePathLengths', () => {
  it('produces one cumulative entry per curve for an open spline', () => {
    // Two straight, evenly-spaced curves of length 9 each: cumulative table [9, 18].
    const points = [p(0, 0), p(3, 0), p(6, 0), p(9, 0), p(12, 0), p(15, 0), p(18, 0)];
    const lengths = computePathLengths(points, false);
    expect(lengths.length).toBe(2);
    expect(lengths[0]).toBeCloseTo(9, 10);
    expect(lengths[1]).toBeCloseTo(18, 10);
  });

  it('wraps the final curve back to the first anchor for a closed spline', () => {
    // A closed square-ish loop of 3 curves; the table is strictly increasing and ends at the perimeter.
    const points = [
      p(0, 0),
      p(3, 0),
      p(6, 0),
      p(9, 0),
      p(9, 3),
      p(9, 6),
      p(9, 9),
      p(6, 9),
      p(3, 9),
    ];
    const lengths = computePathLengths(points, true);
    expect(lengths.length).toBe(3);
    for (let i = 1; i < lengths.length; i += 1) {
      expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!);
    }
    // Last curve wraps p(3,9) -> handles -> p(0,0), a non-zero closing span.
    expect(lengths[2]!).toBeGreaterThan(lengths[1]!);
  });

  it('is non-decreasing and finite for an arbitrary spline', () => {
    const points = [p(0, 0), p(2, 8), p(9, 9), p(12, 3), p(15, -4), p(18, 1), p(21, 0)];
    const lengths = computePathLengths(points, false);
    for (const value of lengths) expect(Number.isFinite(value)).toBe(true);
    for (let i = 1; i < lengths.length; i += 1) {
      expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!);
    }
  });

  it('returns an empty table for a count that fits no spline', () => {
    expect(computePathLengths([p(0, 0), p(1, 1)], false)).toEqual([]);
  });

  it('matches the flat-stream convenience form', () => {
    const points = [p(0, 0), p(3, 0), p(6, 0), p(9, 0)];
    const flat = flatFromPoints(points);
    expect(computePathLengthsFromFlat(flat, false)).toEqual(computePathLengths(points, false));
  });
});

describe('flat / point conversion', () => {
  it('round-trips a point list through the flat stream', () => {
    const points = [p(1, 2), p(3, 4), p(5, 6)];
    expect(pointsFromFlat(flatFromPoints(points))).toEqual(points);
  });
});

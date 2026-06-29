import { describe, expect, it } from 'vitest';
import { simplify } from './douglas-peucker';
import type { Point } from './point';

describe('simplify (Douglas-Peucker)', () => {
  it('reduces a known polyline to its corner subset', () => {
    // An L-shaped polyline with a clear corner at (5, 5); the points along each leg are collinear and
    // should drop, leaving the two endpoints plus the corner.
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 2 },
      { x: 5, y: 5 },
    ];
    const result = simplify(points, 0.1);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it('removes exactly-collinear midpoints (distance 0 is not > 0)', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(simplify(points, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('keeps every point of a non-collinear polyline when tolerance is 0', () => {
    // Each interior point deviates from its chord by a nonzero distance, so a zero tolerance keeps all.
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
      { x: 4, y: 0 },
    ];
    expect(simplify(points, 0)).toEqual(points);
  });

  it('returns the input unchanged for two or fewer points', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
    const pair: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(simplify(pair, 5)).toEqual(pair);
  });

  it('collapses a near-straight run within tolerance to its endpoints', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0.05 },
      { x: 2, y: -0.04 },
      { x: 3, y: 0.02 },
      { x: 4, y: 0 },
    ];
    expect(simplify(points, 0.1)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });
});

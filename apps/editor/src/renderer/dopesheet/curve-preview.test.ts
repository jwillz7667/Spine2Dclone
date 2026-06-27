import { describe, expect, it } from 'vitest';
import { buildBezierTable, evalBezierY } from '@marionette/runtime-core';
import type { CurveType } from '@marionette/format/types';
import { sampleCurve } from './curve-preview';

// The headline R1.2 / LAW 4 guarantee: the curve-editor preview is the SAME bezier sampler the solve runs,
// so what the animator sees equals what sampleSkeleton plays. This imports BOTH the editor preview path
// (sampleCurve) and runtime-core (buildBezierTable/evalBezierY) and asserts they agree.
describe('curve editor preview (WP-1.7, R1.2)', () => {
  it('matches runtime-core bezier eval at 100 sample points (the shared sampler)', () => {
    const curves: CurveType[] = [
      { type: 'bezier', cx1: 0.25, cy1: 0.0, cx2: 0.75, cy2: 1.0 },
      { type: 'bezier', cx1: 0.42, cy1: 0.0, cx2: 0.58, cy2: 1.0 },
      { type: 'bezier', cx1: 1.0, cy1: 0.0, cx2: 0.0, cy2: 1.0 }, // zero-slope inflection
      { type: 'bezier', cx1: 0.3, cy1: 1.4, cx2: 0.7, cy2: -0.4 }, // y overshoot/anticipation
    ];

    for (const curve of curves) {
      if (typeof curve !== 'object') continue;
      const points = sampleCurve(curve, 100);
      const table = buildBezierTable(curve.cx1, curve.cy1, curve.cx2, curve.cy2);

      expect(points).toHaveLength(100);
      for (const point of points) {
        // The preview calls the exact runtime-core functions, so agreement is exact to f64.
        const reference = evalBezierY(table, 0, point.x);
        expect(point.y).toBe(reference);
        expect(Math.abs(point.y - reference)).toBeLessThan(1e-9);
      }
    }
  });

  it('holds the start value across a stepped segment (the curve eval returns the start)', () => {
    const points = sampleCurve('stepped', 21);

    for (const point of points) {
      // y = 0 across the segment means the interpolation holds the start value; it steps to 1 only at the
      // next keyframe (x = 1).
      if (point.x >= 1) expect(point.y).toBe(1);
      else expect(point.y).toBe(0);
    }
  });

  it('is the identity line for linear', () => {
    for (const point of sampleCurve('linear', 21)) expect(point.y).toBe(point.x);
  });

  it('samples both endpoints inclusively', () => {
    const points = sampleCurve({ type: 'bezier', cx1: 0.42, cy1: 0, cx2: 0.58, cy2: 1 }, 100);
    const first = points[0];
    const last = points[points.length - 1];

    expect(first).toEqual({ x: 0, y: 0 });
    expect(last).toEqual({ x: 1, y: 1 });
  });
});

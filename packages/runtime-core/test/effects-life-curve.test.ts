import type { LifeCurve, RGB } from '@marionette/format/types';
import { describe, expect, it } from 'vitest';
import {
  evalLifeCurveNumber,
  evalLifeCurveRgbInto,
  prepareLifeCurveNumber,
  prepareLifeCurveRgb,
} from '../src/effects/life-curve';
import { buildBezierTable, evalBezierY } from '../src/skeleton/curve';

// WP-3.2/8.5: over-life curve evaluation, reusing the skeletal BEZIER_SEGMENTS sampler (one math path).

describe('over-life scalar curve', () => {
  it('linear ramp interpolates between stops and clamps outside [0, 1]', () => {
    const curve = prepareLifeCurveNumber({
      stops: [
        { t: 0, value: 0, curve: 'linear' },
        { t: 1, value: 10, curve: 'linear' },
      ],
    });
    expect(evalLifeCurveNumber(curve, -0.5)).toBe(0); // clamp to first
    expect(evalLifeCurveNumber(curve, 0)).toBe(0);
    expect(evalLifeCurveNumber(curve, 0.5)).toBeCloseTo(5, 9);
    expect(evalLifeCurveNumber(curve, 1)).toBe(10);
    expect(evalLifeCurveNumber(curve, 2)).toBe(10); // clamp to last
  });

  it('a three-stop curve uses the bracketing segment', () => {
    const curve = prepareLifeCurveNumber({
      stops: [
        { t: 0, value: 0, curve: 'linear' },
        { t: 0.5, value: 4, curve: 'linear' },
        { t: 1, value: 0, curve: 'linear' },
      ],
    });
    expect(evalLifeCurveNumber(curve, 0.25)).toBeCloseTo(2, 9); // first segment
    expect(evalLifeCurveNumber(curve, 0.5)).toBeCloseTo(4, 9);
    expect(evalLifeCurveNumber(curve, 0.75)).toBeCloseTo(2, 9); // second segment
  });

  it('stepped easing holds the segment-start value', () => {
    const curve = prepareLifeCurveNumber({
      stops: [
        { t: 0, value: 1, curve: 'stepped' },
        { t: 1, value: 9, curve: 'linear' },
      ],
    });
    expect(evalLifeCurveNumber(curve, 0.99)).toBe(1); // stepped holds start until the next stop
    expect(evalLifeCurveNumber(curve, 1)).toBe(9);
  });
});

describe('over-life RGB curve', () => {
  it('interpolates each channel independently', () => {
    const black: RGB = { r: 0, g: 0, b: 0 };
    const white: RGB = { r: 1, g: 1, b: 1 };
    const curve = prepareLifeCurveRgb({
      stops: [
        { t: 0, value: black, curve: 'linear' },
        { t: 1, value: white, curve: 'linear' },
      ],
    });
    const r = new Float64Array(1);
    const g = new Float64Array(1);
    const b = new Float64Array(1);
    evalLifeCurveRgbInto(curve, 0.5, r, g, b, 0);
    expect(r[0]).toBeCloseTo(0.5, 9);
    expect(g[0]).toBeCloseTo(0.5, 9);
    expect(b[0]).toBeCloseTo(0.5, 9);
  });
});

describe('one math path: bezier easing matches the skeletal sampler', () => {
  it('a bezier-eased segment uses evalBezierY exactly (100 sample points within 1e-12)', () => {
    const cx1 = 0.25;
    const cy1 = 0.1;
    const cx2 = 0.75;
    const cy2 = 0.9;
    const curve: LifeCurve<number> = {
      stops: [
        { t: 0, value: 0, curve: { type: 'bezier', cx1, cy1, cx2, cy2 } },
        { t: 1, value: 1, curve: 'linear' },
      ],
    };
    const prepared = prepareLifeCurveNumber(curve);
    const table = buildBezierTable(cx1, cy1, cx2, cy2);
    for (let i = 1; i <= 100; i += 1) {
      const u = i / 101; // avoid exactly 0/1 so we hit the eased segment interior
      const got = evalLifeCurveNumber(prepared, u);
      // For a [0,1] value range over the [0,1] segment, the value equals the eased y directly.
      const expected = evalBezierY(table, 0, u);
      expect(got).toBeCloseTo(expected, 12);
    }
  });
});

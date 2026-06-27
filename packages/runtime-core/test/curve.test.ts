import { describe, expect, it } from 'vitest';
import { BEZIER_SEGMENTS, buildBezierTable, evalBezierY } from '../src/skeleton/curve';

const POINTS = BEZIER_SEGMENTS + 1;

// Read the x lane of point k from a packed (x,y) table.
function tableX(table: Float64Array, k: number): number {
  return table[k * 2]!;
}
function tableY(table: Float64Array, k: number): number {
  return table[k * 2 + 1]!;
}

describe('bezier table build (section 8.3)', () => {
  it('samples BEZIER_SEGMENTS + 1 points with implicit (0,0) and (1,1) endpoints', () => {
    const table = buildBezierTable(0.25, 0.0, 0.75, 1.0);

    expect(table.length).toBe(POINTS * 2);
    expect(tableX(table, 0)).toBe(0);
    expect(tableY(table, 0)).toBe(0);
    expect(tableX(table, BEZIER_SEGMENTS)).toBe(1);
    expect(tableY(table, BEZIER_SEGMENTS)).toBe(1);
  });

  it('produces a non-decreasing x table for control x in [0, 1]', () => {
    const table = buildBezierTable(0.42, 0.0, 0.58, 1.0);

    for (let k = 1; k < POINTS; k += 1) {
      expect(tableX(table, k)).toBeGreaterThanOrEqual(tableX(table, k - 1));
    }
  });

  it('keeps x non-decreasing even at a zero-slope inflection (cx1=1, cx2=0)', () => {
    // The build-time assertion (appendBezierTable) must pass: X(s) is monotonic on [0,1] for control
    // x in [0,1] (section 8.3 proof), so no throw, and the sampled x stay non-decreasing.
    const table = buildBezierTable(1.0, 0.0, 0.0, 1.0);

    for (let k = 1; k < POINTS; k += 1) {
      expect(tableX(table, k)).toBeGreaterThanOrEqual(tableX(table, k - 1));
    }
  });

  it('throws the build-time assertion when control x leaves [0,1] and x decreases', () => {
    // cx1=2, cx2=-1 makes X(s) non-monotonic (x(0.3) > x(0.4)); the non-decreasing-x assertion fires.
    expect(() => buildBezierTable(2.0, 0.0, -1.0, 1.0)).toThrow(/non-decreasing/);
  });
});

describe('bezier y evaluation (section 8.3)', () => {
  it('reproduces the input fraction exactly for an identity easing (control points on y = x)', () => {
    // When cy_i == cx_i the cubic has x(s) == y(s) for all s, so the x-bracket lerp returns nx exactly.
    const table = buildBezierTable(0.3, 0.3, 0.7, 0.7);

    for (const nx of [0.05, 0.2, 0.37, 0.5, 0.63, 0.8, 0.95, 1.0]) {
      expect(evalBezierY(table, 0, nx)).toBeCloseTo(nx, 12);
    }
  });

  it('returns 0.5 at the symmetric midpoint of an ease-in-out curve', () => {
    // cx1=0.42, cx2=0.58 with cy1=0, cy2=1 is symmetric about (0.5, 0.5); the s=0.5 sample is exactly
    // (0.5, 0.5), so the lerp at nx=0.5 lands on 0.5.
    const table = buildBezierTable(0.42, 0.0, 0.58, 1.0);

    expect(evalBezierY(table, 0, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('is monotonic non-decreasing in nx for an ease with cy in [0,1]', () => {
    const table = buildBezierTable(0.25, 0.1, 0.75, 0.9);

    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= 50; step += 1) {
      const nx = step / 50;
      const y = evalBezierY(table, 0, Math.max(nx, 1e-9));
      expect(Number.isNaN(y)).toBe(false);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = y;
    }
  });

  it('evaluates the zero-slope-inflection curve deterministically and never NaN', () => {
    const table = buildBezierTable(1.0, 0.0, 0.0, 1.0);

    for (const nx of [0.1, 0.3, 0.49, 0.5, 0.51, 0.7, 0.9]) {
      const first = evalBezierY(table, 0, nx);
      const second = evalBezierY(table, 0, nx);
      expect(Number.isNaN(first)).toBe(false);
      expect(second).toBe(first); // deterministic, never iteration-order-dependent
    }
  });

  it('returns y0 (never NaN) on a flat x segment, guarding the lerp denominator', () => {
    // A real bezier table from control x in [0,1] never feeds the eval a zero-width bracket (the lower
    // bound guarantees x[k] < nx <= x[k+1]); this hand-built degenerate table with constant x forces
    // the guard so its determinism is proven directly. All x == 0.5 means no point satisfies x >= nx
    // for nx > 0.5, the search lands on the last segment, and x1 - x0 == 0.
    const table = new Float64Array(POINTS * 2);
    for (let k = 0; k < POINTS; k += 1) {
      table[k * 2] = 0.5; // x
      table[k * 2 + 1] = k / BEZIER_SEGMENTS; // y, strictly increasing so y0 is identifiable
    }

    const y = evalBezierY(table, 0, 0.9);
    expect(Number.isNaN(y)).toBe(false);
    expect(y).toBe(tableY(table, BEZIER_SEGMENTS - 1)); // y0 of the final [last-1, last] segment
  });

  it('reads a bezier segment at a non-zero base offset', () => {
    // The solve packs many segments into one buffer; eval must honor the base.
    const a = buildBezierTable(0.3, 0.3, 0.7, 0.7);
    const b = buildBezierTable(0.42, 0.0, 0.58, 1.0);
    const packed = new Float64Array(a.length + b.length);
    packed.set(a, 0);
    packed.set(b, a.length);

    expect(evalBezierY(packed, a.length, 0.5)).toBeCloseTo(0.5, 12);
    expect(evalBezierY(packed, 0, 0.42)).toBeCloseTo(0.42, 12);
  });
});

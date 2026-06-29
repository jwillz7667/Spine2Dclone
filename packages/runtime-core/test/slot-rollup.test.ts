import { describe, expect, it } from 'vitest';
import { rollupValueAt, CURVE_TYPES } from '../src/slot/rollup';
import type { CurveType } from '../src/slot/rollup';

// WP-4.7 TASK-4.7.6 / phase-4 section 5.4.2: the pinned integer/fixed-point rollup evaluation. These
// values are the cross-runtime contract: a Phase 5 Unity/Godot runtime must reproduce them exactly. The
// representative points below are computed by hand from the fixed-point definition (FP = 65536), so they
// pin the curve math, not merely echo the implementation.

describe('rollupValueAt (pinned integer rollup, WP-4.7)', () => {
  it('clamps below start to fromUnits and at/after end to toUnits', () => {
    for (const curve of CURVE_TYPES) {
      expect(rollupValueAt(100, 900, 1000, 2000, 500, curve)).toBe(100); // atMs < start
      expect(rollupValueAt(100, 900, 1000, 2000, 1000, curve)).toBe(100); // atMs === start
      expect(rollupValueAt(100, 900, 1000, 2000, 2000, curve)).toBe(900); // atMs === end
      expect(rollupValueAt(100, 900, 1000, 2000, 5000, curve)).toBe(900); // atMs > end
    }
  });

  it('linear is exact at the midpoint', () => {
    expect(rollupValueAt(0, 1000, 0, 1000, 500, 'linear')).toBe(500);
  });

  it('easeInQuad at t=0.5 is one quarter (eFP = FP/4)', () => {
    expect(rollupValueAt(0, 1000, 0, 1000, 500, 'easeInQuad')).toBe(250);
  });

  it('easeOutQuad at t=0.5 is three quarters (eFP = 3FP/4)', () => {
    expect(rollupValueAt(0, 1000, 0, 1000, 500, 'easeOutQuad')).toBe(750);
  });

  it('easeInOutCubic is the midpoint at t=0.5 and 62 at t=0.25 (FP/16 progress)', () => {
    expect(rollupValueAt(0, 1000, 0, 1000, 500, 'easeInOutCubic')).toBe(500);
    // t=0.25: branch 1, eFP = 4 * (FP/4)^3 / FP^2 = FP/16 = 4096; value = floor(1000 * 4096 / 65536) = 62.
    expect(rollupValueAt(0, 1000, 0, 1000, 250, 'easeInOutCubic')).toBe(62);
  });

  it('respects a non-zero fromUnits offset (chained rollup link)', () => {
    // A cascade chain link from 200 to 600 at the midpoint of [0,1000], linear: 200 + 400/2 = 400.
    expect(rollupValueAt(200, 600, 0, 1000, 500, 'linear')).toBe(400);
  });

  it('is monotonic non-decreasing across atMs for every curve', () => {
    for (const curve of CURVE_TYPES) {
      let prev = -1;
      for (let atMs = 0; atMs <= 1000; atMs += 25) {
        const v = rollupValueAt(0, 100000, 0, 1000, atMs, curve);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100000);
        prev = v;
      }
    }
  });

  it('handles a very large win amount without overflow (BigInt intermediate products)', () => {
    // 10^12 cents at the linear midpoint: exactly half. A 53-bit float product would lose precision; the
    // BigInt path is exact.
    const big = 1_000_000_000_000;
    expect(rollupValueAt(0, big, 0, 1000, 500, 'linear')).toBe(big / 2);
  });

  it('CURVE_TYPES enumerates exactly the four closed-enum members', () => {
    const expected: CurveType[] = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutCubic'];
    expect([...CURVE_TYPES]).toEqual(expected);
  });
});

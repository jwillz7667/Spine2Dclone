import { describe, expect, it } from 'vitest';
import { loopTime } from '../src';

// loopTime (TASK-1.4.7) folds an elapsed playback time into one animation period [0, duration). It is
// the transport's wrap, kept out of runtime-core so sampleSkeleton stays a pure single-period function.
describe('loopTime', () => {
  it('returns the elapsed time unchanged inside a single period', () => {
    expect(loopTime(0, 2)).toBe(0);
    expect(loopTime(0.5, 2)).toBe(0.5);
    expect(loopTime(1.999, 2)).toBeCloseTo(1.999, 12);
  });

  it('wraps at and past the period end (no clamp)', () => {
    expect(loopTime(2, 2)).toBe(0);
    expect(loopTime(2.5, 2)).toBeCloseTo(0.5, 12);
    expect(loopTime(5, 2)).toBeCloseTo(1, 12);
  });

  it('is negative-safe (a scrub before zero folds forward into the period)', () => {
    expect(loopTime(-0.5, 2)).toBeCloseTo(1.5, 12);
    expect(loopTime(-2, 2)).toBe(0);
    expect(loopTime(-2.5, 2)).toBeCloseTo(1.5, 12);
  });

  it('returns 0 for a non-positive duration (no period to wrap into, no NaN)', () => {
    expect(loopTime(3, 0)).toBe(0);
    expect(loopTime(3, -1)).toBe(0);
    expect(Number.isNaN(loopTime(3, 0))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { ikTargetHandle, mixFromSlider, suggestBendPositive } from './ik-gizmo';

describe('mixFromSlider', () => {
  it('clamps into [0, 1]', () => {
    expect(mixFromSlider(0.5)).toBe(0.5);
    expect(mixFromSlider(-0.2)).toBe(0);
    expect(mixFromSlider(1.7)).toBe(1);
    expect(mixFromSlider(0)).toBe(0);
    expect(mixFromSlider(1)).toBe(1);
  });

  it('falls back to 0 on a non-finite input', () => {
    expect(mixFromSlider(Number.NaN)).toBe(0);
    expect(mixFromSlider(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('ikTargetHandle', () => {
  it('returns the target world position as a fresh, non-aliased point', () => {
    const target = { x: 12, y: -3 };
    const handle = ikTargetHandle(target);
    expect(handle).toEqual({ x: 12, y: -3 });
    expect(handle).not.toBe(target);
  });
});

describe('suggestBendPositive', () => {
  it('suggests positive when the target is to the left of root->mid', () => {
    // root->mid points +x; a target above (left, +y) gives a positive cross.
    expect(suggestBendPositive({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 })).toBe(true);
  });

  it('suggests negative when the target is to the right of root->mid', () => {
    expect(suggestBendPositive({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -5 })).toBe(false);
  });

  it('defaults to positive for a collinear target (zero cross)', () => {
    expect(suggestBendPositive({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(true);
  });
});

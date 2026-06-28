import { MAX_BONE_INFLUENCES, WEIGHT_SUM_EPSILON } from '@marionette/format';
import { describe, expect, it } from 'vitest';
import {
  capInfluences,
  distanceToSegment,
  finalizeVertexWeights,
  normalizeInfluences,
} from '../src';

// Pure weight-math unit tests (WP-2.3 / WP-2.4). These functions carry no document state, so they are
// tested directly against known inputs; the commands that use them are tested in binding-commands and
// weight-paint.

describe('distanceToSegment', () => {
  it('measures the perpendicular distance to an interior foot', () => {
    expect(distanceToSegment(5, 5, 0, 0, 10, 0)).toBeCloseTo(5, 12);
  });

  it('clamps to the nearer endpoint when the foot is past an end', () => {
    expect(distanceToSegment(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5, 12); // before A
    expect(distanceToSegment(15, 0, 0, 0, 10, 0)).toBeCloseTo(5, 12); // past B
  });

  it('is zero for a point on the segment', () => {
    expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
  });

  it('collapses a zero-length segment to the point-to-endpoint distance', () => {
    expect(distanceToSegment(0, 0, 3, 4, 3, 4)).toBeCloseTo(5, 12);
  });
});

describe('normalizeInfluences', () => {
  it('rescales weights to sum 1 preserving proportions', () => {
    const out = normalizeInfluences([
      { boneIndex: 0, weight: 1 },
      { boneIndex: 1, weight: 3 },
    ]);
    expect(out.map((i) => i.weight)).toEqual([0.25, 0.75]);
  });

  it('falls back to an equal split when every weight is zero', () => {
    const out = normalizeInfluences([
      { boneIndex: 0, weight: 0 },
      { boneIndex: 1, weight: 0 },
    ]);
    expect(out.map((i) => i.weight)).toEqual([0.5, 0.5]);
  });

  it('preserves the bind-local coordinates carried alongside the weight', () => {
    const out = normalizeInfluences([
      { boneIndex: 2, vx: 4, vy: -7, weight: 2 },
      { boneIndex: 5, vx: 1, vy: 9, weight: 2 },
    ]);
    expect(out[0]).toEqual({ boneIndex: 2, vx: 4, vy: -7, weight: 0.5 });
    expect(out[1]).toEqual({ boneIndex: 5, vx: 1, vy: 9, weight: 0.5 });
  });

  it('returns an empty list unchanged', () => {
    expect(normalizeInfluences([])).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [{ boneIndex: 0, weight: 4 }];
    normalizeInfluences(input);
    expect(input[0]!.weight).toBe(4);
  });
});

describe('capInfluences', () => {
  it('keeps the largest by weight, drops the rest, and renormalizes the survivors', () => {
    const out = capInfluences(
      [
        { boneIndex: 0, weight: 0.1 },
        { boneIndex: 1, weight: 0.5 },
        { boneIndex: 2, weight: 0.2 },
        { boneIndex: 3, weight: 0.05 },
        { boneIndex: 4, weight: 0.15 },
      ],
      MAX_BONE_INFLUENCES,
    );
    expect(out).toHaveLength(MAX_BONE_INFLUENCES);
    expect(out.some((i) => i.boneIndex === 3)).toBe(false); // smallest dropped
    expect(out.map((i) => i.boneIndex)).toEqual([0, 1, 2, 4]); // survivors keep original order
    expect(out.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 12);
  });

  it('breaks weight ties by original position deterministically', () => {
    const out = capInfluences(
      [
        { boneIndex: 0, weight: 0.25 },
        { boneIndex: 1, weight: 0.25 },
        { boneIndex: 2, weight: 0.25 },
        { boneIndex: 3, weight: 0.25 },
        { boneIndex: 4, weight: 0.25 },
      ],
      MAX_BONE_INFLUENCES,
    );
    expect(out.map((i) => i.boneIndex)).toEqual([0, 1, 2, 3]); // ties keep the earliest four
  });

  it('only renormalizes when already within the cap', () => {
    const out = capInfluences([
      { boneIndex: 0, weight: 1 },
      { boneIndex: 1, weight: 1 },
    ]);
    expect(out.map((i) => i.weight)).toEqual([0.5, 0.5]);
  });
});

describe('finalizeVertexWeights', () => {
  it('guarantees at most MAX_BONE_INFLUENCES summing to 1', () => {
    const out = finalizeVertexWeights([
      { boneIndex: 0, vx: 0, vy: 0, weight: 0.9 },
      { boneIndex: 1, vx: 0, vy: 0, weight: 0.05 },
      { boneIndex: 2, vx: 0, vy: 0, weight: 0.03 },
      { boneIndex: 3, vx: 0, vy: 0, weight: 0.02 },
      { boneIndex: 4, vx: 0, vy: 0, weight: 0.01 },
    ]);
    expect(out.length).toBeLessThanOrEqual(MAX_BONE_INFLUENCES);
    expect(Math.abs(out.reduce((s, i) => s + i.weight, 0) - 1)).toBeLessThanOrEqual(
      WEIGHT_SUM_EPSILON,
    );
  });

  it('is idempotent on an already normalized, capped set', () => {
    const once = finalizeVertexWeights([
      { boneIndex: 0, weight: 0.4 },
      { boneIndex: 1, weight: 0.6 },
    ]);
    expect(finalizeVertexWeights(once)).toEqual(once);
  });
});

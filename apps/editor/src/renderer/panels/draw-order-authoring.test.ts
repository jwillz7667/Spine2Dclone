import { describe, expect, it } from 'vitest';
import {
  applyDrawOrderOffsets,
  computeDrawOrderOffsets,
  moveInOrder,
} from './draw-order-authoring';

const setup = ['a', 'b', 'c', 'd'] as const;

describe('computeDrawOrderOffsets', () => {
  it('returns an empty list for the identity reorder', () => {
    expect(computeDrawOrderOffsets(setup, ['a', 'b', 'c', 'd'])).toEqual([]);
  });

  it('emits the two signed deltas of an adjacent swap and omits the unmoved slots', () => {
    // swap b and c: b moves +1 (index 1 -> 2), c moves -1 (index 2 -> 1).
    expect(computeDrawOrderOffsets(setup, ['a', 'c', 'b', 'd'])).toEqual([
      { slot: 'b', offset: 1 },
      { slot: 'c', offset: -1 },
    ]);
  });

  it('emits every moved slot for a multi-move reorder in setup order', () => {
    // d to the front: d -3, a/b/c each shift +1.
    expect(computeDrawOrderOffsets(setup, ['d', 'a', 'b', 'c'])).toEqual([
      { slot: 'a', offset: 1 },
      { slot: 'b', offset: 1 },
      { slot: 'c', offset: 1 },
      { slot: 'd', offset: -3 },
    ]);
  });
});

describe('applyDrawOrderOffsets', () => {
  it('is the inverse of computeDrawOrderOffsets for a multi-move', () => {
    const desired = ['d', 'a', 'b', 'c'];
    const offsets = computeDrawOrderOffsets(setup, desired);
    expect(applyDrawOrderOffsets(setup, offsets)).toEqual(desired);
  });

  it('returns the setup order for an empty offset list', () => {
    expect(applyDrawOrderOffsets(setup, [])).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('moveInOrder', () => {
  it('moves a slot one step later', () => {
    expect(moveInOrder(setup, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('moves a slot one step earlier', () => {
    expect(moveInOrder(setup, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns the same reference (a no-op) at the ends', () => {
    expect(moveInOrder(setup, 'a', -1)).toBe(setup);
    expect(moveInOrder(setup, 'd', 1)).toBe(setup);
  });
});

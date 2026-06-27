import { describe, expect, it } from 'vitest';
import { applyDeform } from '../src';

// ADR-0003 section 9: deform is solve-order step 5, AFTER skinning. Per-vertex (dx, dy) offsets are
// ADDED to the post-skin world-space positions, written into a caller buffer with ZERO allocation; the
// out buffer may alias skinned (in-place).

describe('applyDeform', () => {
  it('leaves positions unchanged for zero offsets', () => {
    const skinned = new Float32Array([10, 20, 30, 40]);
    const offsets = new Float32Array([0, 0, 0, 0]);
    const out = new Float32Array(4);

    applyDeform(skinned, offsets, out, 2);

    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
  });

  it('translates every vertex by a constant offset', () => {
    const skinned = new Float32Array([10, 20, 30, 40]);
    const offsets = new Float32Array([5, -3, 5, -3]);
    const out = new Float32Array(4);

    applyDeform(skinned, offsets, out, 2);

    expect(Array.from(out)).toEqual([15, 17, 35, 37]);
  });

  it('works in place when out aliases skinned', () => {
    const buffer = new Float32Array([1, 2, 3, 4]);
    const offsets = [10, 20, 30, 40];

    applyDeform(buffer, offsets, buffer, 2);

    expect(Array.from(buffer)).toEqual([11, 22, 33, 44]);
  });

  it('only processes the requested vertex count', () => {
    const skinned = new Float32Array([1, 1, 2, 2, 9, 9]);
    const offsets = new Float32Array([1, 1, 1, 1, 1, 1]);
    const out = new Float32Array([0, 0, 0, 0, 7, 7]);

    applyDeform(skinned, offsets, out, 2);

    // The third vertex is untouched (count = 2).
    expect(Array.from(out)).toEqual([2, 2, 3, 3, 7, 7]);
  });
});

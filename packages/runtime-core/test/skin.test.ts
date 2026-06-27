import type { MeshAttachment } from '@marionette/format/types';
import { describe, expect, it } from 'vitest';
import { compose, solveSkin, solveSkinUnweighted, transformPoint } from '../src';
import type { Mat2x3 } from '../src';

// ADR-0003 section 9 / ADR-0002: skinning is solve-order step 5. Weighted = sum of weight * (boneWorld
// * (vx, vy)) in stored influence order; unweighted fast path = slotBoneWorld * (x, y). Both write
// world-space (x, y) pairs into a caller-provided Float32Array with ZERO allocation.

const meshBase = {
  type: 'mesh',
  path: 'p',
  uvs: [] as number[],
  triangles: [] as number[],
  hullLength: 0,
  width: 0,
  height: 0,
  color: { r: 1, g: 1, b: 1, a: 1 },
} as const;

const weightedMesh = (vertices: number[], bones: number[]): MeshAttachment => ({
  ...meshBase,
  vertices,
  bones,
});

const unweightedMesh = (vertices: number[]): MeshAttachment => ({ ...meshBase, vertices });

// Pack a list of matrices into the boneWorldMatrices Float64Array (6 lanes per global bone index).
const packMatrices = (matrices: Mat2x3[]): Float64Array => {
  const packed = new Float64Array(matrices.length * 6);
  matrices.forEach((m, index) => packed.set(m, index * 6));
  return packed;
};

describe('solveSkin (weighted)', () => {
  it('reproduces the bone transform exactly for a 1-bone rigid weight', () => {
    const m0 = compose(100, -20, 35, 1.3, 0.8, 0, 0);
    const bones = packMatrices([m0]);
    const vx = 12;
    const vy = 7;
    const mesh = weightedMesh([1, 0, vx, vy, 1], [0]);
    const out = new Float32Array(2);

    solveSkin(mesh, bones, out);

    const [ex, ey] = transformPoint(m0, vx, vy);
    expect(out[0]).toBeCloseTo(ex, 4);
    expect(out[1]).toBeCloseTo(ey, 4);
  });

  it('lands at the average for a 2-bone 50/50 weight', () => {
    const m0 = compose(0, 0, 0, 1, 1, 0, 0);
    const m1 = compose(40, 60, 90, 1, 1, 0, 0);
    const bones = packMatrices([m0, m1]);
    const vx = 10;
    const vy = 5;
    const mesh = weightedMesh([2, 0, vx, vy, 0.5, 1, vx, vy, 0.5], [0, 1]);
    const out = new Float32Array(2);

    solveSkin(mesh, bones, out);

    const [ax, ay] = transformPoint(m0, vx, vy);
    const [bx, by] = transformPoint(m1, vx, vy);
    expect(out[0]).toBeCloseTo((ax + bx) / 2, 4);
    expect(out[1]).toBeCloseTo((ay + by) / 2, 4);
  });

  it('skins multiple logical vertices in stream order', () => {
    const m0 = compose(5, 5, 0, 2, 2, 0, 0);
    const bones = packMatrices([m0]);
    // Two logical vertices: [count=1, bone=0, vx, vy, w=1] each. Vertex 0 = (1,0), vertex 1 = (0,1).
    const mesh = weightedMesh([1, 0, 1, 0, 1, 1, 0, 0, 1, 1], [0]);
    const out = new Float32Array(4);

    solveSkin(mesh, bones, out);

    expect([out[0], out[1]]).toEqual([transformPoint(m0, 1, 0)[0], transformPoint(m0, 1, 0)[1]]);
    expect([out[2], out[3]]).toEqual([transformPoint(m0, 0, 1)[0], transformPoint(m0, 0, 1)[1]]);
  });

  it('writes into a reused buffer without allocating across repeated calls', () => {
    const m0 = compose(3, 4, 10, 1, 1, 0, 0);
    const bones = packMatrices([m0]);
    const mesh = weightedMesh([1, 0, 2, 2, 1], [0]);
    const out = new Float32Array(2);

    for (let i = 0; i < 1000; i += 1) {
      solveSkin(mesh, bones, out);
    }

    const [ex, ey] = transformPoint(m0, 2, 2);
    expect(out[0]).toBeCloseTo(ex, 4);
    expect(out[1]).toBeCloseTo(ey, 4);
  });
});

describe('solveSkinUnweighted', () => {
  it('applies the slot bone matrix to each (x, y) pair', () => {
    const slotBoneWorld = compose(20, -10, 45, 1.5, 0.5, 0, 0);
    const mesh = unweightedMesh([1, 0, 0, 1, 3, 4]);
    const out = new Float32Array(6);

    solveSkinUnweighted(mesh, slotBoneWorld, out);

    const points: Array<readonly [number, number]> = [
      [1, 0],
      [0, 1],
      [3, 4],
    ];
    points.forEach(([x, y], index) => {
      const [ex, ey] = transformPoint(slotBoneWorld, x, y);
      expect(out[index * 2]).toBeCloseTo(ex, 4);
      expect(out[index * 2 + 1]).toBeCloseTo(ey, 4);
    });
  });
});

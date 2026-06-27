import { describe, expect, it } from 'vitest';
import {
  decodeWeightedVertices,
  encodeWeightedVertices,
  isWeightedMesh,
  MAX_BONE_INFLUENCES,
  type PerVertexBindings,
} from '../src/mesh/weighted';

// WP-2.2 / ADR-0002: the weighted-vertex codec is the single producer/consumer of the on-disk
// weighted layout. Its core property is round-trip identity (decode(encode(x)) deep-equals x) and the
// `bones` manifest being the ascending, de-duplicated set of referenced global indices.

// A small deterministic LCG (no Math.random, so the fuzz is reproducible and lint-clean). Numerics
// engineering: a fixed seed yields the same stream every run, which is what makes a failure debuggable.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('weighted vertex codec (ADR-0002)', () => {
  it('encodes the format-contract section 6.4 worked example', () => {
    const bindings: PerVertexBindings = [
      [{ boneIndex: 2, vx: -10, vy: -10, weight: 1 }],
      [{ boneIndex: 3, vx: 10, vy: -10, weight: 1 }],
      [
        { boneIndex: 2, vx: 10, vy: 10, weight: 0.5 },
        { boneIndex: 3, vx: 10, vy: 10, weight: 0.5 },
      ],
      [{ boneIndex: 2, vx: -10, vy: 10, weight: 1 }],
    ];
    const { vertices, bones } = encodeWeightedVertices(bindings);
    expect(vertices).toEqual([
      1, 2, -10, -10, 1, 1, 3, 10, -10, 1, 2, 2, 10, 10, 0.5, 3, 10, 10, 0.5, 1, 2, -10, 10, 1,
    ]);
    expect(bones).toEqual([2, 3]);
    expect(decodeWeightedVertices({ vertices })).toEqual(bindings);
  });

  it('produces an ascending, de-duplicated bones manifest regardless of reference order', () => {
    const bindings: PerVertexBindings = [
      [{ boneIndex: 5, vx: 0, vy: 0, weight: 1 }],
      [{ boneIndex: 1, vx: 0, vy: 0, weight: 1 }],
      [
        { boneIndex: 5, vx: 0, vy: 0, weight: 0.5 },
        { boneIndex: 3, vx: 0, vy: 0, weight: 0.5 },
      ],
    ];
    expect(encodeWeightedVertices(bindings).bones).toEqual([1, 3, 5]);
  });

  it('round-trips randomized 1..4 influence bindings (fuzz, deep-equal)', () => {
    const rng = makeRng(0xc0ffee);
    for (let trial = 0; trial < 200; trial += 1) {
      const vertexCount = 1 + Math.floor(rng() * 12);
      const bindings: PerVertexBindings = Array.from({ length: vertexCount }, () => {
        const influences = 1 + Math.floor(rng() * MAX_BONE_INFLUENCES);
        return Array.from({ length: influences }, () => ({
          boneIndex: Math.floor(rng() * 16),
          vx: Math.round((rng() - 0.5) * 2000) / 10,
          vy: Math.round((rng() - 0.5) * 2000) / 10,
          weight: Math.round(rng() * 1000) / 1000,
        }));
      });
      const { vertices } = encodeWeightedVertices(bindings);
      expect(decodeWeightedVertices({ vertices })).toEqual(bindings);
    }
  });

  it('isWeightedMesh keys on the presence of the bones manifest', () => {
    expect(isWeightedMesh({ bones: [0] })).toBe(true);
    expect(isWeightedMesh({ bones: [] })).toBe(true);
    expect(isWeightedMesh({})).toBe(false);
  });

  it('throws on a structurally impossible stream (validated input is assumed)', () => {
    expect(() => decodeWeightedVertices({ vertices: [2, 0, 0, 0, 1] })).toThrow();
  });
});

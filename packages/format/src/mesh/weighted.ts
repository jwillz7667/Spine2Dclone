import type { MeshAttachment } from '../schema/attachment';

// Weighted mesh vertex encoding (handoff section 6, format-contract section 6, ADR-0002). The codec is
// the SINGLE producer/consumer of the on-disk weighted layout. The math (skinning) lives in
// runtime-core; the format owns only the encode/decode and the validation that the stream is exact.

// The standard runtime-cost cap on per-vertex bone influences (ADR-0002). A pinned constant, not
// document state and not configurable: runtimes size fixed per-vertex buffers at this value.
export const MAX_BONE_INFLUENCES = 4;

// Per-logical-vertex weight sum must be within this epsilon of 1.0 (ADR-0002, MESH_WEIGHT_SUM). The
// validator checks; the editor weight-paint pipeline and exporter normalize.
export const WEIGHT_SUM_EPSILON = 1e-4;

// One bone influence on a logical vertex: a GLOBAL bone index (into SkeletonDocument.bones), the
// vertex position (vx, vy) expressed in that bone's local (bind) frame, and the blend weight.
export interface WeightedInfluence {
  readonly boneIndex: number;
  readonly vx: number;
  readonly vy: number;
  readonly weight: number;
}

// The decoded form of a weighted mesh: one inner array per LOGICAL vertex, each holding 1..4
// influences in stored order (the accumulation order is part of the numerical contract, ADR-0003).
export type PerVertexBindings = readonly (readonly WeightedInfluence[])[];

// Encode per-vertex bindings into the on-disk `{ vertices, bones }` pair. `vertices` is the
// concatenated [boneCount, (boneIndex, vx, vy, weight) * boneCount] stream; `bones` is the ascending,
// de-duplicated set of referenced GLOBAL bone indices (the gather manifest, ADR-0002). Round-trips
// with decodeWeightedVertices.
export function encodeWeightedVertices(bindings: PerVertexBindings): {
  vertices: number[];
  bones: number[];
} {
  const vertices: number[] = [];
  const referenced = new Set<number>();
  for (const influences of bindings) {
    vertices.push(influences.length);
    for (const influence of influences) {
      vertices.push(influence.boneIndex, influence.vx, influence.vy, influence.weight);
      referenced.add(influence.boneIndex);
    }
  }
  const bones = [...referenced].sort((a, b) => a - b);
  return { vertices, bones };
}

// Decode a weighted mesh's `vertices` stream into per-vertex bindings. Requires a VALIDATED weighted
// mesh (the import boundary runs validate/mesh.ts first): the stream is self-delimiting (each vertex
// starts with its boneCount), so this walks it directly. A malformed stream that survived validation
// is a programming error and throws rather than returning a half-decoded result (fail loud).
export function decodeWeightedVertices(mesh: Pick<MeshAttachment, 'vertices'>): PerVertexBindings {
  const stream = mesh.vertices;
  const out: WeightedInfluence[][] = [];
  let cursor = 0;
  while (cursor < stream.length) {
    const boneCount = stream[cursor];
    cursor += 1;
    if (boneCount === undefined || !Number.isInteger(boneCount) || boneCount < 1) {
      throw new Error(`weighted vertex stream has an invalid boneCount at index ${cursor - 1}`);
    }
    const influences: WeightedInfluence[] = [];
    for (let i = 0; i < boneCount; i += 1) {
      const boneIndex = stream[cursor];
      const vx = stream[cursor + 1];
      const vy = stream[cursor + 2];
      const weight = stream[cursor + 3];
      if (boneIndex === undefined || vx === undefined || vy === undefined || weight === undefined) {
        throw new Error(`weighted vertex stream is truncated near index ${cursor}`);
      }
      influences.push({ boneIndex, vx, vy, weight });
      cursor += 4;
    }
    out.push(influences);
  }
  return out;
}

// True when a mesh uses the weighted encoding (its `bones` manifest is present). The PRESENCE of
// `bones` is the canonical weighted discriminator (ADR-0002).
export function isWeightedMesh(mesh: Pick<MeshAttachment, 'bones'>): boolean {
  return mesh.bones !== undefined;
}

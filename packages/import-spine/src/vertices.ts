// Spine and our format share the SAME on-disk weighted vertex stream (derivable from the published
// documentation, which describes the per-vertex layout "bone count, then bone index, bind X/Y, weight"):
//   [ boneCount, (boneIndex, bindX, bindY, weight) * boneCount, ... one group per logical vertex ]
// so a weighted mesh/path vertex stream is carried through UNCHANGED. The only value our format keeps
// that Spine's JSON leaves implicit is the `bones` manifest (the ascending, de-duplicated set of
// referenced GLOBAL bone indices), which we derive here by walking the stream.

// True when a vertex stream is weighted. An unweighted stream is exactly `2 * vertexCount` floats (a
// flat [x, y, ...] list); anything else is the self-delimiting weighted stream. vertexCount comes from
// uvs.length / 2 for meshes and from the `vertexCount` field for bounding/clipping/path attachments.
export function isWeightedStream(vertices: readonly number[], vertexCount: number): boolean {
  return vertices.length !== vertexCount * 2;
}

// Derive the `bones` manifest from a weighted vertex stream: the ascending, de-duplicated set of bone
// indices it references. Best-effort by design: a malformed stream (truncated or a non-integer bone
// count) stops the walk and returns what was gathered so far, because the definitive rejection is the
// format mesh validator (MESH_WEIGHT_DECODE / MESH_VERTEX_LENGTH), which runs on the converted document
// and fails the import loudly. Never throws.
export function deriveWeightedBones(vertices: readonly number[]): number[] {
  const referenced = new Set<number>();
  let cursor = 0;
  while (cursor < vertices.length) {
    const boneCount = vertices[cursor];
    cursor += 1;
    if (boneCount === undefined || !Number.isInteger(boneCount) || boneCount < 1) break;
    let truncated = false;
    for (let i = 0; i < boneCount; i += 1) {
      const boneIndex = vertices[cursor];
      if (boneIndex === undefined || vertices[cursor + 3] === undefined) {
        truncated = true;
        break;
      }
      referenced.add(boneIndex);
      cursor += 4;
    }
    if (truncated) break;
  }
  return [...referenced].sort((a, b) => a - b);
}

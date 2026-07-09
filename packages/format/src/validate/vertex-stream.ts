import { MAX_BONE_INFLUENCES, WEIGHT_SUM_EPSILON } from '../mesh/weighted';
import { formatError } from './errors';
import type { FormatError } from './errors';

// The shared weighted-vertex stream check (ADR-0002, format-contract section 6.2/6.3). A mesh and a path
// (ADR-0011 section 1.2) store their deformable vertices with the SAME self-delimiting per-vertex encoding,
// so the defensive decode walk lives here once and both validators consume it. The faults it reports are
// the shared codec codes (MESH_WEIGHT_*), because they describe the codec, not mesh topology.
//
// Walk the stream, checking influence cap, bone range, weight sum, exact consumption, and the `bones`
// manifest equality. Returns the decoded logical-vertex count when the stream decodes and is consumed to
// its end (and, for a mesh, matches the expected count), or null on any hard decode failure. A boneCount it
// cannot trust stops the walk (downstream numbers are unaligned) as MESH_WEIGHT_DECODE.
//
// `expectedCount` is the caller's independently-known logical-vertex count: a mesh knows V from its uvs and
// requires the stream to decode to exactly that; a path has no uvs, so V IS the decoded count and the
// caller omits it (only exact consumption is required).
export function checkWeightedVertexStream(
  stream: readonly number[],
  manifest: readonly number[],
  verticesPath: string,
  bonesPath: string,
  boneCount: number,
  errors: FormatError[],
  expectedCount?: number,
): number | null {
  const referenced = new Set<number>();
  let cursor = 0;
  let logicalVertices = 0;
  let decodeFailed = false;

  while (cursor < stream.length) {
    const influenceCount = stream[cursor];
    cursor += 1;
    if (influenceCount === undefined || !Number.isInteger(influenceCount) || influenceCount < 1) {
      errors.push(
        formatError(
          'MESH_WEIGHT_DECODE',
          verticesPath,
          `weighted vertex stream has an invalid influence count ${influenceCount ?? 'undefined'} at stream index ${cursor - 1}`,
          { index: cursor - 1 },
        ),
      );
      decodeFailed = true;
      break;
    }
    if (influenceCount > MAX_BONE_INFLUENCES) {
      errors.push(
        formatError(
          'MESH_WEIGHT_INFLUENCE_CAP',
          verticesPath,
          `weighted vertex ${logicalVertices} has ${influenceCount} influences, exceeding the cap of ${MAX_BONE_INFLUENCES}`,
          { vertex: logicalVertices, influences: influenceCount, cap: MAX_BONE_INFLUENCES },
        ),
      );
    }
    let weightSum = 0;
    for (let i = 0; i < influenceCount; i += 1) {
      const boneIndex = stream[cursor];
      const weight = stream[cursor + 3];
      if (boneIndex === undefined || stream[cursor + 1] === undefined || weight === undefined) {
        errors.push(
          formatError('MESH_WEIGHT_DECODE', verticesPath, 'weighted vertex stream is truncated', {
            index: cursor,
          }),
        );
        decodeFailed = true;
        break;
      }
      if (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= boneCount) {
        errors.push(
          formatError(
            'MESH_WEIGHT_BONE_RANGE',
            verticesPath,
            `weighted vertex ${logicalVertices} references bone index ${boneIndex}, out of range [0, ${boneCount})`,
            { vertex: logicalVertices, boneIndex, boneCount },
          ),
        );
      } else {
        referenced.add(boneIndex);
      }
      weightSum += weight;
      cursor += 4;
    }
    if (decodeFailed) break;
    if (Math.abs(weightSum - 1) > WEIGHT_SUM_EPSILON) {
      errors.push(
        formatError(
          'MESH_WEIGHT_SUM',
          verticesPath,
          `weighted vertex ${logicalVertices} weights sum to ${weightSum}, not 1 (epsilon ${WEIGHT_SUM_EPSILON})`,
          { vertex: logicalVertices, sum: weightSum },
        ),
      );
    }
    logicalVertices += 1;
  }

  if (decodeFailed) return null;

  const consumedAll = cursor === stream.length;
  const countMatches = expectedCount === undefined || logicalVertices === expectedCount;
  if (!consumedAll || !countMatches) {
    errors.push(
      formatError(
        'MESH_WEIGHT_DECODE',
        verticesPath,
        expectedCount === undefined
          ? `weighted vertex stream decoded ${logicalVertices} vertices consuming ${cursor} of ${stream.length} numbers; expected to consume all`
          : `weighted mesh decoded ${logicalVertices} vertices consuming ${cursor} of ${stream.length} numbers; expected ${expectedCount} vertices consuming all`,
        expectedCount === undefined
          ? { decodedVertices: logicalVertices, consumed: cursor }
          : { decodedVertices: logicalVertices, expectedVertices: expectedCount, consumed: cursor },
      ),
    );
    return null;
  }

  const manifestSet = new Set(manifest);
  const ascendingUnique =
    manifest.length === manifestSet.size && manifest.every((v, i) => i === 0 || v > manifest[i - 1]!);
  const sameMembers =
    manifestSet.size === referenced.size && [...referenced].every((v) => manifestSet.has(v));
  if (!ascendingUnique || !sameMembers) {
    errors.push(
      formatError(
        'MESH_WEIGHT_BONES_MANIFEST',
        bonesPath,
        'weighted `bones` manifest must be the ascending, de-duplicated set of referenced bone indices',
        {
          manifest: manifest.join(','),
          referenced: [...referenced].sort((a, b) => a - b).join(','),
        },
      ),
    );
    return null;
  }

  return logicalVertices;
}

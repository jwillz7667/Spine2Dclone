import { MAX_BONE_INFLUENCES } from '@marionette/format';

// Pure, deterministic weight math for mesh-to-bone binding (WP-2.3) and weight painting (WP-2.4). No
// I/O, no solve, no document access: these operate on per-LOGICAL-vertex influence lists, where each
// influence carries a GLOBAL bone index (into SkeletonDocument.bones, ADR-0002) and a blend weight. The
// functions are generic over any influence shape that has { boneIndex, weight }, so the bind-local
// (vx, vy) coordinates the weighted codec needs ride through untouched while only the weights change.

// The minimal influence shape the weight helpers read and rewrite. Binding / paint commands pass the
// format WeightedInfluence (which additionally carries vx/vy); the extra fields are preserved by the
// generic spread, so these helpers never need to know about them.
export interface BoneInfluence {
  readonly boneIndex: number;
  readonly weight: number;
}

// Shortest distance from point (px, py) to the line SEGMENT (ax, ay)-(bx, by). Unlike the infinite-line
// distance, the foot of the perpendicular is clamped to the segment so a point beyond an endpoint
// measures to that endpoint; a degenerate (zero-length) segment collapses to the point-to-endpoint
// distance. This is the bone-proximity metric for rigid-nearest binding and auto-weight: a bone is its
// origin-to-tip segment, not just its origin.
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

// Rescale a vertex's influences so their weights sum to 1, preserving relative proportions. When the
// total is non-positive (every weight zero, e.g. a freshly seeded vertex) fall back to an equal split so
// the result is always a valid normalized set. Returns fresh objects; the inputs are never mutated.
export function normalizeInfluences<T extends BoneInfluence>(influences: readonly T[]): T[] {
  if (influences.length === 0) return [];
  let sum = 0;
  for (const influence of influences) sum += influence.weight;
  if (sum <= 0) {
    const equal = 1 / influences.length;
    return influences.map((influence) => ({ ...influence, weight: equal }));
  }
  return influences.map((influence) => ({ ...influence, weight: influence.weight / sum }));
}

// Keep at most `max` influences (the largest by weight), drop the rest, then renormalize the survivors
// to sum 1. Ties break by original position so the result is deterministic for a given input order, and
// the survivors are returned in their original relative order (the influence accumulation order is part
// of the skinning numerical contract, ADR-0003). When the input already fits, it is only renormalized.
export function capInfluences<T extends BoneInfluence>(
  influences: readonly T[],
  max: number = MAX_BONE_INFLUENCES,
): T[] {
  if (influences.length <= max) return normalizeInfluences(influences);
  const survivors = influences
    .map((influence, index) => ({ influence, index }))
    .sort((a, b) => b.influence.weight - a.influence.weight || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.influence);
  return normalizeInfluences(survivors);
}

// The canonical post-edit finalize for one vertex: cap to MAX_BONE_INFLUENCES then normalize, so the
// result has at most 4 influences whose weights sum to 1 (within WEIGHT_SUM_EPSILON). Idempotent on an
// already-normalized, already-capped set. Every bind / auto-weight / paint command runs each touched
// vertex through this, which is what guarantees the document validates after the edit.
export function finalizeVertexWeights<T extends BoneInfluence>(influences: readonly T[]): T[] {
  return normalizeInfluences(capInfluences(influences));
}

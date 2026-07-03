import { decodeWeightedVertices } from '@marionette/format';
import { transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import type { BoneId, DocumentReadModel, MeshAttachmentEntity, SlotId } from '../document';

// Pure weight-paint resolution for the WP-2.4 viewport tool and overlay: which WEIGHTED mesh the brush
// paints, where its vertices sit in world space, the active bone's per-vertex weight (the heat map and the
// brush's currentWeights), and the mesh adjacency the smooth mode averages over. The parallel of mesh-edit.ts
// (which resolves the UNWEIGHTED mesh), but for the weighted encoding: it decodes the on-disk weighted
// vertex stream through the format codec (never a second decoder, ADR-0002) and maps each influence's GLOBAL
// bone index to a BoneId so world positions read from a BoneId-keyed solve. Everything here READS the model;
// the actual weight change is a PaintWeightStrokeCommand (Law 2).

// One decoded influence on a logical vertex: the bone (both its GLOBAL index, the encoding's key, and the
// resolved BoneId the world solve is keyed by), the vertex position in that bone's bind-local frame, and the
// blend weight. Mirrors the format's WeightedInfluence with the BoneId added.
export interface WeightPaintInfluence {
  readonly boneIndex: number;
  readonly boneId: BoneId;
  readonly vx: number;
  readonly vy: number;
  readonly weight: number;
}

// The mesh the weight tool paints: the selected slot's active-or-first WEIGHTED mesh, decoded to per-vertex
// influences. `perVertex[i]` is the 1..4 influences of logical vertex i (stored order preserved). Unweighted
// meshes are excluded (that is the mesh tool's target, mesh-edit.ts): the brush needs the bone bindings.
export interface WeightPaintTarget {
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly mesh: MeshAttachmentEntity;
  readonly perVertex: readonly (readonly WeightPaintInfluence[])[];
  readonly triangles: readonly number[];
  readonly vertexCount: number;
}

// The selected slot's active mesh attachment when it is WEIGHTED (its `bones` manifest present and
// non-empty), else the slot's first weighted mesh, decoded to per-vertex influences; null when nothing
// resolves. The GLOBAL bone index each influence carries is the position in model.bones() (ADR-0002), so it
// maps one-to-one to that bone's entity and its BoneId.
export function resolveWeightPaintTarget(
  model: DocumentReadModel,
  slotId: SlotId | null,
): WeightPaintTarget | null {
  if (slotId === null) return null;
  const slot = model.getSlot(slotId);
  if (slot === undefined) return null;

  const attachments = model.attachments(slotId);
  const active = attachments.find((a) => a.name === slot.attachment && a.kind === 'mesh');
  const candidate = active ?? attachments.find((a) => a.kind === 'mesh');
  if (candidate === undefined || candidate.kind !== 'mesh') return null;
  if (candidate.bones === undefined || candidate.bones.length === 0) return null;

  const bones = model.bones();
  const decoded = decodeWeightedVertices({ vertices: [...candidate.vertices] });
  const perVertex = decoded.map((influences) =>
    influences.map((influence) => ({
      boneIndex: influence.boneIndex,
      boneId: bones[influence.boneIndex]!.id,
      vx: influence.vx,
      vy: influence.vy,
      weight: influence.weight,
    })),
  );

  return {
    slotId,
    attachmentName: candidate.name,
    mesh: candidate,
    perVertex,
    triangles: candidate.triangles,
    vertexCount: perVertex.length,
  };
}

// World position per logical vertex, flat [x0, y0, x1, y1, ...]: pos = sum over influences of
// weight * (boneWorld * (vx, vy)). Mirrors runtime-core's solveSkin (and document-core's vertexWorldPosition)
// so the brush's coverage math agrees with the runtime. `worldById` is the setup-pose bone world solve keyed
// by BoneId (scene-solve.solveWorldById); an influence whose bone is absent contributes nothing.
export function weightedVertexWorldPositions(
  target: WeightPaintTarget,
  worldById: ReadonlyMap<BoneId, Mat2x3>,
): number[] {
  const out: number[] = new Array<number>(target.vertexCount * 2);
  for (let i = 0; i < target.perVertex.length; i += 1) {
    let px = 0;
    let py = 0;
    for (const influence of target.perVertex[i]!) {
      const world = worldById.get(influence.boneId);
      if (world === undefined) continue;
      const [wx, wy] = transformPoint(world, influence.vx, influence.vy);
      px += influence.weight * wx;
      py += influence.weight * wy;
    }
    out[i * 2] = px;
    out[i * 2 + 1] = py;
  }
  return out;
}

// The active bone's current weight per vertex index (0 where the active bone is not an influence). Feeds the
// brush's clamp (add stops at 1, subtract at 0) and the heat-map coloring; every vertex index is present so
// the overlay colors untouched vertices as weight 0 rather than leaving gaps.
export function activeBoneWeights(
  target: WeightPaintTarget,
  activeBoneId: BoneId,
): Map<number, number> {
  const weights = new Map<number, number>();
  for (let i = 0; i < target.perVertex.length; i += 1) {
    const influence = target.perVertex[i]!.find((inf) => inf.boneId === activeBoneId);
    weights.set(i, influence?.weight ?? 0);
  }
  return weights;
}

// Vertex adjacency (index -> unique neighbor indices) from the triangle list, for the smooth mode's
// neighbor-average. Every vertex index in [0, vertexCount) is present (an isolated vertex maps to an empty
// list); each triangle contributes its three undirected edges, de-duplicated so a shared edge is listed once.
export function meshAdjacency(
  triangles: readonly number[],
  vertexCount: number,
): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  for (let i = 0; i < vertexCount; i += 1) adjacency.set(i, []);

  const addEdge = (from: number, to: number): void => {
    const neighbors = adjacency.get(from);
    if (neighbors !== undefined && !neighbors.includes(to)) neighbors.push(to);
  };

  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]!;
    const b = triangles[t + 1]!;
    const c = triangles[t + 2]!;
    addEdge(a, b);
    addEdge(b, a);
    addEdge(b, c);
    addEdge(c, b);
    addEdge(c, a);
    addEdge(a, c);
  }
  return adjacency;
}

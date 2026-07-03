import { invert, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import type { DocumentReadModel, MeshAttachmentEntity, SlotId } from '../document';
import { worldToScreen, type Camera } from './camera';
import { solveWorldById } from './scene-solve';

// Pure mesh-edit resolution for the WP-2.1 viewport tool and overlay: which mesh the tool edits, where
// its vertices are in world/screen space, and which vertex a click hits. Follows the scene-solve
// pattern (reuse runtime-core's solve for chrome, never reimplement it; pixel tolerances in screen
// space so picking is zoom-independent). Everything here READS the model; mutation stays in the tool's
// commands (Law 2).

// Max screen distance (px) from a vertex handle for a click to pick it.
export const VERTEX_PICK_TOLERANCE = 8;

// The mesh the tool is editing: the selected slot's active attachment when it is a mesh, else the
// slot's first mesh attachment. UNWEIGHTED only: the flat [x, y] vertex layout is what vertex picking,
// dragging (MoveMeshVertexCommand's lanes), and topology edits all assume; a weighted mesh must be
// unbound first (the WP-2.1 topology-lock workflow), and until then the tool treats the slot as having
// no editable mesh.
export interface MeshEditTarget {
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly mesh: MeshAttachmentEntity;
  readonly boneWorld: Mat2x3; // the slot bone's solved world matrix (setup pose)
}

export function resolveMeshEditTarget(
  model: DocumentReadModel,
  slotId: SlotId | null,
): MeshEditTarget | null {
  if (slotId === null) return null;
  const slot = model.getSlot(slotId);
  if (slot === undefined) return null;

  const attachments = model.attachments(slotId);
  const active = attachments.find((a) => a.name === slot.attachment && a.kind === 'mesh');
  const candidate = active ?? attachments.find((a) => a.kind === 'mesh');
  if (candidate === undefined || candidate.kind !== 'mesh') return null;
  if (candidate.bones !== undefined && candidate.bones.length > 0) return null;

  const boneWorld = solveWorldById(model).get(slot.bone);
  if (boneWorld === undefined) return null;
  return { slotId, attachmentName: candidate.name, mesh: candidate, boneWorld };
}

// The mesh's vertices in world space, flat [x0, y0, x1, y1, ...] (slot-bone locals through the bone
// world). The overlay draws these directly (it lives inside the camera-transformed world container).
export function meshWorldVertices(target: MeshEditTarget): number[] {
  const locals = target.mesh.vertices;
  const out: number[] = new Array<number>(locals.length);
  for (let i = 0; i < locals.length; i += 2) {
    const [wx, wy] = transformPoint(target.boneWorld, locals[i]!, locals[i + 1]!);
    out[i] = wx;
    out[i + 1] = wy;
  }
  return out;
}

// The index of the vertex nearest the screen point within the pick tolerance, or null. Screen-space so
// the tolerance is constant pixels at any zoom (the hitTestBone convention).
export function hitTestMeshVertex(
  target: MeshEditTarget,
  screenX: number,
  screenY: number,
  camera: Camera,
): number | null {
  const world = meshWorldVertices(target);
  let best: number | null = null;
  let bestDistance = VERTEX_PICK_TOLERANCE;
  for (let i = 0; i < world.length; i += 2) {
    const [sx, sy] = worldToScreen(camera, world[i]!, world[i + 1]!);
    const distance = Math.hypot(screenX - sx, screenY - sy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = i / 2;
    }
  }
  return best;
}

// Map a world-space point into the target's slot-bone local space (the space mesh vertices are stored
// in). Used by the drag (world cursor to MoveMeshVertexCommand locals) and by shift-click add.
export function meshLocalFromWorld(
  target: MeshEditTarget,
  worldX: number,
  worldY: number,
): readonly [number, number] {
  return transformPoint(invert(target.boneWorld), worldX, worldY);
}

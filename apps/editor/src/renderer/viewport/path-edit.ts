import { invert, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import type { DocumentReadModel, PathAttachmentEntity, SlotId } from '../document';
import { worldToScreen, type Camera } from './camera';
import { solveWorldById } from './scene-solve';

// Pure path-edit resolution for the PP-D11 viewport Path tool and overlay: which path attachment the tool
// edits, where its control points are in world/screen space, and which control point a click hits. Follows
// the mesh-edit precedent exactly (reuse runtime-core's solve for chrome, never reimplement it; pixel
// tolerances in screen space so picking is zoom-independent). Everything here READS the model; mutation
// stays in the tool's commands (Law 2). The flattened-spline / handle-tether math the OVERLAY draws lives
// in the pure path-overlay-geometry module; this module owns only target resolution and picking.

// Max screen distance (px) from a control-point handle for a click to pick it.
export const CONTROL_POINT_PICK_TOLERANCE = 8;

// The path the tool is editing: the selected slot's active attachment when it is a path, else the slot's
// first path attachment. Path attachments are always UNWEIGHTED in the authoring model (no `bones`
// manifest), so their `vertices` are the flat [x, y, ...] slot-bone-local control-point stream that control-
// point picking, dragging (MovePathControlPoint's pointIndex), and curve appends all assume.
export interface PathEditTarget {
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly path: PathAttachmentEntity;
  readonly boneWorld: Mat2x3; // the slot bone's solved world matrix (setup pose)
}

export function resolvePathEditTarget(
  model: DocumentReadModel,
  slotId: SlotId | null,
): PathEditTarget | null {
  if (slotId === null) return null;
  const slot = model.getSlot(slotId);
  if (slot === undefined) return null;

  const attachments = model.attachments(slotId);
  const active = attachments.find((a) => a.name === slot.attachment && a.kind === 'path');
  const candidate = active ?? attachments.find((a) => a.kind === 'path');
  if (candidate === undefined || candidate.kind !== 'path') return null;

  const boneWorld = solveWorldById(model).get(slot.bone);
  if (boneWorld === undefined) return null;
  return { slotId, attachmentName: candidate.name, path: candidate, boneWorld };
}

// The path's control points in world space, flat [x0, y0, x1, y1, ...] (slot-bone locals through the bone
// world). The overlay feeds these to the pure geometry (flatten spline, handle tethers, control handles),
// which is correct because an affine transform commutes with the Bezier basis: transforming the control
// points then sampling equals sampling then transforming.
export function pathWorldVertices(target: PathEditTarget): number[] {
  const locals = target.path.vertices;
  const out: number[] = new Array<number>(locals.length);
  for (let i = 0; i < locals.length; i += 2) {
    const [wx, wy] = transformPoint(target.boneWorld, locals[i]!, locals[i + 1]!);
    out[i] = wx;
    out[i + 1] = wy;
  }
  return out;
}

// The logical index of the control point nearest the screen point within the pick tolerance, or null.
// Screen-space so the tolerance is constant pixels at any zoom (the hitTestMeshVertex convention). Anchors
// and handles are both draggable, so every control point is a candidate; the returned index is the
// MovePathControlPoint pointIndex.
export function hitTestPathControlPoint(
  target: PathEditTarget,
  screenX: number,
  screenY: number,
  camera: Camera,
): number | null {
  const world = pathWorldVertices(target);
  let best: number | null = null;
  let bestDistance = CONTROL_POINT_PICK_TOLERANCE;
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

// Map a world-space point into the target's slot-bone local space (the space path control points are
// stored in). Used by the drag (world cursor to MovePathControlPoint locals).
export function pathLocalFromWorld(
  target: PathEditTarget,
  worldX: number,
  worldY: number,
): readonly [number, number] {
  return transformPoint(invert(target.boneWorld), worldX, worldY);
}

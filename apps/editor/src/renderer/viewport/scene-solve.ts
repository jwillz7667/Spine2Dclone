import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import type { Bone, SkeletonDocument } from '@marionette/format/types';
import type { BoneId, DocumentReadModel } from '@marionette/document-core';
import {
  buildPose,
  computeWorldTransforms,
  getTranslation,
  MAT2X3_STRIDE,
  resetToSetupPose,
  transformPoint,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import { worldToScreen, type Camera } from './camera';

// Editor-only solve of the live model's bone world transforms, used to position the gizmo and to hit
// test bones and gizmo handles in the viewport overlay. It REUSES runtime-core's solve (the behavioral
// source of truth, INV-1) rather than reimplementing it: the model is projected to a minimal in-memory
// document (no hash, no validation) because the model already guarantees the parent-before-child bone
// order buildPose relies on, and the transform channels come straight from the bone entities. This
// never writes the format and never decides an outcome; it only reads solved positions for chrome.

// Max screen distance (px) from a bone's drawn segment for a click to select it.
const BONE_PICK_TOLERANCE = 10;

// Project the model's bones to the SkeletonDocument shape buildPose consumes (parent ids resolved to
// names, in boneOrder). Only the bone array is meaningful to the solve; the remaining fields are empty
// valid defaults so the value satisfies the type without a cast. Mirrors the bone projection in
// document-core's exportDocument but skips the hash/validation, which the per-frame overlay does not
// need (and must not pay for during a drag).
function projectForSolve(model: DocumentReadModel): SkeletonDocument {
  const bones = model.bones();
  const idToName = new Map<BoneId, string>();
  for (const bone of bones) idToName.set(bone.id, bone.name);

  const projected: Bone[] = bones.map((bone) => ({
    name: bone.name,
    parent: bone.parent === null ? null : (idToName.get(bone.parent) ?? null),
    length: bone.length,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX,
    shearY: bone.shearY,
    transformMode: bone.transformMode,
  }));

  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: model.name,
    hash: '',
    bones: projected,
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    ikConstraints: [],
    transformConstraints: [],
    animations: {},
    atlas: { pages: [] },
  };
}

function readWorld(pose: Pose, index: number): Mat2x3 {
  const base = index * MAT2X3_STRIDE;
  const w = pose.world;
  return [w[base]!, w[base + 1]!, w[base + 2]!, w[base + 3]!, w[base + 4]!, w[base + 5]!];
}

// Solve every bone's world matrix, keyed by internal BoneId. The model's bone order is index-aligned
// with the pose, so the i-th solved matrix belongs to the i-th model bone. Callers that need both a
// bone and its parent matrix solve once and read both out of the returned map.
export function solveWorldById(model: DocumentReadModel): Map<BoneId, Mat2x3> {
  const bones = model.bones();
  const pose = buildPose(projectForSolve(model));
  resetToSetupPose(pose);
  computeWorldTransforms(pose);

  const worldById = new Map<BoneId, Mat2x3>();
  for (let i = 0; i < bones.length; i += 1) {
    worldById.set(bones[i]!.id, readWorld(pose, i));
  }
  return worldById;
}

// The internal id of the bone whose drawn segment (origin to tip) is nearest the screen point, within
// the pick tolerance, or null when the click misses every bone. Hit testing is in screen space so the
// tolerance stays a constant pixel distance regardless of camera zoom.
export function hitTestBone(
  model: DocumentReadModel,
  screenX: number,
  screenY: number,
  camera: Camera,
): BoneId | null {
  const worldById = solveWorldById(model);
  let best: BoneId | null = null;
  let bestDistance = BONE_PICK_TOLERANCE;

  for (const bone of model.bones()) {
    const world = worldById.get(bone.id);
    if (world === undefined) continue;
    const [ox, oy] = getTranslation(world);
    const [tx, ty] = transformPoint(world, bone.length, 0);
    const [osx, osy] = worldToScreen(camera, ox, oy);
    const [tsx, tsy] = worldToScreen(camera, tx, ty);
    const distance = distanceToSegment(screenX, screenY, osx, osy, tsx, tsy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = bone.id;
    }
  }
  return best;
}

// The internal ids of every bone whose solved world ORIGIN falls inside the world-space rectangle, in
// document (boneOrder) order. Used by the viewport marquee: a bone is captured when its origin is inside
// the box (the same origin the gizmo pivots on), which is a stable, zoom-independent hit rule. The rect is
// given by its min/max corners so the caller need not pre-sort a drag that went right-to-left or up.
export function bonesInRect(
  model: DocumentReadModel,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): BoneId[] {
  const worldById = solveWorldById(model);
  const hits: BoneId[] = [];
  for (const bone of model.bones()) {
    const world = worldById.get(bone.id);
    if (world === undefined) continue;
    const [ox, oy] = getTranslation(world);
    if (ox >= minX && ox <= maxX && oy >= minY && oy <= maxY) hits.push(bone.id);
  }
  return hits;
}

// Shortest distance from point (px, py) to the segment (ax, ay) to (bx, by). A degenerate (zero-length)
// segment collapses to the point distance, which keeps a length-0 bone selectable at its origin.
function distanceToSegment(
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

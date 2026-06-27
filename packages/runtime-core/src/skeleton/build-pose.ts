import type { SkeletonDocument } from '@marionette/format/types';
import { allocatePose, SETUP_STRIDE } from './pose';
import type { Pose } from './pose';

// Build a Pose from a VALIDATED document (format-contract: validate on import, then the solve trusts
// the result). It allocates the buffers once, captures each bone's setup transform, and resolves
// parent names to indices. It relies on, and does not re-check, the parent-precedes-child ordering
// invariant the format validator guarantees; if a caller hands it an unvalidated, out-of-order
// document the world pass is undefined (that boundary is the validator's job, not the solve's).
export function buildPose(document: SkeletonDocument): Pose {
  const bones = document.bones;
  const boneCount = bones.length;
  const boneNames = bones.map((bone) => bone.name);
  const pose = allocatePose(boneCount, boneNames);

  const indexByName = new Map<string, number>();
  for (let i = 0; i < boneCount; i += 1) {
    indexByName.set(boneNames[i]!, i);
  }

  for (let i = 0; i < boneCount; i += 1) {
    const bone = bones[i]!;
    pose.parentIndices[i] = bone.parent === null ? -1 : (indexByName.get(bone.parent) ?? -1);
    const base = i * SETUP_STRIDE;
    pose.setup[base] = bone.x;
    pose.setup[base + 1] = bone.y;
    pose.setup[base + 2] = bone.rotation;
    pose.setup[base + 3] = bone.scaleX;
    pose.setup[base + 4] = bone.scaleY;
    pose.setup[base + 5] = bone.shearX;
    pose.setup[base + 6] = bone.shearY;
  }

  return pose;
}

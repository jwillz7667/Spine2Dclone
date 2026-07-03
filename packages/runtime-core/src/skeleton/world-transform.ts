import { composeInto, copyInto, MAT2X3_STRIDE, multiplyInto } from '../math/affine';
import { SETUP_STRIDE } from './pose';
import type { Pose } from './pose';
import { TRANSFORM_MODE_NORMAL, worldFromParentByMode } from './transform-mode';

// Solve step 1 (reset to setup pose): write each bone's local matrix from its captured setup
// transform. Allocation-free: composeInto writes straight into the pre-allocated local buffer.
export function resetToSetupPose(pose: Pose): void {
  const { setup, local, boneCount } = pose;
  for (let i = 0; i < boneCount; i += 1) {
    const s = i * SETUP_STRIDE;
    composeInto(
      local,
      i * MAT2X3_STRIDE,
      setup[s]!,
      setup[s + 1]!,
      setup[s + 2]!,
      setup[s + 3]!,
      setup[s + 4]!,
      setup[s + 5]!,
      setup[s + 6]!,
    );
  }
}

// Solve step 4 (world transforms): a single forward pass. A root's world matrix equals its local
// matrix; every other bone's world matrix inherits its parent's world transform per the bone's
// transformMode (full parent.world * local for `normal`, selectively suppressed for the four non-normal
// modes). The pass relies on the validated parent-precedes-child ordering (parentIndex < i), so the
// parent world matrix is always already written when a child is reached. Allocation-free: every write
// targets the pre-allocated world buffer, so repeated calls grow the heap by zero (asserted by the
// determinism allocation probe). A `normal` bone takes the exact existing multiplyInto path, so an
// all-normal rig is bit-for-bit unchanged.
export function computeWorldTransforms(pose: Pose): void {
  const { local, world, parentIndices, transformModes, boneCount } = pose;
  for (let i = 0; i < boneCount; i += 1) {
    const offset = i * MAT2X3_STRIDE;
    const parent = parentIndices[i]!;
    if (parent < 0) {
      copyInto(world, offset, local, offset);
    } else if (transformModes[i] === TRANSFORM_MODE_NORMAL) {
      multiplyInto(world, offset, world, parent * MAT2X3_STRIDE, local, offset);
    } else {
      worldFromParentByMode(
        world,
        offset,
        world,
        parent * MAT2X3_STRIDE,
        local,
        offset,
        transformModes[i]!,
      );
    }
  }
}

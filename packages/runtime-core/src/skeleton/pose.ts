import { MAT2X3_STRIDE } from '../math/affine';

// The number of f64 lanes one bone's setup transform occupies: x, y, rotation, scaleX, scaleY,
// shearX, shearY (degrees for the angles), in document bone order.
export const SETUP_STRIDE = 7;

// Pre-allocated, index-addressed storage for a skeleton solve (handoff section 6). Every buffer is
// sized once at buildPose time and reused across solves, so the per-frame solve allocates nothing.
// Bones are stored in document order, which the format validator guarantees is parent-before-child;
// the solve relies on that invariant and never re-sorts.
export interface Pose {
  readonly boneCount: number;
  // index -> bone name, document order. Lets a caller read a world matrix back by name.
  readonly boneNames: readonly string[];
  // index -> parent bone index, or -1 for a root. Parent index is always strictly less than the
  // child index (the validated ordering invariant), so a single forward pass is correct.
  readonly parentIndices: Int32Array;
  // SETUP_STRIDE lanes per bone: the setup transform, the source for resetToSetupPose.
  readonly setup: Float64Array;
  // MAT2X3_STRIDE lanes per bone: the local (parent-relative) matrix, written by resetToSetupPose.
  readonly local: Float64Array;
  // MAT2X3_STRIDE lanes per bone: the world matrix, written by computeWorldTransforms.
  readonly world: Float64Array;
}

// Allocate the buffers for a pose of the given bone count. Internal: callers use buildPose.
export function allocatePose(boneCount: number, boneNames: readonly string[]): Pose {
  return {
    boneCount,
    boneNames,
    parentIndices: new Int32Array(boneCount),
    setup: new Float64Array(boneCount * SETUP_STRIDE),
    local: new Float64Array(boneCount * MAT2X3_STRIDE),
    world: new Float64Array(boneCount * MAT2X3_STRIDE),
  };
}

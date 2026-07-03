import { copyInto, identity, MAT2X3_STRIDE, multiplyInto } from '../math/affine';
import type { Mat2x3 } from '../math/affine';
import type { Pose } from '../skeleton/pose';
import { TRANSFORM_MODE_NORMAL, worldFromParentByMode } from '../skeleton/transform-mode';

// On-demand world resolution (ADR-0003 section 2). At solve-order step 3, a constraint needs the
// would-be world matrix of a bone (its target, itself, its parent) while the authoritative forward
// pass is still step 4. resolveWorld composes the bone's ancestor chain's CURRENT local transforms
// root-to-bone using the SAME multiply routine as step 4, so the world it produces equals what step 4
// will produce for that bone (modulo float). It reflects every animation value and every local delta
// written by an earlier-running constraint in this frame, and it is a pure function of current local
// state: two calls with no intervening local write return identical results.

// The deepest ancestor chain resolveWorld will walk. Far beyond any real rig depth (rigs are a few
// dozen bones deep at most); sized generously so the walk never reallocates.
const MAX_CHAIN_DEPTH = 256;

// Solver-owned scratch, reused across calls so resolveWorld allocates nothing. The solve is
// single-threaded and resolveWorld is never called re-entrantly (no resolveWorld nests inside another
// resolveWorld), so a module-level stack/accumulator is safe.
const chainStack = new Int32Array(MAX_CHAIN_DEPTH);
const accumulator = new Float64Array(MAT2X3_STRIDE);
const product = new Float64Array(MAT2X3_STRIDE);
const matScratch = new Float64Array(MAT2X3_STRIDE);

// Write bone boneIndex's world matrix into out[outOffset .. outOffset+5]. Allocation-free.
export function resolveWorld(
  pose: Pose,
  boneIndex: number,
  out: Float64Array,
  outOffset: number,
): void {
  const { parentIndices, transformModes, local } = pose;

  // Walk root-ward, pushing indices: chainStack[0] = boneIndex, chainStack[depth-1] = root ancestor.
  let depth = 0;
  let cursor = boneIndex;
  while (cursor >= 0) {
    chainStack[depth] = cursor;
    depth += 1;
    cursor = parentIndices[cursor]!;
  }

  // Accumulate root-to-bone: start at the root ancestor's local, then inherit each descendant's local
  // under its transformMode (the SAME mode dispatch as step 4, so this on-demand world equals the
  // forward-pass world for that bone). multiplyInto / worldFromParentByMode forbid aliasing their output
  // with an input, so we ping-pong accumulator -> product -> accumulator.
  copyInto(accumulator, 0, local, chainStack[depth - 1]! * MAT2X3_STRIDE);
  for (let k = depth - 2; k >= 0; k -= 1) {
    const childIndex = chainStack[k]!;
    const childOffset = childIndex * MAT2X3_STRIDE;
    if (transformModes[childIndex] === TRANSFORM_MODE_NORMAL) {
      multiplyInto(product, 0, accumulator, 0, local, childOffset);
    } else {
      worldFromParentByMode(
        product,
        0,
        accumulator,
        0,
        local,
        childOffset,
        transformModes[childIndex]!,
      );
    }
    copyInto(accumulator, 0, product, 0);
  }

  copyInto(out, outOffset, accumulator, 0);
}

// Convenience wrapper returning the world matrix as a tuple, for callers/tests that want a Mat2x3.
// Allocates one tuple; the zero-allocation path is resolveWorld(out, offset).
export function resolveWorldMat(pose: Pose, boneIndex: number): Mat2x3 {
  resolveWorld(pose, boneIndex, matScratch, 0);
  return [
    matScratch[0]!,
    matScratch[1]!,
    matScratch[2]!,
    matScratch[3]!,
    matScratch[4]!,
    matScratch[5]!,
  ];
}

// The world matrix of a bone's PARENT, or identity for a root. Constraints express their result as a
// local transform relative to this frame.
export function parentWorldMat(pose: Pose, boneIndex: number): Mat2x3 {
  const parent = pose.parentIndices[boneIndex]!;
  return parent < 0 ? identity() : resolveWorldMat(pose, parent);
}

// Read a bone's current local matrix as a tuple.
export function localMat(pose: Pose, boneIndex: number): Mat2x3 {
  const offset = boneIndex * MAT2X3_STRIDE;
  const { local } = pose;
  return [
    local[offset]!,
    local[offset + 1]!,
    local[offset + 2]!,
    local[offset + 3]!,
    local[offset + 4]!,
    local[offset + 5]!,
  ];
}

// Overwrite a bone's local matrix from a tuple (the channel constraints write a full matrix, not
// recomposed channels, so step 4 reproduces the intended world exactly).
export function writeLocalMat(pose: Pose, boneIndex: number, m: Mat2x3): void {
  const offset = boneIndex * MAT2X3_STRIDE;
  const { local } = pose;
  local[offset] = m[0];
  local[offset + 1] = m[1];
  local[offset + 2] = m[2];
  local[offset + 3] = m[3];
  local[offset + 4] = m[4];
  local[offset + 5] = m[5];
}

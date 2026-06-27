import type { MeshAttachment } from '@marionette/format/types';
import { MAT2X3_STRIDE } from '../math/affine';
import type { Mat2x3 } from '../math/affine';

// Skinning (ADR-0003 section 9, ADR-0002): solve-order step 5, before deform. Both paths write (x, y)
// world-space pairs into a caller-provided pre-allocated Float32Array and allocate NOTHING (they walk
// the vertex stream with index arithmetic). runtime-core may import only @marionette/format/types, so
// the weighted decode is done inline here rather than through the format's codec barrel; the stream
// layout is the one ADR-0002 fixes (self-delimiting: each logical vertex starts with its influence
// count, then [globalBoneIndex, vx, vy, weight] per influence).

// Weighted mesh skinning: for each logical vertex,
//   pos = sum over influences of weight * (boneWorldMatrix[boneIndex] * (vx, vy)),
// accumulated in STORED influence order (the accumulation order is part of the numerical contract).
// boneWorldMatrices is the packed world matrices (MAT2X3_STRIDE lanes per bone, indexed by GLOBAL bone
// index). A 1-bone rigid weight reproduces that bone's transform exactly; a 2-bone 50/50 lands at the
// average of the two bone-space transforms.
export function solveSkin(
  mesh: MeshAttachment,
  boneWorldMatrices: Float64Array,
  out: Float32Array,
): void {
  const stream = mesh.vertices;
  const length = stream.length;
  let cursor = 0;
  let outIndex = 0;
  while (cursor < length) {
    const influenceCount = stream[cursor]!;
    cursor += 1;
    let px = 0;
    let py = 0;
    for (let i = 0; i < influenceCount; i += 1) {
      const boneOffset = stream[cursor]! * MAT2X3_STRIDE;
      const vx = stream[cursor + 1]!;
      const vy = stream[cursor + 2]!;
      const weight = stream[cursor + 3]!;
      cursor += 4;
      const a = boneWorldMatrices[boneOffset]!;
      const b = boneWorldMatrices[boneOffset + 1]!;
      const c = boneWorldMatrices[boneOffset + 2]!;
      const d = boneWorldMatrices[boneOffset + 3]!;
      const tx = boneWorldMatrices[boneOffset + 4]!;
      const ty = boneWorldMatrices[boneOffset + 5]!;
      px += weight * (a * vx + c * vy + tx);
      py += weight * (b * vx + d * vy + ty);
    }
    out[outIndex] = px;
    out[outIndex + 1] = py;
    outIndex += 2;
  }
}

// Unweighted mesh fast path: vertices is a flat [x0, y0, x1, y1, ...] stream of setup-space positions
// rigidly attached to the slot's bone, so pos = slotBoneWorld * (x, y). Zero allocation.
export function solveSkinUnweighted(
  mesh: MeshAttachment,
  slotBoneWorld: Mat2x3,
  out: Float32Array,
): void {
  const stream = mesh.vertices;
  const length = stream.length;
  const a = slotBoneWorld[0];
  const b = slotBoneWorld[1];
  const c = slotBoneWorld[2];
  const d = slotBoneWorld[3];
  const tx = slotBoneWorld[4];
  const ty = slotBoneWorld[5];
  for (let i = 0; i < length; i += 2) {
    const x = stream[i]!;
    const y = stream[i + 1]!;
    out[i] = a * x + c * y + tx;
    out[i + 1] = b * x + d * y + ty;
  }
}

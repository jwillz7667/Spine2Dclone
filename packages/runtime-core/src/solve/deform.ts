// Deform (ADR-0003 section 9): solve-order step 5, AFTER skinning. The per-vertex (dx, dy) offsets are
// ADDED to the POST-SKIN world-space positions: final_i = skinned_i + (dx_i, dy_i). This resolves the
// local-vs-world question in favor of world-space, post-skin, additive application. Writes into a
// caller-provided buffer with ZERO allocation; out may alias skinned (each lane is read before its
// matching write, so in-place is safe). count is the number of (x, y) vertices to process.
export function applyDeform(
  skinned: Float32Array,
  offsets: ArrayLike<number>,
  out: Float32Array,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const x = i * 2;
    const y = x + 1;
    out[x] = skinned[x]! + offsets[x]!;
    out[y] = skinned[y]! + offsets[y]!;
  }
}

// 2x3 affine transform library (handoff section 6 solve, the cross-runtime layout owned by
// conformance-and-ci.md appendix A.3). A transform is the six numbers [a, b, c, d, tx, ty] denoting
// the matrix
//
//     [ a  c  tx ]
//     [ b  d  ty ]
//     [ 0  0  1  ]
//
// in column-vector form, so transformPoint(m, x, y) = (a*x + c*y + tx, b*x + d*y + ty). World
// composition is child.world = parent.world * child.local, and a bone's local matrix is built as
// local = Translate * Rotate * Shear * Scale with rotation taken in radians from the degrees stored
// in the format. This layout is a cross-runtime contract; changing it is a conformance change, not a
// local edit. NO PixiJS, NO DOM: this is platform-agnostic solve math (INV-1).

// A 2x3 affine as a fixed-length tuple. Tuple indices are statically known, so element reads are
// plain numbers (unaffected by noUncheckedIndexedAccess), which keeps the pure API cast-free.
export type Mat2x3 = readonly [number, number, number, number, number, number];

// The number of f64 lanes one matrix occupies in a packed Float64Array (the Pose storage stride).
export const MAT2X3_STRIDE = 6;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function identity(): Mat2x3 {
  return [1, 0, 0, 1, 0, 0];
}

// The product parent * child (apply child first, then parent). This is the world-composition op.
export function multiply(parent: Mat2x3, child: Mat2x3): Mat2x3 {
  const [pa, pb, pc, pd, ptx, pty] = parent;
  const [ca, cb, cc, cd, ctx, cty] = child;
  return [
    pa * ca + pc * cb,
    pb * ca + pd * cb,
    pa * cc + pc * cd,
    pb * cc + pd * cd,
    pa * ctx + pc * cty + ptx,
    pb * ctx + pd * cty + pty,
  ];
}

// Build a local matrix from a bone's setup transform: Translate * Rotate * Shear * Scale. With shear
// zero this reduces to [cos*sx, sin*sx, -sin*sy, cos*sy, x, y], matching the appendix A.3 rotation
// layout. The shear factor is the two-axis tangent shear (identity at zero); it is not exercised by
// any Phase-0 fixture and is locked by the Phase-2 conformance fixtures when shear first appears.
export function compose(
  x: number,
  y: number,
  rotationDeg: number,
  scaleX: number,
  scaleY: number,
  shearXDeg: number,
  shearYDeg: number,
): Mat2x3 {
  const rotation = rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tanShearX = Math.tan(shearXDeg * DEG_TO_RAD);
  const tanShearY = Math.tan(shearYDeg * DEG_TO_RAD);
  return [
    (cos - sin * tanShearY) * scaleX,
    (sin + cos * tanShearY) * scaleX,
    (cos * tanShearX - sin) * scaleY,
    (sin * tanShearX + cos) * scaleY,
    x,
    y,
  ];
}

export function transformPoint(m: Mat2x3, x: number, y: number): readonly [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// The inverse affine. Defined when the determinant a*d - b*c is non-zero (every setup matrix with
// non-zero scale qualifies). Used by tooling and tests, not by the per-frame solve.
export function invert(m: Mat2x3): Mat2x3 {
  const [a, b, c, d, tx, ty] = m;
  const det = a * d - b * c;
  const inverseDet = 1 / det;
  const ia = d * inverseDet;
  const ib = -b * inverseDet;
  const ic = -c * inverseDet;
  const id = a * inverseDet;
  return [ia, ib, ic, id, -(ia * tx + ic * ty), -(ib * tx + id * ty)];
}

// The rotation of the X axis in degrees (atan2 of the first column). Decomposition is lossy for a
// sheared/non-uniform matrix; this is a convenience for tooling and tests, not part of the solve.
export function getRotationDeg(m: Mat2x3): number {
  return Math.atan2(m[1], m[0]) * RAD_TO_DEG;
}

export function getTranslation(m: Mat2x3): readonly [number, number] {
  return [m[4], m[5]];
}

// A bone's local transform decomposed back into the format's authored fields (degrees for rotation and
// shear), the exact inverse of compose().
export interface DecomposedTransform {
  readonly x: number;
  readonly y: number;
  readonly rotationDeg: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearXDeg: number;
  readonly shearYDeg: number;
}

// Decompose a 2x3 affine into the bone transform that compose() rebuilds EXACTLY: for any
// non-degenerate m, compose(decompose(m)) reproduces m to f64 round-off. The TRS+shear parameterization
// has one redundant degree of freedom (five local params, four linear matrix entries), resolved by the
// convention shearY = 0. The X-axis column (a, b) fixes rotation (its angle) and scaleX (its length);
// the Y-axis column's deviation from perpendicular is absorbed entirely into shearX, and scaleY is the
// Y-axis length projected back through that shear. ReparentBone uses this to recompute a bone's local
// transform under a new parent while holding its world transform fixed. Tooling math, not the per-frame
// solve, so allocation here is fine. Degenerate input (zero-scale column) yields a zero scale on that
// axis; callers (reparent under a non-singular parent) never hit that.
export function decompose(m: Mat2x3): DecomposedTransform {
  const [a, b, c, d, tx, ty] = m;
  const scaleX = Math.hypot(a, b);
  const xAxisAngle = Math.atan2(b, a); // == rotation, since shearY is fixed to 0
  const yAxisAngle = Math.atan2(d, c); // == rotation - shearX + 90deg
  const shearX = xAxisAngle + Math.PI / 2 - yAxisAngle;
  // scaleY carries the sign of the determinant (a reflected matrix yields a negative scaleY), so the
  // recompose is exact even for det < 0; scaleX stays the non-negative column length.
  const scaleY = Math.hypot(c, d) * Math.cos(shearX);
  return {
    x: tx,
    y: ty,
    rotationDeg: xAxisAngle * RAD_TO_DEG,
    scaleX,
    scaleY,
    shearXDeg: shearX * RAD_TO_DEG,
    shearYDeg: 0,
  };
}

// Allocation-free hot-path operations on packed Float64Array storage. Offsets address the first lane
// of a matrix; callers pass in-bounds offsets (the buffers are sized to boneCount * MAT2X3_STRIDE),
// so the reads are non-null by construction. These never allocate, which is what lets
// computeWorldTransforms run the per-frame solve with zero heap growth.

// Write Translate * Rotate * Shear * Scale into out[offset .. offset+5]. Mirrors compose().
export function composeInto(
  out: Float64Array,
  offset: number,
  x: number,
  y: number,
  rotationDeg: number,
  scaleX: number,
  scaleY: number,
  shearXDeg: number,
  shearYDeg: number,
): void {
  const rotation = rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tanShearX = Math.tan(shearXDeg * DEG_TO_RAD);
  const tanShearY = Math.tan(shearYDeg * DEG_TO_RAD);
  out[offset] = (cos - sin * tanShearY) * scaleX;
  out[offset + 1] = (sin + cos * tanShearY) * scaleX;
  out[offset + 2] = (cos * tanShearX - sin) * scaleY;
  out[offset + 3] = (sin * tanShearX + cos) * scaleY;
  out[offset + 4] = x;
  out[offset + 5] = y;
}

// Write parent * child into out[outOffset ..]. out may alias neither parent nor child slice (the
// world pass never multiplies a slice into itself). Mirrors multiply().
export function multiplyInto(
  out: Float64Array,
  outOffset: number,
  parent: Float64Array,
  parentOffset: number,
  child: Float64Array,
  childOffset: number,
): void {
  const pa = parent[parentOffset]!;
  const pb = parent[parentOffset + 1]!;
  const pc = parent[parentOffset + 2]!;
  const pd = parent[parentOffset + 3]!;
  const ptx = parent[parentOffset + 4]!;
  const pty = parent[parentOffset + 5]!;
  const ca = child[childOffset]!;
  const cb = child[childOffset + 1]!;
  const cc = child[childOffset + 2]!;
  const cd = child[childOffset + 3]!;
  const ctx = child[childOffset + 4]!;
  const cty = child[childOffset + 5]!;
  out[outOffset] = pa * ca + pc * cb;
  out[outOffset + 1] = pb * ca + pd * cb;
  out[outOffset + 2] = pa * cc + pc * cd;
  out[outOffset + 3] = pb * cc + pd * cd;
  out[outOffset + 4] = pa * ctx + pc * cty + ptx;
  out[outOffset + 5] = pb * ctx + pd * cty + pty;
}

// Copy one matrix slice from src[srcOffset ..] into out[outOffset ..] without allocating (a root
// bone's world matrix equals its local matrix).
export function copyInto(
  out: Float64Array,
  outOffset: number,
  src: Float64Array,
  srcOffset: number,
): void {
  out[outOffset] = src[srcOffset]!;
  out[outOffset + 1] = src[srcOffset + 1]!;
  out[outOffset + 2] = src[srcOffset + 2]!;
  out[outOffset + 3] = src[srcOffset + 3]!;
  out[outOffset + 4] = src[srcOffset + 4]!;
  out[outOffset + 5] = src[srcOffset + 5]!;
}

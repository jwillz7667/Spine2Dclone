import type { TransformMode } from '@marionette/format/types';

// Bone transformMode inheritance (handoff section 6 bone.transformMode; the format schema carries the
// field, this is the solve that honors it). transformMode controls HOW a bone inherits its parent's WORLD
// transform when its own world transform is computed (solve-order step 4). `normal` is full inheritance
// (world = parent.world * local); the other four modes selectively suppress part of the parent's
// rotation, scale, or reflection. These semantics are OUR OWN first-principles contract (LAW 4, we claim
// no Spine compatibility); the A.2 rig-transform-modes fixture locks them and the shared C# core mirrors
// this function exactly. Pure integer-coded dispatch + f64 matrix math: no allocation, no PixiJS, no DOM.
//
// Definitions (parent world matrix P = [pa, pb, pc, pd, ptx, pty], child local L = [la, lb, lc, ld, lx,
// ly]; columns are X = (a, b), Y = (c, d), translation = (tx, ty); world = parentEffective2x2 * localL2x2,
// with the world POSITION as noted per mode):
//   - normal:                 effective parent 2x2 = (pa, pb, pc, pd); position = P applied to (lx, ly).
//   - onlyTranslation:        effective parent 2x2 = identity (local orientation only); position =
//                             (ptx + lx, pty + ly) (the local offset is NOT rotated/scaled by the parent).
//   - noRotationOrReflection: effective parent 2x2 = diag(|Xcol|, |Ycol|) (parent SCALE magnitudes only,
//                             rotation and reflection dropped); position = P applied to (lx, ly).
//   - noScale:                effective parent 2x2 = unit-length parent columns (parent ROTATION and any
//                             reflection, scale removed); position = P applied to (lx, ly).
//   - noScaleOrReflection:    like noScale, but if the unit-column basis is reflected (det < 0) the Y axis
//                             is rebuilt perpendicular to X, removing the reflection; position = P applied.
// Parent columns are normalized independently, so under parent SHEAR these definitions take a specific
// (defined-by-us) behavior; the conformance rig uses an unsheared parent so the modes are unambiguous.

export const TRANSFORM_MODE_NORMAL = 0;
export const TRANSFORM_MODE_ONLY_TRANSLATION = 1;
export const TRANSFORM_MODE_NO_ROTATION_OR_REFLECTION = 2;
export const TRANSFORM_MODE_NO_SCALE = 3;
export const TRANSFORM_MODE_NO_SCALE_OR_REFLECTION = 4;

// Map the format's TransformMode string to the integer code the solve dispatches on. A total switch, so a
// future TransformMode literal fails to compile here until its code is assigned (no silent default).
export function transformModeToCode(mode: TransformMode): number {
  switch (mode) {
    case 'normal':
      return TRANSFORM_MODE_NORMAL;
    case 'onlyTranslation':
      return TRANSFORM_MODE_ONLY_TRANSLATION;
    case 'noRotationOrReflection':
      return TRANSFORM_MODE_NO_ROTATION_OR_REFLECTION;
    case 'noScale':
      return TRANSFORM_MODE_NO_SCALE;
    case 'noScaleOrReflection':
      return TRANSFORM_MODE_NO_SCALE_OR_REFLECTION;
  }
}

// Write child bone's world matrix into world[worldOffset ..] from its parent's world slice and its own
// local slice, honoring `mode`. Allocation-free; the slices are pre-allocated Pose buffers. For
// TRANSFORM_MODE_NORMAL this is byte-identical to multiplyInto (same operands, same op order), so a rig of
// all-normal bones is unaffected; the world-transform passes special-case normal onto multiplyInto anyway,
// and this handles the four non-normal modes (and normal, for completeness and the parity unit test).
export function worldFromParentByMode(
  world: Float64Array,
  worldOffset: number,
  parentWorld: Float64Array,
  parentOffset: number,
  local: Float64Array,
  localOffset: number,
  mode: number,
): void {
  const pa = parentWorld[parentOffset]!;
  const pb = parentWorld[parentOffset + 1]!;
  const pc = parentWorld[parentOffset + 2]!;
  const pd = parentWorld[parentOffset + 3]!;
  const ptx = parentWorld[parentOffset + 4]!;
  const pty = parentWorld[parentOffset + 5]!;
  const la = local[localOffset]!;
  const lb = local[localOffset + 1]!;
  const lc = local[localOffset + 2]!;
  const ld = local[localOffset + 3]!;
  const lx = local[localOffset + 4]!;
  const ly = local[localOffset + 5]!;

  // The effective parent 2x2 (ea, eb, ec, ed) and the world translation (wtx, wty), per mode.
  let ea: number;
  let eb: number;
  let ec: number;
  let ed: number;
  let wtx: number;
  let wty: number;

  if (mode === TRANSFORM_MODE_ONLY_TRANSLATION) {
    ea = 1;
    eb = 0;
    ec = 0;
    ed = 1;
    wtx = ptx + lx;
    wty = pty + ly;
  } else {
    // Every other mode positions the bone via the FULL parent transform applied to the local offset.
    wtx = pa * lx + pc * ly + ptx;
    wty = pb * lx + pd * ly + pty;
    if (mode === TRANSFORM_MODE_NORMAL) {
      ea = pa;
      eb = pb;
      ec = pc;
      ed = pd;
    } else if (mode === TRANSFORM_MODE_NO_ROTATION_OR_REFLECTION) {
      ea = Math.hypot(pa, pb); // |X column| = parent scaleX magnitude
      eb = 0;
      ec = 0;
      ed = Math.hypot(pc, pd); // |Y column| = parent scaleY magnitude
    } else {
      // NO_SCALE or NO_SCALE_OR_REFLECTION: unit-length parent columns (rotation, scale removed).
      const psx = Math.hypot(pa, pb);
      const psy = Math.hypot(pc, pd);
      const ix = psx === 0 ? 0 : 1 / psx;
      const iy = psy === 0 ? 0 : 1 / psy;
      ea = pa * ix;
      eb = pb * ix;
      ec = pc * iy;
      ed = pd * iy;
      if (mode === TRANSFORM_MODE_NO_SCALE_OR_REFLECTION && ea * ed - eb * ec < 0) {
        // Reflected basis: rebuild the Y axis perpendicular to the unit X axis to drop the reflection.
        ec = -eb;
        ed = ea;
      }
    }
  }

  // world 2x2 = effective parent 2x2 * local 2x2 (the multiply convention, mirroring multiplyInto).
  world[worldOffset] = ea * la + ec * lb;
  world[worldOffset + 1] = eb * la + ed * lb;
  world[worldOffset + 2] = ea * lc + ec * ld;
  world[worldOffset + 3] = eb * lc + ed * ld;
  world[worldOffset + 4] = wtx;
  world[worldOffset + 5] = wty;
}

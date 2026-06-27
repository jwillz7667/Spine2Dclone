import type { Animation } from '@marionette/format/types';
import { MAT2X3_STRIDE } from '../math/affine';
import type { PreparedAnimation } from './prepared';

// The number of f64 lanes one bone's setup transform occupies: x, y, rotation, scaleX, scaleY,
// shearX, shearY (degrees for the angles), in document bone order.
export const SETUP_STRIDE = 7;

// The number of f64 lanes one slot's color occupies: r, g, b, a in [0, 1] (the format range; bezier
// easing of a color channel may overshoot slightly, which is intentional and left unclamped here so
// the renderer, not the solve, decides display clamping).
export const SLOT_COLOR_STRIDE = 4;

// Pre-allocated, index-addressed storage for a skeleton solve (handoff section 6). Every buffer is
// sized once at buildPose time and reused across solves, so the per-frame solve allocates nothing.
// Bones are stored in document order, which the format validator guarantees is parent-before-child;
// the solve relies on that invariant and never re-sorts. Slots are stored in document `slots[]` order
// (the setup draw order). The same Pose carries the bone-only Phase-0 outputs (setup/local/world) and
// the Phase-1 slot outputs (color + active attachment), so existing bone consumers are unaffected.
//
// The pose is built from a specific validated document (buildPose) and must be sampled with THAT
// document: sampleSkeleton reads only `document.animations` from the doc, and resolves bone/slot names
// against the names captured here, so the doc and the pose must agree on structure.
export interface Pose {
  readonly boneCount: number;
  // index -> bone name, document order. Lets a caller read a world matrix back by name.
  readonly boneNames: readonly string[];
  // index -> parent bone index, or -1 for a root. Parent index is always strictly less than the
  // child index (the validated ordering invariant), so a single forward pass is correct.
  readonly parentIndices: Int32Array;
  // SETUP_STRIDE lanes per bone: the setup transform, the source for resetToSetupPose and the base
  // that animation channels add/multiply onto.
  readonly setup: Float64Array;
  // MAT2X3_STRIDE lanes per bone: the local (parent-relative) matrix, written by resetToSetupPose and
  // overwritten for animated bones by sampleSkeleton.
  readonly local: Float64Array;
  // MAT2X3_STRIDE lanes per bone: the world matrix, written by computeWorldTransforms.
  readonly world: Float64Array;
  // index -> bone.length (the bone's setup length along its local X axis). Captured at build time and
  // read by two-bone IK (solveIkTwoBone) to size the chain segments; not otherwise part of the world
  // pass. One f64 per bone.
  readonly boneLength: Float64Array;

  readonly slotCount: number;
  // index -> slot name, document (draw) order. Lets a caller read resolved color/attachment by name.
  readonly slotNames: readonly string[];
  // index -> the bone index this slot rides, or -1 if the slot's bone is unknown (captured at build).
  readonly slotBoneIndices: Int32Array;
  // SLOT_COLOR_STRIDE lanes per slot: the setup color, the source for the slot color reset.
  readonly slotSetupColor: Float64Array;
  // SLOT_COLOR_STRIDE lanes per slot: the resolved color written by sampleSkeleton (replaces setup).
  readonly slotColor: Float64Array;
  // index -> the setup-pose active attachment name (or null). The renderer resolves the name to
  // geometry through the default skin; runtime-core carries the NAME only, keeping geometry out of the
  // platform-agnostic core.
  readonly slotSetupAttachment: (string | null)[];
  // index -> the resolved active attachment name (or null), written in place by sampleSkeleton (never
  // reallocated per frame).
  readonly slotAttachment: (string | null)[];

  // Solve scratch: prepared (flattened, bezier-precomputed) animations, cached by Animation identity
  // so the first sample of an animation builds it and every later sample reuses it with zero
  // allocation. A WeakMap, so an edited animation (the immutable model replaces the Animation object
  // on every keyframe edit) is auto-evicted once unreferenced: the cache stays bounded across a long
  // editing session. Owned by the pose (the caller-passed solve state), not a module global.
  readonly preparedAnimations: WeakMap<Animation, PreparedAnimation>;
}

// Allocate the buffers for a pose of the given bone and slot counts. Internal: callers use buildPose.
export function allocatePose(
  boneCount: number,
  boneNames: readonly string[],
  slotCount: number,
  slotNames: readonly string[],
): Pose {
  return {
    boneCount,
    boneNames,
    parentIndices: new Int32Array(boneCount),
    setup: new Float64Array(boneCount * SETUP_STRIDE),
    local: new Float64Array(boneCount * MAT2X3_STRIDE),
    world: new Float64Array(boneCount * MAT2X3_STRIDE),
    boneLength: new Float64Array(boneCount),
    slotCount,
    slotNames,
    slotBoneIndices: new Int32Array(slotCount),
    slotSetupColor: new Float64Array(slotCount * SLOT_COLOR_STRIDE),
    slotColor: new Float64Array(slotCount * SLOT_COLOR_STRIDE),
    slotSetupAttachment: new Array<string | null>(slotCount).fill(null),
    slotAttachment: new Array<string | null>(slotCount).fill(null),
    preparedAnimations: new WeakMap<Animation, PreparedAnimation>(),
  };
}

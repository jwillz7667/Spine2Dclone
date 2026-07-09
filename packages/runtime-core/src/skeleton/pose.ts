import type { Animation } from '@marionette/format/types';
import { MAT2X3_STRIDE } from '../math/affine';
import type { TransformMix, TransformOffset } from '../solve/transform-constraint';
import type { PreparedAnimation } from './prepared';

// The number of f64 lanes one bone's setup transform occupies: x, y, rotation, scaleX, scaleY,
// shearX, shearY (degrees for the angles), in document bone order.
export const SETUP_STRIDE = 7;

// The number of f64 lanes one slot's color occupies: r, g, b, a in [0, 1] (the format range; bezier
// easing of a color channel may overshoot slightly, which is intentional and left unclamped here so
// the renderer, not the solve, decides display clamping).
export const SLOT_COLOR_STRIDE = 4;

// An IK constraint resolved against the pose: the chain bones and the target are stored as BONE
// INDICES (document order, == pose order) rather than names, so step 3 never re-resolves names per
// frame. `boneIndices` has length 1 (one-bone IK) or 2 ([parentIndex, childIndex] for two-bone IK).
// `baseMix`/`baseBendPositive` are the constraint definition's values; `sampled` is the per-frame
// scratch step 2 writes (from the ik timeline, else reset to the base) and step 3 reads. The scratch
// object is allocated once at build time and mutated in place, so the per-frame solve allocates none.
export interface ResolvedIkConstraint {
  readonly name: string;
  readonly boneIndices: Int32Array;
  readonly targetIndex: number;
  readonly baseMix: number;
  readonly baseBendPositive: boolean;
  // The depth controls from the constraint definition (ADR-0009 section 1.1, ADR-0010 section 2). softness
  // is a non-negative world-unit distance; stretch/compress/uniform are booleans. base* are the definition
  // values; the `sampled` scratch carries the per-frame values (softness/stretch/compress may be keyed,
  // uniform is static). Defaults (softness 0, all false) reproduce the ADR-0003 hard solve exactly.
  readonly baseSoftness: number;
  readonly baseStretch: boolean;
  readonly baseCompress: boolean;
  readonly uniform: boolean;
  // The explicit combined-set solve order (ADR-0009 section 1.3), or -1 when this constraint carries none.
  // Read once at build to precompute the pose solve schedule; never sampled per frame.
  readonly order: number;
  readonly sampled: {
    mix: number;
    bendPositive: boolean;
    softness: number;
    stretch: boolean;
    compress: boolean;
  };
}

// A transform constraint resolved against the pose. `boneIndices` are the constrained bones (one or
// more, applied in stored order). `baseMix`/`offset` come from the constraint definition; `sampledMix`
// is the per-frame mix step 2 writes (timeline-present channels override; absent channels keep base)
// and step 3 reads. Both mix objects and the offset are built once and reused (no per-frame alloc).
export interface ResolvedTransformConstraint {
  readonly name: string;
  readonly boneIndices: Int32Array;
  readonly targetIndex: number;
  readonly baseMix: TransformMix;
  readonly offset: TransformOffset;
  // The local/relative variant flags (ADR-0009 section 1.2). Default false/false reproduces the ADR-0003
  // world-space absolute blend. Captured at build; the variant solve is a later PP-B5 slice (ADR-0010
  // section 3) but the flags are carried now so the resolve and pose stay total.
  readonly local: boolean;
  readonly relative: boolean;
  // The explicit combined-set solve order (ADR-0009 section 1.3), or -1 when this constraint carries none.
  readonly order: number;
  readonly sampledMix: TransformMix;
}

// A growable scratch buffer for sampled deform offsets, owned by the pose so mesh-vertex sampling
// reuses it across calls. `offsets` is reallocated only when a larger mesh is sampled than any seen
// before (a one-time, size-keyed allocation); steady-state sampling of same-or-smaller meshes reuses
// it with zero allocation. It is mesh-vertex sampling scratch only, never part of the saved document.
export interface DeformScratch {
  offsets: Float64Array;
}

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
  // index -> the bone's transformMode as an integer code (transform-mode.ts). The world pass reads this
  // to decide how the bone inherits its parent's world transform (full for `normal`, selectively
  // suppressed for the four non-normal modes). All-normal rigs leave this all zero.
  readonly transformModes: Int8Array;
  // SETUP_STRIDE lanes per bone: the setup transform, the source for resetToSetupPose and the base
  // that animation channels add/multiply onto.
  readonly setup: Float64Array;
  // MAT2X3_STRIDE lanes per bone: the local (parent-relative) matrix, written by resetToSetupPose and
  // overwritten for animated bones by sampleSkeleton.
  readonly local: Float64Array;
  // SETUP_STRIDE lanes per bone: the per-channel blended LOCAL COMPONENTS (x, y, rotation, scaleX,
  // scaleY, shearX, shearY) the animation-blend layer (ADR-0005) writes into. It is initialized to the
  // setup transform each frame (beginBlend) and each track lerps its keyed channels toward their sampled
  // value here BEFORE the single compose into `local`; blending the decomposed components (not the
  // composed matrix) is what keeps shortest-arc rotation, componentwise scale/shear, and additive layering
  // well defined, and what the step-3 constraint solve reads. The single-animation path (alpha 1, no mix)
  // writes each channel's sampled value verbatim, so composing from here is bit-identical to composing
  // straight from the sampled values (the byte-locked conformance fixtures prove that neutrality).
  readonly blendLocal: Float64Array;
  // One flag per bone: set when any track keyed a channel of the bone this frame, so only touched bones
  // are recomposed from `blendLocal` into `local` after the track loop (untouched bones keep the
  // reset-to-setup local resetToSetupPose already wrote). Cleared each frame by beginBlend.
  readonly boneTouched: Uint8Array;
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
  // One f64 per slot: the greatest track weight that has written this slot's active attachment this
  // frame (the discrete greater-weight-wins winner weight, ADR-0005 rule 5). Reset to -1 each frame by
  // beginBlend so any keying track (even weight 0) beats "nothing"; a later-applied track with an equal
  // weight overwrites (ties go to the incoming entry, which is applied after the outgoing).
  readonly slotAttachmentWinWeight: Float64Array;
  // One f64 per IK constraint: the discrete greater-weight-wins winner weight for that constraint's
  // sampled bendPositive flag this frame (ADR-0005 rule 5), reset to -1 by beginBlend.
  readonly ikBendWinWeight: Float64Array;
  // One f64 per IK constraint each: the discrete greater-weight-wins winner weights for that constraint's
  // sampled `stretch` and `compress` depth flags this frame (ADR-0010 section 2.4), reset to -1 by
  // beginBlend, exactly like ikBendWinWeight.
  readonly ikStretchWinWeight: Float64Array;
  readonly ikCompressWinWeight: Float64Array;
  // index -> the setup-pose active attachment name (or null). The renderer resolves the name to
  // geometry through the default skin; runtime-core carries the NAME only, keeping geometry out of the
  // platform-agnostic core.
  readonly slotSetupAttachment: (string | null)[];
  // index -> the resolved active attachment name (or null), written in place by sampleSkeleton (never
  // reallocated per frame).
  readonly slotAttachment: (string | null)[];
  // The resolved RENDER ORDER (ADR-0008 draw order, PP-B4): `drawOrder[renderPosition] = slotIndex`,
  // renderPosition 0 furthest back. Reset to `slotSetupDrawOrder` each frame (step 1) and overwritten
  // by the active draw-order key (step 2). A renderer reads it to draw slots front-to-back correctly.
  readonly drawOrder: Int32Array;
  // The setup render order (identity permutation [0, 1, ..., slotCount-1]): the step-1 reset source for
  // `drawOrder`, so a frame with no draw-order key (or below the first key) renders in setup slot order.
  readonly slotSetupDrawOrder: Int32Array;
  // One f64: the greatest track weight that has written the draw order this frame (the discrete greater-
  // weight-wins winner weight for the whole-skeleton draw-order channel, ADR-0008 + ADR-0005 rule 5),
  // reset to -1 by beginBlend so any keying track beats "nothing" and a later-applied equal weight wins.
  // A length-1 typed array (not a scalar) so the pose stays an all-readonly-field, mutate-in-place buffer.
  readonly drawOrderWinWeight: Float64Array;

  // The document's IK constraints, resolved to bone indices, in document array order. Step 3 solves
  // these (then the transform constraints) in this exact order; the per-constraint `sampled` scratch
  // carries the values step 2 wrote. Empty for a rig with no IK constraints.
  readonly ikConstraints: readonly ResolvedIkConstraint[];
  // The document's transform constraints, resolved to bone indices, in document array order. Solved
  // after all IK constraints (the canonical step-3 order). Empty for a rig with none.
  readonly transformConstraints: readonly ResolvedTransformConstraint[];
  // The explicit combined-set solve schedule (ADR-0009 section 1.3, ADR-0010 section 1) or null when no
  // constraint carries an `order`. When present it is a dense permutation of `[0, N)` (N = total
  // constraints): `solveOrder[position]` is a constraint CODE, `code < ikConstraints.length` selecting
  // `ikConstraints[code]`, else `transformConstraints[code - ikConstraints.length]`. Step 3 walks it in
  // position order. Null keeps the exact ADR-0003 two-phase (all IK, then all transform) path, so a rig
  // without order is byte-identical. Precomputed once at build; never touched per frame.
  readonly solveOrder: Int32Array | null;
  // Reused scratch for sampled deform offsets (mesh-vertex sampling, sampleMeshVertices). Not touched
  // by the bone/slot/constraint solve; lives on the pose so repeated mesh sampling allocates nothing.
  readonly deformScratch: DeformScratch;

  // Solve scratch: prepared (flattened, bezier-precomputed) animations, cached by Animation identity
  // so the first sample of an animation builds it and every later sample reuses it with zero
  // allocation. A WeakMap, so an edited animation (the immutable model replaces the Animation object
  // on every keyframe edit) is auto-evicted once unreferenced: the cache stays bounded across a long
  // editing session. Owned by the pose (the caller-passed solve state), not a module global.
  readonly preparedAnimations: WeakMap<Animation, PreparedAnimation>;
}

// The identity render-order permutation [0, 1, ..., slotCount-1] for a pose's setup draw order and the
// initial resolved order. A plain Int32Array fill; called twice at build time, never per frame.
function identityDrawOrder(slotCount: number): Int32Array {
  const order = new Int32Array(slotCount);
  for (let i = 0; i < slotCount; i += 1) order[i] = i;
  return order;
}

// Allocate the buffers for a pose of the given bone and slot counts. Internal: callers use buildPose.
// The resolved constraints are built by buildPose (it owns the name->index map) and handed in here so
// they become the pose's readonly constraint state.
export function allocatePose(
  boneCount: number,
  boneNames: readonly string[],
  slotCount: number,
  slotNames: readonly string[],
  ikConstraints: readonly ResolvedIkConstraint[],
  transformConstraints: readonly ResolvedTransformConstraint[],
): Pose {
  return {
    boneCount,
    boneNames,
    parentIndices: new Int32Array(boneCount),
    transformModes: new Int8Array(boneCount),
    setup: new Float64Array(boneCount * SETUP_STRIDE),
    local: new Float64Array(boneCount * MAT2X3_STRIDE),
    blendLocal: new Float64Array(boneCount * SETUP_STRIDE),
    boneTouched: new Uint8Array(boneCount),
    world: new Float64Array(boneCount * MAT2X3_STRIDE),
    boneLength: new Float64Array(boneCount),
    slotCount,
    slotNames,
    slotBoneIndices: new Int32Array(slotCount),
    slotSetupColor: new Float64Array(slotCount * SLOT_COLOR_STRIDE),
    slotColor: new Float64Array(slotCount * SLOT_COLOR_STRIDE),
    slotAttachmentWinWeight: new Float64Array(slotCount),
    ikBendWinWeight: new Float64Array(ikConstraints.length),
    ikStretchWinWeight: new Float64Array(ikConstraints.length),
    ikCompressWinWeight: new Float64Array(ikConstraints.length),
    slotSetupAttachment: new Array<string | null>(slotCount).fill(null),
    slotAttachment: new Array<string | null>(slotCount).fill(null),
    drawOrder: identityDrawOrder(slotCount),
    slotSetupDrawOrder: identityDrawOrder(slotCount),
    drawOrderWinWeight: new Float64Array(1),
    ikConstraints,
    transformConstraints,
    solveOrder: buildSolveOrder(ikConstraints, transformConstraints),
    deformScratch: { offsets: new Float64Array(0) },
    preparedAnimations: new WeakMap<Animation, PreparedAnimation>(),
  };
}

// Precompute the explicit combined-set solve schedule (ADR-0010 section 1). Returns null when no
// constraint carries an `order` (the ADR-0003 two-phase default). When ANY carries one, the format
// guarantees (CONSTRAINT_ORDER_INVALID) that ALL do and the values are a dense unique permutation of
// `[0, N)`; this builds the position->code map from that. It is defensive against an UNVALIDATED document
// (buildPose's stated lenience): a partial, duplicated, gapped, or out-of-range assignment falls back to
// null (the safe document-order default) rather than producing a corrupt schedule, mirroring how an
// unresolved bone index is captured as -1 and skipped instead of crashing.
function buildSolveOrder(
  ikConstraints: readonly ResolvedIkConstraint[],
  transformConstraints: readonly ResolvedTransformConstraint[],
): Int32Array | null {
  const total = ikConstraints.length + transformConstraints.length;
  if (total === 0) return null;

  let anyOrder = false;
  for (let i = 0; i < ikConstraints.length; i += 1) {
    if (ikConstraints[i]!.order >= 0) anyOrder = true;
  }
  for (let i = 0; i < transformConstraints.length; i += 1) {
    if (transformConstraints[i]!.order >= 0) anyOrder = true;
  }
  if (!anyOrder) return null;

  const codes = new Int32Array(total).fill(-1);
  const place = (order: number, code: number): boolean => {
    if (!Number.isInteger(order) || order < 0 || order >= total || codes[order] !== -1) return false;
    codes[order] = code;
    return true;
  };
  for (let i = 0; i < ikConstraints.length; i += 1) {
    if (!place(ikConstraints[i]!.order, i)) return null;
  }
  for (let j = 0; j < transformConstraints.length; j += 1) {
    if (!place(transformConstraints[j]!.order, ikConstraints.length + j)) return null;
  }
  return codes;
}

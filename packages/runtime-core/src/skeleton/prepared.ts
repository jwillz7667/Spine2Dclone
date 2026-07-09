// Solve-side, prebuilt representation of a format Animation (WP-1.4, TASK-1.4.6). These types carry
// no logic: the per-track build and evaluation live in curve.ts, the per-skeleton assembly in
// sample.ts. They exist so per-frame sampling iterates flat typed arrays (no Object.keys, no per-key
// object reads) and so bezier control points are turned into a sampled lookup table ONCE on build,
// never per frame. Nothing here is serialized into the document (it is recomputed from the format
// Animation on load). This module imports nothing, so it is the dependency-graph leaf that lets
// pose.ts reference PreparedAnimation without a cycle (pose <- prepared, curve <- prepared,
// sample <- {pose, curve, prepared}).

// One numeric channel (rotate angle, translate/scale/shear x+y, or color rgba) flattened for
// allocation-free sampling. `times` is strictly ascending (the validated ANIM_TIME_ORDER invariant).
// `values` packs `componentCount` lanes per keyframe in keyframe order. `curveKinds[i]` is the
// OUTGOING curve of keyframe i (the segment from i to i+1); the last keyframe's curve is unused (the
// format ignores the final keyframe's curve). For a bezier segment, `bezierBase[i]` is the start lane
// of that segment's sampled (x,y) table inside `bezierTable`; for linear/stepped segments it is -1.
export interface PreparedTrack {
  readonly keyCount: number;
  readonly componentCount: number;
  readonly times: Float64Array;
  readonly values: Float64Array;
  readonly curveKinds: Uint8Array;
  readonly bezierBase: Int32Array;
  readonly bezierTable: Float64Array;
}

// The slot attachment channel: a stepped sequence of active attachment names (null shows nothing).
// It carries no curve (attachment swaps are stepped by nature) and no numeric value lanes.
export interface PreparedAttachmentTrack {
  readonly keyCount: number;
  readonly times: Float64Array;
  readonly names: readonly (string | null)[];
}

// A boolean channel sampled STEPPED regardless of the keyframe's curve (ADR-0003 section 7): used for
// the IkFrame `bend` direction, which is non-interpolatable. `values[i]` is 0 or 1 for keyframe i; sampling
// holds the segment-start value until the next key (the same clamp/step rule as the attachment track).
export interface PreparedStepBoolTrack {
  readonly keyCount: number;
  readonly times: Float64Array;
  readonly values: Uint8Array;
}

// The transform channels of one animated bone, resolved to the pose's bone index at build time.
// `boneIndex` is -1 when the animation names a bone the pose does not contain (the channel is then
// skipped); a validated document keyed to the pose it was built from never hits that.
export interface PreparedBoneChannels {
  readonly boneIndex: number;
  readonly rotate: PreparedTrack | null;
  readonly translate: PreparedTrack | null;
  readonly scale: PreparedTrack | null;
  readonly shear: PreparedTrack | null;
  // Per-component split tracks (ADR-0009 section 4.1, ADR-0011 section 3). Each is a single-lane scalar
  // track for one component. The format forbids a joint channel and its split components coexisting on one
  // bone (TIMELINE_COMPONENT_CONFLICT), so at most one of {translate} / {translateX, translateY} is
  // non-null (and likewise scale, shear); applying all present tracks is therefore unambiguous.
  readonly translateX: PreparedTrack | null;
  readonly translateY: PreparedTrack | null;
  readonly scaleX: PreparedTrack | null;
  readonly scaleY: PreparedTrack | null;
  readonly shearX: PreparedTrack | null;
  readonly shearY: PreparedTrack | null;
}

// The channels of one animated slot, resolved to the pose's slot index at build time.
export interface PreparedSlotChannels {
  readonly slotIndex: number;
  readonly color: PreparedTrack | null;
  readonly attachment: PreparedAttachmentTrack | null;
  // Split color tracks (ADR-0009 section 4.2): `rgb` is a 3-lane track, `alpha` a 1-lane track. The joint
  // `color` (RGBA) and the split `rgb`/`alpha` must not coexist on one slot (TIMELINE_COMPONENT_CONFLICT),
  // so at most one form is non-null. The keyable two-color `dark` tint (ADR-0009 section 4.3, RGBA) is
  // independent and blends into the pose's dark-color lane.
  readonly rgb: PreparedTrack | null;
  readonly alpha: PreparedTrack | null;
  readonly dark: PreparedTrack | null;
}

// The timelines of one animated IK constraint, resolved to the pose's ik-constraint index at build
// time. `constraintIndex` is -1 when the animation names a constraint the pose does not contain (the
// channel is then skipped). `mix` interpolates by its curve; `bendPositive` is stepped (ADR-0003 s7).
export interface PreparedIkChannel {
  readonly constraintIndex: number;
  readonly mix: PreparedTrack | null;
  readonly bendPositive: PreparedStepBoolTrack | null;
  // The optional keyable depth channels (ADR-0009 section 1.1, ADR-0010 section 2.4). Each is built from
  // ONLY the frames that key it (all optional on the IkFrame), so a channel no frame keys is null and the
  // constraint's base value holds. `softness` interpolates by its curve (a continuous world-unit
  // distance); `stretch`/`compress` are stepped booleans resolved by the discrete greater-weight-wins
  // rule, exactly like `bendPositive`.
  readonly softness: PreparedTrack | null;
  readonly stretch: PreparedStepBoolTrack | null;
  readonly compress: PreparedStepBoolTrack | null;
}

// The timelines of one animated transform constraint, resolved to the pose's transform-constraint
// index. Each of the six mix channels is prepared from ONLY the keyframes that key it (chosen absent-
// channel semantics, see sample.ts): a channel no keyframe keys is null and keeps the constraint base.
export interface PreparedTransformChannel {
  readonly constraintIndex: number;
  readonly mixRotate: PreparedTrack | null;
  readonly mixX: PreparedTrack | null;
  readonly mixY: PreparedTrack | null;
  readonly mixScaleX: PreparedTrack | null;
  readonly mixScaleY: PreparedTrack | null;
  readonly mixShearY: PreparedTrack | null;
}

// A prepared per-animation draw-order timeline (ADR-0008 section 3, PP-B4). Each key's compact
// {slot, offset} list is DERIVED ONCE at build time into a FULL render-order permutation `orders[k]`,
// where `orders[k][renderPosition] = slotIndex` (renderPosition 0 is furthest back). An empty offsets
// list resolves to the identity (setup order). Precomputing the permutations keeps step-2 application a
// single allocation-free typed-array copy. `times` is strictly ascending (the validated invariant); the
// active key at time t is the latest key at or before t (stepped), or none when t is below the first key.
export interface PreparedDrawOrderTimeline {
  readonly keyCount: number;
  readonly times: Float64Array;
  readonly orders: readonly Int32Array[];
}

// A prepared per-animation event timeline (ADR-0008 section 2, PP-B4). Events are discrete, so there is
// no curve. Each key's payload is RESOLVED ONCE at build time (the EventDef default overridden by the
// key's own int/float/string) into parallel value + presence lanes, so firing a key allocates nothing
// (it copies primitive lanes and string refs into the pooled queue). `times` is NON-DECREASING (the one
// timeline whose ordering is non-strict, ADR-0008 section 2); coincident keys keep their timeline order.
export interface PreparedEventTimeline {
  readonly keyCount: number;
  readonly times: Float64Array;
  readonly names: readonly string[];
  readonly intValues: Float64Array;
  readonly hasInt: Uint8Array;
  readonly floatValues: Float64Array;
  readonly hasFloat: Uint8Array;
  readonly stringValues: readonly (string | null)[];
  readonly hasString: Uint8Array;
}

// One deform timeline: per-logical-vertex (dx, dy) offsets for a (skin, slot, attachment) triple,
// flattened so `track.componentCount` == 2 * vertexCount lanes interpolate together. Looked up by the
// three names in sampleMeshVertices and sampled into the pose's deform scratch.
export interface PreparedDeformChannel {
  readonly skin: string;
  readonly slot: string;
  readonly attachment: string;
  readonly track: PreparedTrack;
}

// A whole animation prepared for one pose. Built once and cached on the pose (keyed by Animation
// identity), so steady-state sampling allocates nothing.
export interface PreparedAnimation {
  readonly boneChannels: readonly PreparedBoneChannels[];
  readonly slotChannels: readonly PreparedSlotChannels[];
  readonly ikChannels: readonly PreparedIkChannel[];
  readonly transformChannels: readonly PreparedTransformChannel[];
  readonly deformChannels: readonly PreparedDeformChannel[];
  // The draw-order reorder timeline (ADR-0008), or null when this animation never reorders. Applied in
  // step 2 as a discrete greater-weight-wins channel; event firing is NOT part of PreparedAnimation
  // (it is a time-RANGE operation, not an instantaneous pose sample) and lives in its own prepared type.
  readonly drawOrder: PreparedDrawOrderTimeline | null;
}

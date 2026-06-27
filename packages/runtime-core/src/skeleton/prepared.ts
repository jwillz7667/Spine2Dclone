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

// The transform channels of one animated bone, resolved to the pose's bone index at build time.
// `boneIndex` is -1 when the animation names a bone the pose does not contain (the channel is then
// skipped); a validated document keyed to the pose it was built from never hits that.
export interface PreparedBoneChannels {
  readonly boneIndex: number;
  readonly rotate: PreparedTrack | null;
  readonly translate: PreparedTrack | null;
  readonly scale: PreparedTrack | null;
  readonly shear: PreparedTrack | null;
}

// The channels of one animated slot, resolved to the pose's slot index at build time.
export interface PreparedSlotChannels {
  readonly slotIndex: number;
  readonly color: PreparedTrack | null;
  readonly attachment: PreparedAttachmentTrack | null;
}

// A whole animation prepared for one pose. Built once and cached on the pose (keyed by Animation
// identity), so steady-state sampling allocates nothing.
export interface PreparedAnimation {
  readonly boneChannels: readonly PreparedBoneChannels[];
  readonly slotChannels: readonly PreparedSlotChannels[];
}

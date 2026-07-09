import type { BoneComponentChannel, KeyframeValue, ScalarValue } from '../document';

// The desired LOCAL transform value a gizmo edit produced, per channel. This is the value the bone
// should HAVE locally after the edit (setup-relative), the input the dispatcher either applies as a
// setup-pose command or inverts into a keyframe delta. A discriminated union so each channel carries
// exactly its own value shape, with no optional fields and no cross-channel leakage.
export type BoneTransformEdit =
  | { readonly channel: 'rotate'; readonly rotation: number }
  | { readonly channel: 'translate'; readonly x: number; readonly y: number }
  | { readonly channel: 'scale'; readonly scaleX: number; readonly scaleY: number }
  | { readonly channel: 'shear'; readonly shearX: number; readonly shearY: number };

// The setup-pose fields setupDelta reads (a structural subset of BoneEntity). A document bone's local
// transform IS the setup pose runtime-core resets to: buildPose copies exactly these into pose.setup,
// and sampleSkeleton adds/multiplies the keyframe value onto them. So the delta must be measured against
// these very numbers, which is why the dispatcher passes the live bone entity here.
export interface SetupTransform {
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearX: number;
  readonly shearY: number;
}

// The EXACT inverse of runtime-core applyBoneChannels (TASK-1.4.3 / R1.4). The sampler, onto the reset
// setup pose, ADDS rotate/translate/shear and MULTIPLIES scale componentwise. So to make sampleSkeleton
// reproduce `edit` at the playhead, the stored keyframe value is the DELTA from setup, never the absolute
// local value: storing the absolute value would double-apply a non-identity setup (for example a torso
// with setup rotation 90, where the playhead pose would then read 180 instead of 90 and miss the gizmo).
// Scale is a componentwise quotient (setup scale is nonzero by construction, format/command invariant).
// This is the load-bearing inverse: getting it wrong desynchronizes the playhead pose from the gizmo.
export function setupDelta(edit: BoneTransformEdit, setup: SetupTransform): KeyframeValue {
  switch (edit.channel) {
    case 'rotate':
      return { angle: edit.rotation - setup.rotation };
    case 'translate':
      return { x: edit.x - setup.x, y: edit.y - setup.y };
    case 'scale':
      return { x: edit.scaleX / setup.scaleX, y: edit.scaleY / setup.scaleY };
    case 'shear':
      return { x: edit.shearX - setup.shearX, y: edit.shearY - setup.shearY };
  }
}

// The per-AXIS setup-relative delta (Stage F2, ADR-0009 section 4.1) for a single split component channel,
// the scalar analogue of setupDelta: the sampler ADDS translate/shear deltas and MULTIPLIES scale, so a
// component keyframe stores one axis of the same delta (translateX is the x of the translate delta, scaleX
// the x of the scale quotient, and so on). `current` is the desired local value (the inspector-displayed
// transform); keying the current pose yields the identity delta (0 for translate/shear, 1 for scale).
export function setupComponentDelta(
  channel: BoneComponentChannel,
  current: SetupTransform,
  setup: SetupTransform,
): ScalarValue {
  switch (channel) {
    case 'translateX':
      return { value: current.x - setup.x };
    case 'translateY':
      return { value: current.y - setup.y };
    case 'scaleX':
      return { value: current.scaleX / setup.scaleX };
    case 'scaleY':
      return { value: current.scaleY / setup.scaleY };
    case 'shearX':
      return { value: current.shearX - setup.shearX };
    case 'shearY':
      return { value: current.shearY - setup.shearY };
  }
}

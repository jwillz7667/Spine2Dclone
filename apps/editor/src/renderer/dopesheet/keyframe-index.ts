import type {
  AnimationEntity,
  BoneChannel,
  KeyframeEntity,
  KeyframeId,
  KeyframeTarget,
  KeyframeValue,
} from '../document';

const BONE_CHANNELS: readonly BoneChannel[] = ['rotate', 'translate', 'scale', 'shear'];

export interface ResolvedKeyframe {
  readonly id: KeyframeId;
  readonly target: KeyframeTarget;
  readonly time: number;
  readonly value: KeyframeValue;
  readonly curve: KeyframeEntity['curve'];
}

// Flatten an animation's authored value channels into a KeyframeId -> {target, time, value, curve}
// index. Selection, drag, and copy all resolve a selected KeyframeId back to its channel through this
// single pass, so no caller re-walks the timelines and none addresses a keyframe by array index, which
// would go stale on any insert/delete (command-history Section 2). Attachment-swap frames carry no value
// and are not authored in Phase 1, so they are not indexed.
export function indexKeyframes(animation: AnimationEntity): Map<KeyframeId, ResolvedKeyframe> {
  const index = new Map<KeyframeId, ResolvedKeyframe>();
  for (const [boneId, set] of animation.bones) {
    for (const channel of BONE_CHANNELS) {
      for (const kf of set[channel]) {
        index.set(kf.id, {
          id: kf.id,
          target: { kind: 'bone', boneId, channel },
          time: kf.time,
          value: kf.value,
          curve: kf.curve,
        });
      }
    }
  }
  for (const [slotId, set] of animation.slots) {
    for (const kf of set.color) {
      index.set(kf.id, {
        id: kf.id,
        target: { kind: 'slot', slotId, channel: 'color' },
        time: kf.time,
        value: kf.value,
        curve: kf.curve,
      });
    }
  }
  return index;
}

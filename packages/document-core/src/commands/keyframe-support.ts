import type { AnimationEntity, BoneChannel, KeyframeEntity } from '../model/doc-state';
import type { AnimationId, BoneId, SlotId } from '../model/ids';
import type { Mutator } from '../model/mutator';

// A slot's value channel: the joint `color` (RGBA) tint, or the Stage F2 two-color `dark` tint (PP-D10),
// both RGBA ColorValue channels served by the same keyframe commands.
export type SlotValueChannel = 'color' | 'dark';

// A keyframe channel address: a bone transform channel or a slot value channel. The keyframe commands
// (SetKeyframe / MoveKeyframe / DeleteKeyframe / SetCurve) target a channel through this discriminated
// reference, so one command set serves every value channel without per-channel duplication. The stepped
// attachment-swap and sequence timelines have their own commands (their values are not curved).
export type KeyframeTarget =
  | { readonly kind: 'bone'; readonly boneId: BoneId; readonly channel: BoneChannel }
  | { readonly kind: 'slot'; readonly slotId: SlotId; readonly channel: SlotValueChannel };

// Read the current keyframes of a target channel from an animation (or [] when the bone/slot has no
// timeline set yet). The `?.[channel]` access is type-safe: a BoneTimelineSet has exactly the four
// BoneChannel keys, and a SlotTimelineSet has the `color` and `dark` value channels.
export function readChannel(
  animation: AnimationEntity,
  target: KeyframeTarget,
): readonly KeyframeEntity[] {
  if (target.kind === 'bone') {
    return animation.bones.get(target.boneId)?.[target.channel] ?? [];
  }
  return animation.slots.get(target.slotId)?.[target.channel] ?? [];
}

// Write a target channel's keyframes through the mutator. The mutator creates the bone/slot timeline set
// on first write and prunes it when the array goes empty, so this is the single write path the keyframe
// commands use for both do and undo.
export function writeChannel(
  mutate: Mutator,
  animId: AnimationId,
  target: KeyframeTarget,
  keyframes: readonly KeyframeEntity[],
): void {
  if (target.kind === 'bone') {
    mutate.setBoneChannel(animId, target.boneId, target.channel, keyframes);
  } else if (target.channel === 'dark') {
    mutate.setSlotDarkChannel(animId, target.slotId, keyframes);
  } else {
    mutate.setSlotColorChannel(animId, target.slotId, keyframes);
  }
}

// Whether two targets address the same channel of the same bone/slot (the coalescing identity for the
// session-merging keyframe commands).
export function sameTarget(a: KeyframeTarget, b: KeyframeTarget): boolean {
  if (a.kind === 'bone' && b.kind === 'bone') {
    return a.boneId === b.boneId && a.channel === b.channel;
  }
  if (a.kind === 'slot' && b.kind === 'slot') {
    return a.slotId === b.slotId && a.channel === b.channel;
  }
  return false;
}

// The id string of a target's owning entity (for typed error messages).
export function targetEntityId(target: KeyframeTarget): string {
  return target.kind === 'bone' ? target.boneId : target.slotId;
}

// Sort keyframes by ascending time, returning a NEW array (the channel invariant is strictly ascending;
// callers guarantee unique times so the comparator never ties).
export function sortByTime(keyframes: readonly KeyframeEntity[]): KeyframeEntity[] {
  return [...keyframes].sort((a, b) => a.time - b.time);
}

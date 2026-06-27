import type { AnimationEntity, BoneChannel, KeyframeEntity } from '../model/doc-state';
import type { AnimationId, BoneId, SlotId } from '../model/ids';
import type { Mutator } from '../model/mutator';

// A keyframe channel address: a bone transform channel or a slot's color channel. The keyframe commands
// (SetKeyframe / MoveKeyframe / DeleteKeyframe / SetCurve) target a channel through this discriminated
// reference, so one command set serves every value channel without per-channel duplication. Phase 1
// authors only these value channels; the stepped attachment-swap timeline has no authoring command.
export type KeyframeTarget =
  | { readonly kind: 'bone'; readonly boneId: BoneId; readonly channel: BoneChannel }
  | { readonly kind: 'slot'; readonly slotId: SlotId; readonly channel: 'color' };

// Read the current keyframes of a target channel from an animation (or [] when the bone/slot has no
// timeline set yet). The `?.[channel]` access is type-safe: a BoneTimelineSet has exactly the four
// BoneChannel keys, and a slot value channel is always 'color' in Phase 1.
export function readChannel(
  animation: AnimationEntity,
  target: KeyframeTarget,
): readonly KeyframeEntity[] {
  if (target.kind === 'bone') {
    return animation.bones.get(target.boneId)?.[target.channel] ?? [];
  }
  return animation.slots.get(target.slotId)?.color ?? [];
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

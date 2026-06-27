import type { BoneTimelineSet, SlotTimelineSet } from '../model/doc-state';
import type { AnimationId, BoneId, SlotId } from '../model/ids';
import type { Mutator } from '../model/mutator';

// A captured bone timeline track (one animation's timelines for one bone) for exact restore.
interface RemovedBoneTrack {
  readonly animId: AnimationId;
  readonly boneId: BoneId;
  readonly set: BoneTimelineSet;
}

// A captured slot timeline track (one animation's color + attachment timelines for one slot).
interface RemovedSlotTrack {
  readonly animId: AnimationId;
  readonly slotId: SlotId;
  readonly set: SlotTimelineSet;
}

// The animation-track slice of a delete cascade memento (TASK-1.5.7): every timeline targeting a deleted
// bone or slot, captured so undo restores them exactly. Empty when no animation references the deletions.
export interface RemovedTracks {
  readonly boneTracks: readonly RemovedBoneTrack[];
  readonly slotTracks: readonly RemovedSlotTrack[];
}

// Scan every animation for timelines targeting any of the given bone/slot ids and capture them. Called
// during a delete-bone / delete-slot cascade BEFORE the bones/slots are removed, so the tracks (which are
// addressed by branded id) are restored to the same ids on undo.
export function collectRemovedTracks(
  mutate: Mutator,
  boneIds: ReadonlySet<BoneId>,
  slotIds: ReadonlySet<SlotId>,
): RemovedTracks {
  const boneTracks: RemovedBoneTrack[] = [];
  const slotTracks: RemovedSlotTrack[] = [];
  for (const animation of mutate.animations()) {
    for (const boneId of boneIds) {
      const set = animation.bones.get(boneId);
      if (set) boneTracks.push({ animId: animation.id, boneId, set });
    }
    for (const slotId of slotIds) {
      const set = animation.slots.get(slotId);
      if (set) slotTracks.push({ animId: animation.id, slotId, set });
    }
  }
  return { boneTracks, slotTracks };
}

// Remove the captured tracks (the prune half of the cascade). Setting a timeline to null removes its
// entry and, when the set is the bone/slot's only timeline, leaves the animation otherwise untouched.
export function pruneRemovedTracks(mutate: Mutator, removed: RemovedTracks): void {
  for (const track of removed.boneTracks) mutate.setBoneTimelines(track.animId, track.boneId, null);
  for (const track of removed.slotTracks) mutate.setSlotTimelines(track.animId, track.slotId, null);
}

// Restore the captured tracks (the undo half of the cascade), re-adding each timeline to its animation.
export function restoreRemovedTracks(mutate: Mutator, removed: RemovedTracks): void {
  for (const track of removed.boneTracks) {
    mutate.setBoneTimelines(track.animId, track.boneId, track.set);
  }
  for (const track of removed.slotTracks) {
    mutate.setSlotTimelines(track.animId, track.slotId, track.set);
  }
}

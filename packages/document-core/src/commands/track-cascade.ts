import type {
  AttachmentEntity,
  BoneTimelineSet,
  DeformKeyframeEntity,
  DeformSkinKey,
  DrawOrderKeyEntity,
  IkConstraintEntity,
  IkKeyframeEntity,
  SlotTimelineSet,
  TransformConstraintEntity,
  TransformKeyframeEntity,
} from '../model/doc-state';
import { makeDrawOrderKey } from '../model/doc-state';
import type { AnimationId, BoneId, SkinId, SlotId } from '../model/ids';
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

// A captured IK constraint that referenced a deleted bone (as a chain bone or target), with its solve-order
// index (for exact re-insert) and every ik timeline keyed to it across all animations.
interface RemovedIkConstraint {
  readonly entity: IkConstraintEntity;
  readonly index: number;
  readonly tracks: readonly {
    readonly animId: AnimationId;
    readonly frames: readonly IkKeyframeEntity[];
  }[];
}

interface RemovedTransformConstraint {
  readonly entity: TransformConstraintEntity;
  readonly index: number;
  readonly tracks: readonly {
    readonly animId: AnimationId;
    readonly frames: readonly TransformKeyframeEntity[];
  }[];
}

// A captured NAMED-skin attachment that sat on a deleted slot, for exact restore.
interface RemovedSkinAttachment {
  readonly skinId: SkinId;
  readonly slotId: SlotId;
  readonly attachment: AttachmentEntity;
}

// A captured deform timeline track (one animation, one skin key, one slot, one attachment) on a deleted slot.
interface RemovedDeformTrack {
  readonly animId: AnimationId;
  readonly skinKey: DeformSkinKey;
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly frames: readonly DeformKeyframeEntity[];
}

// A captured draw-order timeline (one animation) whose keys referenced a deleted slot (Stage F1, PP-D9):
// `before` is the original timeline and `after` is it with every deleted-slot offset dropped, so a slot
// delete never leaves a draw-order key pointing at a gone slot (which would break assertInvariants and
// export). A key whose offsets all drop simply becomes an identity key (empty offsets), which is legal.
interface RemovedDrawOrderTrack {
  readonly animId: AnimationId;
  readonly before: readonly DrawOrderKeyEntity[];
  readonly after: readonly DrawOrderKeyEntity[];
}

// The full delete-cascade memento (TASK-1.5.7, extended in Phase 2): every animation track, constraint,
// named-skin attachment, and deform track that references a deleted bone or slot, captured so undo restores
// them exactly. Empty members when nothing references the deletions.
export interface RemovedTracks {
  readonly boneTracks: readonly RemovedBoneTrack[];
  readonly slotTracks: readonly RemovedSlotTrack[];
  readonly ikConstraints: readonly RemovedIkConstraint[];
  readonly transformConstraints: readonly RemovedTransformConstraint[];
  readonly skinAttachments: readonly RemovedSkinAttachment[];
  readonly deformTracks: readonly RemovedDeformTrack[];
  readonly drawOrderTracks: readonly RemovedDrawOrderTrack[];
}

// Scan every animation/skin/constraint for state targeting any of the given bone/slot ids and capture it.
// Called during a delete-bone / delete-slot cascade BEFORE the bones/slots are removed, so everything
// (addressed by branded id) is restored to the same ids on undo. A constraint cascades when ANY of its
// chain bones OR its target is a deleted bone (it could no longer resolve). A named-skin attachment and a
// deform track cascade when their slot is deleted.
export function collectRemovedTracks(
  mutate: Mutator,
  boneIds: ReadonlySet<BoneId>,
  slotIds: ReadonlySet<SlotId>,
): RemovedTracks {
  const boneTracks: RemovedBoneTrack[] = [];
  const slotTracks: RemovedSlotTrack[] = [];
  const animations = mutate.animations();
  for (const animation of animations) {
    for (const boneId of boneIds) {
      const set = animation.bones.get(boneId);
      if (set) boneTracks.push({ animId: animation.id, boneId, set });
    }
    for (const slotId of slotIds) {
      const set = animation.slots.get(slotId);
      if (set) slotTracks.push({ animId: animation.id, slotId, set });
    }
  }

  const referencesDeletedBone = (bones: readonly BoneId[], target: BoneId): boolean =>
    target !== undefined && (boneIds.has(target) || bones.some((b) => boneIds.has(b)));

  const ikConstraints: RemovedIkConstraint[] = [];
  mutate.ikConstraints().forEach((entity, index) => {
    if (!referencesDeletedBone(entity.bones, entity.target)) return;
    const tracks: { animId: AnimationId; frames: readonly IkKeyframeEntity[] }[] = [];
    for (const animation of animations) {
      const frames = animation.ik.get(entity.id);
      if (frames && frames.length > 0) tracks.push({ animId: animation.id, frames });
    }
    ikConstraints.push({ entity, index, tracks });
  });

  const transformConstraints: RemovedTransformConstraint[] = [];
  mutate.transformConstraints().forEach((entity, index) => {
    if (!referencesDeletedBone(entity.bones, entity.target)) return;
    const tracks: { animId: AnimationId; frames: readonly TransformKeyframeEntity[] }[] = [];
    for (const animation of animations) {
      const frames = animation.transform.get(entity.id);
      if (frames && frames.length > 0) tracks.push({ animId: animation.id, frames });
    }
    transformConstraints.push({ entity, index, tracks });
  });

  const skinAttachments: RemovedSkinAttachment[] = [];
  for (const skin of mutate.skins()) {
    for (const slotId of slotIds) {
      const inner = skin.attachments.get(slotId);
      if (!inner) continue;
      for (const attachment of inner.values()) {
        skinAttachments.push({ skinId: skin.id, slotId, attachment });
      }
    }
  }

  const deformTracks: RemovedDeformTrack[] = [];
  for (const animation of animations) {
    for (const [skinKey, bySlot] of animation.deform) {
      for (const slotId of slotIds) {
        const byName = bySlot.get(slotId);
        if (!byName) continue;
        for (const [attachmentName, frames] of byName) {
          deformTracks.push({ animId: animation.id, skinKey, slotId, attachmentName, frames });
        }
      }
    }
  }

  // Draw-order timelines (Stage F1) referencing a deleted slot: drop that slot's offset from every key so
  // no key points at a gone slot. Only captured when the timeline actually changes (a document with no
  // draw-order keys, or none touching a deleted slot, is untouched).
  const drawOrderTracks: RemovedDrawOrderTrack[] = [];
  for (const animation of animations) {
    if (!animation.drawOrder.some((key) => key.offsets.some((entry) => slotIds.has(entry.slot)))) {
      continue;
    }
    const after = animation.drawOrder.map((key) =>
      makeDrawOrderKey(
        key.id,
        key.time,
        key.offsets.filter((entry) => !slotIds.has(entry.slot)),
      ),
    );
    drawOrderTracks.push({ animId: animation.id, before: animation.drawOrder, after });
  }

  return {
    boneTracks,
    slotTracks,
    ikConstraints,
    transformConstraints,
    skinAttachments,
    deformTracks,
    drawOrderTracks,
  };
}

// Remove the captured state (the prune half of the cascade). Constraint timelines are cleared first, then
// the constraint definitions; named-skin attachments and deform tracks are removed on their owning slot.
export function pruneRemovedTracks(mutate: Mutator, removed: RemovedTracks): void {
  for (const track of removed.boneTracks) mutate.setBoneTimelines(track.animId, track.boneId, null);
  for (const track of removed.slotTracks) mutate.setSlotTimelines(track.animId, track.slotId, null);
  for (const c of removed.ikConstraints) {
    for (const t of c.tracks) mutate.setIkChannel(t.animId, c.entity.id, []);
    mutate.removeIkConstraint(c.entity.id);
  }
  for (const c of removed.transformConstraints) {
    for (const t of c.tracks) mutate.setTransformChannel(t.animId, c.entity.id, []);
    mutate.removeTransformConstraint(c.entity.id);
  }
  for (const a of removed.skinAttachments) {
    mutate.removeSkinAttachment(a.skinId, a.slotId, a.attachment.name);
  }
  for (const d of removed.deformTracks) {
    mutate.setDeformChannel(d.animId, d.skinKey, d.slotId, d.attachmentName, []);
  }
  for (const t of removed.drawOrderTracks) mutate.setDrawOrderTimeline(t.animId, t.after);
}

// Restore the captured state (the undo half of the cascade). Bones/slots are already re-inserted by the
// delete command before this runs, so constraints (which reference bones) and deform/skin attachments
// (which reference slots) resolve. Constraints are re-inserted at their original solve-order index
// (ascending) BEFORE their timelines, so a restored ik/transform timeline always keys a live constraint.
export function restoreRemovedTracks(mutate: Mutator, removed: RemovedTracks): void {
  for (const track of removed.boneTracks) {
    mutate.setBoneTimelines(track.animId, track.boneId, track.set);
  }
  for (const track of removed.slotTracks) {
    mutate.setSlotTimelines(track.animId, track.slotId, track.set);
  }
  for (const c of [...removed.ikConstraints].sort((a, b) => a.index - b.index)) {
    mutate.insertIkConstraint(c.entity, c.index);
    for (const t of c.tracks) mutate.setIkChannel(t.animId, c.entity.id, t.frames);
  }
  for (const c of [...removed.transformConstraints].sort((a, b) => a.index - b.index)) {
    mutate.insertTransformConstraint(c.entity, c.index);
    for (const t of c.tracks) mutate.setTransformChannel(t.animId, c.entity.id, t.frames);
  }
  for (const a of removed.skinAttachments) {
    mutate.setSkinAttachment(a.skinId, a.slotId, a.attachment);
  }
  for (const d of removed.deformTracks) {
    mutate.setDeformChannel(d.animId, d.skinKey, d.slotId, d.attachmentName, d.frames);
  }
  for (const t of removed.drawOrderTracks) mutate.setDrawOrderTimeline(t.animId, t.before);
}

import {
  DeleteAttachmentKeyframeCommand,
  DeleteDeformKeyframeCommand,
  DeleteDrawOrderKeyCommand,
  DeleteEventKeyCommand,
  DeleteIkKeyframeCommand,
  DeleteKeyframeCommand,
  DeleteSequenceKeyframeCommand,
  DeleteTransformKeyframeCommand,
  type AnimationEntity,
  type BoneChannel,
  type Command,
  type History,
  type KeyframeId,
} from '../document';

// The dopesheet's unified keyframe-deletion wiring (PP-D2). Every dopesheet row kind is deletable from
// ONE Delete-key handler: the value channels (bone rotate/translate/scale/shear, slot color), the slot
// attachment-swap timeline, the per-(skin, slot, attachment) deform timelines, the IK-mix and
// transform-constraint timelines, and the two discrete special timelines (events, draw order). Each id
// resolves to the ONE document-core delete command that owns its timeline (LAW 2: no direct mutation);
// this module never mutates the document. A multi-key delete opens a SINGLE History interaction session,
// so removing several keys across several timelines is ONE undo step. Selection is by branded KeyframeId
// throughout, so it survives inserts, reorders, and renames (the id never addresses a keyframe by index).
//
// The KeyframeId space is one monotonic sequence shared across all timelines and never reused, so a given
// id belongs to exactly one timeline and a single pass builds an unambiguous id -> command index.

const BONE_CHANNELS: readonly BoneChannel[] = ['rotate', 'translate', 'scale', 'shear'];

// Build the id -> delete-command index for every deletable keyframe in the animation. The command is
// captured as a factory (built lazily on execute) so constructing the index has no side effects and the
// panel can also derive the full id set from its keys for selection pruning.
function buildDeleteIndex(animation: AnimationEntity): Map<KeyframeId, () => Command> {
  const index = new Map<KeyframeId, () => Command>();
  const animId = animation.id;

  for (const [boneId, set] of animation.bones) {
    for (const channel of BONE_CHANNELS) {
      for (const kf of set[channel]) {
        index.set(kf.id, () => new DeleteKeyframeCommand(animId, { kind: 'bone', boneId, channel }, kf.id));
      }
    }
  }

  for (const [slotId, set] of animation.slots) {
    for (const kf of set.color) {
      index.set(
        kf.id,
        () => new DeleteKeyframeCommand(animId, { kind: 'slot', slotId, channel: 'color' }, kf.id),
      );
    }
    // The attachment-swap timeline is addressed by TIME in its delete command (a slot holds at most one
    // attachment frame per time), so the factory captures the frame's time rather than its id.
    for (const frame of set.attachment) {
      index.set(frame.id, () => new DeleteAttachmentKeyframeCommand(animId, slotId, frame.time));
    }
    // The frame-sequence timeline (PP-D10) is addressed by KeyframeId.
    for (const kf of set.sequence) {
      index.set(kf.id, () => new DeleteSequenceKeyframeCommand(animId, slotId, kf.id));
    }
  }

  for (const [constraintId, keys] of animation.ik) {
    for (const kf of keys) {
      index.set(kf.id, () => new DeleteIkKeyframeCommand(animId, constraintId, kf.id));
    }
  }

  for (const [constraintId, keys] of animation.transform) {
    for (const kf of keys) {
      index.set(kf.id, () => new DeleteTransformKeyframeCommand(animId, constraintId, kf.id));
    }
  }

  for (const [skinKey, bySlot] of animation.deform) {
    for (const [slotId, byAttachment] of bySlot) {
      for (const [attachmentName, keys] of byAttachment) {
        for (const kf of keys) {
          index.set(
            kf.id,
            () => new DeleteDeformKeyframeCommand(animId, skinKey, slotId, attachmentName, kf.id),
          );
        }
      }
    }
  }

  for (const key of animation.events) {
    index.set(key.id, () => new DeleteEventKeyCommand(animId, key.id));
  }
  for (const key of animation.drawOrder) {
    index.set(key.id, () => new DeleteDrawOrderKeyCommand(animId, key.id));
  }

  return index;
}

// Every KeyframeId the animation currently holds across ALL timelines. The panel prunes a selected id that
// no longer resolves after an edit or undo (editor-state reconciliation, never inside a command); it must
// consider every timeline, not just the value channels, or a selected deform/ik/constraint/attachment key
// would be dropped from the selection on the next revision.
export function collectKeyframeIds(animation: AnimationEntity): Set<KeyframeId> {
  return new Set(buildDeleteIndex(animation).keys());
}

// Delete every SELECTED keyframe across all timelines in ONE interaction session (one undo step). Ids that
// no longer resolve (already deleted, or foreign to this animation) are skipped. Returns the ids actually
// deleted so the caller can prune them from the ephemeral selection; an empty result issues no command, so
// pressing Delete with nothing deletable selected creates no empty undo entry.
export function deleteSelectedKeyframes(
  history: History,
  animation: AnimationEntity,
  keyframeIds: readonly KeyframeId[],
): KeyframeId[] {
  const index = buildDeleteIndex(animation);
  const targets = keyframeIds.filter((id) => index.has(id));
  if (targets.length === 0) return [];

  history.beginInteraction();
  try {
    for (const id of targets) {
      const factory = index.get(id);
      if (factory !== undefined) history.execute(factory());
    }
  } finally {
    history.endInteraction('Delete Keyframes');
  }
  return targets;
}

import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { AttachmentFrameEntity } from '../model/doc-state';
import type { AnimationId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete a slot attachment-swap frame at exactly `time` (the stepped animation.slots[slot].attachment
// timeline). Addressed by time (the swap channel has one frame per time, so time is the stable address);
// a missing frame is the typed CommandTargetMissingError, thrown before any mutation. before/after are
// whole-channel mementos (the channel array with and without the frame), so undo is bit-exact and the
// surviving frames keep their ids and order. When the channel empties the mutator prunes the track. Never
// coalesces (mirroring DeleteKeyframe).
export class DeleteAttachmentKeyframeCommand implements Command {
  readonly kind = 'anim.attachment.delete';
  readonly label = 'Delete Attachment Keyframe';
  private before: readonly AttachmentFrameEntity[] | undefined;
  private after: readonly AttachmentFrameEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly slotId: SlotId,
    private readonly time: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.slots.get(this.slotId)?.attachment ?? [];
      if (!channel.some((frame) => frame.time === this.time)) {
        throw new CommandTargetMissingError(this.kind, String(this.time));
      }
      this.before = channel;
      this.after = channel.filter((frame) => frame.time !== this.time);
    }
    ctx.mutate.setSlotAttachmentChannel(this.animId, this.slotId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotAttachmentChannel(this.animId, this.slotId, this.before);
  }
}

function countAttachmentFrames(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  slotId: string,
): number {
  if (snapshot === undefined) return 0;
  const track = snapshot.slots.find((t) => t.slotId === slotId);
  return track ? track.attachment.length : 0;
}

export const deleteAttachmentKeyframeSpec: CommandSpec = {
  kind: 'anim.attachment.delete',
  // 'rigged' has an animation ('move') whose mesh_slot attachment timeline carries two frames, so deleting
  // the first leaves a real (smaller) track.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    for (const animation of model.animations()) {
      for (const slot of model.slots()) {
        const frames = animation.slots.get(slot.id)?.attachment ?? [];
        const first = frames[0];
        if (!first) continue;
        return { command: new DeleteAttachmentKeyframeCommand(animation.id, slot.id, first.time) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    for (const animBefore of before.animations) {
      for (const track of animBefore.slots) {
        if (track.attachment.length === 0) continue;
        const beforeCount = countAttachmentFrames(
          findAnimationSnapshot(before, animBefore.id),
          track.slotId,
        );
        const afterCount = countAttachmentFrames(
          findAnimationSnapshot(after, animBefore.id),
          track.slotId,
        );
        if (afterCount !== beforeCount - 1) {
          throw new Error('anim.attachment.delete did not remove exactly one attachment frame');
        }
        return;
      }
    }
    throw new Error('anim.attachment.delete fixture seed had no attachment timeline');
  },
};

import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import { makeAttachmentFrame, type AttachmentFrameEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move a slot attachment-swap frame to a new time (the deferred quality-wave follow-up to SetAttachmentKey
// frame; `anim.attachment.move`, PP-D10). Targets the frame by KeyframeId (an index would go stale on any
// sibling edit), re-sorts the channel, and REJECTS a move onto a time another frame already occupies with a
// typed KeyframeCollisionError thrown before any mutation (the attachment channel keys by time, so two
// frames never share one). Session coalescing collapses a dopesheet drag to one undo step; before/after are
// whole-channel mementos, so undo is bit-exact.
export class MoveAttachmentKeyframeCommand implements Command {
  readonly kind = 'anim.attachment.move';
  readonly label = 'Move Attachment Keyframe';
  private before: readonly AttachmentFrameEntity[] | undefined;
  private after: readonly AttachmentFrameEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly slotId: SlotId,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.slots.get(this.slotId)?.attachment ?? [];
      const moving = channel.find((frame) => frame.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (channel.some((frame) => frame.id !== this.keyframeId && frame.time === this.newTime)) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = channel;
      const moved = makeAttachmentFrame(moving.id, this.newTime, moving.name);
      this.after = channel
        .map((frame) => (frame.id === this.keyframeId ? moved : frame))
        .sort((a, b) => a.time - b.time);
    }
    ctx.mutate.setSlotAttachmentChannel(this.animId, this.slotId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotAttachmentChannel(this.animId, this.slotId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveAttachmentKeyframeCommand &&
      prev.animId === this.animId &&
      prev.slotId === this.slotId &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MoveAttachmentKeyframeCommand(
        this.animId,
        this.slotId,
        this.keyframeId,
        this.newTime,
      );
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

function attachmentTimes(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  slotId: string,
): number[] {
  if (snapshot === undefined) return [];
  const track = snapshot.slots.find((t) => t.slotId === slotId);
  return track ? track.attachment.map((frame) => frame.time) : [];
}

export const moveAttachmentKeyframeSpec: CommandSpec = {
  kind: 'anim.attachment.move',
  // 'rigged' has an animation whose mesh_slot attachment timeline carries two frames, so moving the last one
  // to a free time strictly between the two stays in range, collides with nothing, and shows only a delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    for (const animation of model.animations()) {
      for (const slot of model.slots()) {
        const frames = animation.slots.get(slot.id)?.attachment ?? [];
        if (frames.length < 2) continue;
        const last = frames[frames.length - 1]!;
        const prev = frames[frames.length - 2]!;
        const newTime = (prev.time + last.time) / 2;
        return {
          command: new MoveAttachmentKeyframeCommand(animation.id, slot.id, last.id, newTime),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    for (const animBefore of before.animations) {
      for (const track of animBefore.slots) {
        if (track.attachment.length < 2) continue;
        const b = attachmentTimes(findAnimationSnapshot(before, animBefore.id), track.slotId);
        const a = attachmentTimes(findAnimationSnapshot(after, animBefore.id), track.slotId);
        if (a.length !== b.length) throw new Error('anim.attachment.move changed the frame count');
        if (a.join(',') === b.join(',')) {
          throw new Error('anim.attachment.move produced no time delta');
        }
        for (let i = 1; i < a.length; i += 1) {
          if (a[i]! <= a[i - 1]!) {
            throw new Error('anim.attachment.move left the channel out of time order');
          }
        }
        return;
      }
    }
    throw new Error('anim.attachment.move fixture seed had no attachment timeline');
  },
};

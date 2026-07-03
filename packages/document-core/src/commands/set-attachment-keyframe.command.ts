import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import { makeAttachmentFrame, type AttachmentFrameEntity } from '../model/doc-state';
import type { AnimationId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Insert-or-replace a slot attachment-swap frame at `time` (the stepped animation.slots[slot].attachment
// timeline the keyframe-support header recorded as having no authoring command). If a frame already exists
// at `time`, its `name` is replaced (its KeyframeId and time are kept); otherwise a new frame is minted and
// inserted, keeping the channel strictly time-sorted. A non-null `name` MUST resolve to an attachment under
// the slot in the default skin (the same referential rule the import validator's SLOT_ATTACHMENT_MISSING
// enforces); a null `name` hides the slot and is always legal. before/after are whole-channel mementos, so
// undo is bit-exact. Does NOT coalesce: a swap is discrete and stepped, not a continuous scrub (mirroring
// SetIkKeyframe, whose keyed edits are likewise discrete).
export class SetAttachmentKeyframeCommand implements Command {
  readonly kind = 'anim.attachment.set';
  readonly label = 'Set Attachment Keyframe';
  private before: readonly AttachmentFrameEntity[] | undefined;
  private after: readonly AttachmentFrameEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly slotId: SlotId,
    private readonly time: number,
    private readonly name: string | null,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      if (!ctx.mutate.getSlot(this.slotId)) {
        throw new CommandTargetMissingError(this.kind, this.slotId);
      }
      // A non-null swap target must resolve to an attachment on this slot in the default skin (the
      // author-time mirror of the import validator's SLOT_ATTACHMENT_MISSING); null hides the slot and
      // needs no attachment.
      if (this.name !== null && !ctx.mutate.getAttachment(this.slotId, this.name)) {
        throw new CommandTargetMissingError(this.kind, this.name);
      }
      const channel = animation.slots.get(this.slotId)?.attachment ?? [];
      this.before = channel;
      const existing = channel.find((frame) => frame.time === this.time);
      if (existing) {
        const updated = makeAttachmentFrame(existing.id, existing.time, this.name);
        this.after = channel.map((frame) => (frame.id === existing.id ? updated : frame));
      } else {
        const inserted = makeAttachmentFrame(ctx.ids.mint('keyframe'), this.time, this.name);
        this.after = [...channel, inserted].sort((a, b) => a.time - b.time);
      }
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

export const setAttachmentKeyframeSpec: CommandSpec = {
  kind: 'anim.attachment.set',
  // 'rigged' has an animation ('move') whose mesh_slot attachment timeline already carries two frames, so
  // an insert at the midpoint of the first two is a free time, in range, with a real delta; mesh_slot's
  // 'panel' attachment resolves the referential check.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    for (const animation of model.animations()) {
      for (const slot of model.slots()) {
        const frames = animation.slots.get(slot.id)?.attachment ?? [];
        if (frames.length < 2) continue;
        const time = (frames[0]!.time + frames[1]!.time) / 2;
        const att = model.attachments(slot.id)[0];
        const name = att ? att.name : null;
        return { command: new SetAttachmentKeyframeCommand(animation.id, slot.id, time, name) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    for (const animBefore of before.animations) {
      for (const track of animBefore.slots) {
        if (track.attachment.length < 2) continue;
        const beforeCount = countAttachmentFrames(
          findAnimationSnapshot(before, animBefore.id),
          track.slotId,
        );
        const afterCount = countAttachmentFrames(
          findAnimationSnapshot(after, animBefore.id),
          track.slotId,
        );
        if (afterCount !== beforeCount + 1) {
          throw new Error('anim.attachment.set did not insert exactly one attachment frame');
        }
        return;
      }
    }
    throw new Error('anim.attachment.set fixture seed had no attachment timeline');
  },
};

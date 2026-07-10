import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SequenceKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete a slot frame-sequence keyframe by id (`anim.sequence.delete`, PP-D10). A missing id is a typed
// CommandTargetMissingError before any mutation. before/after are whole-channel mementos; an empty result
// prunes the channel (and the slot entry when nothing else remains), exactly reversed on undo. Never coalesces.
export class DeleteSequenceKeyframeCommand implements Command {
  readonly kind = 'anim.sequence.delete';
  readonly label = 'Delete Sequence Keyframe';
  private before: readonly SequenceKeyframeEntity[] | undefined;
  private after: readonly SequenceKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly slotId: SlotId,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.slots.get(this.slotId)?.sequence ?? [];
      if (!channel.some((k) => k.id === this.keyframeId)) {
        throw new CommandTargetMissingError(this.kind, this.keyframeId);
      }
      this.before = channel;
      this.after = channel.filter((k) => k.id !== this.keyframeId);
    }
    ctx.mutate.setSlotSequenceChannel(this.animId, this.slotId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotSequenceChannel(this.animId, this.slotId, this.before);
  }
}

export const deleteSequenceKeyframeSpec: CommandSpec = {
  kind: 'anim.sequence.delete',
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!animation) return null;
    for (const slot of model.slots()) {
      const seq = animation.slots.get(slot.id)?.sequence ?? [];
      if (seq.length === 0) continue;
      return { command: new DeleteSequenceKeyframeCommand(animation.id, slot.id, seq[0]!.id) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('anim.sequence.delete fixture seed had no animations');
    for (const track of animBefore.slots) {
      if (track.sequence.length === 0) continue;
      const a = findAnimationSnapshot(after, animBefore.id)?.slots.find(
        (t) => t.slotId === track.slotId,
      );
      const afterLen = a ? a.sequence.length : 0;
      if (afterLen !== track.sequence.length - 1) {
        throw new Error('anim.sequence.delete did not remove exactly one key');
      }
      return;
    }
    throw new Error('anim.sequence.delete fixture seed had no sequence timeline');
  },
};

import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import { makeSequenceKeyframe, type SequenceKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move a slot frame-sequence keyframe to a new time (`anim.sequence.move`, PP-D10). Targets the key by
// KeyframeId, re-sorts the channel, preserves mode/index/delay, and REJECTS a move onto a time another key
// already occupies with a typed KeyframeCollisionError thrown before any mutation (sequence times are
// strict-ascending). Session coalescing collapses a dopesheet drag to one undo step; before/after are
// whole-channel mementos, so undo is bit-exact.
export class MoveSequenceKeyframeCommand implements Command {
  readonly kind = 'anim.sequence.move';
  readonly label = 'Move Sequence Keyframe';
  private before: readonly SequenceKeyframeEntity[] | undefined;
  private after: readonly SequenceKeyframeEntity[] = [];

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
      const channel = animation.slots.get(this.slotId)?.sequence ?? [];
      const moving = channel.find((k) => k.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (channel.some((k) => k.id !== this.keyframeId && k.time === this.newTime)) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = channel;
      const moved = makeSequenceKeyframe(
        moving.id,
        this.newTime,
        moving.mode,
        moving.index,
        moving.delay,
      );
      this.after = channel
        .map((k) => (k.id === this.keyframeId ? moved : k))
        .sort((a, b) => a.time - b.time);
    }
    ctx.mutate.setSlotSequenceChannel(this.animId, this.slotId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotSequenceChannel(this.animId, this.slotId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveSequenceKeyframeCommand &&
      prev.animId === this.animId &&
      prev.slotId === this.slotId &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MoveSequenceKeyframeCommand(
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

function sequenceTimes(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  slotId: string,
): number[] {
  if (snapshot === undefined) return [];
  const track = snapshot.slots.find((t) => t.slotId === slotId);
  return track ? track.sequence.map((k) => k.time) : [];
}

export const moveSequenceKeyframeSpec: CommandSpec = {
  kind: 'anim.sequence.move',
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!animation) return null;
    for (const slot of model.slots()) {
      const seq = animation.slots.get(slot.id)?.sequence ?? [];
      if (seq.length < 2) continue;
      const last = seq[seq.length - 1]!;
      const prev = seq[seq.length - 2]!;
      const newTime = (prev.time + last.time) / 2;
      return { command: new MoveSequenceKeyframeCommand(animation.id, slot.id, last.id, newTime) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('anim.sequence.move fixture seed had no animations');
    for (const track of animBefore.slots) {
      if (track.sequence.length < 2) continue;
      const b = sequenceTimes(findAnimationSnapshot(before, animBefore.id), track.slotId);
      const a = sequenceTimes(findAnimationSnapshot(after, animBefore.id), track.slotId);
      if (a.length !== b.length) throw new Error('anim.sequence.move changed the key count');
      if (a.join(',') === b.join(',')) throw new Error('anim.sequence.move produced no time delta');
      for (let i = 1; i < a.length; i += 1) {
        if (a[i]! <= a[i - 1]!) throw new Error('anim.sequence.move left the channel out of order');
      }
      return;
    }
    throw new Error('anim.sequence.move fixture seed had no sequence timeline');
  },
};

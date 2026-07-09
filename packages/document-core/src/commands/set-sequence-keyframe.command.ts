import type { SequenceMode } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import { makeSequenceKeyframe, type SequenceKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

function sortByTime(keys: readonly SequenceKeyframeEntity[]): SequenceKeyframeEntity[] {
  return [...keys].sort((a, b) => a.time - b.time);
}

// Insert-or-update a slot frame-sequence keyframe (`anim.sequence.set`, PP-D10; ADR-0009 section 3). If a key
// already exists at exactly `time`, its mode/index/delay are updated (its id is kept); otherwise a new key is
// minted and inserted, keeping the sequence timeline strict-ascending in time. before/after are whole-channel
// mementos; it COALESCES on the touched KeyframeId, so editing the same key's playback params during one
// gesture folds to a single undo step. The slot must exist; the format does not require the slot carry a
// sequence attachment at that time (that is solve state, ADR-0009 section 3), so no referential check is added.
export class SetSequenceKeyframeCommand implements Command {
  readonly kind = 'anim.sequence.set';
  readonly label = 'Set Sequence Keyframe';
  private before: readonly SequenceKeyframeEntity[] | undefined;
  private after: readonly SequenceKeyframeEntity[] = [];
  private touchedId: KeyframeId | undefined;

  constructor(
    private readonly animId: AnimationId,
    private readonly slotId: SlotId,
    private readonly time: number,
    private readonly mode: SequenceMode,
    private readonly index: number,
    private readonly delay: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      if (!ctx.mutate.getSlot(this.slotId)) throw new CommandTargetMissingError(this.kind, this.slotId);
      const channel = animation.slots.get(this.slotId)?.sequence ?? [];
      this.before = channel;
      const existing = channel.find((k) => k.time === this.time);
      if (existing) {
        this.touchedId = existing.id;
        const updated = makeSequenceKeyframe(existing.id, existing.time, this.mode, this.index, this.delay);
        this.after = sortByTime(channel.map((k) => (k.id === existing.id ? updated : k)));
      } else {
        const id = ctx.ids.mint('keyframe');
        this.touchedId = id;
        const inserted = makeSequenceKeyframe(id, this.time, this.mode, this.index, this.delay);
        this.after = sortByTime([...channel, inserted]);
      }
    }
    ctx.mutate.setSlotSequenceChannel(this.animId, this.slotId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotSequenceChannel(this.animId, this.slotId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetSequenceKeyframeCommand &&
      prev.animId === this.animId &&
      prev.slotId === this.slotId &&
      prev.touchedId !== undefined &&
      prev.touchedId === this.touchedId
    ) {
      const merged = new SetSequenceKeyframeCommand(
        this.animId,
        this.slotId,
        this.time,
        this.mode,
        this.index,
        this.delay,
      );
      merged.before = prev.before;
      merged.after = this.after;
      merged.touchedId = this.touchedId;
      return merged;
    }
    return null;
  }
}

function sequenceCount(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  slotId: string,
): number {
  if (snapshot === undefined) return 0;
  const track = snapshot.slots.find((t) => t.slotId === slotId);
  return track ? track.sequence.length : 0;
}

export const setSequenceKeyframeSpec: CommandSpec = {
  kind: 'anim.sequence.set',
  // 'rigged' has an animation ('move') with a slot ('mesh_slot') carrying a sequence timeline; inserting at a
  // free time (0.75) between the existing keys is a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!animation) return null;
    for (const slot of model.slots()) {
      const seq = animation.slots.get(slot.id)?.sequence ?? [];
      if (seq.length === 0) continue;
      return { command: new SetSequenceKeyframeCommand(animation.id, slot.id, 0.75, 'loop', 0, 0.1) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (animBefore === undefined) throw new Error('anim.sequence.set fixture seed had no animations');
    for (const track of animBefore.slots) {
      if (track.sequence.length === 0) continue;
      const b = sequenceCount(findAnimationSnapshot(before, animBefore.id), track.slotId);
      const a = sequenceCount(findAnimationSnapshot(after, animBefore.id), track.slotId);
      if (a !== b + 1) throw new Error('anim.sequence.set did not insert exactly one sequence key');
      return;
    }
    throw new Error('anim.sequence.set fixture seed had no sequence timeline');
  },
};

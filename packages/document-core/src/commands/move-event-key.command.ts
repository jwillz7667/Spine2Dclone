import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import { makeEventKey, type EventKeyEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import { sortEventKeysByTime } from './event-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move an event-timeline key to a new time (command-history Stage F1, `event.key.move`; PP-D9). Targets the
// key by KeyframeId and re-sorts the timeline. There is NO collision check: event times are non-decreasing,
// so two events MAY legitimately fire at the same time (ADR-0008 section 2). Session coalescing collapses a
// dopesheet drag to one undo step; before/after are whole-timeline mementos.
export class MoveEventKeyCommand implements Command {
  readonly kind = 'event.key.move';
  readonly label = 'Move Event Key';
  private before: readonly EventKeyEntity[] | undefined;
  private after: readonly EventKeyEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const moving = animation.events.find((key) => key.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      this.before = animation.events;
      const moved = makeEventKey(moving.id, this.newTime, moving.event, {
        int: moving.int,
        float: moving.float,
        string: moving.string,
      });
      this.after = sortEventKeysByTime(
        animation.events.map((key) => (key.id === this.keyframeId ? moved : key)),
      );
    }
    ctx.mutate.setEventTimeline(this.animId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setEventTimeline(this.animId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveEventKeyCommand &&
      prev.animId === this.animId &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MoveEventKeyCommand(this.animId, this.keyframeId, this.newTime);
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

export const moveEventKeySpec: CommandSpec = {
  kind: 'event.key.move',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    const key = animation.events[0];
    if (!key) return null;
    // Move the first event key to a free time (0.1), staying in range with a real delta.
    return { command: new MoveEventKeyCommand(animation.id, key.id, 0.1) };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('event.key.move fixture seed had no animations');
    const b = findAnimationSnapshot(before, target.id)?.events ?? [];
    const a = findAnimationSnapshot(after, target.id)?.events ?? [];
    if (a.length !== b.length) throw new Error('event.key.move changed the key count');
    if (a.map((k) => k.time).join(',') === b.map((k) => k.time).join(',')) {
      throw new Error('event.key.move produced no time delta');
    }
  },
};

import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { EventKeyEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete an event-timeline key by KeyframeId (command-history Stage F1, `event.key.delete`; PP-D9). The
// before memento is the whole timeline (which carries the removed key's time, event, and overrides), so
// undo restores it exactly. Never coalesces.
export class DeleteEventKeyCommand implements Command {
  readonly kind = 'event.key.delete';
  readonly label = 'Delete Event Key';
  private before: readonly EventKeyEntity[] | undefined;
  private after: readonly EventKeyEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      if (!animation.events.some((key) => key.id === this.keyframeId)) {
        throw new CommandTargetMissingError(this.kind, this.keyframeId);
      }
      this.before = animation.events;
      this.after = animation.events.filter((key) => key.id !== this.keyframeId);
    }
    ctx.mutate.setEventTimeline(this.animId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setEventTimeline(this.animId, this.before);
  }
}

export const deleteEventKeySpec: CommandSpec = {
  kind: 'event.key.delete',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    const key = animation.events[0];
    if (!key) return null;
    return { command: new DeleteEventKeyCommand(animation.id, key.id) };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('event.key.delete fixture seed had no animations');
    const b = findAnimationSnapshot(before, target.id)?.events.length ?? 0;
    const a = findAnimationSnapshot(after, target.id)?.events.length ?? 0;
    if (a !== b - 1) throw new Error('event.key.delete did not remove exactly one event key');
  },
};

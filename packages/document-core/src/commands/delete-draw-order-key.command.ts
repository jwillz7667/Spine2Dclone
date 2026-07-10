import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { DrawOrderKeyEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete a draw-order timeline key by KeyframeId (command-history Stage F1, `draworder.key.delete`; PP-D9).
// The before memento is the whole timeline (which carries the removed key's time and offsets), so undo
// restores it exactly. Never coalesces.
export class DeleteDrawOrderKeyCommand implements Command {
  readonly kind = 'draworder.key.delete';
  readonly label = 'Delete Draw Order Key';
  private before: readonly DrawOrderKeyEntity[] | undefined;
  private after: readonly DrawOrderKeyEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      if (!animation.drawOrder.some((key) => key.id === this.keyframeId)) {
        throw new CommandTargetMissingError(this.kind, this.keyframeId);
      }
      this.before = animation.drawOrder;
      this.after = animation.drawOrder.filter((key) => key.id !== this.keyframeId);
    }
    ctx.mutate.setDrawOrderTimeline(this.animId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setDrawOrderTimeline(this.animId, this.before);
  }
}

export const deleteDrawOrderKeySpec: CommandSpec = {
  kind: 'draworder.key.delete',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    const key = animation.drawOrder[0];
    if (!key) return null;
    return { command: new DeleteDrawOrderKeyCommand(animation.id, key.id) };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined)
      throw new Error('draworder.key.delete fixture seed had no animations');
    const b = findAnimationSnapshot(before, target.id)?.drawOrder.length ?? 0;
    const a = findAnimationSnapshot(after, target.id)?.drawOrder.length ?? 0;
    if (a !== b - 1)
      throw new Error('draworder.key.delete did not remove exactly one draw-order key');
  },
};
